"""Portas de persistência.

São Protocols, não classes-base: a implementação em infrastructure/ não importa este
módulo, e os casos de uso podem ser testados com um dublê de três linhas.

Nenhum método recebe `owner_id`. Isso é intencional — a delimitação por tenant é da
RLS, que já roda com as claims do usuário na conexão. Se a assinatura aceitasse
owner_id, existiria um caminho no código capaz de pedir dado de outro dono.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol
from uuid import UUID

from app.domain.algorithms import Observation
from app.domain.entities import (
    Capture,
    CaptureFile,
    Encounter,
    NewEncounter,
    NewPatient,
    Patient,
)


class PatientRepository(Protocol):
    async def list_all(self) -> Sequence[Patient]: ...

    async def get(self, patient_id: UUID) -> Patient | None: ...

    async def find_by_name(self, full_name: str) -> Sequence[Patient]:
        """Pacientes do próprio médico cujo nome normalizado é o mesmo.

        Serve ao aviso de duplicata na criação. Usa a mesma normalização do índice
        único, para a tela avisar exatamente sobre o que o banco recusaria.
        """
        ...

    async def create(self, data: NewPatient) -> Patient: ...

    async def update(self, patient_id: UUID, changes: Mapping[str, Any]) -> Patient | None: ...

    async def delete(self, patient_id: UUID) -> bool:
        """`False` quando nada foi apagado — inexistente ou invisível pela RLS."""
        ...


class EncounterRepository(Protocol):
    async def list_for_patient(self, patient_id: UUID) -> Sequence[Encounter]: ...

    async def get(self, encounter_id: UUID) -> Encounter | None: ...

    async def create(self, patient_id: UUID, data: NewEncounter) -> Encounter: ...

    async def start_analysis(self, encounter_id: UUID) -> Encounter | None:
        """Marca a consulta como tendo análise em envio. `None` se ela não for visível."""
        ...

    async def set_analysis_status(self, encounter_id: UUID, status: str) -> bool: ...

    async def delete(self, encounter_id: UUID) -> bool:
        """`False` quando nada foi apagado — inexistente ou invisível pela RLS."""
        ...


class CaptureRepository(Protocol):
    async def create_many(
        self, encounter_id: UUID, captures: Sequence[Mapping[str, Any]]
    ) -> Sequence[Capture]: ...

    async def list_for_encounter(self, encounter_id: UUID) -> Sequence[Capture]: ...

    async def list_detail_for_encounter(self, encounter_id: UUID) -> Sequence[Mapping[str, Any]]:
        """Linhas completas das capturas, para reabrir a consulta.

        Devolve Mapping e não entidade de propósito: é projeção de leitura, com 20
        colunas que ninguém combina nem valida — criar uma dataclass só para
        atravessá-la seria cerimônia sem regra dentro.
        """
        ...

    async def list_files_for_patient(self, patient_id: UUID) -> Sequence[CaptureFile]:
        """Todo arquivo de captura sob o paciente, para poder apagá-los do bucket.

        Existe porque a cascata do banco não alcança o R2: apagar o paciente destrói
        as linhas e deixa os objetos pagando armazenamento para sempre. Precisa ser
        chamado ANTES do DELETE — depois não há mais de onde derivar as chaves.
        """
        ...

    async def list_files_for_encounter(self, encounter_id: UUID) -> Sequence[CaptureFile]:
        """O mesmo, no recorte de uma consulta. Também antes do DELETE."""
        ...


class AlgorithmDataRepository(Protocol):
    """De onde os algoritmos tiram dado. Eles mesmos nunca consultam o banco.

    A separação não é cerimônia: é ela que deixa um algoritmo ser testado com objetos
    literais, e que impede que a regra de pesquisa e o SQL se misturem num arquivo só.

    Um método só, porque a diferença entre os dois recortes cabe numa cláusula `WHERE`.
    """

    async def observations(self, encounter_id: UUID | None = None) -> Sequence[Observation]:
        """As linhas de medição, filtradas por consulta ou não filtradas.

        `encounter_id` preenchido devolve o recorte de uma consulta; nulo devolve tudo
        que a RLS deixa este usuário ver, que é o recorte de coorte.

        Vazio quando a consulta não tem análise, e também quando ela não é visível pela
        RLS. Quem distingue os dois casos é o caso de uso, resolvendo a consulta antes.
        """
        ...


class ObjectStorage(Protocol):
    """Porta para o R2.

    As duas assinaturas são cálculo local: assinar não toca a rede. Só `delete` é I/O,
    e é a implementação que decide como não bloquear o event loop.
    """

    def presign_put(self, file: CaptureFile, content_type: str) -> str: ...

    def presign_get(self, file: CaptureFile) -> str:
        """URL de leitura, curta: ela vai para o browser e some da tela em minutos."""
        ...

    async def delete(self, files: Sequence[CaptureFile]) -> None:
        """Apaga em lote. Chave inexistente não é erro — o objeto já não está lá."""
        ...
