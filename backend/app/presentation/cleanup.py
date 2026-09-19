"""Limpeza do bucket depois de uma exclusão.

Existe porque duas rotas destrutivas — apagar paciente e apagar consulta — precisam
exatamente do mesmo cuidado, e ele não é óbvio: *quando* apagar (depois do commit) e
*o que fazer sem R2 configurado. Duplicá-lo era duplicar a chance de uma das duas
apagar cedo demais.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from fastapi import BackgroundTasks

from app.domain.entities import CaptureFile
from app.domain.repositories import ObjectStorage

logger = logging.getLogger(__name__)


def schedule_orphan_cleanup(
    background: BackgroundTasks,
    storage: ObjectStorage | None,
    orfaos: Sequence[CaptureFile],
    *,
    alvo: str,
) -> None:
    """Agenda o DELETE no R2 dos arquivos que a exclusão deixou órfãos.

    Em background de propósito: roda DEPOIS da resposta, e portanto depois de a
    transação ter commitado. Apagar antes inverteria o risco — uma falha no commit
    deixaria o registro vivo apontando para arquivos que já não existem.

    Sem bucket configurado não há como limpar. O registro clínico já foi apagado; o
    que fica é custo de armazenamento, e ele é registrado em log para poder ser
    varrido depois. `alvo` é o que identifica a exclusão nesse log.
    """
    if not orfaos:
        return
    if storage is None:
        logger.warning("%s apagado com %d arquivos órfãos: R2 não configurado", alvo, len(orfaos))
        return
    background.add_task(storage.delete, orfaos)
