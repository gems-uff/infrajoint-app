"""Executar um algoritmo de pesquisa."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from app.application.algorithms import registry
from app.domain.algorithms import AlgorithmResult, AlgorithmScope
from app.domain.errors import NotFoundError
from app.domain.repositories import AlgorithmDataRepository, EncounterRepository


@dataclass(frozen=True, slots=True)
class RunAlgorithm:
    """Acha o algoritmo, busca as linhas do recorte dele e executa.

    O `scope` do algoritmo é que decide o recorte, e não um parâmetro do pedido: um
    algoritmo de consulta exige `encounter_id`, um de coorte ignora o que vier. É o que
    impede executar um algoritmo de coorte sobre uma consulta só, ou o contrário, por
    engano do cliente.

    **A consulta é resolvida ANTES de buscar as medições**, e não por zelo: sem isso,
    uma consulta de outro dono devolveria zero linhas pela RLS, o algoritmo responderia
    "dados insuficientes" e a tela diria que a consulta não tem análise. Seria uma
    mentira plausível sobre dado alheio. Resolvendo primeiro, sai 404, que é o que o
    resto da API responde para linha invisível.

    Slug desconhecido também é 404: quem pede um algoritmo que não existe está pedindo
    um recurso que não existe, e a lista de quais existem está em `GET /algorithms`.
    """

    encounters: EncounterRepository
    data: AlgorithmDataRepository

    async def execute(self, slug: str, encounter_id: UUID | None = None) -> AlgorithmResult:
        algorithm = registry.find(slug)
        if algorithm is None:
            raise NotFoundError("algoritmo não encontrado")

        if algorithm.scope is AlgorithmScope.ENCOUNTER:
            if encounter_id is None:
                raise NotFoundError("consulta não encontrada")
            if await self.encounters.get(encounter_id) is None:
                raise NotFoundError("consulta não encontrada")
            linhas = await self.data.observations(encounter_id)
        else:
            # Sem filtro: a RLS recorta sozinha, devolvendo o acervo deste usuário.
            linhas = await self.data.observations()

        # Sem guarda de "veio alguma linha?" aqui: `run` é total por contrato, e devolve
        # o `insufficient-data` com a frase que explica o que faltou. Repetir a checagem
        # neste ponto criaria uma segunda mensagem para o mesmo caso.
        return algorithm.run(linhas)
