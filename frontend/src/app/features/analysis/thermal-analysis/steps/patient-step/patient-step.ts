import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Patient } from '../../../../patients/data/patient.model';
import { PatientsService } from '../../../../patients/data/patients.service';
import { duplicatesFromError, messageFromError } from '../../../../patients/data/api-error';

/**
 * Primeira etapa do fluxo: escolher o paciente a quem a análise será atrelada.
 *
 * Emite o paciente escolhido e não guarda nada — quem retém o estado do fluxo é
 * o container. Criar um paciente aqui é a única escrita que acontece antes do
 * fim: sem paciente não há a quem atrelar, e ele é um cadastro por si só, não um
 * rascunho da análise.
 *
 * O cadastro rápido pede nome **e** data de nascimento, os mesmos dois campos que a
 * API exige. Um formulário mais curto que o contrato só produziria 422.
 */
@Component({
  selector: 'app-patient-step',
  imports: [FormsModule, DatePipe],
  templateUrl: './patient-step.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatientStep {
  readonly selected = output<Patient>();

  private readonly patients = inject(PatientsService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly list = signal<readonly Patient[]>([]);
  protected readonly filter = signal('');
  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly newBirthDate = signal('');
  /**
   * Hoje, em ISO, para o `max` do campo de nascimento.
   *
   * Nascimento no futuro é erro de digitação, e o backend o recusa com 422
   * (`PatientCreate._nao_pode_ser_no_futuro`). O atributo evita a viagem: o
   * seletor de data do browser não deixa escolher adiante.
   */
  protected readonly hoje = new Date().toISOString().slice(0, 10);

  /**
   * Homônimos que a API devolveu ao recusar o cadastro.
   *
   * Mesma mecânica de `/pacientes`, e não por simetria: sem ela esta tela ficava num
   * beco. O 409 aparecia como erro, o botão de recuperação era "Tentar de novo" —
   * que recarrega a lista e não muda nada — e um homônimo legítimo (mesmo nome, data
   * diferente) só era cadastrável saindo do fluxo, indo em Pacientes e voltando.
   *
   * Enquanto houver algum, o botão vira "Cadastrar assim mesmo": é o segundo pedido,
   * e só ele leva `allow_duplicate`. Nome **e** data iguais continuam recusados pelo
   * índice único do banco, e aí a recusa é a correta.
   */
  protected readonly duplicates = signal<readonly Patient[]>([]);

  protected readonly canSubmit = computed(
    () => !this.saving() && this.newName().trim() !== '' && this.newBirthDate() !== '',
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.patients.list().subscribe({
      next: (patients) => {
        this.list.set(patients);
        this.loading.set(false);
      },
      error: (cause: unknown) => {
        this.error.set(messageFromError(cause));
        this.loading.set(false);
      },
    });
  }

  protected get visible(): readonly Patient[] {
    const term = this.filter().trim().toLowerCase();
    const all = this.list();
    return term ? all.filter((p) => p.full_name.toLowerCase().includes(term)) : all;
  }

  protected choose(patient: Patient): void {
    this.selected.emit(patient);
  }

  protected startCreating(): void {
    this.creating.set(true);
    this.newName.set(this.filter().trim());
    this.newBirthDate.set('');
    this.duplicates.set([]);
    this.error.set(null);
  }

  protected cancelCreating(): void {
    this.creating.set(false);
    this.newName.set('');
    this.newBirthDate.set('');
    this.duplicates.set([]);
    this.error.set(null);
  }

  /** Mudou o nome, mudou a pergunta: o aviso anterior falava de outra pessoa. */
  protected onNameChanged(nome: string): void {
    this.newName.set(nome);
    this.duplicates.set([]);
  }

  /**
   * Envia o cadastro. `confirmado` é o segundo clique, depois de a tela mostrar os
   * homônimos — só ele autoriza a API a criar um paciente com nome repetido.
   */
  protected create(confirmado = false): void {
    if (!this.canSubmit()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);

    this.patients
      .create(
        { full_name: this.newName().trim(), birth_date: this.newBirthDate() },
        confirmado,
      )
      .subscribe({
        next: (patient) => {
          this.saving.set(false);
          this.creating.set(false);
          this.duplicates.set([]);
          this.selected.emit(patient);
        },
        error: (cause: unknown) => {
          // Homônimo não é erro: é uma pergunta. O formulário fica como está, com a
          // lista de quem já existe ao lado do botão que confirma.
          this.duplicates.set(duplicatesFromError(cause) ?? []);
          this.error.set(this.duplicates().length > 0 ? null : messageFromError(cause));
          this.saving.set(false);
        },
      });
  }
}
