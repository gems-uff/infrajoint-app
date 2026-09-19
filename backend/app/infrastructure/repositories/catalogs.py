"""Leitura dos catálogos: dado de referência, igual para todo mundo.

Separado dos repositórios clínicos porque a natureza é outra. `public.diagnoses` e
`public.joints` não têm dono, não são recortadas por tenant e ninguém as escreve pela
aplicação: a RLS delas é uma policy de leitura para `authenticated`, e mudar o conteúdo
é migration. Misturá-las com `patients` sugeriria regras que elas não têm.
"""

from __future__ import annotations

from collections.abc import Sequence

import asyncpg

from app.domain.entities import Diagnosis


class PostgresCatalogRepository:
    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    async def list_diagnoses(self) -> Sequence[Diagnosis]:
        """O catálogo inteiro, para a tela montar a lista de escolha.

        São 17 linhas hoje e crescem uma a uma; paginar seria cerimônia. A ordem é a do
        rótulo, que é como a pessoa procura na tela — não a do código, que agrupa por
        capítulo da CID e não ajuda quem está lendo.
        """
        rows = await self._connection.fetch(
            "SELECT code, label FROM public.diagnoses ORDER BY label"
        )
        return [Diagnosis(code=row["code"], label=row["label"]) for row in rows]
