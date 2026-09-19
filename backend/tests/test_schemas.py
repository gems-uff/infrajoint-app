"""Testes das validações de borda que não dependem de banco.

Sem asyncpg e sem HTTP: os schemas são Pydantic puro, e as regras abaixo são as que
recusam um payload ANTES de a consulta existir. Vivem separadas dos testes de API
porque aqueles precisam do Supabase local e são pulados sem ele — e estas são
justamente as guardas que não podem depender de alguém ter subido o Docker.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.presentation.schemas import CaptureMeasurementIn, PatientCreate, PatientUpdate

HOJE = date.today()
ONTEM = HOJE - timedelta(days=1)
AMANHA = HOJE + timedelta(days=1)


# --- Data de nascimento -----------------------------------------------------
#
# O banco só cobra `not null`. Sem esta guarda, um dedo no ano errado criava paciente
# nascido depois da consulta — que não quebra nada em execução e contamina em silêncio
# o acervo que a pesquisa vai analisar.


@pytest.mark.parametrize("quando", [ONTEM, HOJE, date(1940, 2, 29)])
def test_aceita_nascimento_ate_hoje(quando: date) -> None:
    assert PatientCreate(full_name="Fulana", birth_date=quando).birth_date == quando


def test_recusa_nascimento_no_futuro_na_criacao() -> None:
    with pytest.raises(ValidationError, match="não pode estar no futuro"):
        PatientCreate(full_name="Fulana", birth_date=AMANHA)


def test_recusa_nascimento_no_futuro_na_edicao() -> None:
    with pytest.raises(ValidationError, match="não pode estar no futuro"):
        PatientUpdate(birth_date=AMANHA)


def test_edicao_sem_a_data_continua_passando() -> None:
    """O PATCH é parcial: não enviar o campo não pode esbarrar no validador."""
    alteracao = PatientUpdate(full_name="Outro Nome")
    assert alteracao.model_dump(exclude_unset=True) == {"full_name": "Outro Nome"}


def test_edicao_nao_apaga_a_data_com_nulo() -> None:
    """A guarda anterior continua valendo: `birth_date` é `not null` no banco."""
    with pytest.raises(ValidationError, match="não pode ser nulo"):
        PatientUpdate(birth_date=None)


# --- Id de articulação da medição -------------------------------------------


def test_aceita_id_de_articulacao_do_catalogo() -> None:
    assert CaptureMeasurementIn(joint_id="RIGHT_MCP_3").joint_id == "RIGHT_MCP_3"


@pytest.mark.parametrize("bruto", ["../evil_ABCDE", "x RIGHT_MCP_3", "RIGHT_MCP_3 x", "ab"])
def test_recusa_id_de_articulacao_fora_do_formato(bruto: str) -> None:
    """O `pattern` do Pydantic casa em qualquer posição: sem as âncoras, os três
    primeiros passavam por trazer um trecho válido no meio."""
    with pytest.raises(ValidationError):
        CaptureMeasurementIn(joint_id=bruto)
