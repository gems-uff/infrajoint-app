"""Integração: Angular → JWT → FastAPI → RLS, com o banco local de verdade.

O teste que importa é `test_medico_b_recebe_404_no_paciente_de_a`. Ele é o critério de
aceite da Fase 3 do plano, e é o único capaz de detectar o Risco nº 1: se a API
conectasse com privilégio que ignora a RLS, tudo o mais continuaria passando.
"""

from __future__ import annotations

from typing import Any

from tests.conftest import (
    ADMIN,
    LEITOR,
    MEDICO_A,
    MEDICO_B,
    PESQUISADOR_1,
    PESQUISADOR_2,
)

# Data padrão dos pacientes de teste. `birth_date` é obrigatória desde a migration
# `birth_date_obrigatoria`, e os testes que exercitam a duplicata passam uma data
# própria para poderem ser a MESMA pessoa ou outra, conforme o caso.
_NASCIMENTO = "1970-01-01"


async def _criar_paciente(http: Any, nome: str, birth_date: str = _NASCIMENTO) -> dict[str, Any]:
    response = await http.post("/patients", json={"full_name": nome, "birth_date": birth_date})
    assert response.status_code == 201, response.text
    return response.json()


async def _nomes_de_teste(http: Any) -> list[str]:
    """Nomes dos pacientes criados por estes testes, em ordem alfabética.

    Filtrar pelo prefixo é o que mantém a suíte verde contra um banco local que você
    também usa à mão — asserção sobre o total quebraria a cada paciente cadastrado
    pelo navegador.
    """
    listagem = await http.get("/patients")
    assert listagem.status_code == 200
    return sorted(p["full_name"] for p in listagem.json() if p["full_name"].startswith("API-TEST"))


async def test_health_nao_exige_token(client: tuple[Any, dict]) -> None:
    http, _ = client
    response = await http.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_medico_cria_e_lista_o_proprio_paciente(client: tuple[Any, dict]) -> None:
    http, acting = client
    acting["user_id"] = MEDICO_A

    criado = await _criar_paciente(http, "API-TEST Ana")
    assert "owner_id" not in criado, "owner_id é detalhe de tenancy, não vai para o cliente"

    assert await _nomes_de_teste(http) == ["API-TEST Ana"]


async def test_medico_b_recebe_404_no_paciente_de_a(client: tuple[Any, dict]) -> None:
    http, acting = client

    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST Paciente de A")

    acting["user_id"] = MEDICO_B
    detalhe = await http.get(f"/patients/{paciente['id']}")
    assert detalhe.status_code == 404, "linha invisível tem que sumir, não ser recusada"

    assert await _nomes_de_teste(http) == []


async def test_medico_b_nao_edita_paciente_de_a(client: tuple[Any, dict]) -> None:
    http, acting = client

    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST Paciente de A")

    acting["user_id"] = MEDICO_B
    response = await http.patch(f"/patients/{paciente['id']}", json={"phone": "11999999999"})
    assert response.status_code == 404


async def test_medico_b_nao_cria_consulta_no_paciente_de_a(client: tuple[Any, dict]) -> None:
    http, acting = client

    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST Paciente de A")

    acting["user_id"] = MEDICO_B
    response = await http.post(f"/patients/{paciente['id']}/encounters", json={"reason": "invasão"})
    assert response.status_code == 404


async def test_medico_exclui_o_proprio_paciente_e_a_consulta_vai_junto(
    client: tuple[Any, dict],
) -> None:
    """Prova a cascata: apagar o paciente destrói o histórico clínico dele."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await _criar_paciente(http, "API-TEST com histórico")
    criada = await http.post(f"/patients/{paciente['id']}/encounters", json={"reason": "consulta"})
    assert criada.status_code == 201
    encounter_id = criada.json()["id"]

    assert (await http.delete(f"/patients/{paciente['id']}")).status_code == 204
    assert (await http.get(f"/patients/{paciente['id']}")).status_code == 404

    # A consulta some com o paciente — verificado no banco, fora da API.
    import asyncpg

    from tests.conftest import LOCAL_ADMIN_DSN

    connection = await asyncpg.connect(LOCAL_ADMIN_DSN)
    try:
        restantes = await connection.fetchval(
            "SELECT count(*) FROM public.encounters WHERE id = $1", encounter_id
        )
    finally:
        await connection.close()
    assert restantes == 0, "o ON DELETE CASCADE não levou a consulta junto"


async def test_medico_b_nao_exclui_paciente_de_a(client: tuple[Any, dict]) -> None:
    http, acting = client

    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST Paciente de A")

    acting["user_id"] = MEDICO_B
    assert (await http.delete(f"/patients/{paciente['id']}")).status_code == 404

    # E continua existindo para o dono.
    acting["user_id"] = MEDICO_A
    assert (await http.get(f"/patients/{paciente['id']}")).status_code == 200


async def test_leitor_recebe_403_ao_excluir(client: tuple[Any, dict]) -> None:
    http, acting = client

    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST Paciente de A")

    acting["user_id"] = LEITOR
    assert (await http.delete(f"/patients/{paciente['id']}")).status_code == 403


async def test_leitor_recebe_403_ao_criar_paciente(client: tuple[Any, dict]) -> None:
    http, acting = client
    acting["user_id"] = LEITOR

    response = await http.post(
        "/patients", json={"full_name": "API-TEST do leitor", "birth_date": _NASCIMENTO}
    )
    assert response.status_code == 403


async def test_admin_enxerga_pacientes_dos_dois_medicos(client: tuple[Any, dict]) -> None:
    http, acting = client

    acting["user_id"] = MEDICO_A
    await _criar_paciente(http, "API-TEST de A")
    acting["user_id"] = MEDICO_B
    await _criar_paciente(http, "API-TEST de B")

    acting["user_id"] = ADMIN
    assert await _nomes_de_teste(http) == ["API-TEST de A", "API-TEST de B"]


async def test_so_o_admin_ve_de_quem_e_cada_paciente(client: tuple[Any, dict]) -> None:
    """O admin enxerga a base dos dois médicos numa lista só — e pode apagar dela.

    Sem saber de quem é a linha, apagar paciente alheio não é decisão, é acidente.
    `owner_name` existe para isso, e só para o admin: um médico comum só vê os
    próprios pacientes, então o campo diria o nome dele em toda linha.
    """
    http, acting = client

    acting["user_id"] = MEDICO_A
    de_a = await _criar_paciente(http, "API-TEST de A")
    assert de_a["owner_name"] is None, "para o próprio médico o campo não tem o que dizer"

    acting["user_id"] = ADMIN
    listagem = await http.get("/patients")
    donos = {
        p["full_name"]: p["owner_name"]
        for p in listagem.json()
        if p["full_name"].startswith("API-TEST")
    }
    assert donos["API-TEST de A"], "o admin precisa ver de quem é o paciente"

    # Preenchido significa exatamente uma coisa: **é de outro médico**. Nas linhas do
    # próprio admin ele cala, porque ali o rótulo não decidiria nada — e é isso que
    # deixa a tela esconder "Editar" só onde a policy vai recusar.
    proprio = await _criar_paciente(http, "API-TEST do próprio admin")
    assert proprio["owner_name"] is None
    listagem_2 = await http.get("/patients")
    do_admin = next(p for p in listagem_2.json() if p["full_name"] == "API-TEST do próprio admin")
    assert do_admin["owner_name"] is None, "no que é dele, o campo não tem o que dizer"

    # E o nome do médico nunca vaza pelo id do tenant, que continua fora da resposta.
    assert "owner_id" not in listagem.json()[0]

    # Também no detalhe, que é onde mora o botão de excluir.
    detalhe = await http.get(f"/patients/{de_a['id']}")
    assert detalhe.json()["owner_name"] == donos["API-TEST de A"]

    # Para o outro médico, nem o paciente nem o dono existem.
    acting["user_id"] = MEDICO_B
    assert (await http.get(f"/patients/{de_a['id']}")).status_code == 404


async def test_admin_apaga_paciente_alheio_mas_nao_o_edita(client: tuple[Any, dict]) -> None:
    """A regra completa: o admin administra o acervo, não assina no lugar de quem atendeu.

    A assimetria é deliberada e o eixo não é o tamanho do estrago, é falsificação
    contra remoção: um paciente apagado não engana ninguém, e o médico percebe que ele
    sumiu; um cadastro editado passa a afirmar algo que o dono nunca escreveu.

    O 403 (e não 404) também é escolha: o admin ENXERGA o paciente, então esconder a
    existência dele seria mentir. O que falta a ele é ser o responsável.
    """
    http, acting = client

    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST alvo do admin")

    acting["user_id"] = ADMIN
    assert (await http.get(f"/patients/{paciente['id']}")).status_code == 200, "leitura continua"

    recusado = await http.patch(f"/patients/{paciente['id']}", json={"phone": "11999999999"})
    assert recusado.status_code == 403, recusado.text

    # E nada foi gravado.
    acting["user_id"] = MEDICO_A
    assert (await http.get(f"/patients/{paciente['id']}")).json()["phone"] is None

    # Apagar, sim.
    acting["user_id"] = ADMIN
    assert (await http.delete(f"/patients/{paciente['id']}")).status_code == 204
    acting["user_id"] = MEDICO_A
    assert (await http.get(f"/patients/{paciente['id']}")).status_code == 404


async def test_consulta_criada_aparece_no_detalhe_do_paciente(client: tuple[Any, dict]) -> None:
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await _criar_paciente(http, "API-TEST com consulta")
    criada = await http.post(
        f"/patients/{paciente['id']}/encounters", json={"reason": "dor articular"}
    )
    assert criada.status_code == 201

    detalhe = await http.get(f"/patients/{paciente['id']}")
    assert detalhe.status_code == 200
    assert [e["reason"] for e in detalhe.json()["encounters"]] == ["dor articular"]


async def test_apagar_o_nome_vira_422_e_nao_500(client: tuple[Any, dict]) -> None:
    """`full_name` é `not null`: o erro é do cliente, não do servidor."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await _criar_paciente(http, "API-TEST Ana")
    response = await http.patch(f"/patients/{paciente['id']}", json={"full_name": None})
    assert response.status_code == 422, response.text

    # E o nome continua lá.
    detalhe = await http.get(f"/patients/{paciente['id']}")
    assert detalhe.json()["full_name"] == "API-TEST Ana"


async def test_limpar_campo_opcional_continua_valendo(client: tuple[Any, dict]) -> None:
    """O contrapeso do teste acima: `null` nos campos nulos ainda limpa o campo."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    criado = await http.post(
        "/patients",
        json={"full_name": "API-TEST Ana", "birth_date": _NASCIMENTO, "phone": "11999"},
    )
    assert criado.status_code == 201
    paciente = criado.json()
    assert paciente["phone"] == "11999"

    response = await http.patch(f"/patients/{paciente['id']}", json={"phone": None})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] is None


async def test_erro_inesperado_responde_500_com_cabecalho_de_cors(_seeded: None) -> None:
    """Sem os cabeçalhos, o browser mostra erro de CORS no lugar do erro real.

    O handler de 500 tem que ficar DENTRO do CORSMiddleware. Como `add_middleware`
    insere na posição 0, isso depende da ordem de registro em `create_app()` — este
    teste é o que impede a ordem de ser invertida sem querer.
    """
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app
    from app.presentation import deps

    origem = "http://localhost:4200"
    app = create_app()
    app.dependency_overrides[deps.get_user_id] = lambda: MEDICO_A

    async with app.router.lifespan_context(app):
        # Banco fora do ar depois de a aplicação ter subido: erro de infraestrutura
        # genuíno, do tipo que o handler existe para cobrir.
        await app.state.database.disconnect()

        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as http:
            response = await http.get("/patients", headers={"Origin": origem})

    assert response.status_code == 500
    assert response.json() == {"detail": "erro interno"}, "a mensagem interna não pode vazar"
    assert response.headers.get("access-control-allow-origin") == origem


# --- Fase 4: body map persistido ---------------------------------------------------
#
# O fluxo de Análise Térmica grava tudo ao finalizar: a consulta nasce já com o body
# map e os escores, numa chamada só. Não existe passo intermediário no banco, então
# abandonar o fluxo no meio não deixa consulta vazia no histórico.

_ARTICULACOES = {
    "RIGHT_KNEE": {"pain": True, "swelling": True},
    "LEFT_KNEE": {"pain": False, "swelling": False},
    "RIGHT_MCP_3": {"pain": True, "swelling": False},
}
_CDAI = {
    "score": 12.5,
    "level": "moderate",
    "tender_count": 2,
    "swollen_count": 1,
    "patient_global": 5.0,
    "evaluator_global": 4.5,
}
_DAS28 = {
    "score": 4.21,
    "level": "moderate",
    "tender_count": 2,
    "swollen_count": 1,
    "acute_phase": "esr",
    "acute_value": 25.0,
    "patient_global_health": 40.0,
}


async def test_consulta_grava_body_map_e_escores_numa_chamada(client: tuple[Any, dict]) -> None:
    """Critério de aceite: avaliar → salvar → recarregar → dados idênticos."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await _criar_paciente(http, "API-TEST body map")
    criada = await http.post(
        f"/patients/{paciente['id']}/encounters",
        json={
            "reason": "avaliação de atividade",
            "joint_evaluations": _ARTICULACOES,
            "scores": {"CDAI": _CDAI, "DAS28": _DAS28},
        },
    )
    assert criada.status_code == 201, criada.text

    # Recarregar pelo detalhe do paciente devolve exatamente o que foi gravado.
    detalhe = await http.get(f"/patients/{paciente['id']}")
    (consulta,) = detalhe.json()["encounters"]

    assert consulta["joint_evaluations"] == _ARTICULACOES
    # Casing normalizado na fronteira: o frontend manda 'CDAI', o banco guarda 'cdai'.
    assert set(consulta["scores"]) == {"cdai", "das28"}
    assert consulta["scores"]["cdai"] == _CDAI
    assert consulta["scores"]["das28"] == _DAS28


async def test_consulta_sem_body_map_continua_valendo(client: tuple[Any, dict]) -> None:
    """As duas etapas do fluxo são opcionais — cabe consulta sem body map."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await _criar_paciente(http, "API-TEST sem body map")
    criada = await http.post(f"/patients/{paciente['id']}/encounters", json={"reason": "retorno"})
    assert criada.status_code == 201, criada.text

    consulta = criada.json()
    assert consulta["joint_evaluations"] is None
    assert consulta["scores"] == {}, "o default do banco é objeto vazio, não null"


async def test_body_map_sem_escore_fechado(client: tuple[Any, dict]) -> None:
    """O DAS28 exige VHS/PCR; sem isso o body map ainda precisa poder ser salvo."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await _criar_paciente(http, "API-TEST só articulações")
    criada = await http.post(
        f"/patients/{paciente['id']}/encounters",
        json={"joint_evaluations": _ARTICULACOES},
    )
    assert criada.status_code == 201, criada.text
    assert criada.json()["joint_evaluations"] == _ARTICULACOES
    assert criada.json()["scores"] == {}


async def test_escore_invalido_vira_422(client: tuple[Any, dict]) -> None:
    """Escore fora de faixa é erro do cliente — não pode virar dado clínico gravado."""
    http, acting = client
    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST validação")
    rota = f"/patients/{paciente['id']}/encounters"

    casos = {
        "tipo desconhecido": {"scores": {"SDAI": _CDAI}},
        "cdai acima da faixa": {"scores": {"CDAI": {**_CDAI, "score": 999}}},
        "contagem acima de 28": {"scores": {"CDAI": {**_CDAI, "tender_count": 29}}},
        "faixa de atividade inválida": {"scores": {"CDAI": {**_CDAI, "level": "altíssima"}}},
        "campo extra no escore": {"scores": {"CDAI": {**_CDAI, "chute": 1}}},
        "reagente inválido": {"scores": {"DAS28": {**_DAS28, "acute_phase": "vhs"}}},
        "id de articulação inválido": {"joint_evaluations": {"joelho direito": {"pain": True}}},
        "achado incompleto": {"joint_evaluations": {"RIGHT_KNEE": {"pain": True}}},
    }
    for rotulo, payload in casos.items():
        resposta = await http.post(rota, json=payload)
        assert resposta.status_code == 422, f"{rotulo}: {resposta.status_code} {resposta.text[:90]}"


async def test_catalogo_de_diagnosticos_e_legivel(client: tuple[Any, dict]) -> None:
    """Dado de referência: qualquer autenticado lê, e ninguém escreve pela aplicação."""
    http, acting = client
    acting["user_id"] = LEITOR

    resposta = await http.get("/diagnoses")
    assert resposta.status_code == 200
    catalogo = {d["code"]: d["label"] for d in resposta.json()}
    assert catalogo["M05"] == "Artrite reumatoide soropositiva"
    assert len(catalogo) >= 17


async def test_paciente_com_varios_diagnosticos(client: tuple[Any, dict]) -> None:
    """O limite que o campo de texto impunha: um diagnóstico por paciente.

    Comorbidade em reumatologia é regra, não exceção. E o rótulo volta junto do código,
    para a tela não precisar de um segundo request só para traduzir.
    """
    http, acting = client
    acting["user_id"] = MEDICO_A

    criado = await http.post(
        "/patients",
        json={
            "full_name": "API-TEST comorbidade",
            "birth_date": _NASCIMENTO,
            "study_group": "caso",
            "diagnoses": [
                {"code": "M05", "is_primary": True},
                {"code": "M79.7"},
            ],
        },
    )
    assert criado.status_code == 201, criado.text

    detalhe = (await http.get(f"/patients/{criado.json()['id']}")).json()
    assert detalhe["study_group"] == "caso"
    # O principal vem primeiro, e os rótulos vêm do catálogo.
    assert [d["code"] for d in detalhe["diagnoses"]] == ["M05", "M79.7"]
    assert detalhe["diagnoses"][0]["label"] == "Artrite reumatoide soropositiva"
    assert detalhe["diagnoses"][0]["is_primary"] is True
    assert detalhe["diagnoses"][1]["is_primary"] is False


async def test_diagnostico_fora_do_catalogo_e_recusado(client: tuple[Any, dict]) -> None:
    """A chave estrangeira é a fronteira: 'AR' não é código, é abreviação."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    resposta = await http.post(
        "/patients",
        json={
            "full_name": "API-TEST diagnóstico inválido",
            "birth_date": _NASCIMENTO,
            "diagnoses": [{"code": "AR"}],
        },
    )
    assert resposta.status_code == 409, resposta.text
    assert "catálogo" in resposta.json()["detail"]


async def test_dois_diagnosticos_principais_sao_recusados(client: tuple[Any, dict]) -> None:
    """ "Principal" só significa alguma coisa se houver no máximo um."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    resposta = await http.post(
        "/patients",
        json={
            "full_name": "API-TEST dois principais",
            "birth_date": _NASCIMENTO,
            "diagnoses": [
                {"code": "M05", "is_primary": True},
                {"code": "M32", "is_primary": True},
            ],
        },
    )
    assert resposta.status_code == 409, resposta.text


async def test_editar_diagnosticos_substitui_o_conjunto(client: tuple[Any, dict]) -> None:
    """O PATCH manda o conjunto inteiro, e ele substitui o anterior."""
    http, acting = client
    acting["user_id"] = MEDICO_A

    criado = await http.post(
        "/patients",
        json={
            "full_name": "API-TEST troca de diagnóstico",
            "birth_date": _NASCIMENTO,
            "diagnoses": [{"code": "M05", "is_primary": True}],
        },
    )
    id_paciente = criado.json()["id"]

    editado = await http.patch(
        f"/patients/{id_paciente}",
        json={"diagnoses": [{"code": "M32", "is_primary": True}, {"code": "M10"}]},
    )
    assert editado.status_code == 200, editado.text
    assert [d["code"] for d in editado.json()["diagnoses"]] == ["M32", "M10"]

    # E o resto do cadastro não foi tocado por uma edição que só citou a relação.
    assert editado.json()["full_name"] == "API-TEST troca de diagnóstico"


async def test_articulacao_fora_do_catalogo_e_recusada(client: tuple[Any, dict]) -> None:
    """A garantia que só existe desde que a avaliação virou tabela.

    `RIGHT_MCP_9` passa no regex da borda: tem a forma de um id de articulação. O que ele
    não tem é linha em `public.joints` — a mão tem cinco dedos. Antes desta tabela, ele
    era gravado em silêncio e depois sumia de qualquer agregação, o que não dá erro, dá
    número errado. Agora a chave estrangeira recusa.

    A mensagem sai com a lista da avaliação de propósito: recusar um payload de 28
    articulações sem dizer onde olhar não ajuda ninguém.
    """
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await _criar_paciente(http, "API-TEST articulação inexistente")
    resposta = await http.post(
        f"/patients/{paciente['id']}/encounters",
        json={"joint_evaluations": {"RIGHT_MCP_9": {"pain": True, "swelling": False}}},
    )
    assert resposta.status_code == 409, resposta.text
    assert "catálogo" in resposta.json()["detail"]

    # E a consulta não ficou pela metade: a transação inteira foi desfeita.
    detalhe = await http.get(f"/patients/{paciente['id']}")
    assert detalhe.json()["encounters"] == []


async def test_medico_b_nao_le_body_map_de_a(client: tuple[Any, dict]) -> None:
    """A RLS vale para o dado clínico novo como vale para o resto."""
    http, acting = client

    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST body map de A")
    await http.post(
        f"/patients/{paciente['id']}/encounters",
        json={"joint_evaluations": _ARTICULACOES, "scores": {"CDAI": _CDAI}},
    )

    acting["user_id"] = MEDICO_B
    assert (await http.get(f"/patients/{paciente['id']}")).status_code == 404


async def test_homonimo_recusa_com_a_lista_e_passa_na_confirmacao(
    client: tuple[Any, dict],
) -> None:
    """Avisar antes é o ponto: o médico quase sempre queria abrir quem já existe."""
    http, acting = client
    acting["user_id"] = MEDICO_A
    existente = await _criar_paciente(http, "API-TEST Ana Souza")

    # Acento, caixa e espaço não fazem pessoa nova — é o cadastro duplicado que mais
    # acontece, alguém redigitando quem já está lá.
    conflito = await http.post(
        "/patients", json={"full_name": "  api-test  aná   sóuza ", "birth_date": _NASCIMENTO}
    )
    assert conflito.status_code == 409, conflito.text
    assert [p["id"] for p in conflito.json()["duplicates"]] == [existente["id"]]

    # Confirmado, com data de nascimento diferente: é outra pessoa, e entra.
    confirmado = await http.post(
        "/patients?allow_duplicate=true",
        json={"full_name": "API-TEST Ana Souza", "birth_date": "1980-03-12"},
    )
    assert confirmado.status_code == 201, confirmado.text


async def test_mesmo_nome_e_mesma_data_o_banco_recusa(client: tuple[Any, dict]) -> None:
    """O limite do 'cadastrar assim mesmo': nem o médico distinguiria os dois depois."""
    http, acting = client
    acting["user_id"] = MEDICO_A
    corpo = {"full_name": "API-TEST Ana Souza", "birth_date": "1980-03-12"}
    assert (await http.post("/patients", json=corpo)).status_code == 201

    negado = await http.post("/patients?allow_duplicate=true", json=corpo)
    assert negado.status_code == 409, negado.text
    assert "data de nascimento" in negado.json()["detail"]


async def test_paciente_sem_data_de_nascimento_vira_422(client: tuple[Any, dict]) -> None:
    """Sem documento e sem prontuário, a data é o que separa dois homônimos.

    Substitui o antigo teste do NULLS NOT DISTINCT: enquanto a coluna era nula, o índice
    precisava fazer 'sem data' colidir com 'sem data'. Tornando-a obrigatória, o par que
    ninguém conseguia separar deixa de nascer — e a recusa passa a ser na borda, com
    mensagem legível, em vez de no índice.
    """
    http, acting = client
    acting["user_id"] = MEDICO_A

    negado = await http.post("/patients", json={"full_name": "API-TEST Sem Data"})
    assert negado.status_code == 422, negado.text

    # E nem pela edição ela pode ser apagada depois.
    paciente = await _criar_paciente(http, "API-TEST Com Data")
    apagar = await http.patch(f"/patients/{paciente['id']}", json={"birth_date": None})
    assert apagar.status_code == 422, apagar.text
    assert (await http.get(f"/patients/{paciente['id']}")).json()["birth_date"] == _NASCIMENTO


async def test_homonimo_de_outro_medico_nao_atrapalha_nem_aparece(
    client: tuple[Any, dict],
) -> None:
    """A unicidade é por dono — global, ela vazaria existência através da RLS."""
    http, acting = client
    acting["user_id"] = MEDICO_A
    await _criar_paciente(http, "API-TEST Homônima")

    acting["user_id"] = MEDICO_B
    criado = await http.post(
        "/patients", json={"full_name": "API-TEST Homônima", "birth_date": _NASCIMENTO}
    )
    assert criado.status_code == 201, "o paciente do outro médico não pode barrar este"


async def test_editar_para_o_nome_de_outro_paciente_vira_409(client: tuple[Any, dict]) -> None:
    """A duplicata também chega pela edição, e o PATCH não pode responder 500."""
    http, acting = client
    acting["user_id"] = MEDICO_A
    primeiro = await _criar_paciente(http, "API-TEST Primeira")
    segunda = await _criar_paciente(http, "API-TEST Segunda")

    resposta = await http.patch(
        f"/patients/{segunda['id']}", json={"full_name": primeiro["full_name"]}
    )
    assert resposta.status_code == 409, resposta.text


async def test_admin_ve_mas_nao_registra_consulta_no_paciente_de_outro(
    client: tuple[Any, dict],
) -> None:
    """O admin perde a autoria, não a supervisão."""
    http, acting = client
    acting["user_id"] = MEDICO_A
    paciente = await _criar_paciente(http, "API-TEST paciente de A")

    acting["user_id"] = ADMIN
    assert (await http.get(f"/patients/{paciente['id']}")).status_code == 200, "leitura continua"

    negado = await http.post(f"/patients/{paciente['id']}/encounters", json={"reason": "auditoria"})
    assert negado.status_code == 403, negado.text

    # E nada foi gravado: o dono continua sem consulta nenhuma.
    acting["user_id"] = MEDICO_A
    assert (await http.get(f"/patients/{paciente['id']}")).json()["encounters"] == []


async def test_campo_desconhecido_vira_422(client: tuple[Any, dict]) -> None:
    http, acting = client
    acting["user_id"] = MEDICO_A

    response = await http.post(
        "/patients",
        json={
            "full_name": "API-TEST",
            "birth_date": _NASCIMENTO,
            "owner_id": str(MEDICO_B),
        },
    )
    assert response.status_code == 422, "tentar definir o dono não pode passar em silêncio"


async def test_sem_token_recebe_401(_seeded: None) -> None:
    # Depende de `_seeded` só pelo skip que ele carrega: este teste sobe o lifespan de
    # verdade, então sem banco ele falharia em vez de ser pulado como os outros.
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app()  # sem override: o HTTPBearer real recusa
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            assert (await http.get("/patients")).status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# Acervo de pesquisa
#
# O que estes testes cobrem que `rls_isolation.sql` não cobre: o caminho inteiro,
# incluindo as guardas da API. É onde se vê a diferença entre 403 e 404 — a policy
# sozinha só sabe recusar, e quem escolhe a resposta é o caso de uso.
# ─────────────────────────────────────────────────────────────────────────────


async def test_pesquisador_enxerga_e_edita_o_paciente_do_par(client: tuple[Any, dict]) -> None:
    """A mudança inteira em um teste: P2 vê, sabe de quem é, e edita.

    `can_edit`/`can_delete` vêm do banco, das mesmas funções que as policies chamam.
    A tela os usa para não oferecer o botão que a policy vai recusar.
    """
    http, acting = client

    acting["user_id"] = PESQUISADOR_1
    paciente = await _criar_paciente(http, "API-TEST Paciente do pool")

    acting["user_id"] = PESQUISADOR_2
    assert await _nomes_de_teste(http) == ["API-TEST Paciente do pool"]

    detalhe = await http.get(f"/patients/{paciente['id']}")
    assert detalhe.status_code == 200
    corpo = detalhe.json()
    assert corpo["owner_name"] == "Pesquisadora API P1", "o rótulo diz que a linha é do par"
    assert corpo["can_edit"] is True
    assert corpo["can_delete"] is False, "editar sim, apagar não"

    edicao = await http.patch(f"/patients/{paciente['id']}", json={"phone": "21999999999"})
    assert edicao.status_code == 200, edicao.text
    assert edicao.json()["phone"] == "21999999999"
    # A resposta do PATCH também precisa dizer a verdade sobre a linha: devolvê-la com
    # o default `can_delete=True` reexibiria o botão de excluir logo após salvar.
    assert edicao.json()["can_delete"] is False


async def test_a_edicao_do_par_fica_assinada(client: tuple[Any, dict]) -> None:
    """`updated_by` responde o que `updated_at` sozinho não responde: quem editou.

    P1 é quem enxerga o nome de P2, e não o contrário: o campo cala sobre as edições
    do próprio chamador, senão repetiria o nome dele em toda linha da lista.
    """
    http, acting = client

    acting["user_id"] = PESQUISADOR_1
    paciente = await _criar_paciente(http, "API-TEST Paciente editado pelo par")
    assert (await http.get(f"/patients/{paciente['id']}")).json()["editor_name"] is None

    acting["user_id"] = PESQUISADOR_2
    await http.patch(f"/patients/{paciente['id']}", json={"phone": "21988887777"})

    acting["user_id"] = PESQUISADOR_1
    detalhe = await http.get(f"/patients/{paciente['id']}")
    assert detalhe.json()["editor_name"] == "Pesquisador API P2"


async def test_pesquisador_nao_apaga_o_paciente_do_par(client: tuple[Any, dict]) -> None:
    """403, e não 404: P2 ENXERGA o paciente, o que falta é ser o responsável.

    Sem a guarda do caso de uso, o DELETE não acharia linha sob a policy e a API
    responderia 404 por um paciente que a listagem dele acabou de mostrar.
    """
    http, acting = client

    acting["user_id"] = PESQUISADOR_1
    paciente = await _criar_paciente(http, "API-TEST Paciente que o par não apaga")

    acting["user_id"] = PESQUISADOR_2
    exclusao = await http.delete(f"/patients/{paciente['id']}")
    assert exclusao.status_code == 403, exclusao.text

    acting["user_id"] = PESQUISADOR_1
    assert (await http.get(f"/patients/{paciente['id']}")).status_code == 200


async def test_consulta_do_par_pertence_ao_dono_e_a_autoria_e_de_quem_registrou(
    client: tuple[Any, dict],
) -> None:
    """P2 registra no paciente de P1: a consulta é de P1, a autoria é de P2.

    É a divergência que devolveu `created_by` ao schema. Sem ela, o registro
    apareceria como escrito por P1, que não atendeu.
    """
    http, acting = client

    acting["user_id"] = PESQUISADOR_1
    paciente = await _criar_paciente(http, "API-TEST Paciente com consulta do par")

    acting["user_id"] = PESQUISADOR_2
    criada = await http.post(
        f"/patients/{paciente['id']}/encounters", json={"reason": "coleta do par"}
    )
    assert criada.status_code == 201, criada.text
    consulta = criada.json()
    assert consulta["can_edit"] is True
    assert consulta["can_delete"] is False

    acting["user_id"] = PESQUISADOR_1
    detalhe = await http.get(f"/patients/{paciente['id']}")
    registrada = detalhe.json()["encounters"][0]
    assert registrada["author_name"] == "Pesquisador API P2"

    acting["user_id"] = PESQUISADOR_2
    assert (await http.delete(f"/encounters/{consulta['id']}")).status_code == 403


async def test_o_acervo_de_pesquisa_nao_alcanca_medico_nenhum(client: tuple[Any, dict]) -> None:
    """`same_research_pool` exige os dois lados pesquisadores.

    É o que garante que promover alguém a pesquisador não mexe em quem já usava a
    plataforma: para o médico, nada mudou.
    """
    http, acting = client

    acting["user_id"] = MEDICO_A
    do_medico = await _criar_paciente(http, "API-TEST Paciente do medico")

    acting["user_id"] = PESQUISADOR_1
    assert (await http.get(f"/patients/{do_medico['id']}")).status_code == 404
    do_pesquisador = await _criar_paciente(http, "API-TEST Paciente do pesquisador")

    acting["user_id"] = MEDICO_A
    assert (await http.get(f"/patients/{do_pesquisador['id']}")).status_code == 404
    assert await _nomes_de_teste(http) == ["API-TEST Paciente do medico"]


async def test_admin_le_o_acervo_de_pesquisa_e_nao_escreve_nele(client: tuple[Any, dict]) -> None:
    """A regra do admin não afrouxou: `can_curate` não o inclui, nem no pool."""
    http, acting = client

    acting["user_id"] = PESQUISADOR_1
    paciente = await _criar_paciente(http, "API-TEST Paciente visto pelo admin")

    acting["user_id"] = ADMIN
    detalhe = await http.get(f"/patients/{paciente['id']}")
    assert detalhe.status_code == 200
    assert detalhe.json()["can_edit"] is False
    assert detalhe.json()["can_delete"] is True, "o admin administra o acervo"

    edicao = await http.patch(f"/patients/{paciente['id']}", json={"phone": "11888888888"})
    assert edicao.status_code == 403, edicao.text
