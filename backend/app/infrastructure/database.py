"""Pool asyncpg e a sessão sob RLS.

Este módulo é a fronteira de segurança inteira do backend: se `session()` estiver
correta, toda query do request roda com as claims do usuário e a RLS protege sozinha.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import UUID

import asyncpg


class Database:
    def __init__(self, dsn: str, *, min_size: int = 1, max_size: int = 10) -> None:
        self._dsn = dsn
        self._min_size = min_size
        self._max_size = max_size
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        self._pool = await asyncpg.create_pool(
            self._dsn,
            min_size=self._min_size,
            max_size=self._max_size,
            # O Supavisor em modo transaction devolve a conexão ao pool a cada commit,
            # então prepared statements nomeados não sobrevivem entre transações e o
            # driver quebraria de forma intermitente em produção.
            statement_cache_size=0,
        )

    async def disconnect(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    @asynccontextmanager
    async def session(self, user_id: UUID) -> AsyncIterator[asyncpg.Connection]:
        """Abre uma transação já autenticada como o usuário.

        Três coisas precisam acontecer nesta ordem, e todas dentro da transação:

        1. `SET LOCAL ROLE authenticated` — sem isto o app_api não alcança tabela
           nenhuma, porque foi criado com NOINHERIT e sem grants. É a garantia de que
           esquecer este passo quebra a query em vez de rodar sem RLS.
        2. As claims, para `auth.uid()` resolver dentro das policies.
        3. O corpo do request.

        `SET LOCAL` só vale até o fim da transação — que é exatamente o que se quer
        com um pooler em modo transaction reciclando conexões entre usuários.
        """
        if self._pool is None:
            raise RuntimeError("pool não inicializado; chame connect() no lifespan")

        claims = json.dumps({"sub": str(user_id), "role": "authenticated"})

        async with self._pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute("SET LOCAL ROLE authenticated")
                await connection.execute(
                    "SELECT set_config('request.jwt.claims', $1, true)", claims
                )
                yield connection
