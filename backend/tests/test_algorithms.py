"""Testes dos algoritmos e do caso de uso que os executa.

Sem banco, sem HTTP e sem asyncpg: um algoritmo é função pura sobre dataclasses, e é
por isso que ele se testa com objetos literais. Esse é o retorno concreto de o
algoritmo receber `Observation` em vez de ir buscar linha no Postgres.

Os casos da assimetria térmica são os do `thermal-asymmetry.spec.ts` que existia no
frontend, caso a caso: o porte não podia mudar comportamento, e é aqui que isso fica
verificável.

**Uma diferença é deliberada.** Aquele spec conseguia montar uma captura de índice 0
com fase `dynamic`, porque fase e índice eram campos separados. No banco não são: a
migration `captura_so_indice` removeu a coluna `phase`, e `capture_index` passou a ser
a fase (NULL avulsa, 0 basal, N dinâmica). O caso em que o resumo dizia "a primeira
captura, de índice 0" descrevia um estado que os dados persistidos não comportam, e
aqui ele é a basal.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app.application.algorithms import registry
from app.application.algorithms.thermal_asymmetry import thermal_asymmetry
from app.application.use_cases.algorithms import RunAlgorithm
from app.domain.algorithms import (
    AlgorithmResult,
    AlgorithmScope,
    AlgorithmStatus,
    Observation,
)
from app.domain.entities import Encounter
from app.domain.errors import NotFoundError

PACIENTE = uuid4()
CONSULTA = uuid4()
QUANDO = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)


def _linha(
    joint_id: str | None,
    temperatura: float | None,
    *,
    cobertura: float = 1.0,
    grupo: str | None = None,
) -> Observation:
    """Uma linha como o repositório a devolveria.

    `label` sem o lado e `side` como coluna, que é o formato que a consulta produz a
    partir do catálogo. `joint_id` nulo é a captura que existe e não mediu nada.
    """
    side = rotulo = None
    if joint_id is not None:
        prefixo, sufixo = joint_id.split("_", 1)
        side = prefixo.lower()
        rotulo = sufixo.replace("_", " ")
    return Observation(
        patient_id=PACIENTE,
        study_group=grupo,
        primary_diagnosis=None,
        encounter_id=CONSULTA,
        occurred_at=QUANDO,
        cdai_score=None,
        cdai_level=None,
        das28_score=None,
        das28_level=None,
        capture_id=CONSULTA,
        capture_index=None,
        joint_id=joint_id,
        label=rotulo,
        side=side,
        t_mean=temperatura,
        t_median=temperatura,
        t_min=temperatura,
        t_max=temperatura,
        skin_coverage=cobertura,
        pain=None,
        swelling=None,
    )


def _captura(medicoes: Sequence[Observation], *, index: int | None = None) -> list[Observation]:
    """As linhas de uma captura, todas com o mesmo `capture_id`.

    Uma captura sem medição vira uma linha só, de campos nulos: é o buraco na sequência,
    e ele precisa sobreviver ao agrupamento que o algoritmo faz.
    """
    id_captura = uuid4()
    linhas = list(medicoes) or [_linha(None, None)]
    return [replace(linha, capture_id=id_captura, capture_index=index) for linha in linhas]


def _linhas(*capturas: Sequence[Observation]) -> list[Observation]:
    """As linhas de várias capturas, na ordem em que a consulta as devolveria."""
    return [linha for captura in capturas for linha in captura]


# --- O algoritmo ------------------------------------------------------------


def test_pareia_os_dois_lados_e_reporta_a_magnitude() -> None:
    resultado = thermal_asymmetry.run(
        _captura([_linha("LEFT_MCP_3", 33.4), _linha("RIGHT_MCP_3", 32.0)])
    )

    assert resultado.status is AlgorithmStatus.OK
    assert len(resultado.values) == 1
    valor = resultado.values[0]
    # A magnitude vai no número e o lado no rótulo: `values` não carrega convenção de
    # sinal, para a tabela da tela poder ordenar sem saber dela.
    assert valor.value == pytest.approx(1.4)
    assert valor.unit == "°C"
    assert "esquerda mais quente" in valor.label
    assert "esquerda mais quente" in resultado.summary


def test_ordena_do_maior_para_o_menor_pela_magnitude() -> None:
    resultado = thermal_asymmetry.run(
        _captura(
            [
                _linha("LEFT_MCP_1", 32.0),
                _linha("RIGHT_MCP_1", 32.3),  # 0,3, e a mão direita mais quente
                _linha("LEFT_MCP_2", 34.0),
                _linha("RIGHT_MCP_2", 32.0),  # 2,0
            ]
        )
    )

    assert [v.value for v in resultado.values] == pytest.approx([2.0, 0.3])
    assert "direita mais quente" in resultado.values[1].label


def test_descarta_o_par_com_cobertura_de_pele_baixa() -> None:
    resultado = thermal_asymmetry.run(
        _captura(
            [
                _linha("LEFT_MCP_3", 33.0, cobertura=0.2),
                _linha("RIGHT_MCP_3", 32.0),
                _linha("LEFT_MCP_4", 33.0),
                _linha("RIGHT_MCP_4", 32.0),
            ]
        )
    )

    assert len(resultado.values) == 1
    assert "cobertura de pele abaixo de 40%" in resultado.summary


def test_medicao_sem_temperatura_nao_e_relatada_como_cobertura() -> None:
    """Os dois motivos de descarte são diferentes, e a ação de quem lê também.

    ROI sem leitura nenhuma é falha de medição; cobertura baixa é medição fraca. Relatar
    a segunda escondendo a primeira mandaria conferir o enquadramento de uma ROI que nem
    mediu.
    """
    resultado = thermal_asymmetry.run(
        _captura([_linha("LEFT_MCP_3", None), _linha("RIGHT_MCP_3", 32.0)])
    )

    assert resultado.status is AlgorithmStatus.INSUFFICIENT_DATA
    assert "medição sem temperatura" in resultado.summary
    assert "cobertura" not in resultado.summary


def test_articulacao_sem_par_no_outro_lado_nao_conta_como_descarte() -> None:
    resultado = thermal_asymmetry.run(_captura([_linha("LEFT_MCP_3", 33.0)]))

    assert resultado.status is AlgorithmStatus.INSUFFICIENT_DATA
    assert "descartad" not in resultado.summary


def test_usa_a_primeira_captura_com_medicao_e_diz_qual_foi() -> None:
    """A basal sem medição não pode fazer o algoritmo relatar sobre a sequência inteira.

    Uma basal cujo alinhamento falhou entra sem medição nenhuma. Usá-la faria o
    resultado dizer "nada detectado" sobre uma sequência em que as outras capturas foram
    medidas.
    """
    resultado = thermal_asymmetry.run(
        _linhas(
            _captura([], index=0),
            _captura([_linha("LEFT_MCP_3", 33.4), _linha("RIGHT_MCP_3", 32.0)], index=1),
        )
    )

    assert resultado.status is AlgorithmStatus.OK
    assert "índice 1" in resultado.summary
    assert "a anterior não tem" in resultado.summary


def test_nomeia_a_basal_pelo_que_ela_e() -> None:
    resultado = thermal_asymmetry.run(
        _linhas(
            _captura([_linha("LEFT_MCP_3", 33.4), _linha("RIGHT_MCP_3", 32.0)], index=0),
            _captura([], index=1),
        )
    )

    assert "a captura basal" in resultado.summary


def test_analise_avulsa_nao_ganha_aviso_de_escopo() -> None:
    """Com uma captura só não há "primeira de N" a ressalvar, e a frase sobraria."""
    resultado = thermal_asymmetry.run(
        _captura([_linha("LEFT_MCP_3", 33.4), _linha("RIGHT_MCP_3", 32.0)])
    )

    assert "carregadas" not in resultado.summary


def test_maos_simetricas_sao_achado_e_nao_falha() -> None:
    """Empate não tem lado mais quente.

    Dizer "esquerda" por causa de um `>= 0` seria inventar uma direção que a medição
    não mostra.
    """
    resultado = thermal_asymmetry.run(
        _captura([_linha("LEFT_MCP_3", 33.0), _linha("RIGHT_MCP_3", 33.0)])
    )

    assert resultado.status is AlgorithmStatus.OK
    assert resultado.values[0].value == 0
    assert resultado.values[0].label == "MCP 3 (sem diferença)"
    assert "Nenhuma diferença" in resultado.summary


def test_nao_responde_quando_todo_par_esta_abaixo_do_corte() -> None:
    resultado = thermal_asymmetry.run(
        _captura(
            [
                _linha("LEFT_MCP_3", 33.8, cobertura=0.1),
                _linha("RIGHT_MCP_3", 32.4, cobertura=0.1),
            ]
        )
    )

    assert resultado.status is AlgorithmStatus.INSUFFICIENT_DATA
    assert "cobertura de pele" in resultado.summary


def test_separa_os_dois_motivos_de_descarte_quando_ambos_acontecem() -> None:
    resultado = thermal_asymmetry.run(
        _captura(
            [
                _linha("LEFT_MCP_3", None),
                _linha("RIGHT_MCP_3", 32.4),
                _linha("LEFT_MCP_5", 33.0, cobertura=0.1),
                _linha("RIGHT_MCP_5", 32.0),
            ]
        )
    )

    assert resultado.status is AlgorithmStatus.INSUFFICIENT_DATA
    assert "2 descartados" in resultado.summary
    assert "1 por cobertura de pele abaixo de 40% (MCP 5)" in resultado.summary
    assert "1 por medição sem temperatura (MCP 3)" in resultado.summary


def test_sequencia_usa_so_a_primeira_captura_e_diz_de_quantas() -> None:
    """1,4 é da basal; 4,0 seria da dinâmica, que este algoritmo não usa."""
    resultado = thermal_asymmetry.run(
        _linhas(
            _captura([_linha("LEFT_MCP_3", 33.8), _linha("RIGHT_MCP_3", 32.4)], index=0),
            _captura([_linha("LEFT_MCP_3", 25.0), _linha("RIGHT_MCP_3", 21.0)], index=1),
        )
    )

    assert resultado.status is AlgorithmStatus.OK
    assert resultado.values[0].value == pytest.approx(1.4)
    assert "das 2 carregadas" in resultado.summary


def test_nenhuma_captura_medida_na_sequencia() -> None:
    resultado = thermal_asymmetry.run(_linhas(_captura([], index=0), _captura([], index=1)))

    assert resultado.status is AlgorithmStatus.INSUFFICIENT_DATA
    assert "sem par correspondente" in resultado.summary


def test_run_e_total_sem_linha_nenhuma() -> None:
    """A assinatura promete um resultado para qualquer entrada, inclusive vazia."""
    resultado = thermal_asymmetry.run([])

    assert resultado.status is AlgorithmStatus.INSUFFICIENT_DATA
    assert not resultado.values


# --- O registry -------------------------------------------------------------


def test_o_registry_acha_o_algoritmo_pelo_slug() -> None:
    assert registry.find(thermal_asymmetry.slug) is thermal_asymmetry
    assert registry.find("nao-existe") is None


def test_slugs_sao_unicos() -> None:
    """A rota despacha pelo slug, então dois iguais tornariam um deles inalcançável."""
    slugs = [a.slug for a in registry.ALGORITHMS]
    assert len(slugs) == len(set(slugs))


def test_todo_algoritmo_declara_um_escopo_conhecido() -> None:
    """O escopo é o que decide o recorte buscado; um valor solto viraria busca errada."""
    assert all(a.scope in tuple(AlgorithmScope) for a in registry.ALGORITHMS)


# --- O caso de uso ----------------------------------------------------------


class _EncountersFake:
    """Dublê do repositório de consultas. `None` é o que a RLS produz para linha alheia."""

    def __init__(self, encontrada: Encounter | None) -> None:
        self._encontrada = encontrada

    async def get(self, encounter_id: UUID) -> Encounter | None:
        return self._encontrada


class _DataFake:
    def __init__(self, linhas: Sequence[Observation]) -> None:
        self._linhas = linhas
        self.chamado_com: list[UUID | None] = []

    async def observations(self, encounter_id: UUID | None = None) -> Sequence[Observation]:
        self.chamado_com.append(encounter_id)
        return self._linhas


class _DeCoorte:
    """Algoritmo de coorte mínimo, só para exercitar o despacho por escopo."""

    slug = "coorte-de-teste"
    title = "Coorte de teste"
    description = "Conta as linhas que chegaram."
    scope = AlgorithmScope.COHORT

    def run(self, rows: Sequence[Observation]) -> AlgorithmResult:
        return AlgorithmResult(status=AlgorithmStatus.OK, summary=f"{len(rows)} linhas")


def _encounter() -> Encounter:
    return Encounter(
        id=uuid4(),
        patient_id=uuid4(),
        owner_id=uuid4(),
        occurred_at=QUANDO,
        reason=None,
        joint_evaluations=None,
        scores={},
        analysis_status=None,
        capture_count=0,
        created_at=QUANDO,
        updated_at=QUANDO,
    )


async def test_slug_desconhecido_vira_404() -> None:
    use_case = RunAlgorithm(_EncountersFake(_encounter()), _DataFake([]))

    with pytest.raises(NotFoundError):
        await use_case.execute("nao-existe", uuid4())


async def test_consulta_invisivel_vira_404_e_nao_le_medicao() -> None:
    """Consulta alheia não pode virar "dados insuficientes".

    Sem resolver a consulta antes, a RLS devolveria zero linhas, o algoritmo responderia
    insuficiente e a tela diria que a consulta não tem análise — uma mentira plausível
    sobre dado de outra pessoa.
    """
    data = _DataFake([])
    use_case = RunAlgorithm(_EncountersFake(None), data)

    with pytest.raises(NotFoundError):
        await use_case.execute(thermal_asymmetry.slug, uuid4())
    assert not data.chamado_com


async def test_escopo_de_consulta_sem_id_vira_404() -> None:
    """Pedir um algoritmo de consulta sem dizer qual não tem resposta possível."""
    data = _DataFake([])
    use_case = RunAlgorithm(_EncountersFake(_encounter()), data)

    with pytest.raises(NotFoundError):
        await use_case.execute(thermal_asymmetry.slug, None)
    assert not data.chamado_com


async def test_executa_o_algoritmo_sobre_as_linhas_da_consulta() -> None:
    linhas = _captura([_linha("LEFT_MCP_3", 33.4), _linha("RIGHT_MCP_3", 32.0)])
    data = _DataFake(linhas)
    use_case = RunAlgorithm(_EncountersFake(_encounter()), data)
    consulta = uuid4()

    resultado = await use_case.execute(thermal_asymmetry.slug, consulta)

    assert resultado.status is AlgorithmStatus.OK
    assert resultado.values[0].value == pytest.approx(1.4)
    # Buscou com o filtro da consulta, e não o acervo inteiro.
    assert data.chamado_com == [consulta]


async def test_escopo_de_coorte_busca_sem_filtro(monkeypatch: pytest.MonkeyPatch) -> None:
    """Coorte não resolve consulta nenhuma e busca sem filtro.

    É o que faz o segundo escopo funcionar sem nenhuma peça nova: a mesma consulta, sem
    a cláusula de consulta, já é o recorte da coorte — e a RLS o limita ao acervo
    daquele usuário.
    """
    de_coorte = _DeCoorte()
    monkeypatch.setattr(registry, "ALGORITHMS", (*registry.ALGORITHMS, de_coorte))

    data = _DataFake(_captura([_linha("LEFT_MCP_3", 33.4)]))
    encounters = _EncountersFake(None)  # nem seria consultado
    use_case = RunAlgorithm(encounters, data)

    resultado = await use_case.execute(de_coorte.slug, None)

    assert resultado.summary == "1 linhas"
    assert data.chamado_com == [None]


async def test_coorte_ignora_a_consulta_que_o_cliente_mandar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """O recorte é do algoritmo, não do pedido.

    Sem isso, mandar um `encounter_id` junto de um algoritmo de coorte rodaria a
    comparação entre grupos sobre uma consulta só, devolvendo um número que parece
    resposta e não é.
    """
    de_coorte = _DeCoorte()
    monkeypatch.setattr(registry, "ALGORITHMS", (*registry.ALGORITHMS, de_coorte))

    data = _DataFake([])
    use_case = RunAlgorithm(_EncountersFake(_encounter()), data)

    await use_case.execute(de_coorte.slug, uuid4())

    assert data.chamado_com == [None], "o id mandado pelo cliente deveria ter sido ignorado"
