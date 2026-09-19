"""Fase 5: análise de imagens persistida.

O R2 é substituído por um duplo — assinar de verdade exigiria credencial de bucket e
testaria o boto3, não o InfraJoint. Todo o resto é real: pool asyncpg, `SET LOCAL
ROLE`, claims, policies, triggers e SQL. É esse recorte que faz o teste de captura
cross-tenant valer como prova.
"""

from __future__ import annotations

from typing import Any

from app.domain.entities import CaptureFile
from tests.conftest import LEITOR, MEDICO_A, MEDICO_B

# `birth_date` é obrigatória desde a migration `birth_date_obrigatoria`; aqui ela é só
# preenchimento, porque nenhum destes testes é sobre o cadastro do paciente.
_NASCIMENTO = "1970-01-01"


class FakeStorage:
    """Duplo do R2. `presign_put` devolve a própria chave e a registra.

    `existentes` é o conteúdo do bucket, e quem o preenche são os testes: não há mais
    um `exists` — o backend deixou de conferir os objetos ao fechar a análise. O que
    ele ainda serve é aos testes de exclusão, que provam que nada sobra no bucket.
    """

    def __init__(self, existentes: set[str] | None = None) -> None:
        self.existentes = existentes if existentes is not None else set()
        self.assinadas: list[str] = []
        self.apagadas: list[str] = []

    @staticmethod
    def _key(file: CaptureFile) -> str:
        return f"{file.owner_id}/{file.encounter_id}/{file.capture_id}/{file.kind.value}"

    def presign_get(self, file: CaptureFile) -> str:
        return f"https://bucket.local/{self._key(file)}?leitura=1"

    def presign_put(self, file: CaptureFile, content_type: str) -> str:
        chave = self._key(file)
        self.assinadas.append(chave)
        return f"https://bucket.local/{chave}?assinada=1&ct={content_type}"

    async def delete(self, files: Any) -> None:
        for file in files:
            chave = self._key(file)
            self.apagadas.append(chave)
            self.existentes.discard(chave)


def _captura(indice: int | None) -> dict[str, Any]:
    """Uma captura do payload. `indice` None é a avulsa, 0 a basal, N a dinâmica N."""
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
        "agreement": {"normalized": 0.87, "dice": 0.61, "ceiling": 0.70},
        # A medição passou a ter colunas, e a identidade dela é o id do body map: a
        # análise térmica traduz lado + landmark do MediaPipe ao montar o payload, e da
        # borda para dentro existe uma nomenclatura só. Ver `medicoes_das_rois`.
        "measurements": [
            {
                "joint_id": "RIGHT_WRIST",
                "t_mean": 33.2,
                "t_median": 33.1,
                "t_min": 32.8,
                "t_max": 33.9,
                "area": 1438,
                "sample_count": 1400,
                "shape": "ellipse",
                "rgb_x": 209.1,
                "rgb_y": 269.8,
                "csv_x": 106.6,
                "csv_y": 133.9,
                "rx_csv": 27.0,
                "ry_csv": 17.0,
                "edited": False,
            }
        ],
        # Os três, sempre: o schema recusa um subconjunto, porque uma captura sem a
        # matriz não tem medição e sem as duas imagens não tem o que alinhar.
        "files": {
            "optical": {"size": 1000, "content_type": "image/jpeg"},
            "thermal": {"size": 1500, "content_type": "image/jpeg"},
            "matrix": {"size": 2000, "content_type": "text/csv"},
        },
    }


async def _consulta_de(http: Any, nome: str) -> str:
    paciente = await http.post("/patients", json={"full_name": nome, "birth_date": _NASCIMENTO})
    assert paciente.status_code == 201, paciente.text
    consulta = await http.post(f"/patients/{paciente.json()['id']}/encounters", json={})
    assert consulta.status_code == 201, consulta.text
    return consulta.json()["id"]


async def test_avulsa_e_sequencia_pelo_mesmo_endpoint(client_com_storage: tuple) -> None:
    """Uma captura ou 21: mesma rota, mesmo corpo, sem discriminador."""
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A

    for n in (1, 21):
        eid = await _consulta_de(http, f"API-TEST análise n={n}")
        # n == 1 é a avulsa, e ela se declara pelo índice nulo — não há mais uma
        # coluna `phase` dizendo o mesmo por outro caminho.
        capturas = [_captura(0 if n > 1 else None)]
        capturas += [_captura(i) for i in range(1, n)]

        r = await http.post(f"/encounters/{eid}/captures", json={"captures": capturas})
        assert r.status_code == 201, r.text
        # Três arquivos por captura ⇒ três URLs assinadas por captura.
        assert len(r.json()["uploads"]) == n * 3


async def test_chave_derivada_do_dono_da_linha(client_com_storage: tuple) -> None:
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST chave")

    r = await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    assert r.status_code == 201

    # {owner_id}/{encounter_id}/{capture_id}/{kind} — e o dono é o do paciente.
    for chave in storage.assinadas:
        assert chave.startswith(f"{MEDICO_A}/{eid}/")
        assert chave.rsplit("/", 1)[1] in {"optical", "thermal", "matrix"}


async def test_segundo_post_na_mesma_consulta_vira_409(client_com_storage: tuple) -> None:
    """Repetir o POST criaria um segundo jogo de capturas sob a mesma consulta."""
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST duplo")

    assert (
        await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    ).status_code == 201
    repetido = await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    assert repetido.status_code == 409, repetido.text


async def test_ready_fecha_a_analise_sem_conferir_o_bucket(client_com_storage: tuple) -> None:
    """Fechar a análise é decisão do cliente, que viu a resposta de cada PUT.

    Havia aqui um HEAD por objeto, e este teste cobrava o 409 enquanto faltasse
    arquivo. Ele saiu: o 204 com o bucket vazio é o preço aceito, e está registrado
    para que a mudança apareça se alguém reintroduzir a conferência sem querer.
    """
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST ready")

    r = await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    assert r.status_code == 201

    assert storage.existentes == set(), "nada subiu"
    assert (await http.patch(f"/encounters/{eid}/analysis-status")).status_code == 204


async def test_ready_recusa_consulta_sem_analise(client_com_storage: tuple) -> None:
    """Sem capturas gravadas não há o que fechar — 404, não um `ready` vazio."""
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST sem analise")

    assert (await http.patch(f"/encounters/{eid}/analysis-status")).status_code == 404


async def test_analise_aparece_na_leitura_do_paciente(client_com_storage: tuple) -> None:
    """O ciclo inteiro precisa ser visível — senão o dado é gravado e some.

    Sem `analysis_status` e `capture_count` na resposta, o médico sobe as imagens com
    sucesso e não tem como saber disso pela aplicação.
    """
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST leitura", "birth_date": _NASCIMENTO}
    )
    pid = paciente.json()["id"]
    eid = (await http.post(f"/patients/{pid}/encounters", json={})).json()["id"]

    async def consulta() -> dict[str, Any]:
        detalhe = await http.get(f"/patients/{pid}")
        return detalhe.json()["encounters"][0]

    # Antes de qualquer análise: nulo significa "não tem", não "vazia".
    assert (await consulta())["analysis_status"] is None
    assert (await consulta())["capture_count"] == 0

    await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0), _captura(1)]})
    parcial = await consulta()
    assert parcial["analysis_status"] == "uploading"
    assert parcial["capture_count"] == 2, "as capturas contam mesmo antes de os bytes subirem"

    storage.existentes.update(storage.assinadas)
    assert (await http.patch(f"/encounters/{eid}/analysis-status")).status_code == 204

    final = await consulta()
    assert final["analysis_status"] == "ready"
    assert final["capture_count"] == 2


async def test_capturas_de_outro_medico_nao_entram_na_contagem(
    client_com_storage: tuple,
) -> None:
    """A subconsulta da contagem roda sob a mesma RLS do resto."""
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST contagem", "birth_date": _NASCIMENTO}
    )
    pid = paciente.json()["id"]
    eid = (await http.post(f"/patients/{pid}/encounters", json={})).json()["id"]
    await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})

    acting["user_id"] = MEDICO_B
    assert (await http.get(f"/patients/{pid}")).status_code == 404


async def test_medico_b_nao_anexa_captura_a_consulta_de_a(client_com_storage: tuple) -> None:
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST cross-tenant")

    acting["user_id"] = MEDICO_B
    r = await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    assert r.status_code == 404, "consulta invisível some, não é recusada"


async def test_admin_nao_grava_analise_na_consulta_de_outro(client_com_storage: tuple) -> None:
    """A análise segue a consulta: quem não a registrou não a preenche."""
    from tests.conftest import ADMIN

    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST análise de A")

    acting["user_id"] = ADMIN
    negado = await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    assert negado.status_code == 403, negado.text
    # A consulta continua visível para ele — é autoria que falta, não acesso.
    assert (await http.get(f"/encounters/{eid}")).status_code == 200


async def test_admin_nao_fecha_analise_da_consulta_de_outro(client_com_storage: tuple) -> None:
    """Fechar a análise segue a mesma autoria de gravá-la.

    Sem a guarda de dono, o admin passava direto pelo 404 (ele enxerga a consulta
    alheia) e batia na policy de escrita, que devolve 500 no lugar de um 403 que
    explica o que faltou.
    """
    from tests.conftest import ADMIN

    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST ready de A")

    assert (
        await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    ).status_code == 201
    storage.existentes.update(storage.assinadas)

    acting["user_id"] = ADMIN
    negado = await http.patch(f"/encounters/{eid}/analysis-status")
    assert negado.status_code == 403, negado.text

    # E o dono continua fechando normalmente.
    acting["user_id"] = MEDICO_A
    assert (await http.patch(f"/encounters/{eid}/analysis-status")).status_code == 204


async def test_leitor_recebe_403(client_com_storage: tuple) -> None:
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST leitor")

    acting["user_id"] = LEITOR
    r = await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    assert r.status_code == 403


async def test_payload_invalido_vira_422(client_com_storage: tuple) -> None:
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST validação")
    rota = f"/encounters/{eid}/captures"

    casos = {
        "sem capturas": {"captures": []},
        # Índice repetido cobre a basal duplicada: duas basais são dois índices 0.
        "índice repetido": {"captures": [_captura(0), _captura(0)]},
        "kind desconhecido": {"captures": [{**_captura(0), "files": {"../escape": {"size": 1}}}]},
        "índice fora da faixa": {"captures": [{**_captura(0), "capture_index": 64}]},
        "tamanho zero": {"captures": [{**_captura(0), "files": {"optical": {"size": 0}}}]},
    }
    for rotulo, payload in casos.items():
        r = await http.post(rota, json=payload)
        assert r.status_code == 422, f"{rotulo}: {r.status_code} {r.text[:90]}"


async def test_apagar_paciente_limpa_os_arquivos_do_bucket(client_com_storage: tuple) -> None:
    """A cascata do banco não alcança o R2; sem isto os objetos ficam órfãos.

    A limpeza roda em background, depois da resposta — e portanto depois do commit.
    O httpx executa as background tasks antes de devolver a resposta ao teste.
    """
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST exclusão", "birth_date": _NASCIMENTO}
    )
    pid = paciente.json()["id"]
    eid = (await http.post(f"/patients/{pid}/encounters", json={})).json()["id"]
    await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0), _captura(1)]})

    storage.existentes.update(storage.assinadas)
    esperadas = sorted(storage.assinadas)
    assert len(esperadas) == 6, "duas capturas, três arquivos em cada"

    assert (await http.delete(f"/patients/{pid}")).status_code == 204

    assert sorted(storage.apagadas) == esperadas
    assert storage.existentes == set(), "nada pode ter sobrado no bucket"


async def test_apagar_paciente_sem_analise_nao_chama_o_bucket(client_com_storage: tuple) -> None:
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST sem análise", "birth_date": _NASCIMENTO}
    )
    await http.post(f"/patients/{paciente.json()['id']}/encounters", json={})

    assert (await http.delete(f"/patients/{paciente.json()['id']}")).status_code == 204
    assert storage.apagadas == []


async def test_apagar_consulta_limpa_so_os_arquivos_dela(client_com_storage: tuple) -> None:
    """A exclusão recorta a consulta: o paciente e as outras consultas ficam.

    É o ponto de errar mais fácil aqui — reusar a listagem por paciente apagaria do
    bucket os arquivos de consultas que continuam existindo.
    """
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST exclusão consulta", "birth_date": _NASCIMENTO}
    )
    pid = paciente.json()["id"]
    alvo = (await http.post(f"/patients/{pid}/encounters", json={})).json()["id"]
    await http.post(f"/encounters/{alvo}/captures", json={"captures": [_captura(0), _captura(1)]})
    do_alvo = sorted(storage.assinadas)

    outra = (await http.post(f"/patients/{pid}/encounters", json={})).json()["id"]
    await http.post(f"/encounters/{outra}/captures", json={"captures": [_captura(0)]})
    storage.existentes.update(storage.assinadas)
    da_outra = sorted(set(storage.assinadas) - set(do_alvo))
    assert len(do_alvo) == 6 and len(da_outra) == 3

    assert (await http.delete(f"/encounters/{alvo}")).status_code == 204

    assert sorted(storage.apagadas) == do_alvo
    assert sorted(storage.existentes) == da_outra, "a outra consulta não pode ser tocada"
    assert (await http.get(f"/encounters/{alvo}")).status_code == 404
    assert (await http.get(f"/encounters/{outra}")).status_code == 200
    # O paciente sobrevive: quem foi apagado foi a consulta.
    assert (await http.get(f"/patients/{pid}")).status_code == 200


async def test_apagar_consulta_de_outro_medico_da_404(client_com_storage: tuple) -> None:
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST exclusão cross-tenant")
    await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})
    storage.existentes.update(storage.assinadas)

    acting["user_id"] = MEDICO_B
    assert (await http.delete(f"/encounters/{eid}")).status_code == 404
    # Nem os arquivos: a RLS esconde as capturas, então não há chave a derivar.
    assert storage.apagadas == []
    assert storage.existentes != set()


async def test_leitor_nao_apaga_consulta(client_com_storage: tuple) -> None:
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST exclusão leitor")

    acting["user_id"] = LEITOR
    assert (await http.delete(f"/encounters/{eid}")).status_code == 403


async def test_apagar_consulta_funciona_sem_r2_configurado(client: tuple) -> None:
    """Sem bucket, a consulta é apagada assim mesmo — o resto vira log de órfãos."""
    http, acting = client
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST consulta sem R2")

    assert (await http.delete(f"/encounters/{eid}")).status_code == 204
    assert (await http.get(f"/encounters/{eid}")).status_code == 404


async def test_apagar_paciente_funciona_sem_r2_configurado(client: tuple) -> None:
    """A exclusão do prontuário não pode depender de o bucket estar configurado.

    Usa a fixture `client`, que NÃO substitui o storage — em ambiente de teste ele é
    nulo, como numa instalação sem credencial de R2.
    """
    http, acting = client
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST sem R2", "birth_date": _NASCIMENTO}
    )
    assert (await http.delete(f"/patients/{paciente.json()['id']}")).status_code == 204


async def test_reabrir_consulta_devolve_tudo_identico(client_com_storage: tuple) -> None:
    """Critério de aceite da Fase 6: fechar, reabrir, e os dados serem os mesmos."""
    http, acting, storage = client_com_storage
    acting["user_id"] = MEDICO_A

    paciente = await http.post(
        "/patients", json={"full_name": "API-TEST reabrir", "sex": "F", "birth_date": _NASCIMENTO}
    )
    pid = paciente.json()["id"]
    criada = await http.post(
        f"/patients/{pid}/encounters",
        json={
            "reason": "reavaliação",
            "joint_evaluations": {"RIGHT_KNEE": {"pain": True, "swelling": False}},
        },
    )
    eid = criada.json()["id"]
    await http.post(
        f"/encounters/{eid}/captures",
        json={"captures": [_captura(0), _captura(1)]},
    )
    storage.existentes.update(storage.assinadas)
    assert (await http.patch(f"/encounters/{eid}/analysis-status")).status_code == 204

    detalhe = await http.get(f"/encounters/{eid}")
    assert detalhe.status_code == 200, detalhe.text
    corpo = detalhe.json()

    # Paciente embutido evita um segundo request na tela.
    assert corpo["patient"]["full_name"] == "API-TEST reabrir"
    assert corpo["patient"]["sex"] == "F"
    # E não vaza o dono: PatientOut nunca teve owner_id.
    assert "owner_id" not in corpo["patient"]

    assert corpo["reason"] == "reavaliação"
    assert corpo["joint_evaluations"] == {"RIGHT_KNEE": {"pain": True, "swelling": False}}
    assert corpo["analysis_status"] == "ready"

    assert [c["capture_index"] for c in corpo["captures"]] == [0, 1]
    primeira = corpo["captures"][0]
    # Índice 0 é a basal: é só o que distingue as duas agora.
    assert primeira["capture_index"] == 0
    # O que reconstrói a sobreposição: a afim e a largura da matriz.
    assert (primeira["align_a"], primeira["align_tx"]) == (0.5, 3.0)
    # As medições voltam reagrupadas da tabela, com os mesmos valores e a mesma
    # identidade que foram gravados.
    assert len(primeira["measurements"]) == 1
    medicao = primeira["measurements"][0]
    assert medicao["joint_id"] == "RIGHT_WRIST"
    assert (medicao["t_mean"], medicao["t_max"]) == (33.2, 33.9)
    assert (medicao["area"], medicao["sample_count"]) == (1438, 1400)
    assert medicao["shape"] == "ellipse"
    assert medicao["edited"] is False
    # O indicador continua acessível, dentro do JSON de onde a coluna o copiava.
    assert primeira["agreement"]["normalized"] == 0.87
    # URLs de leitura assinadas, uma por arquivo — os três, derivados do enum,
    # porque não há mais coluna dizendo quais a captura tem.
    assert sorted(primeira["files"]) == ["matrix", "optical", "thermal"]
    assert primeira["files"]["matrix"]["url"].endswith("leitura=1")


async def test_analise_incompleta_nao_devolve_capturas(client_com_storage: tuple) -> None:
    """Em 'uploading' os objetos podem não existir; URLs para eles dariam 404 na tela."""
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST incompleta")
    await http.post(f"/encounters/{eid}/captures", json={"captures": [_captura(0)]})

    corpo = (await http.get(f"/encounters/{eid}")).json()
    assert corpo["analysis_status"] == "uploading"
    assert corpo["captures"] == [], "a tela precisa saber que o envio não terminou"
    # As linhas existem mesmo sem os objetos: a contagem é justamente o que deixa a
    # tela dizer *quanta* imagem ficou por confirmar, em vez de exibir zero e parecer
    # que a análise está vazia.
    assert corpo["capture_count"] == 1


async def test_consulta_sem_analise_abre_normalmente(client_com_storage: tuple) -> None:
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST só body map")

    corpo = (await http.get(f"/encounters/{eid}")).json()
    assert corpo["analysis_status"] is None
    assert corpo["captures"] == []


async def test_medico_b_nao_reabre_consulta_de_a(client_com_storage: tuple) -> None:
    http, acting, _ = client_com_storage
    acting["user_id"] = MEDICO_A
    eid = await _consulta_de(http, "API-TEST reabrir alheia")

    acting["user_id"] = MEDICO_B
    assert (await http.get(f"/encounters/{eid}")).status_code == 404
