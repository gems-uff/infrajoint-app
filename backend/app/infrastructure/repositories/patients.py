from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any
from uuid import UUID

import asyncpg

from app.domain.entities import Diagnosis, NewPatient, Patient, Sex, StudyGroup
from app.domain.errors import ConflictError

# O índice único da migration `patients_sem_duplicado`: (owner_id, nome normalizado,
# birth_date). Violá-lo é erro de fluxo do cliente, não falha interna — traduzir aqui
# é o que evita que ele suba como 500 com nome de índice dentro.
_INDICE_DUPLICATA = "patients_sem_duplicado"
_MENSAGEM_DUPLICATA = (
    "já existe um paciente com este nome e esta data de nascimento no seu cadastro"
)

_COLUMNS = """
    id, owner_id, full_name, birth_date, sex,
    phone, study_group, created_at, updated_at
"""

# Os diagnósticos viraram relação (`diagnostico_e_grupo`) e voltam com o rótulo do
# catálogo junto, para a tela não precisar de um segundo request só para traduzir código.
# O principal vem primeiro; o resto em ordem de código, que é estável.
_DIAGNOSTICOS = """
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'code', d.code, 'label', d.label, 'is_primary', pd.is_primary)
                     ORDER BY pd.is_primary DESC, d.code)
       FROM public.patient_diagnoses pd
       JOIN public.diagnoses d ON d.code = pd.diagnosis_code
      WHERE pd.patient_id = public.patients.id), '[]'::jsonb) AS diagnoses"""

# Nas leituras vão junto o nome de quem é a linha, o de quem a editou por último e o
# que este chamador pode fazer com ela.
#
# As quatro colunas são calculadas pelo BANCO, pelas mesmas funções que as policies
# chamam. É de propósito: reimplementar `can_curate` em Python daria duas fontes da
# verdade para a mesma regra, e a que aparece na tela seria a errada no dia em que
# divergissem. Aqui a tela erra junto com a policy, ou acerta junto.
#
# Os nomes são SECURITY DEFINER e só respondem a quem já enxerga o prontuário inteiro
# daquela pessoa (admin ou par de pool), nunca nas linhas do próprio chamador — ver
# `app.user_display_name()`. Para um médico comum os dois vêm NULL, que é o certo: ele
# só enxerga os próprios pacientes, e o rótulo repetiria o nome dele em toda linha.
_COLUMNS_DE_LEITURA = f"""{_COLUMNS.rstrip()},{_DIAGNOSTICOS},
    app.owner_display_name(owner_id) AS owner_name,
    app.user_display_name(updated_by) AS editor_name,
    app.can_curate(owner_id)  AS can_edit,
    app.can_discard(owner_id) AS can_delete"""

# Whitelist de colunas editáveis. O nome vem do schema Pydantic do router, mas o SQL
# é montado por interpolação — então a lista precisa existir aqui, na única camada
# que conhece nomes de coluna.
_UPDATABLE = frozenset(
    {
        "full_name",
        "birth_date",
        "sex",
        "phone",
        "study_group",
    }
)

# `diagnoses` não é coluna: é a tabela de vínculo, tratada à parte no UPDATE.
_RELACAO = "diagnoses"


def _diagnosticos(bruto: Any) -> tuple[Diagnosis, ...]:
    """O agregado do banco vira entidades. Ausente nos caminhos de escrita."""
    if bruto is None:
        return ()
    linhas = json.loads(bruto) if isinstance(bruto, str) else bruto
    return tuple(
        Diagnosis(code=d["code"], is_primary=d["is_primary"], label=d.get("label")) for d in linhas
    )


def _to_entity(row: asyncpg.Record) -> Patient:
    return Patient(
        id=row["id"],
        owner_id=row["owner_id"],
        full_name=row["full_name"],
        birth_date=row["birth_date"],
        sex=Sex(row["sex"]) if row["sex"] else None,
        phone=row["phone"],
        study_group=StudyGroup(row["study_group"]) if row["study_group"] else None,
        diagnoses=_diagnosticos(row.get("diagnoses")),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        # Ausentes nos caminhos de escrita, que não selecionam as colunas — e ali a
        # resposta é sobre a linha que o próprio chamador acabou de gravar.
        owner_name=row.get("owner_name"),
        editor_name=row.get("editor_name"),
        can_edit=row.get("can_edit", True),
        can_delete=row.get("can_delete", True),
    )


class PostgresPatientRepository:
    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    async def list_all(self) -> Sequence[Patient]:
        rows = await self._connection.fetch(
            f"SELECT {_COLUMNS_DE_LEITURA} FROM public.patients ORDER BY created_at DESC"
        )
        return [_to_entity(row) for row in rows]

    async def get(self, patient_id: UUID) -> Patient | None:
        row = await self._connection.fetchrow(
            f"SELECT {_COLUMNS_DE_LEITURA} FROM public.patients WHERE id = $1",
            patient_id,
        )
        return _to_entity(row) if row else None

    async def find_by_name(self, full_name: str) -> Sequence[Patient]:
        """Homônimos no acervo de quem cadastra, pelo nome normalizado.

        `app.can_curate(owner_id)` explícito, e não só a RLS: para o admin a RLS deixa
        ver todo mundo, e o aviso de duplicata passaria a falar de pacientes de outros
        médicos. Não é filtro vindo do chamador — é a mesma função que a policy de
        escrita usa, então o recorte é exatamente "os pacientes que eu poderia editar".

        No acervo de pesquisa isso inclui os dos pares, e é o comportamento certo: o
        aviso existe para oferecer *abrir o existente* em vez de criar um segundo
        cadastro da mesma pessoa, e num acervo compartilhado o cadastro que já existe
        costuma ser o de outra pessoa da equipe.

        O índice único continua sendo por dono (`patients_sem_duplicado`), então o
        homônimo de um par não é RECUSADO pelo banco, só avisado aqui. É a diferença
        entre as duas camadas, e ela é assumida: dois pesquisadores podem mesmo
        precisar de cadastros próprios do mesmo paciente.

        A comparação passa pela `app.normalized_name()` do índice único, então o que a
        tela avisa e o que o banco recusa são a mesma noção de "mesmo nome".
        """
        rows = await self._connection.fetch(
            f"""
            SELECT {_COLUMNS_DE_LEITURA} FROM public.patients
             WHERE app.can_curate(owner_id)
               AND app.normalized_name(full_name) = app.normalized_name($1)
             ORDER BY created_at DESC
            """,
            full_name,
        )
        return [_to_entity(row) for row in rows]

    async def create(self, data: NewPatient) -> Patient:
        # owner_id não aparece no INSERT: o trigger app.own_row() o define a partir de
        # auth.uid(). Enviá-lo daqui seria descartado de qualquer forma.
        #
        # RETURNING nas colunas cruas: paciente recém-criado é sempre do chamador, e os
        # defaults da entidade já dizem exatamente isso.
        try:
            row = await self._connection.fetchrow(
                f"""
                INSERT INTO public.patients
                    (full_name, birth_date, sex, phone, study_group)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING {_COLUMNS}
                """,
                data.full_name,
                data.birth_date,
                data.sex.value if data.sex else None,
                data.phone,
                data.study_group.value if data.study_group else None,
            )
        except asyncpg.UniqueViolationError as exc:
            raise _conflito(exc) from exc

        await self._gravar_diagnosticos(row["id"], data.diagnoses)
        return replace(_to_entity(row), diagnoses=tuple(data.diagnoses))

    async def _gravar_diagnosticos(
        self, patient_id: UUID, diagnosticos: Sequence[Diagnosis]
    ) -> None:
        """Substitui o conjunto de diagnósticos do paciente.

        Apaga e reinsere em vez de casar linha a linha: são poucos por paciente, e
        calcular a diferença aqui custaria mais código do que a operação inteira.

        A chave estrangeira para o catálogo é a fronteira real. Um código inexistente
        vira 409 com o código na mensagem, e não 500 com nome de constraint dentro.
        """
        await self._connection.execute(
            "DELETE FROM public.patient_diagnoses WHERE patient_id = $1", patient_id
        )
        if not diagnosticos:
            return

        try:
            await self._connection.execute(
                """
                INSERT INTO public.patient_diagnoses
                    (patient_id, diagnosis_code, is_primary)
                SELECT $1, d->>'code', (d->>'is_primary')::boolean
                  FROM jsonb_array_elements($2::jsonb) AS d
                """,
                patient_id,
                json.dumps([{"code": d.code, "is_primary": d.is_primary} for d in diagnosticos]),
            )
        except asyncpg.ForeignKeyViolationError as exc:
            codigos = ", ".join(sorted({d.code for d in diagnosticos}))
            raise ConflictError(f"há diagnóstico fora do catálogo: {codigos}") from exc
        except asyncpg.UniqueViolationError as exc:
            raise ConflictError("um paciente só pode ter um diagnóstico principal") from exc

    async def delete(self, patient_id: UUID) -> bool:
        # O ON DELETE CASCADE leva consultas, análises e capturas junto. O RETURNING
        # distingue "apagou" de "não havia linha visível" sem um SELECT antes.
        deleted = await self._connection.fetchval(
            "DELETE FROM public.patients WHERE id = $1 RETURNING id", patient_id
        )
        return deleted is not None

    async def update(self, patient_id: UUID, changes: Mapping[str, Any]) -> Patient | None:
        colunas = {k: v for k, v in changes.items() if k != _RELACAO}
        unknown = set(colunas) - _UPDATABLE
        if unknown:
            raise ValueError(f"colunas não editáveis: {sorted(unknown)}")

        # Só os diagnósticos mudaram: não há SET a montar, e um UPDATE sem coluna é SQL
        # inválido. A relação é gravada e a linha relida com o agregado novo.
        if not colunas:
            if _RELACAO in changes:
                await self._gravar_diagnosticos(patient_id, changes[_RELACAO])
            return await self.get(patient_id)

        assignments = ", ".join(f"{column} = ${i}" for i, column in enumerate(colunas, start=2))
        values = [
            value.value if isinstance(value, (Sex, StudyGroup)) else value
            for value in colunas.values()
        ]

        # A edição também esbarra no índice: renomear um paciente para o nome e a data
        # de outro é a mesma duplicata, chegando pelo outro caminho.
        #
        # O RETURNING traz as colunas de leitura, e não as cruas como no INSERT: quem
        # edita nem sempre é o dono desde o acervo de pesquisa, e devolver `can_delete`
        # no default faria a tela reexibir o botão de excluir logo depois de um par
        # salvar a edição — oferecendo justamente o que a policy vai recusar.
        try:
            row = await self._connection.fetchrow(
                f"""
                UPDATE public.patients SET {assignments}
                 WHERE id = $1
                RETURNING {_COLUMNS_DE_LEITURA}
                """,
                patient_id,
                *values,
            )
        except asyncpg.UniqueViolationError as exc:
            raise _conflito(exc) from exc

        if row is None:
            return None
        if _RELACAO in changes:
            await self._gravar_diagnosticos(patient_id, changes[_RELACAO])
            return await self.get(patient_id)
        return _to_entity(row)


def _conflito(exc: asyncpg.UniqueViolationError) -> Exception:
    """Traduz a violação do índice; qualquer outra continua subindo como está."""
    if exc.constraint_name == _INDICE_DUPLICATA:
        return ConflictError(_MENSAGEM_DUPLICATA)
    return exc
