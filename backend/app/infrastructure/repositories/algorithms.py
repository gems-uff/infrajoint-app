"""Leitura do que os algoritmos consomem.

**Uma consulta só, e o escopo é o `WHERE`.** As linhas de uma consulta e as de vários
pacientes saem do mesmo SQL: o que muda é ter ou não o filtro por consulta. Foi a troca
que permitiu colapsar duas interfaces de algoritmo em uma, e ela vale nos dois sentidos
— sem o filtro, o caso de coorte funciona sem nenhuma peça nova.

A RLS continua sendo a fronteira: a conexão já roda com as claims do usuário, então a
consulta sem filtro devolve o acervo daquela pessoa, não o banco inteiro. Não há função
`SECURITY DEFINER` e não há caminho de leitura privilegiado para pesquisa.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

import asyncpg

from app.domain.algorithms import Observation

# O rótulo do catálogo, sem o lado.
#
# `joints.label` guarda "MCP 3 (mão direita)" e "Punho direito", que nomeiam UMA
# articulação. Quem compara os dois lados precisa nomear o PAR, e "MCP 3 (mão esquerda)
# (esquerda mais quente)" não é frase. A derivação fica aqui, ao lado do catálogo de
# onde ela sai, e não numa segunda tabela de rótulos no Python.
#
# O modo de falhar é seguro: `regexp_replace` devolve o texto intacto quando não casa,
# então um rótulo em formato novo aparece verboso, nunca errado.
_ROTULO_SEM_LADO = (
    r"regexp_replace(j.label, "
    r"'\s*\(mão (direita|esquerda)\)$|\s+(direito|direita|esquerdo|esquerda)$', '')"
)

# Cobertura de pele: quantas células da região tinham leitura válida.
#
# Não é coluna. A migration `colunas_sem_uso` a removeu porque era `sample_count / area`
# gravado ao lado das duas, e derivado guardado junto da origem diverge em silêncio no
# dia em que a forma de contar mudar. Volta a ser calculada na leitura, como o frontend
# já faz ao reconstruir a ROI.
#
# **Os dois `COALESCE` são obrigatórios, e o do numerador não é simetria.** As duas
# colunas são anuláveis no banco e opcionais em `CaptureMeasurementIn`, porque uma ROI
# pode registrar a região sem produzir leitura. Com `area` preenchida e `sample_count`
# nulo, a divisão devolvia NULL, o `float()` da leitura estourava e a rota respondia
# 500. Contagem ausente é zero célula aproveitada, que é cobertura zero — o mesmo
# default que o frontend aplica.
_COBERTURA = """
    CASE WHEN COALESCE(m.area, 0) > 0
         THEN COALESCE(m.sample_count, 0)::numeric / m.area
         ELSE 0
    END AS skin_coverage"""

# O diagnóstico principal do paciente.
#
# `patient_diagnoses` tem N linhas por paciente, porque comorbidade é regra em
# reumatologia, e juntá-la inteira multiplicaria cada medição pelo número de
# diagnósticos. Filtrando o principal na cláusula ON, o join devolve no máximo uma
# linha: o índice parcial `patient_diagnoses_um_principal` garante isso.
#
# As comorbidades ficam de fora enquanto nenhuma pergunta de pesquisa as pedir. Quando
# pedirem, elas voltam agregadas numa lista — o que exige uma subconsulta, justamente
# porque agregar é o preço de trazer N linhas sem multiplicar a medição.
_DIAGNOSTICOS = """
      LEFT JOIN public.patient_diagnoses dx
             ON dx.patient_id = p.id AND dx.is_primary"""

# Os escores da consulta, um join por índice em vez de um join com `index_type` na linha.
#
# `encounter_scores` tem chave (encounter_id, index_type), então até duas linhas por
# consulta. Um join simples duplicaria cada medição, uma vez para o CDAI e outra para o
# DAS28. Com o tipo fixado na cláusula ON, cada um vira um par de colunas.
_ESCORES = """
      LEFT JOIN public.encounter_scores sc_cdai
             ON sc_cdai.encounter_id = e.id AND sc_cdai.index_type = 'cdai'
      LEFT JOIN public.encounter_scores sc_das28
             ON sc_das28.encounter_id = e.id AND sc_das28.index_type = 'das28'"""

# A avaliação do médico NA MESMA articulação da medição.
#
# Esta é a única das três que junta sem cuidado extra: a chave é (encounter_id,
# joint_id), exatamente o par que a linha já tem, então sai no máximo uma avaliação por
# medição. É o cruzamento que a reestruturação das tabelas tornou possível.
_AVALIACAO = """
      LEFT JOIN public.encounter_joint_evaluations ev
             ON ev.encounter_id = e.id AND ev.joint_id = m.joint_id"""

# As colunas que os algoritmos leem.
_SELECT = f"""
    SELECT p.id           AS patient_id,
           p.study_group,
           dx.diagnosis_code AS primary_diagnosis,
           e.id           AS encounter_id,
           e.occurred_at,
           sc_cdai.score  AS cdai_score,
           sc_cdai.level  AS cdai_level,
           sc_das28.score AS das28_score,
           sc_das28.level AS das28_level,
           c.id           AS capture_id,
           c.capture_index,
           m.joint_id,
           j.side,
           {_ROTULO_SEM_LADO} AS label,
           m.t_mean,
           m.t_median,
           m.t_min,
           m.t_max,
           {_COBERTURA},
           ev.pain,
           ev.swelling
      FROM public.analysis_captures c
      JOIN public.encounters e ON e.id = c.encounter_id
      JOIN public.patients p ON p.id = e.patient_id
      LEFT JOIN public.capture_measurements m ON m.capture_id = c.id
      LEFT JOIN public.joints j ON j.id = m.joint_id{_DIAGNOSTICOS}{_ESCORES}{_AVALIACAO}"""

# A ordem reproduz a que o frontend usava: por tempo decorrido, com as capturas sem
# tempo ao final. Importa porque a assimetria térmica relata sobre a primeira captura
# com medição, e "primeira" precisa significar a mesma coisa aqui e na tela.
#
# `patient_id` e `encounter_id` vêm antes no recorte de coorte para as linhas de um
# mesmo paciente ficarem juntas; dentro de uma consulta só, eles são constantes e não
# atrapalham a ordem.
_ORDER = """
     ORDER BY p.id,
              e.occurred_at,
              c.elapsed_seconds NULLS LAST,
              c.capture_index NULLS FIRST,
              c.id,
              m.joint_id"""


def _to_observation(row: asyncpg.Record) -> Observation:
    """`numeric` chega como Decimal, e os algoritmos fazem conta com float.

    Misturar os dois levanta TypeError na subtração, então a conversão acontece aqui,
    na borda do banco, e não espalhada dentro de cada algoritmo.
    """

    def numero(coluna: str) -> float | None:
        valor = row[coluna]
        return None if valor is None else float(valor)

    return Observation(
        patient_id=row["patient_id"],
        study_group=row["study_group"],
        primary_diagnosis=row["primary_diagnosis"],
        encounter_id=row["encounter_id"],
        occurred_at=row["occurred_at"],
        cdai_score=numero("cdai_score"),
        cdai_level=row["cdai_level"],
        das28_score=numero("das28_score"),
        das28_level=row["das28_level"],
        capture_id=row["capture_id"],
        capture_index=row["capture_index"],
        joint_id=row["joint_id"],
        label=row["label"],
        side=row["side"],
        t_mean=numero("t_mean"),
        t_median=numero("t_median"),
        t_min=numero("t_min"),
        t_max=numero("t_max"),
        skin_coverage=float(row["skin_coverage"]),
        pain=row["pain"],
        swelling=row["swelling"],
    )


class PostgresAlgorithmDataRepository:
    def __init__(self, connection: asyncpg.Connection) -> None:
        self._connection = connection

    async def observations(self, encounter_id: UUID | None = None) -> Sequence[Observation]:
        """As linhas de medição, filtradas por consulta ou não filtradas.

        `encounter_id` preenchido devolve o recorte de uma consulta; nulo devolve tudo
        que a RLS deixa este usuário ver, que é o recorte de coorte. Um método só, e não
        um por escopo, porque a diferença cabe numa cláusula.

        Vazio quando não há o que ver — consulta sem análise, consulta de outro dono, ou
        um acervo ainda sem coleta. Quem distingue consulta invisível de consulta sem
        análise é o caso de uso, resolvendo a consulta antes.
        """
        if encounter_id is None:
            rows = await self._connection.fetch(f"{_SELECT}{_ORDER}")
        else:
            rows = await self._connection.fetch(
                f"{_SELECT}\n     WHERE c.encounter_id = $1{_ORDER}", encounter_id
            )
        return [_to_observation(row) for row in rows]
