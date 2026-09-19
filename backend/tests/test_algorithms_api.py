"""Os algoritmos contra o banco de verdade.

`test_algorithms.py` prova o cálculo com objetos literais. Este arquivo prova a outra
metade, que aquele não alcança: a consulta que monta a entrada. São coisas que só o
Postgres responde — o rótulo derivado do catálogo, a cobertura recalculada a partir de
`area` e `sample_count`, a ordem das capturas e o recorte da RLS.

Sem banco esta suíte é pulada, e é justamente aqui que "verde" sem banco não prova nada.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, ClassVar
from uuid import UUID

import pytest

from app.application.algorithms import registry
from app.application.algorithms.thermal_asymmetry import thermal_asymmetry
from app.domain.algorithms import (
    AlgorithmResult,
    AlgorithmScope,
    AlgorithmStatus,
    AlgorithmValue,
    Observation,
)
from tests.conftest import MEDICO_A, MEDICO_B

_NASCIMENTO = "1970-01-01"
_SLUG = thermal_asymmetry.slug


def _medicao(joint_id: str, t_mean: float, *, area: int = 1000, amostras: int = 900) -> dict:
    """Uma medição do payload.

    `area` e `sample_count` não são enfeite: a cobertura de pele deixou de ser coluna na
    migration `colunas_sem_uso`, e é a razão entre as duas que o algoritmo usa para
    descartar medição fraca. Se a consulta parar de recalculá-la, o descarte some.
    """
    return {
        "joint_id": joint_id,
        "t_mean": t_mean,
        "t_median": t_mean,
        "t_min": t_mean - 0.5,
        "t_max": t_mean + 0.5,
        "area": area,
        "sample_count": amostras,
        "shape": "circle",
        "rgb_x": 100.0,
        "rgb_y": 100.0,
        "csv_x": 50.0,
        "csv_y": 50.0,
        "rx_csv": 10.0,
        "ry_csv": 10.0,
        "edited": False,
    }


def _captura(indice: int | None, medicoes: list[dict]) -> dict[str, Any]:
    return {
        "capture_index": indice,
        "elapsed_seconds": None if indice is None else indice * 30.0,
        "align_a": 0.5,
        "align_b": 0.0,
        "align_tx": 3.0,
        "align_c": 0.0,
        "align_d": 0.5,
        "align_ty": 7.0,
        "alignment_method": "silhouette",
        "measurements": medicoes,
        "files": {
            "optical": {"size": 1000, "content_type": "image/jpeg"},
            "thermal": {"size": 1500, "content_type": "image/jpeg"},
            "matrix": {"size": 2000, "content_type": "text/csv"},
        },
    }


async def _consulta_com(http: Any, nome: str, capturas: list[dict]) -> str:
    paciente = await http.post("/patients", json={"full_name": nome, "birth_date": _NASCIMENTO})
    assert paciente.status_code == 201, paciente.text
    consulta = await http.post(f"/patients/{paciente.json()['id']}/encounters", json={})
    assert consulta.status_code == 201, consulta.text
    eid = consulta.json()["id"]

    gravado = await http.post(f"/encounters/{eid}/captures", json={"captures": capturas})
    assert gravado.status_code == 201, gravado.text
    return eid


async def test_lista_os_algoritmos_registrados(client: tuple) -> None:
    http, acting = client
    acting["user_id"] = MEDICO_A

    r = await http.get("/algorithms")
    assert r.status_code == 200, r.text

    por_slug = {a["slug"]: a for a in r.json()}
    assert _SLUG in por_slug
    assert por_slug[_SLUG]["scope"] == "encounter"
    # O escopo vem declarado pelo algoritmo, e é o que a tela usa para saber o que
    # perguntar antes de executar.
    assert all(a["scope"] in {"encounter", "cohort"} for a in r.json())


async def test_roda_sobre_a_consulta_e_pareia_os_dois_lados(client_com_storage: tuple) -> None:
    """O caminho inteiro: rota, consulta SQL, catálogo e cálculo."""
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A

    eid = await _consulta_com(
        http,
        "API-TEST algoritmo",
        [
            _captura(
                None,
                [
                    _medicao("LEFT_MCP_3", 33.4),
                    _medicao("RIGHT_MCP_3", 32.0),
                    _medicao("LEFT_WRIST", 33.0),
                    _medicao("RIGHT_WRIST", 32.8),
                ],
            )
        ],
    )

    r = await http.post(f"/algorithms/{_SLUG}/run", json={"encounter_id": eid})
    assert r.status_code == 200, r.text
    corpo = r.json()

    assert corpo["status"] == "ok"
    # Do maior para o menor, e o lado no rótulo em vez do sinal.
    assert [round(v["value"], 1) for v in corpo["values"]] == [1.4, 0.2]
    assert corpo["values"][0]["unit"] == "°C"

    # As duas formas de rótulo do catálogo, sem o lado: "MCP 3 (mão direita)" perde o
    # parêntese e "Punho esquerdo" perde o adjetivo. É a derivação em SQL que não tinha
    # como ser verificada sem banco.
    rotulos = [v["label"] for v in corpo["values"]]
    assert rotulos[0].startswith("MCP 3 (")
    assert rotulos[1].startswith("Punho (")
    assert "esquerda mais quente" in rotulos[0]


async def test_cobertura_de_pele_vem_de_area_e_sample_count(client_com_storage: tuple) -> None:
    """A coluna não existe mais; o descarte depende da razão ser recalculada na leitura."""
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A

    eid = await _consulta_com(
        http,
        "API-TEST cobertura",
        [
            _captura(
                None,
                [
                    # 200/1000 = 0,2, abaixo do corte de 0,4: o par cai.
                    _medicao("LEFT_MCP_3", 33.4, area=1000, amostras=200),
                    _medicao("RIGHT_MCP_3", 32.0),
                    _medicao("LEFT_WRIST", 33.0),
                    _medicao("RIGHT_WRIST", 32.8),
                ],
            )
        ],
    )

    corpo = (await http.post(f"/algorithms/{_SLUG}/run", json={"encounter_id": eid})).json()

    assert len(corpo["values"]) == 1, "a MCP 3 deveria ter sido descartada"
    assert "cobertura de pele abaixo de 40%" in corpo["summary"]


async def test_captura_sem_medicao_continua_na_sequencia(client_com_storage: tuple) -> None:
    """A basal sem medição não pode sumir da contagem nem ser usada como resultado.

    É o LEFT JOIN: se a captura vazia caísse fora, o resumo diria "a primeira captura"
    sobre a de índice 1 e esconderia o buraco na coleta.
    """
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A

    eid = await _consulta_com(
        http,
        "API-TEST buraco",
        [
            _captura(0, []),
            _captura(1, [_medicao("LEFT_MCP_3", 33.4), _medicao("RIGHT_MCP_3", 32.0)]),
        ],
    )

    corpo = (await http.post(f"/algorithms/{_SLUG}/run", json={"encounter_id": eid})).json()

    assert corpo["status"] == "ok"
    assert "índice 1" in corpo["summary"]
    assert "das 2 carregadas" in corpo["summary"]
    assert "a anterior não tem" in corpo["summary"]


async def test_consulta_sem_analise_responde_dados_insuficientes(client: tuple) -> None:
    """Consulta visível e vazia é 200 com a explicação, não erro: é caso normal."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST vazia", "birth_date": _NASCIMENTO}
    )
    consulta = await http.post(f"/patients/{paciente.json()['id']}/encounters", json={})
    eid = consulta.json()["id"]

    r = await http.post(f"/algorithms/{_SLUG}/run", json={"encounter_id": eid})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "insufficient-data"


async def test_consulta_de_outro_medico_vira_404(client_com_storage: tuple) -> None:
    """O recorte é o mesmo do resto da API, e ele é da RLS.

    Sem o caso de uso resolver a consulta antes, a RLS devolveria zero medições e a
    resposta seria "dados insuficientes" — uma frase plausível sobre dado alheio, com
    200 no lugar de 404.
    """
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_com(
        http,
        "API-TEST alheia",
        [_captura(None, [_medicao("LEFT_MCP_3", 33.4), _medicao("RIGHT_MCP_3", 32.0)])],
    )

    acting["user_id"] = MEDICO_B
    r = await http.post(f"/algorithms/{_SLUG}/run", json={"encounter_id": eid})
    assert r.status_code == 404, r.text


async def test_slug_desconhecido_vira_404(client: tuple) -> None:
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST slug", "birth_date": _NASCIMENTO}
    )
    consulta = await http.post(f"/patients/{paciente.json()['id']}/encounters", json={})

    r = await http.post("/algorithms/nao-existe/run", json={"encounter_id": consulta.json()["id"]})
    assert r.status_code == 404, r.text


async def test_listar_algoritmos_exige_token(_seeded: None) -> None:
    """Sem repositório na assinatura, a autenticação não chega de carona.

    As outras rotas herdam o 401 da cadeia repositório → conexão → token. `GET
    /algorithms` lê uma lista em memória e não pede repositório nenhum, então já
    respondeu 200 para quem não mandou token. A dependência explícita no router é o
    que conserta, e é isto que impede a regressão: um app SEM o override do conftest.
    """
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app()
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as http:
            assert (await http.get("/algorithms")).status_code == 401
            # A par de comparação: a rota vizinha, que herda o 401 pela cadeia.
            assert (await http.get("/diagnoses")).status_code == 401


async def test_medicao_com_area_e_sem_contagem_nao_derruba_a_rota(
    client_com_storage: tuple,
) -> None:
    """As duas colunas da cobertura são anuláveis, e uma sem a outra já deu 500.

    `area` e `sample_count` são opcionais em `CaptureMeasurementIn` porque uma ROI pode
    registrar a região sem produzir leitura. Com `area` preenchida e `sample_count`
    nulo, a divisão devolvia NULL e o `float()` da leitura estourava. Contagem ausente é
    cobertura zero, e cobertura zero é descarte — não erro de servidor.
    """
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A

    sem_contagem = _medicao("LEFT_MCP_3", 33.4)
    sem_contagem["sample_count"] = None

    eid = await _consulta_com(
        http,
        "API-TEST sem contagem",
        [
            _captura(
                None,
                [
                    sem_contagem,
                    _medicao("RIGHT_MCP_3", 32.0),
                    _medicao("LEFT_WRIST", 33.0),
                    _medicao("RIGHT_WRIST", 32.8),
                ],
            )
        ],
    )

    r = await http.post(f"/algorithms/{_SLUG}/run", json={"encounter_id": eid})
    assert r.status_code == 200, r.text
    corpo = r.json()
    # O par sem contagem cai por cobertura; o outro continua sendo comparado.
    assert [v["label"].split(" (")[0] for v in corpo["values"]] == ["Punho"]
    assert "cobertura de pele abaixo de 40%" in corpo["summary"]


class _ContaLinhas:
    """Algoritmo de coorte mínimo: devolve quantas linhas e quantos pacientes chegaram.

    Existe só nos testes. O que ele prova não é a conta, é que o segundo escopo alcança
    o banco de verdade, pela mesma consulta, sem nenhuma peça nova.
    """

    slug = "conta-linhas"
    title = "Conta linhas"
    description = "Quantas medições e quantos pacientes o recorte alcançou."
    scope = AlgorithmScope.COHORT

    def run(self, rows: Sequence[Observation]) -> AlgorithmResult:
        pacientes = {linha.patient_id for linha in rows}
        return AlgorithmResult(
            status=AlgorithmStatus.OK,
            summary=f"{len(rows)} linhas de {len(pacientes)} pacientes.",
            values=[AlgorithmValue(label="pacientes", value=float(len(pacientes)))],
        )


async def test_coorte_alcanca_varios_pacientes_e_respeita_a_rls(
    client_com_storage: tuple, monkeypatch: pytest.MonkeyPatch
) -> None:
    """O recorte sem filtro é o acervo de quem pergunta, não o banco inteiro.

    É a metade que nenhum teste cobria: a consulta sem `WHERE` de consulta depende
    inteiramente da RLS para não vazar. Se a policy sumisse, o médico B veria as linhas
    do médico A — que é exatamente o modo de falha silencioso que este teste pega.

    Mede a VARIAÇÃO, e não um total: assertar "B vê zero" amarraria o teste à ordem de
    execução, porque outro teste pode ter criado dados de B antes deste rodar.
    """
    http, acting, _ = client_com_storage
    monkeypatch.setattr(registry, "ALGORITHMS", (*registry.ALGORITHMS, _ContaLinhas()))

    async def pacientes_vistos_por(quem: UUID) -> float:
        acting["user_id"] = quem
        r = await http.post("/algorithms/conta-linhas/run", json={})
        assert r.status_code == 200, r.text
        return r.json()["values"][0]["value"]

    antes_a = await pacientes_vistos_por(MEDICO_A)
    antes_b = await pacientes_vistos_por(MEDICO_B)

    acting["user_id"] = MEDICO_A
    for nome in ("API-TEST coorte 1", "API-TEST coorte 2"):
        await _consulta_com(
            http,
            nome,
            [_captura(None, [_medicao("LEFT_MCP_3", 33.4), _medicao("RIGHT_MCP_3", 32.0)])],
        )

    # O algoritmo de coorte enxerga os dois pacientes novos de uma vez, sem receber
    # consulta nenhuma no corpo do pedido.
    assert await pacientes_vistos_por(MEDICO_A) == antes_a + 2
    # E nada disso apareceu para o outro médico.
    assert await pacientes_vistos_por(MEDICO_B) == antes_b


class _Espia:
    """Devolve as linhas cruas, para o teste poder inspecionar o que a consulta montou."""

    slug = "espia"
    title = "Espia"
    description = "Só para teste: expõe o que chegou."
    scope = AlgorithmScope.ENCOUNTER
    recebido: ClassVar[list[Observation]] = []

    def run(self, rows: Sequence[Observation]) -> AlgorithmResult:
        type(self).recebido = list(rows)
        return AlgorithmResult(status=AlgorithmStatus.OK, summary=f"{len(rows)} linhas")


async def test_traz_diagnostico_avaliacao_e_escores_sem_duplicar_a_linha(
    client_com_storage: tuple, monkeypatch: pytest.MonkeyPatch
) -> None:
    """As três tabelas clínicas entram sem multiplicar as medições.

    É o risco real de achatar tudo numa linha: `patient_diagnoses` tem N por paciente e
    `encounter_scores` até 2 por consulta. Juntadas sem cuidado, cada medição sairia
    repetida e qualquer média sairia sobre linhas fantasmas — sem erro, só errada.

    Este paciente tem 2 diagnósticos e a consulta tem os 2 escores, que é o pior caso:
    um join ingênuo devolveria 4 linhas por articulação em vez de 1.
    """
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    monkeypatch.setattr(registry, "ALGORITHMS", (*registry.ALGORITHMS, _Espia()))

    paciente = await http.post(
        "/patients",
        json={
            "full_name": "API-TEST clinico",
            "birth_date": _NASCIMENTO,
            "study_group": "caso",
            "diagnoses": [{"code": "M05", "is_primary": True}, {"code": "M10"}],
        },
    )
    assert paciente.status_code == 201, paciente.text

    consulta = await http.post(
        f"/patients/{paciente.json()['id']}/encounters",
        json={
            "joint_evaluations": {"RIGHT_MCP_3": {"pain": True, "swelling": True}},
            "scores": {
                "CDAI": {
                    "score": 22.4,
                    "level": "high",
                    "tender_count": 7,
                    "swollen_count": 5,
                    "patient_global": 6.0,
                    "evaluator_global": 4.4,
                },
                "DAS28": {
                    "score": 5.1,
                    "level": "high",
                    "tender_count": 7,
                    "swollen_count": 5,
                    "acute_phase": "crp",
                    "acute_value": 12.0,
                    "patient_global_health": 60.0,
                },
            },
        },
    )
    assert consulta.status_code == 201, consulta.text
    eid = consulta.json()["id"]

    gravado = await http.post(
        f"/encounters/{eid}/captures",
        json={
            "captures": [
                _captura(None, [_medicao("RIGHT_MCP_3", 33.4), _medicao("LEFT_MCP_3", 32.0)])
            ]
        },
    )
    assert gravado.status_code == 201, gravado.text

    r = await http.post("/algorithms/espia/run", json={"encounter_id": eid})
    assert r.status_code == 200, r.text

    linhas = _Espia.recebido
    # Duas articulações medidas, duas linhas. Nem 4, nem 8.
    assert len(linhas) == 2, f"a linha foi duplicada: {len(linhas)}"

    por_junta = {linha.joint_id: linha for linha in linhas}
    direita = por_junta["RIGHT_MCP_3"]

    # Diagnóstico: só o principal, mesmo o paciente tendo dois.
    assert direita.primary_diagnosis == "M05"
    assert direita.study_group == "caso"

    # Escores: um campo por índice, e não uma linha por índice.
    assert direita.cdai_score == pytest.approx(22.4)
    assert direita.cdai_level == "high"
    assert direita.das28_score == pytest.approx(5.1)
    assert direita.das28_level == "high"

    # Avaliação articular: casada pela MESMA articulação da medição.
    assert (direita.pain, direita.swelling) == (True, True)
    # A esquerda não foi avaliada, e isso é diferente de avaliada como sem dor.
    assert por_junta["LEFT_MCP_3"].pain is None
