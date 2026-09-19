from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any
from uuid import UUID

import asyncpg

from app.domain.entities import AnalysisStatus, Encounter, NewEncounter
from app.domain.errors import ConflictError

_COLUMNS = """
    id, patient_id, owner_id, occurred_at, reason,
    analysis_status, created_at, updated_at
"""

# A avaliação articular virou tabela (`avaliacao_articular`), e esta subconsulta a
# devolve na forma que o contrato da API sempre teve:
#
#     {"RIGHT_MCP_3": {"pain": true, "swelling": false}, ...}
#
# É o que mantém `EncounterOut` e o frontend intocados: o banco guarda linhas, a API
# continua falando documento. Sem avaliação nenhuma o agregado é NULL, que é
# exatamente o que a coluna antiga guardava para consulta sem body map.
_AVALIACOES = """
    (SELECT jsonb_object_agg(a.joint_id,
            jsonb_build_object('pain', a.pain, 'swelling', a.swelling))
       FROM public.encounter_joint_evaluations a
      WHERE a.encounter_id = public.encounters.id) AS joint_evaluations"""

# Os escores viraram tabela (`escores_clinicos`) e voltam na forma que o contrato tem:
#
#     {"cdai": {"score": 12.5, "level": "moderate", ...}, "das28": {...}}
#
# `to_jsonb(s)` devolve a linha inteira; tiram-se as três colunas de escrituração e
# `jsonb_strip_nulls` remove as do OUTRO índice, que numa linha de CDAI estão nulas por
# construção. É o que faz o objeto sair com exatamente os campos daquele índice.
#
# `coalesce` para objeto vazio, e não NULL: `scores` sempre foi `not null default '{}'`,
# e consulta sem escore devolve `{}`. Distingue "não calculou" de "não tem o campo".
_ESCORES = """
    COALESCE((SELECT jsonb_object_agg(s.index_type,
              jsonb_strip_nulls(to_jsonb(s) - 'encounter_id' - 'index_type' - 'owner_id'))
       FROM public.encounter_scores s
      WHERE s.encounter_id = public.encounters.id), '{}'::jsonb) AS scores"""

# Nas leituras vão junto quem registrou a consulta e o que este chamador pode fazer
# com ela. Mesmas funções que as policies chamam, pelo mesmo motivo de
# `repositories/patients.py`: a tela erra junto com a policy, ou acerta junto.
#
# `author_name` só é diferente do dono no acervo de pesquisa, onde a consulta que um
# pesquisador registra no paciente de um par nasce com o owner do par. Fora dele vem
# NULL, porque `app.user_display_name()` cala sobre as linhas do próprio chamador.
_DERIVADAS = """
    app.user_display_name(created_by) AS author_name,
    app.can_curate(owner_id)  AS can_edit,
    app.can_discard(owner_id) AS can_delete"""

# Leitura traz a avaliação articular reagrupada; escrita não. No INSERT as linhas filhas
# ainda não existem — elas dependem do id que a própria instrução acabou de gerar —,
# então o agregado viria NULL e mentiria sobre o que foi gravado. `create` devolve a
# avaliação que ele mesmo escreveu.
_COLUMNS_DE_LEITURA = f"{_COLUMNS.rstrip()},{_AVALIACOES},{_ESCORES},{_DERIVADAS}"
_COLUMNS_DE_ESCRITA = f"{_COLUMNS.rstrip()},{_DERIVADAS}"


def _encode(value: Mapping[str, Any] | None) -> str | None:
    """asyncpg não converte dict para jsonb sozinho; o SQL faz o cast de $n::jsonb."""
    return None if value is None else json.dumps(value)


def _decode(value: str | None) -> Any:
    """asyncpg devolve jsonb como texto se nenhum codec estiver registrado.

    Decodificar aqui, e não com um `set_type_codec` no pool, mantém a conversão no
    único módulo que já conhece o driver — e evita que a sessão sob RLS ganhe mais
    um passo de setup por conexão.
    """
    return json.loads(value) if isinstance(value, str) else value


def _to_entity(row: asyncpg.Record) -> Encounter:
    return Encounter(
        id=row["id"],
        patient_id=row["patient_id"],
        owner_id=row["owner_id"],
        occurred_at=row["occurred_at"],
        reason=row["reason"],
        # Ausente nos caminhos de escrita, que não reagrupam a tabela filha.
        joint_evaluations=_decode(row.get("joint_evaluations")),
        scores=_decode(row.get("scores")) or {},
        analysis_status=(
            AnalysisStatus(row["analysis_status"]) if row["analysis_status"] else None
        ),
        capture_count=row.get("capture_count") or 0,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        # Ausentes nos caminhos de escrita, pela mesma razão de `Patient`: ali a linha
        # é a que o próprio chamador acabou de gravar.
        author_name=row.get("author_name"),
        can_edit=row.get("can_edit", True),
        can_delete=row.get("can_delete", True),
    )


class PostgresEncounterRepository:
    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    async def get(self, encounter_id: UUID) -> Encounter | None:
        # `capture_count` sai da mesma subconsulta da listagem: a consulta reaberta
        # precisa dizer quantas capturas tem antes de decidir baixá-las, e sem isto
        # o detalhe respondia sempre 0 — número errado, não ausência de número.
        row = await self._connection.fetchrow(
            f"""
            SELECT {_COLUMNS_DE_LEITURA},
                   (SELECT count(*) FROM public.analysis_captures c
                     WHERE c.encounter_id = public.encounters.id) AS capture_count
              FROM public.encounters
             WHERE id = $1
            """,
            encounter_id,
        )
        return _to_entity(row) if row else None

    async def start_analysis(self, encounter_id: UUID) -> Encounter | None:
        """Marca a consulta como tendo análise de imagem em envio.

        Sobrou só isto: os rótulos da sessão e os parâmetros saíram do schema, e o que
        resta é a transição de estado. `analysis_status` nasce 'uploading' porque as
        linhas das capturas existem e os bytes ainda não.
        """
        row = await self._connection.fetchrow(
            f"""
            UPDATE public.encounters SET analysis_status = 'uploading'
             WHERE id = $1
            RETURNING {_COLUMNS}
            """,
            encounter_id,
        )
        return _to_entity(row) if row else None

    async def delete(self, encounter_id: UUID) -> bool:
        # As capturas somem por cascata (analysis_captures.encounter_id ... on delete
        # cascade). Os objetos no R2 não — quem os apaga é o router, depois do commit.
        deleted = await self._connection.fetchval(
            "DELETE FROM public.encounters WHERE id = $1 RETURNING id", encounter_id
        )
        return deleted is not None

    async def set_analysis_status(self, encounter_id: UUID, status: str) -> bool:
        updated = await self._connection.fetchval(
            "UPDATE public.encounters SET analysis_status = $2 WHERE id = $1 RETURNING id",
            encounter_id,
            status,
        )
        return updated is not None

    async def list_for_patient(self, patient_id: UUID) -> Sequence[Encounter]:
        rows = await self._connection.fetch(
            f"""
            SELECT {_COLUMNS_DE_LEITURA},
                   (SELECT count(*) FROM public.analysis_captures c
                     WHERE c.encounter_id = public.encounters.id) AS capture_count
              FROM public.encounters
             WHERE patient_id = $1
             ORDER BY occurred_at DESC
            """,
            patient_id,
        )
        return [_to_entity(row) for row in rows]

    async def create(self, patient_id: UUID, data: NewEncounter) -> Encounter:
        # owner_id vem do trigger app.inherit_owner(), que copia do paciente lendo-o
        # sob a RLS de quem escreve. No acervo de pesquisa isso significa que a
        # consulta registrada no paciente de um par pertence ao PAR — por isso o
        # RETURNING traz as colunas derivadas, e não as cruas: devolvê-las no default
        # faria a tela oferecer excluir uma consulta que a policy não deixa apagar.
        #
        # O fluxo de Análise Térmica grava tudo numa instrução só: a consulta nasce
        # já com o body map e os escores. Não há passo intermediário no banco, então
        # abandonar o fluxo no meio não deixa consulta vazia no histórico.
        row = await self._connection.fetchrow(
            f"""
            INSERT INTO public.encounters (patient_id, occurred_at, reason)
            VALUES ($1, COALESCE($2, now()), $3)
            RETURNING {_COLUMNS_DE_ESCRITA}
            """,
            patient_id,
            data.occurred_at,
            data.reason,
        )

        # A avaliação articular é gravada em seguida, e não na mesma instrução: ela
        # depende do id que o INSERT acabou de gerar, e o trigger de posse lê a consulta
        # no banco para herdar o dono. Numa CTE única a linha-pai ainda não estaria
        # visível para o trigger, e ele abortaria sem achar o pai.
        #
        # O fan-out acontece no SQL, a partir do mesmo documento que a API recebeu: uma
        # instrução, N linhas, e a chave estrangeira conferindo cada articulação.
        if data.joint_evaluations:
            try:
                await self._connection.execute(
                    """
                    INSERT INTO public.encounter_joint_evaluations
                        (encounter_id, joint_id, pain, swelling)
                    SELECT $1, chave,
                           (valor->>'pain')::boolean,
                           (valor->>'swelling')::boolean
                      FROM jsonb_each($2::jsonb) AS t(chave, valor)
                    """,
                    row["id"],
                    _encode(data.joint_evaluations),
                )
            except asyncpg.ForeignKeyViolationError as exc:
                raise _articulacao_desconhecida(data.joint_evaluations) from exc

        # Os escores seguem o mesmo caminho da avaliação articular: fan-out em SQL a
        # partir do documento que a API recebeu. As colunas de um índice ficam nulas na
        # linha do outro — `valor->>'acute_phase'` numa linha de CDAI é NULL —, e é a
        # restrição `escore_completo` que garante que isso seja a forma certa, e não
        # esquecimento.
        if data.scores:
            await self._connection.execute(
                """
                INSERT INTO public.encounter_scores
                    (encounter_id, index_type, score, level, tender_count, swollen_count,
                     patient_global, evaluator_global,
                     acute_phase, acute_value, patient_global_health)
                SELECT $1, chave,
                       (valor->>'score')::numeric,
                       valor->>'level',
                       (valor->>'tender_count')::smallint,
                       (valor->>'swollen_count')::smallint,
                       (valor->>'patient_global')::numeric,
                       (valor->>'evaluator_global')::numeric,
                       valor->>'acute_phase',
                       (valor->>'acute_value')::numeric,
                       (valor->>'patient_global_health')::numeric
                  FROM jsonb_each($2::jsonb) AS t(chave, valor)
                """,
                row["id"],
                _encode(data.scores),
            )

        # A entidade sai com o que ACABOU de ser gravado. Reler os agregados custaria uma
        # ida a mais ao banco para descobrir o que esta função escreveu.
        return replace(
            _to_entity(row),
            joint_evaluations=data.joint_evaluations,
            scores=data.scores or {},
        )


def _articulacao_desconhecida(avaliacoes: Mapping[str, Any]) -> ConflictError:
    """Traduz a violação da chave estrangeira para `public.joints`.

    Antes desta tabela existir, um id de articulação inválido era gravado em silêncio: o
    schema da borda valida só o formato, e o jsonb aceitava qualquer chave. Agora o banco
    recusa, e a recusa precisa dizer QUAL id está fora do catálogo — senão o cliente
    recebe 409 sobre um payload de 28 articulações sem saber onde olhar.

    Os candidatos saem do próprio payload, e não da exceção: a mensagem do Postgres traz
    o nome da constraint, não o valor. Listar os que não parecem do catálogo é o mais
    perto que dá para chegar sem uma consulta a mais.
    """
    return ConflictError(
        f"há articulação fora do catálogo na avaliação: {', '.join(sorted(avaliacoes))}"
    )
