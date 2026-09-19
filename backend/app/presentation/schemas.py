"""Schemas de entrada e saída da API.

Separados das entidades de propósito: `Patient` carrega `owner_id`, que é detalhe de
tenancy e não interessa ao cliente — ele nunca vê senão o próprio.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.domain.algorithms import AlgorithmResult
from app.domain.entities import Encounter, Patient, Sex, StudyGroup

# Ex.: RIGHT_MCP_3, LEFT_KNEE. Formato dos ids do catálogo do frontend.
_JOINT_ID = re.compile(r"[A-Z][A-Z0-9_]{2,39}")


def _recusa_nascimento_futuro(value: date) -> date:
    """Recusa data de nascimento no futuro.

    O banco só cobra `not null`, e nenhuma das três telas que gravam paciente
    limitava o campo: um dedo no ano errado criava um cadastro com nascimento à
    frente da consulta. Ele não quebra nada em tempo de execução — o relatório
    calcula idade negativa e imprime `—` —, mas entra no acervo que a pesquisa
    vai analisar, e lá o erro não se distingue de um dado real.

    A validação mora aqui, e não só no `max` do campo de data, porque são três
    formulários gravando na mesma rota: um deles esquecer o atributo volta a
    abrir o buraco, e o atributo do browser não é obstáculo para um POST direto.
    """
    if value > date.today():
        raise ValueError("a data de nascimento não pode estar no futuro")
    return value


class DiagnosisIn(BaseModel):
    """Um diagnóstico escolhido no cadastro, pelo código da CID-10.

    O código é validado no formato aqui e conferido contra `public.diagnoses` pela chave
    estrangeira, que é a fronteira real — mesma divisão de trabalho do id de articulação.
    """

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=16)
    is_primary: bool = False


class DiagnosisOut(BaseModel):
    """O diagnóstico como a tela o exibe: código e nome, sem um segundo request."""

    code: str
    label: str
    is_primary: bool


class DiagnosisCatalogOut(BaseModel):
    """Uma linha do catálogo. Sem `is_primary`: isso é do vínculo, não do diagnóstico."""

    code: str
    label: str


class PatientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=200)
    # Sem default: é obrigatória, e o cliente que a omitir recebe 422 em vez de criar
    # um cadastro que nenhum homônimo futuro conseguirá distinguir.
    birth_date: date
    sex: Sex | None = None
    phone: str | None = Field(default=None, max_length=40)
    # Vários por paciente: comorbidade é regra em reumatologia. O teto é generoso e
    # existe só para um payload absurdo não ser gravado como veio.
    diagnoses: list[DiagnosisIn] = Field(default_factory=list, max_length=20)
    study_group: StudyGroup | None = None

    @field_validator("birth_date")
    @classmethod
    def _nao_pode_ser_no_futuro(cls, value: date) -> date:
        return _recusa_nascimento_futuro(value)


class PatientUpdate(BaseModel):
    """Todos os campos opcionais: o PATCH grava só o que foi enviado.

    `extra="forbid"` faz um campo desconhecido virar 422 em vez de ser silenciosamente
    ignorado — um typo no cliente não pode parecer sucesso.
    """

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    birth_date: date | None = None
    sex: Sex | None = None
    phone: str | None = Field(default=None, max_length=40)
    diagnoses: list[DiagnosisIn] | None = Field(default=None, max_length=20)
    study_group: StudyGroup | None = None

    @field_validator("full_name", "birth_date")
    @classmethod
    def _obrigatorio_nao_pode_ser_apagado(
        cls, value: str | date | None, info: ValidationInfo
    ) -> str | date | None:
        """Campo `not null` no banco não pode ser limpo por um `null` explícito.

        Os outros três campos são nulos no banco, então enviar `null` neles significa
        limpar o campo — que é o comportamento desejado. `full_name` e `birth_date` são
        `not null`: sem esta guarda o `UPDATE` falharia no constraint e o cliente
        receberia 500 por um erro que é dele. Para `full_name`, `min_length` sozinho não
        resolve — ele só vale para `str`, e `null` passaria por baixo.
        """
        if value is None:
            raise ValueError(f"{info.field_name} não pode ser nulo")
        return value

    @field_validator("birth_date")
    @classmethod
    def _nao_pode_ser_no_futuro(cls, value: date | None) -> date | None:
        # O nulo já foi recusado acima; a anotação o admite porque os dois validadores
        # rodam sobre o mesmo campo opcional.
        return None if value is None else _recusa_nascimento_futuro(value)


class PatientOut(BaseModel):
    id: UUID
    full_name: str
    birth_date: date
    sex: Sex | None
    phone: str | None
    diagnoses: list[DiagnosisOut]
    # 'caso' ou 'controle'. Nulo é "ainda não classificado", que é diferente de controle.
    study_group: StudyGroup | None
    created_at: datetime
    updated_at: datetime
    # O nome de quem é a linha, nunca o `owner_id`: a tela precisa saber de quem é o
    # prontuário, e o id do tenant não interessa ao cliente. Nulo nas linhas do próprio
    # chamador e para quem não é admin nem par de pool — ver `app.user_display_name()`.
    owner_name: str | None = None
    # Quem gravou a última edição, quando não foi quem está lendo. Só aparece no acervo
    # de pesquisa, onde alguém além do dono pode ter editado.
    editor_name: str | None = None
    # O que este chamador pode fazer com esta linha, calculado pelo banco com as mesmas
    # funções que as policies usam. A tela não deduz mais isso de `owner_name`: no
    # acervo de pesquisa "é de outra pessoa" deixou de significar "não posso editar".
    can_edit: bool = True
    can_delete: bool = True

    @classmethod
    def from_entity(cls, patient: Patient) -> PatientOut:
        return cls(
            id=patient.id,
            full_name=patient.full_name,
            birth_date=patient.birth_date,
            sex=patient.sex,
            phone=patient.phone,
            diagnoses=[
                DiagnosisOut(code=d.code, label=d.label or d.code, is_primary=d.is_primary)
                for d in patient.diagnoses
            ],
            study_group=patient.study_group,
            created_at=patient.created_at,
            updated_at=patient.updated_at,
            owner_name=patient.owner_name,
            editor_name=patient.editor_name,
            can_edit=patient.can_edit,
            can_delete=patient.can_delete,
        )


class ActivityLevel(StrEnum):
    """Faixa de atividade da doença. Espelha DISEASE_ACTIVITY_META no frontend."""

    REMISSION = "remission"
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"


class JointEvaluationIn(BaseModel):
    """O achado de uma articulação. Duas perguntas, nada além disso."""

    model_config = ConfigDict(extra="forbid")

    pain: bool
    swelling: bool


class CdaiScore(BaseModel):
    """CDAI = TJC28 + SJC28 + PGA + EGA, ambos os globais em EVA de 0 a 10. Faixa 0 a 76."""

    model_config = ConfigDict(extra="forbid")

    score: float = Field(ge=0, le=76)
    level: ActivityLevel
    tender_count: int = Field(ge=0, le=28)
    swollen_count: int = Field(ge=0, le=28)
    patient_global: float = Field(ge=0, le=10)
    evaluator_global: float = Field(ge=0, le=10)


class Das28Score(BaseModel):
    """DAS28 por VHS ou PCR. O teto de 10 cobre a faixa clínica com folga."""

    model_config = ConfigDict(extra="forbid")

    score: float = Field(ge=0, le=10)
    level: ActivityLevel
    tender_count: int = Field(ge=0, le=28)
    swollen_count: int = Field(ge=0, le=28)
    acute_phase: Literal["esr", "crp"]
    acute_value: float = Field(ge=0, le=300)
    patient_global_health: float = Field(ge=0, le=100)


# A chave do objeto JSON é o tipo de avaliação — é o que dá unicidade por tipo sem
# constraint nenhuma no banco. O casing é normalizado aqui, na fronteira: o frontend
# usa 'CDAI'/'DAS28' e o banco guarda minúsculo.
_SCORE_MODELS: dict[str, type[BaseModel]] = {"cdai": CdaiScore, "das28": Das28Score}

# Teto de segurança: o catálogo tem 28 articulações no corpo e algumas dezenas nas
# mãos. Cem cobre tudo com folga e impede um payload absurdo de ser gravado.
_MAX_JOINTS = 100


class EncounterCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    occurred_at: datetime | None = None
    # `max_length` não é decorativo: o uvicorn não limita o tamanho do corpo, e um
    # campo textual sem teto seria bufferizado em memória e gravado como veio.
    reason: str | None = Field(default=None, max_length=300)

    # As duas etapas do fluxo de Análise Térmica são opcionais, então os dois campos
    # também são: cabe consulta sem body map, e body map sem escore fechado (o DAS28
    # exige VHS/PCR, que nem sempre está em mãos na hora).
    joint_evaluations: dict[str, JointEvaluationIn] | None = None
    scores: dict[str, Any] | None = None

    @field_validator("joint_evaluations")
    @classmethod
    def _valida_articulacoes(
        cls, value: dict[str, JointEvaluationIn] | None
    ) -> dict[str, JointEvaluationIn] | None:
        if value is None:
            return None
        if len(value) > _MAX_JOINTS:
            raise ValueError(f"no máximo {_MAX_JOINTS} articulações por avaliação")
        # O catálogo de articulações vive no frontend e não é replicado aqui — duas
        # listas divergiriam em silêncio. Valida-se a forma do id, não o valor.
        invalidos = [k for k in value if not _JOINT_ID.fullmatch(k)]
        if invalidos:
            raise ValueError(f"ids de articulação inválidos: {sorted(invalidos)[:5]}")
        return value

    @field_validator("scores")
    @classmethod
    def _valida_escores(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        normalizado: dict[str, Any] = {}
        for tipo, payload in value.items():
            chave = tipo.lower()
            modelo = _SCORE_MODELS.get(chave)
            if modelo is None:
                conhecidos = sorted(_SCORE_MODELS)
                raise ValueError(f"tipo de avaliação desconhecido: {tipo!r}; use {conhecidos}")
            if chave in normalizado:
                raise ValueError(f"tipo de avaliação repetido: {chave!r}")
            normalizado[chave] = modelo.model_validate(payload).model_dump()
        return normalizado


class EncounterOut(BaseModel):
    id: UUID
    patient_id: UUID
    occurred_at: datetime
    reason: str | None
    # Devolvidos como vieram do banco: é o que permite reabrir a consulta e ver os
    # mesmos dados. As chaves de `scores` saem minúsculas, como foram gravadas.
    joint_evaluations: dict[str, JointEvaluationIn] | None
    scores: dict[str, Any]
    # `null` = consulta sem análise de imagem; 'uploading' = linhas gravadas e o
    # cliente ainda não confirmou o envio; 'ready' = ele confirmou. Quem confere os
    # objetos é o cliente, que viu a resposta de cada PUT — ver `MarkAnalysisReady`.
    analysis_status: Literal["uploading", "ready"] | None
    capture_count: int
    created_at: datetime
    # Quem registrou a consulta, quando não foi quem está lendo. No acervo de pesquisa
    # o dono da consulta é o dono do PACIENTE, então ele não responde essa pergunta.
    author_name: str | None = None
    can_edit: bool = True
    can_delete: bool = True

    @classmethod
    def from_entity(cls, encounter: Encounter) -> EncounterOut:
        return cls(
            id=encounter.id,
            patient_id=encounter.patient_id,
            occurred_at=encounter.occurred_at,
            reason=encounter.reason,
            analysis_status=encounter.analysis_status.value if encounter.analysis_status else None,
            capture_count=encounter.capture_count,
            joint_evaluations=dict(encounter.joint_evaluations)
            if encounter.joint_evaluations
            else None,
            scores=dict(encounter.scores),
            created_at=encounter.created_at,
            author_name=encounter.author_name,
            can_edit=encounter.can_edit,
            can_delete=encounter.can_delete,
        )


class CaptureMeasurementIn(BaseModel):
    """A medição de uma articulação numa captura.

    Deixou de ser dicionário opaco quando `measurements` virou tabela: agora cada campo
    tem coluna, e o que a borda não validar chega no banco como cast de texto.

    **A identidade é `joint_id`, o vocabulário do body map.** A análise térmica trabalha
    internamente com lado mais índice do landmark do MediaPipe e traduz ao montar o
    payload — da fronteira da API para dentro existe uma nomenclatura só, e é ela que
    permite cruzar esta medição com a avaliação articular. Ver `medicoes_das_rois`.

    Os campos numéricos são opcionais porque uma ROI pode não ter leitura válida: sem
    pele suficiente ou fora da matriz, a captura registra a região e não a temperatura.
    O que não pode faltar é a identidade.
    """

    model_config = ConfigDict(extra="forbid")

    # Âncoras obrigatórias: o `pattern` do Pydantic casa em QUALQUER posição, então sem
    # `^...$` um `../x_ABC` passava por trazer um trecho válido no meio. A chave
    # estrangeira para `public.joints` continua sendo a fronteira real — e é por ela que
    # isto nunca foi explorável —, mas a borda precisa recusar o que diz que recusa.
    joint_id: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,39}$")

    # Faixa larga de propósito: é temperatura de pele em graus Celsius, e apertar aqui
    # recusaria uma medição estranha que o pesquisador precisa ver para investigar.
    t_mean: float | None = Field(default=None, ge=0, le=100)
    t_median: float | None = Field(default=None, ge=0, le=100)
    t_min: float | None = Field(default=None, ge=0, le=100)
    t_max: float | None = Field(default=None, ge=0, le=100)

    area: int | None = Field(default=None, ge=0)
    sample_count: int | None = Field(default=None, ge=0)

    shape: Literal["circle", "ellipse"] | None = None
    rgb_x: float | None = None
    rgb_y: float | None = None
    csv_x: float | None = None
    csv_y: float | None = None
    rx_csv: float | None = Field(default=None, ge=0)
    ry_csv: float | None = Field(default=None, ge=0)

    edited: bool = False


MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_CAPTURES = 64


class CaptureFileIn(BaseModel):
    """Declaração do arquivo — tamanho e tipo, não conteúdo.

    Ela NÃO prova que o upload aconteceu, e nada no servidor prova: quem confere é
    o cliente, que viu a resposta de cada PUT, e é ele que fecha a análise em
    `ready`. O preço dessa escolha está registrado em `MarkAnalysisReady`.
    """

    model_config = ConfigDict(extra="forbid")

    size: int = Field(gt=0, le=MAX_FILE_BYTES)
    content_type: str = Field(default="application/octet-stream", max_length=100)


class CaptureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Posição da captura, em uma coluna só: None = avulsa, 0 = basal, N = dinâmica N.
    # Nulo na avulsa porque uma captura solta pode ser basal, pós-estresse ou teste de
    # bancada — o banco precisa distinguir "não sei" de "é basal", e é o nulo que faz
    # isso agora que não há mais uma coluna `phase` ao lado para divergir dela.
    capture_index: int | None = Field(default=None, ge=0, lt=MAX_CAPTURES)
    elapsed_seconds: float | None = Field(default=None, ge=0, le=100_000)

    align_a: float | None = None
    align_b: float | None = None
    align_tx: float | None = None
    align_c: float | None = None
    align_d: float | None = None
    align_ty: float | None = None
    # Método, e não modo: 'manual' já é um dos valores aqui, então uma segunda coluna
    # dizendo o mesmo só criaria a chance de as duas discordarem.
    alignment_method: Literal["silhouette", "fiducial", "manual"] | None = None

    agreement: dict[str, Any] | None = None
    fiducial_correction: dict[str, Any] | None = None
    measurements: list[CaptureMeasurementIn] = Field(default_factory=list, max_length=64)
    # Problema de processamento desta captura — uma sequência de 21 pode ter uma
    # falha isolada, e perder esse registro esconderia por que ela não tem medição.
    issue: str | None = Field(default=None, max_length=300)

    # As chaves são Literal, não texto livre: elas entram na chave do objeto no R2, e
    # texto livre permitiria `../` e escapar do prefixo do dono.
    files: dict[Literal["optical", "thermal", "matrix"], CaptureFileIn]

    @field_validator("files")
    @classmethod
    def _os_tres(cls, value: dict[str, CaptureFileIn]) -> dict[str, CaptureFileIn]:
        """Uma captura é o conjunto dos três arquivos, nunca um subconjunto.

        Sem a matriz não há medição, e sem as duas imagens não há o que alinhar —
        uma captura incompleta é uma que ninguém consegue reabrir. E é esta regra que
        sustenta o resto: como toda captura tem os três, a lista de arquivos é o enum
        `FileKind`, e não uma coluna. Aceitar um subconjunto aqui faria a assinatura
        de leitura e a exclusão mirarem um objeto que nunca existiu.
        """
        faltando = {"optical", "thermal", "matrix"} - set(value)
        if faltando:
            raise ValueError(f"captura sem os arquivos: {', '.join(sorted(faltando))}")
        return value


class AnalysisCreate(BaseModel):
    """Corpo do `POST /encounters/{id}/captures`.

    Uma consulta tem UMA análise. Avulsa é `captures` com um elemento; sequência tem
    N. Não há discriminador, e é de propósito.
    """

    model_config = ConfigDict(extra="forbid")

    captures: list[CaptureIn] = Field(min_length=1, max_length=MAX_CAPTURES)

    @field_validator("captures")
    @classmethod
    def _indices(cls, value: list[CaptureIn]) -> list[CaptureIn]:
        indices = [c.capture_index for c in value]
        if len(set(indices)) != len(indices):
            raise ValueError("capture_index repetido")
        # A basal única não precisa de checagem própria: ela é a captura de índice 0, e
        # a linha acima já recusa índice repetido. `unique (encounter_id, capture_index)`
        # cobra o mesmo no banco; recusar aqui só troca o erro de constraint por uma
        # mensagem legível.
        return value


class SignedUploadOut(BaseModel):
    capture_id: UUID
    capture_index: int | None
    kind: Literal["optical", "thermal", "matrix"]
    url: str


class AnalysisCreatedOut(BaseModel):
    """As URLs valem por 1 h e o POST **não** pode ser repetido.

    Repetir criaria um segundo jogo de capturas sob a mesma consulta; o backend
    recusa com 409. Guarde estas URLs.
    """

    encounter_id: UUID
    uploads: list[SignedUploadOut]


class CaptureFileOut(BaseModel):
    """Arquivo da captura, com a URL de leitura assinada.

    `url` é nula quando o R2 não está configurado: a consulta ainda abre, com as
    medições e os escores, só sem as imagens.

    Só a URL sai: `size` e `content_type` eram devolvidos e nenhuma tela os lia — a
    reabertura usa `url` e mais nada.
    """

    url: str | None = None


class CaptureDetailOut(BaseModel):
    """Uma captura como ela foi gravada — é isto que reconstrói a tela.

    Os campos saem crus, do jeito que o domínio os produziu: a sobreposição é
    remontada no frontend a partir da afim e da matriz do CSV baixado, e a curva a
    partir de `measurements`. Nada é recalculado aqui.
    """

    id: UUID
    # None = avulsa, 0 = basal, N = dinâmica N. A tela deriva o `kind` daqui.
    capture_index: int | None
    elapsed_seconds: float | None

    align_a: float | None
    align_b: float | None
    align_tx: float | None
    align_c: float | None
    align_d: float | None
    align_ty: float | None
    alignment_method: Literal["silhouette", "fiducial", "manual"] | None

    agreement: dict[str, Any] | None
    fiducial_correction: dict[str, Any] | None
    measurements: list[dict[str, Any]]
    issue: str | None
    files: dict[str, CaptureFileOut]


class EncounterDetailOut(EncounterOut):
    """A consulta reaberta, com tudo que a tela precisa numa chamada só.

    `patient` reusa `PatientOut` em vez de redeclarar o formato — assim a próxima
    mudança de coluna acerta este endpoint e o de pacientes de uma vez.

    `captures` vem vazia enquanto `analysis_status` não for `ready`: em `uploading`
    os objetos podem não estar no bucket, e URLs para eles dariam 404 na tela.
    """

    patient: PatientOut
    captures: list[CaptureDetailOut]


class PatientDetailOut(PatientOut):
    """Detalhe do paciente com as consultas embutidas.

    Evita um segundo request na tela de detalhe, mesmo motivo pelo qual o agregado da
    Fase 6 embute o paciente dentro da consulta.
    """

    encounters: list[EncounterOut]


# --- Algoritmos -------------------------------------------------------------


class AlgorithmOut(BaseModel):
    """Um algoritmo disponível, como a tela o lista.

    `scope` é o que diz à tela o que perguntar antes de executar: qual consulta, ou
    nada. É declarado pelo próprio algoritmo, e não deduzido de onde ele foi
    registrado — há uma lista só.
    """

    slug: str
    title: str
    description: str
    scope: Literal["encounter", "cohort"]


class AlgorithmValueOut(BaseModel):
    """Um número com nome. `unit` ausente quando o número não tem unidade."""

    label: str
    value: float
    unit: str | None = None


class AlgorithmResultOut(BaseModel):
    """O resultado, igual para os dois tipos de algoritmo.

    `status` não é redundante com `summary`: sem ele a tela teria que interpretar o
    texto para saber se mostra um achado ou a razão de não haver achado.
    """

    status: Literal["ok", "insufficient-data"]
    summary: str
    values: list[AlgorithmValueOut]

    @classmethod
    def from_result(cls, result: AlgorithmResult) -> AlgorithmResultOut:
        return cls(
            status=result.status.value,
            summary=result.summary,
            values=[
                AlgorithmValueOut(label=v.label, value=v.value, unit=v.unit) for v in result.values
            ],
        )


class RunAlgorithmIn(BaseModel):
    """Sobre o que rodar.

    Opcional porque o recorte depende do `scope` do algoritmo: um de consulta exige o
    id, um de coorte não recebe nada e alcança o acervo inteiro daquele usuário. Quem
    cobra a presença é o caso de uso, que conhece o algoritmo — validar aqui exigiria
    que o schema consultasse o registry para saber qual regra aplicar.
    """

    model_config = ConfigDict(extra="forbid")

    encounter_id: UUID | None = None
