"""Os algoritmos de pesquisa: listar e executar.

Duas rotas genéricas, e não uma por algoritmo. É o que faz plugar um algoritmo novo não
criar rota, não mexer em schema e não pedir deploy de nada além do arquivo dele.

Nenhuma regra de negócio mora aqui, e nenhuma checagem de permissão: quem decide o que
cada pessoa alcança é a RLS, na conexão que `deps.get_connection` abriu.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.application.algorithms import registry
from app.application.use_cases.algorithms import RunAlgorithm
from app.presentation import deps
from app.presentation.schemas import AlgorithmOut, AlgorithmResultOut, RunAlgorithmIn

router = APIRouter(prefix="/algorithms", tags=["algoritmos"])


@router.get(
    "",
    response_model=list[AlgorithmOut],
    summary="Os algoritmos de pesquisa disponíveis.",
)
async def list_algorithms(
    _: Annotated[UUID, Depends(deps.get_user_id)],
) -> list[AlgorithmOut]:
    """Lê o registry em memória. Não toca o banco, e por isso não depende de conexão.

    **A dependência do token é explícita aqui, e não pode sair.** Nas outras rotas a
    autenticação chega de carona: elas pedem um repositório, o repositório pede a
    conexão, e a conexão pede o token. Esta não pede repositório nenhum, então sem esta
    linha ela responde 200 para qualquer um — foi o que aconteceu, e o que este
    parâmetro conserta. Quais análises a plataforma sabe fazer é informação da
    ferramenta, não algo a expor ao mundo.

    `get_user_id` só verifica o token; não abre transação e não lê `public.users`, que
    seria ida ao banco para responder uma lista que está em memória.
    """
    return [
        AlgorithmOut(
            slug=a.slug,
            title=a.title,
            description=a.description,
            scope=a.scope.value,
        )
        for a in registry.ALGORITHMS
    ]


@router.post(
    "/{slug}/run",
    response_model=AlgorithmResultOut,
    summary="Executa um algoritmo e devolve o resultado. Nada é gravado.",
)
async def run_algorithm(
    slug: str,
    payload: RunAlgorithmIn,
    use_case: Annotated[RunAlgorithm, Depends(deps.run_algorithm)],
) -> AlgorithmResultOut:
    """Uma rota para qualquer algoritmo, de qualquer escopo.

    Não há ramo por tipo aqui: quem decide o recorte é o `scope` declarado pelo
    algoritmo, e o caso de uso o traduz em buscar com ou sem filtro. Acrescentar um
    algoritmo de coorte não toca este arquivo.
    """
    resultado = await use_case.execute(slug, payload.encounter_id)
    return AlgorithmResultOut.from_result(resultado)
