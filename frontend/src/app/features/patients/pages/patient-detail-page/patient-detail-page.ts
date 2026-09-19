import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';

import { messageFromError } from '../../data/api-error';
import {
  AnalysisBadge,
  JointSummary,
  ScoreChip,
  analysisBadgeOf,
  jointSummaryOf,
  scoresOf,
} from '../../data/encounter-summary';
import {
  Encounter,
  Patient,
  SEX_OPTIONS,
  STUDY_GROUP_OPTIONS,
  Sex,
  studyGroupLabel,
} from '../../data/patient.model';
import { PatientsService } from '../../data/patients.service';
import { DiagnosisPicker } from '../../components/diagnosis-picker/diagnosis-picker';
import { DiagnosisCatalog, PatientDiagnosis, StudyGroup } from '../../data/patient.model';

@Component({
  selector: 'app-patient-detail-page',
  imports: [DiagnosisPicker, DatePipe, ReactiveFormsModule, RouterLink, LucideDynamicIcon],
  templateUrl: './patient-detail-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatientDetailPage {
  /** Vem de `withComponentInputBinding()`; casa com o `:id` da rota. */
  readonly id = input.required<string>();

  private readonly patientsService = inject(PatientsService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);

  /**
   * Sem as consultas de propósito: elas moram só em `encounters`.
   *
   * Guardar o `PatientDetail` inteiro deixaria uma segunda cópia da lista aqui, que
   * envelheceria a cada consulta criada — e a próxima pessoa a ler `patient().encounters`
   * pegaria dado velho sem nenhum aviso.
   */
  protected readonly patient = signal<Patient | null>(null);
  protected readonly encounters = signal<readonly Encounter[]>([]);
  protected readonly loading = signal(true);
  protected readonly savingPatient = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);

  protected readonly sexOptions = SEX_OPTIONS;
  protected readonly studyGroupOptions = STUDY_GROUP_OPTIONS;
  protected readonly studyGroupLabel = studyGroupLabel;

  protected readonly patientForm = this.formBuilder.group({
    full_name: ['', [Validators.required, Validators.maxLength(200)]],
    birth_date: ['', [Validators.required]],
    sex: ['' as Sex | ''],
    phone: [''],
    study_group: ['' as StudyGroup | ''],
  });

  /** Fora do FormGroup, pelo mesmo motivo da página de cadastro: é relação. */
  protected readonly diagnoses = signal<readonly PatientDiagnosis[]>([]);
  /**
   * Hoje, em ISO, para o `max` do campo de nascimento.
   *
   * Nascimento no futuro é erro de digitação, e o backend o recusa com 422
   * (`PatientCreate._nao_pode_ser_no_futuro`). O atributo evita a viagem: o
   * seletor de data do browser não deixa escolher adiante.
   */
  protected readonly hoje = new Date().toISOString().slice(0, 10);

  protected readonly catalog = signal<readonly DiagnosisCatalog[]>([]);

  constructor() {
    // Não dá para carregar no construtor: signal input required só tem valor depois do
    // binding, e ler antes disso levanta NG0950. O effect roda quando `id` está pronto —
    // e roda de novo se a rota mudar para outro paciente sem recriar o componente.
    effect(() => this.load(this.id()));

    // O catálogo é dado de referência e não depende do paciente: uma busca só, fora do
    // effect, para não refazer a cada troca de rota. Falhar aqui não impede editar o
    // resto do cadastro, só deixa a lista de escolha vazia.
    this.patientsService.listDiagnoses().subscribe({
      next: (catalogo) => this.catalog.set(catalogo),
    });
  }

  private load(patientId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.patientsService.get(patientId).subscribe({
      next: (detail) => {
        this.patient.set(detail);
        this.encounters.set(detail.encounters);
        this.patientForm.patchValue({
          full_name: detail.full_name,
          birth_date: detail.birth_date,
          sex: detail.sex ?? '',
          phone: detail.phone ?? '',
          study_group: detail.study_group ?? '',
        });
        this.diagnoses.set(detail.diagnoses);
        this.loading.set(false);
      },
      error: (failure) => {
        this.error.set(messageFromError(failure));
        this.loading.set(false);
      },
    });
  }

  protected sexLabel(sex: Sex | null): string | null {
    return SEX_OPTIONS.find((option) => option.value === sex)?.label ?? null;
  }

  protected toggleEditing(): void {
    this.editing.update((open) => !open);
    this.error.set(null);
  }

  protected savePatient(): void {
    if (this.patientForm.invalid || this.savingPatient()) {
      this.patientForm.markAllAsTouched();
      return;
    }

    this.savingPatient.set(true);
    this.error.set(null);

    const raw = this.patientForm.getRawValue();
    const changes = {
      full_name: raw.full_name.trim(),
      birth_date: raw.birth_date,
      sex: raw.sex === '' ? null : raw.sex,
      phone: blankToNull(raw.phone),
      study_group: raw.study_group === '' ? null : raw.study_group,
      diagnoses: this.diagnoses().map((d) => ({ code: d.code, is_primary: d.is_primary })),
    };

    this.patientsService.update(this.id(), changes).subscribe({
      next: (updated) => {
        this.patient.set(updated);
        this.editing.set(false);
        this.savingPatient.set(false);
      },
      error: (failure) => {
        this.error.set(messageFromError(failure));
        this.savingPatient.set(false);
      },
    });
  }

  protected toggleConfirmDelete(): void {
    this.confirmingDelete.update((open) => !open);
    this.error.set(null);
  }

  protected confirmDelete(): void {
    if (this.deleting()) {
      return;
    }

    this.deleting.set(true);
    this.error.set(null);

    this.patientsService.delete(this.id()).subscribe({
      next: () => {
        // Sem `deleting.set(false)`: a página está saindo, e desligar a flag antes da
        // navegação reabilitaria o botão por um instante.
        void this.router.navigate(['/pacientes']);
      },
      error: (failure) => {
        this.error.set(messageFromError(failure));
        this.deleting.set(false);
        this.confirmingDelete.set(false);
      },
    });
  }

  /** Índices de atividade gravados na consulta, prontos para exibição. */
  protected scoresOf(encounter: Encounter): readonly ScoreChip[] {
    return scoresOf(encounter);
  }

  /** Resumo do body map da consulta, ou `null` se ela não tiver um. */
  protected jointSummaryOf(encounter: Encounter): JointSummary | null {
    return jointSummaryOf(encounter);
  }

  /** Estado da análise de imagem, ou `null` se a consulta não tiver uma. */
  protected analysisBadgeOf(encounter: Encounter): AnalysisBadge | null {
    return analysisBadgeOf(encounter);
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
