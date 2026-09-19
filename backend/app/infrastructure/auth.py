"""Verificação do JWT do Supabase via JWKS."""

from __future__ import annotations

from uuid import UUID

import jwt
from jwt import PyJWKClient
from starlette.concurrency import run_in_threadpool


class InvalidTokenError(Exception):
    """Token ausente, expirado, mal assinado ou de outro emissor."""


class JwtVerifier:
    """Valida assinatura, emissor, audiência e expiração; devolve o `sub`.

    O papel do usuário NÃO sai daqui. Ele é lido de public.users a cada request,
    porque com a role dentro do token promover alguém só valeria depois do refresh.
    """

    def __init__(self, jwks_url: str, issuer: str, audience: str) -> None:
        self._issuer = issuer
        self._audience = audience
        # O PyJWKClient cacheia as chaves por kid; só a primeira verificação busca.
        self._jwks = PyJWKClient(jwks_url, cache_keys=True)

    async def verify(self, token: str) -> UUID:
        try:
            # A busca do JWKS é HTTP síncrono. Só acontece no cache miss, mas
            # bloquearia o event loop se rodasse direto.
            signing_key = await run_in_threadpool(self._jwks.get_signing_key_from_jwt, token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "sub"]},
            )
        except Exception as exc:  # PyJWT usa uma árvore ampla de exceções
            raise InvalidTokenError(str(exc)) from exc

        subject = payload.get("sub")
        if not subject:
            raise InvalidTokenError("token sem 'sub'")
        try:
            return UUID(subject)
        except ValueError as exc:
            raise InvalidTokenError("'sub' não é um uuid") from exc
