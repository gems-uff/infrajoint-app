from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

import asyncpg

from app.domain.entities import Capture, CaptureFile, FileKind
from app.domain.errors import ConflictError

# Ordem fixa das colunas do INSERT. Nenhum nome vem do cliente — o schema Pydantic do
# router valida os campos, e esta lista é a única que o SQL conhece.
_INSERT_COLUMNS = (
    "capture_index",
    "elapsed_seconds",
    "align_a",
    "align_b",
    "align_tx",
    "align_c",
    "align_d",
    "align_ty",
    "alignment_method",
    "agreement",
    "fiducial_correction",
    "issue",
)

# Colunas jsonb da própria captura: o asyncpg não converte dict/list sozinho, o SQL faz
# o cast. `measurements` saiu daqui quando virou tabela (`medicoes_das_rois`); ele
# continua entrando e saindo como array na borda, mas por fan-out e agregado.
_JSON_COLUMNS = frozenset({"agreement", "fiducial_correction"})

# As colunas da medição, na ordem do INSERT. O nome de cada uma é também a chave que a
# borda valida em `CaptureMeasurementIn`, e é o que permite o fan-out ser genérico.
_MEASUREMENT_COLUMNS = (
    "joint_id",
    "t_mean",
    "t_median",
    "t_min",
    "t_max",
    "area",
    "sample_count",
    "shape",
    "rgb_x",
    "rgb_y",
    "csv_x",
    "csv_y",
    "rx_csv",
    "ry_csv",
    "edited",
)

# Tipos que o cast de texto precisa saber, porque `jsonb_array_elements` devolve tudo
# como jsonb e `->>` sempre entrega texto.
_MEASUREMENT_CASTS = {
    "joint_id": "text",
    "shape": "text",
    "area": "integer",
    "sample_count": "integer",
    "edited": "boolean",
}

# As medições de uma captura, reagrupadas na forma de array que o contrato sempre teve.
# `to_jsonb(m)` devolve a linha inteira; tiram-se as duas colunas de escrituração.
_MEDICOES = """
    COALESCE((SELECT jsonb_agg(to_jsonb(m) - 'capture_id' - 'owner_id'
                               ORDER BY m.joint_id)
       FROM public.capture_measurements m
      WHERE m.capture_id = public.analysis_captures.id), '[]'::jsonb) AS measurements"""


def _to_entity(row: asyncpg.Record) -> Capture:
    return Capture(
        id=row["id"],
        encounter_id=row["encounter_id"],
        owner_id=row["owner_id"],
        capture_index=row["capture_index"],
    )


def _to_files(rows: Sequence[asyncpg.Record]) -> list[CaptureFile]:
    """Deriva as três chaves de bucket de cada linha de captura.

    Os três `FileKind` são a lista de arquivos de qualquer captura — o schema de
    entrada não aceita menos —, então não há uma coluna a consultar. Chave que nunca
    subiu não atrapalha: o `delete` do R2 trata ausência como sucesso.

    As duas listagens — por paciente e por consulta — diferem só no recorte do WHERE;
    a expansão é esta, e é onde estaria o bug de apagar a chave errada.
    """
    return [
        CaptureFile(
            owner_id=row["owner_id"],
            encounter_id=row["encounter_id"],
            capture_id=row["id"],
            kind=kind,
        )
        for row in rows
        for kind in FileKind
    ]


class PostgresCaptureRepository:
    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    async def create_many(
        self, encounter_id: UUID, captures: Sequence[Mapping[str, Any]]
    ) -> Sequence[Capture]:
        """Insere as N capturas numa instrução só.

        Um INSERT por captura custaria N idas ao banco — 21 numa sequência, e o
        Postgres está em outro continente. Aqui é uma ida, dentro da transação que a
        sessão sob RLS já abriu.

        `owner_id` não aparece: o trigger app.inherit_owner() o deriva da consulta,
        lendo-a sob a RLS de quem escreve. É essa leitura que impede anexar captura à
        consulta de outro médico.
        """
        if not captures:
            return []

        colunas = ", ".join(("encounter_id", *_INSERT_COLUMNS))
        valores: list[Any] = []
        linhas: list[str] = []
        for captura in captures:
            marcadores = [f"${len(valores) + 1}"]
            valores.append(encounter_id)
            for coluna in _INSERT_COLUMNS:
                bruto = captura.get(coluna)
                if coluna in _JSON_COLUMNS:
                    valores.append(None if bruto is None else json.dumps(bruto))
                    marcadores.append(f"${len(valores)}::jsonb")
                else:
                    valores.append(bruto)
                    marcadores.append(f"${len(valores)}")
            linhas.append(f"({', '.join(marcadores)})")

        rows = await self._connection.fetch(
            f"""
            INSERT INTO public.analysis_captures ({colunas})
            VALUES {", ".join(linhas)}
            RETURNING id, encounter_id, owner_id, capture_index
            """,
            *valores,
        )

        await self._gravar_medicoes(rows, captures)
        return [_to_entity(row) for row in rows]

    async def _gravar_medicoes(
        self, rows: Sequence[asyncpg.Record], captures: Sequence[Mapping[str, Any]]
    ) -> None:
        """Distribui as medições das capturas em linhas de `capture_measurements`.

        O casamento é por `capture_index`, e não pela ordem do RETURNING — mesma razão
        pela qual as URLs assinadas já se casavam assim: depender da ordem do INSERT
        gravaria a medição de uma captura sob o id de outra no dia em que ela mudasse.

        Tudo numa instrução só. São 22 medições por captura e até 21 capturas: um INSERT
        por medição seriam 462 idas ao banco.
        """
        por_indice = {row["capture_index"]: row["id"] for row in rows}

        medicoes: list[dict[str, Any]] = []
        for captura in captures:
            id_captura = por_indice.get(captura.get("capture_index"))
            if id_captura is None:
                continue
            for medicao in captura.get("measurements") or []:
                medicoes.append({**dict(medicao), "capture_id": str(id_captura)})

        if not medicoes:
            return

        seletores = ", ".join(
            f"(m->>'{coluna}')::{_MEASUREMENT_CASTS.get(coluna, 'numeric')}"
            for coluna in _MEASUREMENT_COLUMNS
        )
        try:
            await self._connection.execute(
                f"""
                INSERT INTO public.capture_measurements
                    (capture_id, {", ".join(_MEASUREMENT_COLUMNS)})
                SELECT (m->>'capture_id')::uuid, {seletores}
                  FROM jsonb_array_elements($1::jsonb) AS m
                """,
                json.dumps(medicoes),
            )
        except asyncpg.ForeignKeyViolationError as exc:
            desconhecidas = sorted({str(m.get("joint_id")) for m in medicoes})
            raise ConflictError(
                f"há articulação fora do catálogo nas medições: {', '.join(desconhecidas)}"
            ) from exc

    async def list_detail_for_encounter(self, encounter_id: UUID) -> Sequence[Mapping[str, Any]]:
        rows = await self._connection.fetch(
            f"""
            SELECT id, owner_id, {", ".join(_INSERT_COLUMNS)}, {_MEDICOES}
              FROM public.analysis_captures
             WHERE encounter_id = $1
             ORDER BY capture_index
            """,
            encounter_id,
        )
        capturas: list[Mapping[str, Any]] = []
        for row in rows:
            registro = dict(row)
            for coluna in (*_JSON_COLUMNS, "measurements"):
                bruto = registro.get(coluna)
                if isinstance(bruto, str):
                    registro[coluna] = json.loads(bruto)
            capturas.append(registro)
        return capturas

    async def list_files_for_patient(self, patient_id: UUID) -> Sequence[CaptureFile]:
        rows = await self._connection.fetch(
            """
            SELECT c.id, c.encounter_id, c.owner_id
              FROM public.analysis_captures c
              JOIN public.encounters e ON e.id = c.encounter_id
             WHERE e.patient_id = $1
            """,
            patient_id,
        )
        return _to_files(rows)

    async def list_files_for_encounter(self, encounter_id: UUID) -> Sequence[CaptureFile]:
        rows = await self._connection.fetch(
            """
            SELECT id, encounter_id, owner_id
              FROM public.analysis_captures
             WHERE encounter_id = $1
            """,
            encounter_id,
        )
        return _to_files(rows)

    async def list_for_encounter(self, encounter_id: UUID) -> Sequence[Capture]:
        rows = await self._connection.fetch(
            """
            SELECT id, encounter_id, owner_id, capture_index
              FROM public.analysis_captures
             WHERE encounter_id = $1
             ORDER BY capture_index
            """,
            encounter_id,
        )
        return [_to_entity(row) for row in rows]
