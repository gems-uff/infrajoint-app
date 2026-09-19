from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.domain.entities import (
    AnalysisStatus,
    AuthenticatedUser,
    Capture,
    CaptureFile,
    FileKind,
)
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError
from app.domain.repositories import (
    CaptureRepository,
    EncounterRepository,
    ObjectStorage,
    PatientRepository,
)


@dataclass(frozen=True, slots=True)
class SignedUpload:
    capture_id: UUID
    capture_index: int | None
    kind: FileKind
    url: str


@dataclass(frozen=True, slots=True)
class CreatedAnalysis:
    captures: Sequence[Capture]
    uploads: Sequence[SignedUpload]


@dataclass(frozen=True, slots=True)
class CreateCaptures:
    """Grava a análise na consulta e devolve as URLs para o browser subir os arquivos.

    Uma consulta tem UMA análise, avulsa ou em sequência — a diferença é a
    cardinalidade das capturas, nunca um discriminador. Por isso este caso de uso
    recusa uma segunda chamada: repetir o POST criaria um segundo jogo de capturas
    sob a mesma consulta, e o cliente ficaria com URLs órfãs apontando para linhas
    que ninguém lê.
    """

    encounters: EncounterRepository
    captures: CaptureRepository
    storage: ObjectStorage

    async def execute(
        self,
        user: AuthenticatedUser,
        encounter_id: UUID,
        captures: Sequence[Mapping[str, Any]],
    ) -> CreatedAnalysis:
        if not user.is_clinician:
            raise ForbiddenError("apenas médicos e administradores gravam análises")

        # Resolver a consulta antes de escrever é o que transforma "consulta de outro
        # médico" em 404 em vez de deixar o trigger de posse vazar erro de banco.
        encounter = await self.encounters.get(encounter_id)
        if encounter is None:
            raise NotFoundError("consulta não encontrada")

        # Mesma regra da criação da consulta: quem grava a análise é quem pode
        # escrever na consulta — o dono, ou um par do acervo de pesquisa. O admin
        # enxerga a consulta alheia e não escreve nela, então o 404 acima não o pega —
        # e sem esta guarda ele receberia 500 vindo da policy de escrita das capturas.
        if not encounter.can_edit:
            raise ForbiddenError("apenas o responsável pela consulta grava a análise")

        if await self.captures.list_for_encounter(encounter_id):
            raise ConflictError("esta consulta já tem uma análise de imagem")

        if await self.encounters.start_analysis(encounter_id) is None:
            raise NotFoundError("consulta não encontrada")

        gravadas = await self.captures.create_many(encounter_id, captures)

        # O `content_type` vem do corpo da requisição, e não de uma coluna: ele é
        # usado só aqui, para assinar, na mesma chamada que o recebeu. Guardá-lo no
        # banco era ida e volta para buscar o que já estava na mão.
        #
        # O casamento é por `capture_index`, e não pela ordem do RETURNING: o índice é
        # único na consulta, e depender da ordem do INSERT assinaria a URL de uma
        # captura com o tipo declarado de outra no dia em que ela mudasse.
        declarados = {c.get("capture_index"): (c.get("files") or {}) for c in captures}

        # O endereço usa o owner_id que veio DA LINHA, não o id de quem chamou: se
        # algum dia os dois divergirem, o objeto ainda cai no prefixo do dono real.
        uploads = [
            SignedUpload(
                capture_id=capture.id,
                capture_index=capture.capture_index,
                kind=kind,
                url=self.storage.presign_put(
                    CaptureFile(capture.owner_id, encounter_id, capture.id, kind),
                    declarados.get(capture.capture_index, {})
                    .get(kind.value, {})
                    .get("content_type", "application/octet-stream"),
                ),
            )
            for capture in gravadas
            for kind in FileKind
        ]
        return CreatedAnalysis(captures=gravadas, uploads=uploads)


@dataclass(frozen=True, slots=True)
class MarkAnalysisReady:
    """Fecha a análise em `ready`.

    Quem confere que os bytes chegaram é o cliente: ele vê a resposta de cada PUT e
    só chama este endpoint quando nenhum falhou. Havia aqui um HEAD por objeto
    confirmando isso no bucket; ele saiu porque só pegava o caso de o cliente estar
    errado sobre um envio que ele mesmo viu dar certo, e custava uma ida à rede por
    arquivo — 63 numa sequência de 21 capturas.

    O preço é conhecido: um cliente que chame isto sem ter subido tudo deixa a
    consulta em `ready` com objeto faltando, e o buraco só aparece na reabertura.
    """

    encounters: EncounterRepository
    captures: CaptureRepository

    async def execute(self, user: AuthenticatedUser, encounter_id: UUID) -> None:
        if not user.is_clinician:
            raise ForbiddenError("apenas médicos e administradores gravam análises")

        encounter = await self.encounters.get(encounter_id)
        if encounter is None:
            raise NotFoundError("consulta não encontrada")

        # Mesma guarda de CreateCaptures, e pelo mesmo motivo. A RLS já recusa a
        # escrita, mas o 404 acima não pega o admin, que enxerga a consulta alheia:
        # sem esta linha ele fecharia a análise de outro médico, ou receberia um 500
        # vindo da policy no lugar do 403 que descreve o que aconteceu.
        if not encounter.can_edit:
            raise ForbiddenError("apenas o responsável pela consulta fecha a análise")

        if not await self.captures.list_for_encounter(encounter_id):
            raise NotFoundError("esta consulta não tem análise de imagem")

        # O retorno é conferido: `set_analysis_status` devolve `False` quando o UPDATE
        # não alcança linha nenhuma, e responder 204 nesse caso afirmaria que a análise
        # foi fechada quando ela não foi. Só chega aqui quem passou pelo `get` acima,
        # então isto é a consulta apagada entre as duas leituras — raro, e a resposta
        # certa para ele é a mesma de qualquer consulta que não existe mais.
        if not await self.encounters.set_analysis_status(encounter_id, AnalysisStatus.READY.value):
            raise NotFoundError("consulta não encontrada")


@dataclass(frozen=True, slots=True)
class EncounterDetail:
    encounter: Any
    patient: Any
    """Capturas com as URLs de leitura já embutidas em `files[kind].url`."""
    captures: Sequence[Mapping[str, Any]]


@dataclass(frozen=True, slots=True)
class GetEncounterDetail:
    """Reabre a consulta: paciente, body map, escores e capturas, numa chamada.

    O paciente vem embutido para a tela não precisar de um segundo request — mesma
    escolha que o detalhe do paciente faz ao embutir as consultas.

    **Só devolve capturas quando a análise está `ready`.** Em `uploading` as linhas
    existem mas os objetos podem não estar no bucket: assinar URLs para eles daria
    404 no browser e a tela mostraria uma análise quebrada em vez de dizer que o
    envio não terminou. O `analysis_status` vai junto para ela poder dizer isso.
    """

    encounters: EncounterRepository
    patients: PatientRepository
    captures: CaptureRepository
    storage: ObjectStorage | None

    async def execute(self, encounter_id: UUID) -> EncounterDetail:
        encounter = await self.encounters.get(encounter_id)
        if encounter is None:
            raise NotFoundError("consulta não encontrada")

        patient = await self.patients.get(encounter.patient_id)
        if patient is None:
            # A RLS já teria escondido a consulta; se chegou aqui e o paciente sumiu,
            # é inconsistência, não permissão.
            raise NotFoundError("paciente da consulta não encontrado")

        if encounter.analysis_status != AnalysisStatus.READY:
            return EncounterDetail(encounter=encounter, patient=patient, captures=[])

        linhas = await self.captures.list_detail_for_encounter(encounter_id)
        capturas: list[Mapping[str, Any]] = []
        for linha in linhas:
            registro = dict(linha)
            # Os três, sempre: é o que o POST cobra, e a chave de cada um é derivada
            # dos ids da própria linha. Não há coluna a consultar.
            registro["files"] = {
                kind.value: {
                    # Nula sem R2 configurado: a consulta ainda abre, com as medições
                    # e os escores, só sem as imagens.
                    "url": None
                    if self.storage is None
                    else self.storage.presign_get(
                        CaptureFile(
                            owner_id=registro["owner_id"],
                            encounter_id=encounter_id,
                            capture_id=registro["id"],
                            kind=kind,
                        )
                    )
                }
                for kind in FileKind
            }
            capturas.append(registro)

        return EncounterDetail(encounter=encounter, patient=patient, captures=capturas)
