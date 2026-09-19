"""Os algoritmos disponíveis.

"Plugar" um algoritmo é escrever o arquivo ao lado deste e acrescentar uma linha na
lista abaixo. Não há descoberta automática e não há catálogo em banco: o primeiro
esconderia de quem lê quais algoritmos existem, e o segundo seria uma segunda fonte da
verdade capaz de divergir desta sem ninguém notar.

Uma lista só. O escopo de cada algoritmo é um campo dele, não uma lista separada: quem
despacha pergunta ao algoritmo qual recorte buscar, em vez de deduzir isso de onde ele
estava registrado.
"""

from __future__ import annotations

from collections.abc import Sequence

from app.application.algorithms.thermal_asymmetry import thermal_asymmetry
from app.domain.algorithms import Algorithm

ALGORITHMS: Sequence[Algorithm] = (thermal_asymmetry,)


def find(slug: str) -> Algorithm | None:
    return next((a for a in ALGORITHMS if a.slug == slug), None)
