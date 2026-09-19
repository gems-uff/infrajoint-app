"""Entidades e regras de negócio. Nenhum import de framework, banco ou HTTP."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class UserRole(StrEnum):
    """Espelha o enum public.user_role no banco."""

    USER = "user"
    MEDICO = "medico"
    # O pesquisador escreve dado clínico como o médico, e enxerga o acervo dos
    # outros pesquisadores. Quem decide isso é a RLS (`app.same_research_pool`),
    # nunca esta camada: aqui o papel só serve para recusar cedo, com mensagem.
    PESQUISADOR = "pesquisador"
    ADMIN = "admin"


class StudyGroup(StrEnum):
    """O papel da pessoa no estudo, e não um achado clínico.

    Fica em coluna própria, e não como um diagnóstico do catálogo, porque uma linha
    dizendo que alguém "tem" o diagnóstico Controle seria falsa num banco que outras
    pessoas vão analisar — e obrigaria toda consulta de diagnóstico a excluir um código
    mágico. Separado, um controle pode receber um diagnóstico incidental sem deixar de
    ser controle.

    Nulo na coluna significa "ainda não classificado", que é diferente de controle.
    """

    CASO = "caso"
    CONTROLE = "controle"


@dataclass(frozen=True, slots=True)
class Diagnosis:
    """Um diagnóstico do paciente, pelo código da CID-10.

    `label` vem do catálogo e só é preenchido na leitura, mesmo padrão de
    `Patient.owner_name`: nos caminhos de escrita o cliente enviou o código, e devolver
    o rótulo exigiria uma ida a mais ao banco para dizer o que ele já sabe.
    """

    code: str
    is_primary: bool = False
    label: str | None = None


class Sex(StrEnum):
    FEMALE = "F"
    MALE = "M"
    OTHER = "O"
    NOT_INFORMED = "N"


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    id: UUID
    role: UserRole

    @property
    def is_clinician(self) -> bool:
        """Quem pode criar e editar dado clínico.

        Espelha app.is_clinician() no banco de propósito: a API rejeita cedo para dar
        uma mensagem clara, e a policy rejeita de novo por ser a fronteira real. Se as
        duas discordarem, quem vence é o banco.

        Responde só "este papel escreve dado clínico?". **Em qual linha** ele pode
        escrever é outra pergunta, e ela não se responde a partir do papel desde que
        o acervo de pesquisa existe: quem responde é `Patient.can_edit`, que vem
        calculado pelo banco linha a linha.
        """
        return self.role in (UserRole.MEDICO, UserRole.PESQUISADOR, UserRole.ADMIN)


@dataclass(frozen=True, slots=True)
class Patient:
    id: UUID
    owner_id: UUID
    full_name: str
    # Obrigatória: sem documento e sem número de prontuário, é o único campo que
    # distingue dois homônimos. Ver a migration `birth_date_obrigatoria`.
    birth_date: date
    sex: Sex | None
    phone: str | None
    # Vários por paciente desde `diagnostico_e_grupo`: comorbidade em reumatologia é
    # regra, não exceção, e o campo de texto anterior cabia um só.
    diagnoses: Sequence[Diagnosis]
    study_group: StudyGroup | None
    created_at: datetime
    updated_at: datetime
    # Nome do dono, e não o id: serve à tela, não à autorização. Vem preenchido para
    # o admin e para o par de pool, e só nas linhas alheias — `app.user_display_name()`
    # devolve NULL nos demais casos, e para um médico comum ele diria o nome dele
    # mesmo em toda linha.
    owner_name: str | None = None
    # Quem gravou a última edição, quando não foi quem está lendo. Só faz sentido no
    # acervo compartilhado, e é NULL fora dele.
    editor_name: str | None = None
    # Espelho das policies, calculado pelo banco linha a linha (`app.can_curate` e
    # `app.can_discard`). A tela usa para não oferecer o que a policy vai recusar, e
    # os casos de uso para responder 403 em vez de 404 a quem ENXERGA a linha.
    #
    # O default vale para os caminhos de escrita, que não selecionam as colunas: ali
    # a linha é sempre a que o próprio chamador acabou de gravar.
    can_edit: bool = True
    can_delete: bool = True


@dataclass(frozen=True, slots=True)
class NewPatient:
    full_name: str
    birth_date: date
    sex: Sex | None = None
    phone: str | None = None
    diagnoses: Sequence[Diagnosis] = ()
    study_group: StudyGroup | None = None


@dataclass(frozen=True, slots=True)
class Encounter:
    id: UUID
    patient_id: UUID
    owner_id: UUID
    occurred_at: datetime
    reason: str | None
    joint_evaluations: Mapping[str, Any] | None
    scores: Mapping[str, Any]
    # `None` = consulta sem análise de imagem. Distingue "não tem" de "tem e ainda
    # está subindo", que na tela são coisas bem diferentes.
    analysis_status: AnalysisStatus | None
    # Quantas capturas a consulta tem. Contado na listagem por paciente e ao abrir
    # a consulta; nos caminhos de escrita vale 0, o que é verdade neles: a consulta
    # acabou de nascer, ou as capturas ainda não foram inseridas.
    capture_count: int
    created_at: datetime
    updated_at: datetime
    # Quem registrou a consulta, quando não foi quem está lendo. No acervo de
    # pesquisa `owner_id` deixou de responder isso: a consulta que um pesquisador
    # registra no paciente de um par nasce com o owner do par.
    author_name: str | None = None
    # Mesmo espelho de `Patient`, e pelos mesmos motivos.
    can_edit: bool = True
    can_delete: bool = True


class FileKind(StrEnum):
    """Os três arquivos de uma captura, e a lista completa deles.

    É enum, e não texto livre, porque este valor entra na chave do objeto no R2 —
    texto livre permitiria `../` e escapar do prefixo do dono.

    Toda captura tem os três, sempre: é o que o schema de entrada cobra. Por isso
    iterar este enum **é** a lista de arquivos de qualquer captura, e não existe mais
    uma coluna `files` no banco repetindo a mesma informação linha a linha.
    """

    OPTICAL = "optical"
    THERMAL = "thermal"
    MATRIX = "matrix"


class AnalysisStatus(StrEnum):
    """Onde o upload está. `None` na coluna significa consulta sem análise."""

    UPLOADING = "uploading"
    READY = "ready"


@dataclass(frozen=True, slots=True)
class CaptureFile:
    """Endereço de um arquivo de captura, em termos de domínio.

    A porta de armazenamento recebe isto e deriva a chave sozinha — assim a
    aplicação nunca precisa saber como o R2 organiza objetos.
    """

    owner_id: UUID
    encounter_id: UUID
    capture_id: UUID
    kind: FileKind


@dataclass(frozen=True, slots=True)
class Capture:
    """Uma captura gravada, com o que basta para assinar suas URLs.

    Os resultados (`measurements`, alinhamento) não voltam aqui: eles são gravados e
    lidos pela tela de detalhe, não por este fluxo.
    """

    id: UUID
    encounter_id: UUID
    owner_id: UUID
    # None na análise avulsa, 0 na basal, N na dinâmica N.
    capture_index: int | None


@dataclass(frozen=True, slots=True)
class NewEncounter:
    """O que o fluxo de Análise Térmica grava ao finalizar.

    `joint_evaluations` e `scores` são opcionais porque as duas etapas do fluxo são
    opcionais: uma consulta pode existir sem body map, e um body map pode existir sem
    escore fechado (o DAS28 precisa de VHS/PCR, que nem sempre está em mãos).

    As duas ficam como Mapping e não como dataclass de domínio de propósito. O
    catálogo de articulações e as fórmulas dos índices vivem no frontend; replicá-los
    aqui criaria duas fontes da verdade que divergem em silêncio. A validação de
    forma e faixa acontece na borda, em presentation/schemas.py.
    """

    occurred_at: datetime | None = None
    reason: str | None = None
    joint_evaluations: Mapping[str, Any] | None = None
    scores: Mapping[str, Any] | None = None
