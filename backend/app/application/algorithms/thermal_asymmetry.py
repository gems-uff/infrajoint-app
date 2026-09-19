"""Assimetria térmica entre as mãos, articulação por articulação, na imagem estática.

Compara cada articulação com a sua correspondente do outro lado. É por articulação, e
não pela média da mão, porque inflamação articular é focal: uma MCP com 1,4 °C de
diferença, diluída entre dez articulações simétricas, vira 0,1 °C na média da mão, um
número que não diz nada.

"Estática" é o termo do domínio, e não um eufemismo para "uma imagem só": ele opõe esta
leitura, as mãos em repouso num instante, à termografia dinâmica, que é a resposta ao
estresse térmico ao longo do tempo. Por isso o escopo está no nome e não escondido na
implementação: com uma sequência carregada, este algoritmo usa a primeira captura COM
articulação medida e diz isso no resumo. A evolução do reaquecimento é outra pergunta, e
caberá a um algoritmo dinâmico.

Veio do frontend, onde rodava em TypeScript sobre o estado da tela. O cálculo é o mesmo,
inclusive o corte de cobertura de pele: o que mudou foi de onde os números chegam.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import groupby
from typing import Literal

from app.domain.algorithms import (
    AlgorithmResult,
    AlgorithmScope,
    AlgorithmStatus,
    AlgorithmValue,
    Observation,
)

# Cobertura de pele mínima para a medição entrar na comparação.
#
# Constante, e não parâmetro de tela: um botão exigiria descrever o parâmetro em
# metadados e renderizar formulário, o que é máquina demais para uma demanda que não
# existe. Está aqui, com nome, e muda-se em uma linha.
COBERTURA_MINIMA = 0.4

MotivoDescarte = Literal["cobertura", "sem-temperatura"]


@dataclass(frozen=True, slots=True)
class _Par:
    label: str
    # E menos D: positivo significa mão esquerda mais quente.
    assinada: float


@dataclass(frozen=True, slots=True)
class _Descartado:
    label: str
    motivo: MotivoDescarte


def _motivo_de_descarte(medicao: Observation) -> MotivoDescarte | None:
    """Por que esta medição não serve para comparar, ou `None` quando serve.

    Os dois motivos já foram contados juntos e relatados como cobertura de pele, o que
    descrevia errado o mais grave dos dois: uma ROI sem temperatura nenhuma não é uma
    ROI mal coberta, é uma ROI que não mediu. Quem lê precisa saber qual dos dois
    aconteceu, porque a ação é diferente.
    """
    if medicao.t_mean is None:
        return "sem-temperatura"
    return "cobertura" if medicao.skin_coverage < COBERTURA_MINIMA else None


def _sufixo(medicao: Observation) -> str:
    """`RIGHT_MCP_3` e `LEFT_MCP_3` viram `MCP_3`, que é o que pareia os dois lados.

    O prefixo sai a partir de `side`, que é coluna do catálogo, e não por corte de
    string no palpite: se a nomenclatura mudar, o catálogo é quem manda.
    """
    return medicao.joint_id.removeprefix(f"{medicao.side.upper()}_")


def _parear(
    medicoes: Sequence[Observation],
) -> tuple[list[_Par], list[_Descartado]]:
    """Pareia as articulações da captura, separando o que não dá para comparar."""
    esquerdas = {_sufixo(m): m for m in medicoes if m.side == "left"}
    direitas = {_sufixo(m): m for m in medicoes if m.side == "right"}

    pares: list[_Par] = []
    descartados: list[_Descartado] = []

    for sufixo, esquerda in esquerdas.items():
        direita = direitas.get(sufixo)
        if direita is None:
            # Não detectada do outro lado: não há par, e não é descarte.
            continue
        # O lado que falhou pior manda no motivo. Sem temperatura é falha de medição,
        # cobertura baixa é medição fraca, e relatar a segunda escondendo a primeira
        # mandaria o leitor conferir o enquadramento de uma ROI que nem mediu.
        motivo = _motivo_de_descarte(esquerda) or _motivo_de_descarte(direita)
        if motivo is not None:
            descartados.append(_Descartado(label=esquerda.label, motivo=motivo))
            continue
        # As duas temperaturas existem: `_motivo_de_descarte` já recusou o contrário.
        assert esquerda.t_mean is not None and direita.t_mean is not None
        pares.append(_Par(label=esquerda.label, assinada=esquerda.t_mean - direita.t_mean))

    pares.sort(key=lambda par: abs(par.assinada), reverse=True)
    return pares, descartados


def _lado_mais_quente(assinada: float) -> str | None:
    """Qual mão está mais quente no par, ou `None` quando as duas medem igual."""
    if assinada == 0:
        return None
    return "esquerda" if assinada > 0 else "direita"


def _frases_de_descarte(descartados: Sequence[_Descartado]) -> str:
    """Os descartes em prosa, agrupados por motivo.

    Com um motivo só a frase não repete a contagem, porque "1 descartado: 1 por
    cobertura" diz duas vezes a mesma coisa.
    """
    rotulos: dict[MotivoDescarte, str] = {
        "cobertura": f"cobertura de pele abaixo de {COBERTURA_MINIMA * 100:.0f}%",
        "sem-temperatura": "medição sem temperatura",
    }

    grupos = [
        (motivo, [d.label for d in descartados if d.motivo == motivo])
        for motivo in ("cobertura", "sem-temperatura")
    ]
    grupos = [(motivo, nomes) for motivo, nomes in grupos if nomes]

    if len(grupos) == 1:
        motivo, nomes = grupos[0]
        palavra = "descartado" if len(nomes) == 1 else "descartados"
        return f"{len(nomes)} {palavra} por {rotulos[motivo]} ({', '.join(nomes)})."

    descricoes = " e ".join(
        f"{len(nomes)} por {rotulos[motivo]} ({', '.join(nomes)})" for motivo, nomes in grupos
    )
    return f"{len(descartados)} descartados, {descricoes}."


@dataclass(frozen=True, slots=True)
class _Captura:
    """Uma captura reconstituída a partir das linhas que pertencem a ela."""

    capture_index: int | None
    medicoes: list[Observation]

    @property
    def is_baseline(self) -> bool:
        return self.capture_index == 0


def _agrupar(rows: Sequence[Observation]) -> list[_Captura]:
    """Junta as linhas por captura, na ordem em que vieram.

    A entrada é uma planilha: paciente, consulta e captura se repetem em cada linha.
    Este algoritmo é por captura, então ele desfaz a repetição aqui, uma vez, em vez
    de a interface entregar tudo aninhado e obrigar todo algoritmo a receber a forma
    que só este usa.

    `groupby` basta porque as linhas chegam contíguas por captura, garantido pelo
    ORDER BY do repositório. Uma captura sem medição vem como uma linha de campos
    nulos e vira uma captura de lista vazia: é o buraco na sequência, e ele precisa
    sobreviver ao agrupamento.
    """
    return [
        _Captura(
            capture_index=linhas[0].capture_index,
            medicoes=[linha for linha in linhas if linha.measured],
        )
        for linhas in (
            list(grupo) for _, grupo in groupby(rows, key=lambda linha: linha.capture_id)
        )
    ]


def _origem(captura: _Captura, posicao: int, total: int) -> str | None:
    """Aviso de escopo.

    O nome do algoritmo já diz "estática", mas quem lê só o resultado não vê o nome, e
    um texto sobre 1 de 21 capturas passaria por um texto sobre as 21.
    """
    if total == 1:
        return None

    estatica = "é uma leitura estática, não a evolução do reaquecimento."

    if posicao > 0:
        # Houve captura antes desta, e ela não tinha medição. Dizer "primeira captura"
        # aqui descreveria uma captura que não é esta, e esconderia o buraco, que é
        # justamente o que a captura sem medição existe para mostrar.
        faltantes = "a anterior não tem" if posicao == 1 else f"as {posicao} anteriores não têm"
        return (
            f"Calculado sobre a captura de índice {captura.capture_index}, "
            f"das {total} carregadas: {faltantes} articulação medida. "
            f"Com a ressalva, {estatica}"
        )

    # Nomeia a captura pelo que ela é, não por um instante: a basal fica fora do eixo de
    # reaquecimento, e chamá-la de "instante inicial" contradiria a curva e a linha do
    # tempo, que já não lhe dão posição no tempo.
    identificacao = (
        "a captura basal"
        if captura.is_baseline
        else f"a primeira captura, de índice {captura.capture_index},"
    )
    return f"Calculado sobre {identificacao} das {total} carregadas: {estatica}"


class ThermalAsymmetry:
    slug = "assimetria-termica-estatica"
    title = "Assimetria térmica (imagem estática)"
    scope = AlgorithmScope.ENCOUNTER
    description = (
        "Compara cada articulação com a correspondente do outro lado numa imagem "
        "estática, as mãos num instante, em repouso, e reporta as diferenças de "
        "temperatura da maior para a menor. Numa sequência, usa a primeira captura "
        "com medição."
    )

    def run(self, rows: Sequence[Observation]) -> AlgorithmResult:
        captures = _agrupar(rows)
        # A primeira COM medição, e não a de índice 0: uma basal cujo alinhamento
        # falhou entra na sequência sem medição nenhuma, e usá-la faria o algoritmo
        # relatar "nada detectado nas duas mãos" sobre uma sequência em que 20 capturas
        # foram medidas. O resumo diz qual captura usou.
        posicao = next((i for i, c in enumerate(captures) if c.medicoes), -1)
        # Nenhuma tem medição: cai na primeira, e `_parear` produz o insuficiente certo.
        captura = captures[max(posicao, 0)] if captures else None

        # A rota já não chama `run` sem análise, mas a guarda não é por causa dela: é
        # para `run` ser total. A assinatura promete um resultado para qualquer entrada,
        # e um chamador futuro não tem como saber de uma pré-condição que só existe na
        # borda.
        if captura is None:
            return AlgorithmResult(
                status=AlgorithmStatus.INSUFFICIENT_DATA,
                summary=(
                    "Não há captura analisada: não há medição sobre a qual calcular assimetria."
                ),
            )

        pares, descartados = _parear(captura.medicoes)

        if not pares:
            return AlgorithmResult(
                status=AlgorithmStatus.INSUFFICIENT_DATA,
                summary=(
                    f"Nenhum par pôde ser comparado. {_frases_de_descarte(descartados)}"
                    if descartados
                    else "Não há articulação detectada nas duas mãos: sem par "
                    "correspondente, não há assimetria a calcular."
                ),
            )

        maior = pares[0]
        lado_do_maior = _lado_mais_quente(maior.assinada)

        # Só contagens no texto, nenhum número com casa decimal, porque formatar é
        # trabalho da tela. Os valores vão em `values`, como números.
        frases = [
            "Nenhuma diferença de temperatura entre as mãos nos pares comparados."
            if lado_do_maior is None
            else f"Maior diferença na {maior.label}, com a mão {lado_do_maior} mais quente.",
            f"{len(pares)} {'par comparado' if len(pares) == 1 else 'pares comparados'}."
            + (f" {_frases_de_descarte(descartados)}" if descartados else ""),
        ]

        aviso = _origem(captura, max(posicao, 0), len(captures))
        if aviso is not None:
            frases.append(aviso)

        return AlgorithmResult(
            status=AlgorithmStatus.OK,
            summary=" ".join(frases),
            # O lado vai no rótulo, e não no sinal do número: `values` é magnitude, e a
            # tabela da tela ordena e formata sem saber de convenção de sinal.
            values=[
                AlgorithmValue(
                    label=(
                        f"{par.label} (sem diferença)"
                        if (lado := _lado_mais_quente(par.assinada)) is None
                        else f"{par.label} ({lado} mais quente)"
                    ),
                    value=abs(par.assinada),
                    unit="°C",
                )
                for par in pares
            ],
        )


thermal_asymmetry = ThermalAsymmetry()
