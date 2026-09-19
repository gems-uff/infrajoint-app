from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.domain.entities import AuthenticatedUser, CaptureFile, NewPatient, Patient
from app.domain.errors import DuplicatePatientError, ForbiddenError, NotFoundError
from app.domain.repositories import CaptureRepository, PatientRepository


@dataclass(frozen=True, slots=True)
class ListPatients:
    patients: PatientRepository

    async def execute(self) -> Sequence[Patient]:
        # Sem filtro por dono: a RLS já restringiu a conexão ao tenant do chamador.
        return await self.patients.list_all()


@dataclass(frozen=True, slots=True)
class GetPatient:
    patients: PatientRepository

    async def execute(self, patient_id: UUID) -> Patient:
        patient = await self.patients.get(patient_id)
        if patient is None:
            raise NotFoundError("paciente não encontrado")
        return patient


@dataclass(frozen=True, slots=True)
class CreatePatient:
    patients: PatientRepository

    async def execute(
        self, user: AuthenticatedUser, data: NewPatient, *, allow_duplicate: bool = False
    ) -> Patient:
        """Cria o paciente, avisando antes se já houver homônimo.

        O aviso existe porque o banco não pode ser a primeira notícia: o índice único
        recusa nome + data iguais, mas quem cadastra normalmente nem lembra do
        paciente que já está lá. Recusando aqui, com a lista de quem já existe, a tela
        pode oferecer *abrir o existente* — que é o que o médico queria em quase todos
        os casos.

        `allow_duplicate` é a confirmação do segundo pedido: homônimo com data de
        nascimento diferente é pessoa diferente e passa. Com a mesma data, o índice
        continua recusando — e aí a recusa é a correta, porque nem o médico teria como
        distinguir os dois depois.

        No acervo de pesquisa o aviso alcança os pacientes dos pares (ver
        `find_by_name`), e é lá que ele rende mais: o cadastro que já existe costuma
        ser o de outra pessoa da equipe. O índice único, esse continua por dono, então
        o homônimo de um par é avisado e não recusado.
        """
        if not user.is_clinician:
            raise ForbiddenError("apenas médicos e administradores criam pacientes")

        if not allow_duplicate:
            homonimos = await self.patients.find_by_name(data.full_name)
            if homonimos:
                raise DuplicatePatientError("já existe paciente com este nome no acervo", homonimos)

        return await self.patients.create(data)


@dataclass(frozen=True, slots=True)
class DeletePatient:
    patients: PatientRepository
    captures: CaptureRepository

    async def execute(self, user: AuthenticatedUser, patient_id: UUID) -> Sequence[CaptureFile]:
        """Apaga o paciente e, em cascata, todo o histórico clínico dele.

        A ordem das checagens importa: o papel é verificado antes de tocar no banco,
        para o leitor receber 403 (o papel dele é o problema) em vez de 404 (que
        sugeriria que o paciente não existe).

        Devolve os arquivos que ficaram órfãos no bucket. A cascata do banco não
        alcança o R2 — apagar aqui e não lá deixaria os objetos pagando armazenamento
        para sempre, com dado clínico dentro.

        **Quem apaga do bucket é o chamador, depois do commit.** Apagar aqui dentro
        inverteria o risco: se a transação falhasse no fim, os arquivos já teriam ido
        embora e o paciente continuaria existindo, apontando para imagens que não
        estão mais lá. Órfão custa dinheiro; arquivo faltando num prontuário vivo
        custa muito mais.
        """
        if not user.is_clinician:
            raise ForbiddenError("apenas médicos e administradores excluem pacientes")

        # Ler antes de apagar existe pelo acervo de pesquisa: o par ENXERGA o paciente
        # do outro e não pode apagá-lo. Sem esta guarda o DELETE não acharia linha sob
        # a policy e a resposta seria 404 — por um paciente que a listagem dele acabou
        # de mostrar. Mesma razão da guarda de `UpdatePatient`, e o mesmo 403.
        paciente = await GetPatient(self.patients).execute(patient_id)
        if not paciente.can_delete:
            raise ForbiddenError("apenas o responsável pelo paciente exclui o cadastro")

        # Coletar ANTES do DELETE: depois não há linha de onde derivar as chaves.
        orfaos = await self.captures.list_files_for_patient(patient_id)
        if not await self.patients.delete(patient_id):
            raise NotFoundError("paciente não encontrado")
        return orfaos


@dataclass(frozen=True, slots=True)
class UpdatePatient:
    patients: PatientRepository

    async def execute(
        self, user: AuthenticatedUser, patient_id: UUID, changes: Mapping[str, Any]
    ) -> Patient:
        """Edita o cadastro: o dono, ou um par do acervo de pesquisa. Nunca o admin.

        Espelha `patients_update` no banco, que é a fronteira real. Quem responde é a
        própria linha (`can_edit`, calculado por `app.can_curate()` na leitura), e não
        uma comparação de ids aqui: a resposta depende do papel do dono, que esta
        camada não enxerga, e duplicar a regra em Python daria duas fontes da verdade.

        As duas metades da regra:

          · o admin não edita. `paciente_e_do_dono` estabeleceu o princípio, e ele
            continua valendo: editar cadastro alheio gravaria conteúdo dele sob o nome
            de outra pessoa, sem nada na tela denunciando.
          · o par de pool edita. O acervo de pesquisa é comum, e foi para isso que ele
            existe. A autoria da edição fica em `patients.updated_by`.

        Apagar continua sendo do dono e do admin (ver `DeletePatient`), e a assimetria
        é deliberada nos dois sentidos: o admin apaga e não edita porque remover não
        falsifica; o par edita e não apaga porque destruir coleta alheia é o que o
        acervo compartilhado não autoriza.
        """
        if not user.is_clinician:
            raise ForbiddenError("apenas médicos e administradores editam pacientes")

        # Resolver antes de escrever, mesma razão de `CreateEncounter`: para o médico
        # errado o paciente já sumiu na RLS e isto vira 404. Quem cai na guarda é o
        # admin, que ENXERGA o paciente de todo mundo — sem ela ele bateria na policy
        # de UPDATE e receberia 404 por um paciente que a listagem dele acabou de
        # mostrar. 403 é a resposta honesta: a identidade não é segredo para ele, o
        # que falta é ser o responsável.
        patient = await GetPatient(self.patients).execute(patient_id)
        if not patient.can_edit:
            raise ForbiddenError("apenas o responsável pelo paciente edita o cadastro")

        if not changes:
            return patient

        atualizado = await self.patients.update(patient_id, changes)
        if atualizado is None:
            raise NotFoundError("paciente não encontrado")
        return atualizado
