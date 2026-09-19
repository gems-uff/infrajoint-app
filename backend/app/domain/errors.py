"""Erros de negócio. A tradução para HTTP acontece na borda, em main.py."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - só para tipar o payload do conflito
    from app.domain.entities import Patient


class DomainError(Exception):
    """Base para tudo que o domínio sabe recusar."""


class NotFoundError(DomainError):
    """Recurso inexistente — ou existente e invisível para quem pediu.

    Os dois casos colapsam de propósito. A RLS devolve zero linhas quando a linha é
    de outro tenant, e responder 403 ali confirmaria que o id existe.
    """


class ForbiddenError(DomainError):
    """A identidade é conhecida, mas o papel não autoriza a operação."""


class ConflictError(DomainError):
    """O pedido é válido, mas o estado atual do recurso não o comporta.

    Repetir o POST de uma análise que já existe, ou fechar em `ready` uma análise
    cujos arquivos não chegaram ao bucket. A mensagem diz o que falta — é erro de
    fluxo do cliente, não falha interna, então ela pode sair para fora.
    """


class DuplicatePatientError(ConflictError):
    """Já existe paciente com este nome sob o mesmo médico.

    Carrega os candidatos junto: recusar sem dizer *quem* já existe obrigaria a tela
    a ir buscá-los, e o médico decide justamente olhando as datas de nascimento. Um
    homônimo de verdade é cadastrável — o cliente repete o pedido dizendo que quer
    mesmo —, o que o banco continua recusando é nome e nascimento idênticos.
    """

    def __init__(self, message: str, matches: Sequence[Patient]) -> None:
        super().__init__(message)
        self.matches = matches
