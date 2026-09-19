import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';

import { duplicatesFromError, messageFromError } from '../../data/api-error';
import {
  Patient,
  PatientCreate,
  SEX_OPTIONS,
  STUDY_GROUP_OPTIONS,
  Sex,
  studyGroupLabel,
} from '../../data/patient.model';
import { PatientsService } from '../../data/patients.service';
import { DiagnosisPicker } from '../../components/diagnosis-picker/diagnosis-picker';
import { DiagnosisCatalog, PatientDiagnosis, StudyGroup } from '../../data/patient.model';

@Component({
  selector: 'app-patients-page',
  imports: [DiagnosisPicker, DatePipe, ReactiveFormsModule, RouterLink, LucideDynamicIcon],
  templateUrl: './patients-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatientsPage {
  private readonly patientsService = inject(PatientsService);
  private readonly formBuilder = inject(NonNullableFormBuilder);

  protected readonly patients = signal<readonly Patient[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  /**
   * Homônimos que a API devolveu ao recusar o cadastro.
   *
   * Enquanto houver algum, o botão de salvar vira "cadastrar assim mesmo": é o
   * segundo pedido, e só ele leva `allow_duplicate`. Não é estado do formulário —
   * some assim que o nome muda, porque aí o aviso é sobre outra pessoa.
   */
  protected readonly duplicates = signal<readonly Patient[]>([]);

  protected readonly sexOptions = SEX_OPTIONS;
  protected readonly studyGroupOptions = STUDY_GROUP_OPTIONS;
  protected readonly studyGroupLabel = studyGroupLabel;

  protected readonly form = this.formBuilder.group({
    full_name: ['', [Validators.required, Validators.maxLength(200)]],
    // Obrigatória pelo mesmo motivo que o banco a exige: é o que separa dois
    // homônimos, e o aviso de duplicata só ajuda a decidir se ela existir.
    birth_date: ['', [Validators.required]],
    sex: ['' as Sex | ''],
    phone: [''],
    study_group: ['' as StudyGroup | ''],
  });

  /**
   * Os diagnósticos ficam fora do `FormGroup`: viraram relação, e a tela os edita por
   * adicionar e remover, não por digitar. Ver `DiagnosisPicker`.
   */
  protected readonly diagnoses = signal<readonly PatientDiagnosis[]>([]);
  protected readonly catalog = signal<readonly DiagnosisCatalog[]>([]);
  /**
   * Hoje, em ISO, para o `max` do campo de nascimento.
   *
   * Nascimento no futuro é erro de digitação, e o backend o recusa com 422
   * (`PatientCreate._nao_pode_ser_no_futuro`). O atributo evita a viagem: o
   * seletor de data do browser não deixa escolher adiante.
   */
  protected readonly hoje = new Date().toISOString().slice(0, 10);

  constructor() {
    this.load();
    // O catálogo é dado de referência e só muda por migration: uma busca por sessão de
    // tela basta, e falhar nela não impede cadastrar sem diagnóstico.
    this.patientsService.listDiagnoses().subscribe({
      next: (catalogo) => this.catalog.set(catalogo),
    });
    // Mudou o nome, mudou a pergunta: o aviso anterior falava de outra pessoa.
    this.form.controls.full_name.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.duplicates.set([]));
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.patientsService.list().subscribe({
      next: (patients) => {
        this.patients.set(patients);
        this.loading.set(false);
      },
      error: (failure) => {
        this.error.set(messageFromError(failure));
        this.loading.set(false);
      },
    });
  }

  protected toggleForm(): void {
    this.formOpen.update((open) => !open);
    this.error.set(null);
    this.duplicates.set([]);
  }

  /**
   * Envia o cadastro. `confirmado` é o segundo clique, depois de a tela mostrar os
   * homônimos — só ele autoriza a API a criar um paciente com nome repetido.
   */
  protected submit(confirmado = false): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    this.patientsService.create(this.toPayload(), confirmado).subscribe({
      next: (created) => {
        this.patients.update((current) => [created, ...current]);
        this.form.reset();
        // Os diagnósticos vivem fora do FormGroup, então `reset()` não os alcança. Sem
        // esta linha, o próximo paciente cadastrado nasceria com os diagnósticos do
        // anterior já marcados, e quem não reparasse gravaria dado clínico errado.
        this.diagnoses.set([]);
        this.duplicates.set([]);
        this.formOpen.set(false);
        this.saving.set(false);
      },
      error: (failure) => {
        // Homônimo não é erro: é uma pergunta. O formulário fica como está, com a
        // lista de quem já existe ao lado do botão que confirma.
        this.duplicates.set(duplicatesFromError(failure) ?? []);
        this.error.set(this.duplicates().length > 0 ? null : messageFromError(failure));
        this.saving.set(false);
      },
    });
  }

  /** Campo vazio significa "não informado", e o backend espera `null`, não `''`. */
  private toPayload(): PatientCreate {
    const raw = this.form.getRawValue();
    return {
      full_name: raw.full_name.trim(),
      birth_date: raw.birth_date,
      sex: raw.sex === '' ? null : raw.sex,
      phone: blankToNull(raw.phone),
      study_group: raw.study_group === '' ? null : raw.study_group,
      diagnoses: this.diagnoses().map((d) => ({ code: d.code, is_primary: d.is_primary })),
    };
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
