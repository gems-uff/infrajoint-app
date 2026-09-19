from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from app.core.config import get_settings
from app.domain.errors import (
    ConflictError,
    DuplicatePatientError,
    ForbiddenError,
    NotFoundError,
)
from app.infrastructure.auth import JwtVerifier
from app.infrastructure.database import Database
from app.infrastructure.storage import R2Storage
from app.presentation.routers import algorithms, catalogs, encounters, patients
from app.presentation.schemas import PatientOut

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    database = Database(
        settings.database_url,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
    )
    await database.connect()
    app.state.database = database
    app.state.jwt_verifier = JwtVerifier(
        jwks_url=settings.supabase_jwks_url,
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
    )
    # Sem credencial de R2 a API sobe assim mesmo: só o upload de capturas fica
    # indisponível, e responde 503 dizendo isso.
    app.state.storage = (
        R2Storage(
            endpoint=settings.r2_endpoint,
            bucket=settings.r2_bucket,
            access_key_id=settings.r2_access_key_id,
            secret_access_key=settings.r2_secret_access_key,
            url_ttl_seconds=settings.r2_url_ttl_seconds,
        )
        if settings.r2_configured
        else None
    )
    try:
        yield
    finally:
        await database.disconnect()


def create_app() -> FastAPI:
    settings = get_settings()

    # O uvicorn configura os próprios loggers, não a raiz. Sem isto, `logger.exception`
    # cai no logging.lastResort e o traceback sai sem data, nível nem origem.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
    )

    app = FastAPI(
        title="InfraJoint API",
        version="0.1.0",
        summary="Pacientes e consultas, com autorização na RLS do Postgres.",
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
        redoc_url=None,
    )

    # Ordem contraintuitiva e importante: `add_middleware` insere na posição 0, então o
    # ÚLTIMO registrado fica por FORA. Este precisa ser registrado antes do CORS para
    # acabar por dentro dele.
    #
    # Por que não `@app.exception_handler(Exception)`: aquele é servido pelo
    # ServerErrorMiddleware, que é a camada mais externa de todas — fora do CORS. A
    # resposta de 500 saía sem os cabeçalhos, e o browser mostrava um erro de CORS opaco
    # no lugar do erro real. Justo a classe de falha que mais precisa ser diagnosticável.
    @app.middleware("http")
    async def _unexpected(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            # Erro de banco costuma trazer nome de tabela, coluna e às vezes o valor.
            # Vai para o log; o cliente recebe só o genérico.
            logger.exception("erro não tratado", exc_info=exc)
            return JSONResponse(status_code=500, content={"detail": "erro interno"})

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        # A API autentica por `Authorization: Bearer`, nunca por cookie. Com False, um
        # eventual curinga em CORS_ORIGINS seria permissivo em vez de catastrófico.
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(NotFoundError)
    async def _not_found(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ForbiddenError)
    async def _forbidden(_: Request, exc: ForbiddenError) -> JSONResponse:
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    async def _conflict(_: Request, exc: ConflictError) -> JSONResponse:
        # A mensagem sai para fora: ela diz o que falta subir, e é erro de fluxo do
        # cliente, não detalhe interno.
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(DuplicatePatientError)
    async def _duplicate_patient(_: Request, exc: DuplicatePatientError) -> JSONResponse:
        """409 com os homônimos no corpo, para a tela poder oferecer abrir o existente.

        Registrado além do handler de `ConflictError`, do qual herda: o Starlette
        percorre a MRO da exceção e escolhe o mais específico.
        """
        return JSONResponse(
            status_code=409,
            content={
                "detail": str(exc),
                "duplicates": [
                    PatientOut.from_entity(p).model_dump(mode="json") for p in exc.matches
                ],
            },
        )

    if settings.docs_enabled:

        @app.get("/", include_in_schema=False)
        async def root() -> RedirectResponse:
            """A raiz não serve nada; mandar para as docs evita um 404 confuso."""
            return RedirectResponse(url="/docs")

    @app.get("/health", tags=["infra"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(algorithms.router)
    app.include_router(catalogs.router)
    app.include_router(patients.router)
    app.include_router(encounters.router)
    return app


app = create_app()
