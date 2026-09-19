"""Contratos dos algoritmos de pesquisa.

Um algoritmo recebe **linhas de medição** e devolve **dados**: uma frase e uma lista de
números com nome. Ele não formata nada, porque quem decide que 1.4 aparece como
"1,4 °C" é a tela, uma vez só, igual para todos. É o que faz plugar um algoritmo novo
custar só a conta.

**Uma interface só, e não uma por escopo.** Houve uma versão com duas, `AnalysisAlgorithm`
e `CohortAlgorithm`, cada uma recebendo o dado numa forma: a primeira em árvore
(consulta → capturas → medições), a segunda em tabela. A diferença parecia natural
porque a forma em árvore foi herdada do algoritmo que veio do frontend, e não porque
alguma regra a exigisse. Achatando as duas numa linha só, o escopo deixa de ser um tipo
e vira o que sempre foi: um filtro na consulta.

O que sobra são duas perguntas separadas, e cada uma com um dono claro:

- **Quais linhas chegam** é do `scope` que o algoritmo declara, resolvido antes do `run`.
- **O que fazer com elas** é do algoritmo, dentro do `run`.

Este módulo não importa framework, banco nem HTTP: um algoritmo é função pura, e é isso
que permite testá-lo com objetos literais.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID


class AlgorithmStatus(StrEnum):
    """`INSUFFICIENT_DATA` é resposta legítima, não erro.

    Sequência ruim é caso comum, e sem este campo a tela teria que interpretar o texto
    do resumo para saber se mostra um achado ou a justificativa de não haver achado.
    """

    OK = "ok"
    INSUFFICIENT_DATA = "insufficient-data"


class AlgorithmScope(StrEnum):
    """Sobre que recorte o algoritmo trabalha.

    É o único campo que distingue um algoritmo de outro na borda, e ele existe para a
    tela saber o que perguntar antes de executar: qual consulta, ou nada.

    `COHORT` não pede filtro nenhum e alcança tudo que a RLS deixa aquele usuário ver.
    Não é acesso privilegiado: é a mesma visibilidade que ele teria navegando pela tela.
    """

    ENCOUNTER = "encounter"
    COHORT = "cohort"


@dataclass(frozen=True, slots=True)
class AlgorithmValue:
    """Uma linha do resultado: um número com nome, e a unidade quando houver."""

    label: str
    value: float
    # Ausente quando o número não tem unidade — uma contagem, uma proporção.
    unit: str | None = None


@dataclass(frozen=True, slots=True)
class AlgorithmResult:
    """O que todo algoritmo devolve.

    `values` vazio é caso normal: o achado pode não ser numérico, e aí a tela mostra só
    o resumo.
    """

    status: AlgorithmStatus
    summary: str
    values: Sequence[AlgorithmValue] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class Observation:
    """Uma medição de ROI, com o contexto dela ao lado.

    É a linha que todo algoritmo recebe, seja ele de uma consulta ou de muitas. Uma
    planilha: paciente, grupo, consulta e captura se repetem em cada linha da mesma
    captura, e é essa repetição que dispensa a estrutura em árvore.

    **Dataclass, e não dicionário.** Um `Mapping[str, Any]` seria mais frouxo e deixaria
    um nome de campo errado falhar só quando rodasse. Aqui ele falha ao escrever.

    **O que tem mais de uma linha por dono entra por um caminho só**, e é isso que
    mantém a linha sendo uma por medição: do diagnóstico vem só o principal, e cada
    escore virou um campo. Juntar essas tabelas inteiras multiplicaria cada medição, e o
    erro não apareceria — sairia uma média sobre linhas repetidas, plausível e errada.

    **A maioria destes campos ainda não tem leitor**, e isso é escolha, não descuido: o
    único algoritmo escrito usa seis deles. Em outras partes do projeto a régua é a
    oposta — a migration `colunas_sem_uso` removeu colunas sem consumidor —, e aqui ela
    não vale porque a linha É o conjunto de variáveis do estudo. Ela existe para as
    perguntas de pesquisa serem escritas sem mexer no SQL, e a primeira delas, comparar
    temperatura entre casos e controles, já usa grupo e as quatro temperaturas.

    O que não entrou foi o que tem custo sem pergunta à vista: as comorbidades, que
    exigiriam agregação, e nome e telefone, que são identificação e não variável.
    """

    # --- o paciente ---------------------------------------------------------
    patient_id: UUID
    # `None` = ainda não classificado, que é diferente de controle.
    study_group: str | None
    # O código da CID-10 marcado como principal, e só ele.
    #
    # As comorbidades ficam de fora porque trazer N diagnósticos numa linha por medição
    # exige agregá-los antes, e ninguém as lê ainda. O principal é um só por paciente,
    # garantido por índice, então ele entra num join comum.
    primary_diagnosis: str | None

    # --- a consulta ---------------------------------------------------------
    encounter_id: UUID
    occurred_at: datetime

    # Os escores fechados naquela consulta, um campo por índice.
    #
    # **`index_type` não vira coluna, e isso não é estilo.** `encounter_scores` tem
    # chave (encounter_id, index_type), então até duas linhas por consulta: carregar o
    # tipo como valor duplicaria cada medição, uma vez para o CDAI e outra para o
    # DAS28. Achatados em campos nomeados, a linha continua sendo uma por medição.
    #
    # `None` quando aquele índice não foi fechado — o DAS28 exige VHS ou PCR, que nem
    # sempre está em mãos.
    cdai_score: float | None
    cdai_level: str | None
    das28_score: float | None
    das28_level: str | None

    # --- a captura ----------------------------------------------------------
    capture_id: UUID
    # `None` na análise avulsa, 0 na basal, N na dinâmica N.
    capture_index: int | None

    # --- a medição ----------------------------------------------------------
    #
    # Os cinco campos abaixo são nulos juntos, e só num caso: a captura existe e não
    # produziu medição nenhuma. A linha vem assim mesmo, em vez de sumir, porque uma
    # captura sem medição é informação sobre a coleta — é o buraco na sequência, e quem
    # relata "a anterior não tem articulação medida" precisa enxergá-lo.
    joint_id: str | None
    # O rótulo do catálogo sem o lado ("MCP 3"), para nomear o par na comparação.
    label: str | None
    side: str | None
    # `None` também quando a ROI existe e não teve leitura válida: 0 °C é temperatura
    # possível, e confundir "não medido" com "muito frio" é erro que não aparece.
    t_mean: float | None
    t_median: float | None
    t_min: float | None
    t_max: float | None
    # `sample_count / area`. Não é coluna do banco: a migration `colunas_sem_uso` a
    # removeu por ser derivada, e o repositório a recalcula na leitura.
    skin_coverage: float

    # O que o médico marcou NESTA articulação, nesta consulta.
    #
    # É o cruzamento que a reestruturação das tabelas tornou possível: a medição e a
    # avaliação usam o mesmo `joint_id`, vindo do mesmo catálogo. `None` quando a
    # articulação não foi avaliada, que é diferente de avaliada como sem dor.
    pain: bool | None
    swelling: bool | None

    @property
    def measured(self) -> bool:
        """A linha carrega uma medição, e não só a existência da captura."""
        return self.joint_id is not None


class Algorithm(Protocol):
    """Um algoritmo plugado.

    Implementações são trocáveis atrás desta assinatura, e é o único padrão de projeto
    envolvido: Strategy. Quem chama acha pelo `slug` e executa, sem saber qual rodou.

    `scope` não muda a assinatura de `run`, só decide quais linhas o chamador busca
    antes de chamar.
    """

    slug: str
    title: str
    description: str
    scope: AlgorithmScope

    def run(self, rows: Sequence[Observation]) -> AlgorithmResult: ...
