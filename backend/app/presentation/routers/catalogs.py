"""Os catálogos que a tela precisa para montar formulários."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.infrastructure.repositories.catalogs import PostgresCatalogRepository
from app.presentation import deps
from app.presentation.schemas import DiagnosisCatalogOut

router = APIRouter(tags=["catálogos"])


@router.get(
    "/diagnoses",
    response_model=list[DiagnosisCatalogOut],
    summary="O catálogo de diagnósticos, com o código da CID-10 e o nome.",
)
async def list_diagnoses(
    repo: Annotated[PostgresCatalogRepository, Depends(deps.get_catalog_repository)],
) -> list[DiagnosisCatalogOut]:
    return [
        DiagnosisCatalogOut(code=d.code, label=d.label or d.code)
        for d in await repo.list_diagnoses()
    ]
