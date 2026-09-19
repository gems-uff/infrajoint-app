from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, status

from app.application.use_cases.captures import (
    CreateCaptures,
    GetEncounterDetail,
    MarkAnalysisReady,
)
from app.application.use_cases.encounters import DeleteEncounter
from app.presentation import deps
from app.presentation.cleanup import schedule_orphan_cleanup
from app.presentation.schemas import (
    AnalysisCreate,
    AnalysisCreatedOut,
    CaptureDetailOut,
    EncounterDetailOut,
    EncounterOut,
    PatientOut,
    SignedUploadOut,
)

router = APIRouter(prefix="/encounters", tags=["encounters"])


@router.post(
    "/{encounter_id}/captures",
    response_model=AnalysisCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="Cria a análise de imagem da consulta e devolve os PUTs assinados.",
)
async def create_captures(
    encounter_id: UUID,
    payload: AnalysisCreate,
    user: deps.CurrentUser,
    use_case: Annotated[CreateCaptures, Depends(deps.create_captures)],
) -> AnalysisCreatedOut:
    captures = []
    for captura in payload.captures:
        linha = captura.model_dump(exclude={"files"})
        linha["files"] = {k: v.model_dump() for k, v in captura.files.items()}
        captures.append(linha)

    criada = await use_case.execute(user, encounter_id, captures)
    return AnalysisCreatedOut(
        encounter_id=encounter_id,
        uploads=[
            SignedUploadOut(
                capture_id=u.capture_id,
                capture_index=u.capture_index,
                kind=u.kind.value,
                url=u.url,
            )
            for u in criada.uploads
        ],
    )


@router.patch(
    "/{encounter_id}/analysis-status",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Fecha a análise em 'ready'. Quem confere que os arquivos subiram é o cliente.",
)
async def mark_ready(
    encounter_id: UUID,
    user: deps.CurrentUser,
    use_case: Annotated[MarkAnalysisReady, Depends(deps.mark_analysis_ready)],
) -> None:
    await use_case.execute(user, encounter_id)


@router.get(
    "/{encounter_id}",
    response_model=EncounterDetailOut,
    summary="Reabre a consulta: paciente, body map, escores e capturas com URLs de leitura.",
)
async def get_encounter(
    encounter_id: UUID,
    use_case: Annotated[GetEncounterDetail, Depends(deps.get_encounter_detail)],
) -> EncounterDetailOut:
    detalhe = await use_case.execute(encounter_id)
    return EncounterDetailOut(
        **EncounterOut.from_entity(detalhe.encounter).model_dump(),
        patient=PatientOut.from_entity(detalhe.patient),
        captures=[CaptureDetailOut.model_validate(c) for c in detalhe.captures],
    )


@router.delete(
    "/{encounter_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Apaga a consulta, o body map, os escores e a análise de imagem dela.",
)
async def delete_encounter(
    encounter_id: UUID,
    user: deps.CurrentUser,
    use_case: Annotated[DeleteEncounter, Depends(deps.delete_encounter)],
    background: BackgroundTasks,
    storage: deps.StorageOptional,
) -> None:
    # Storage opcional, como em apagar paciente: a exclusão do registro clínico é o
    # que o médico pediu, e a limpeza do bucket é consequência dela — não requisito.
    orfaos = await use_case.execute(user, encounter_id)
    schedule_orphan_cleanup(background, storage, orfaos, alvo=f"consulta {encounter_id}")
