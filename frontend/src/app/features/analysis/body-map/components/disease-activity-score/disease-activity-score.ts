import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { Das28AcutePhase, DISEASE_ACTIVITY_META, MAX_ACUTE_VALUE } from '../../disease-activity';
import { JointAssessmentService } from '../../joint-assessment.service';

/**
 * Displays the CDAI or DAS28 disease-activity score and collects its inputs.
 *
 * The joint counts, the clinician-typed parameters and the arithmetic all live
 * in {@link JointAssessmentService}. This component only renders them and pushes
 * edits back — the findings have to be serializable by whoever owns the store,
 * and a component's private signals cannot be read from outside.
 */
@Component({
  selector: 'app-disease-activity-score',
  templateUrl: './disease-activity-score.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiseaseActivityScore {
  readonly assessmentType = input.required<string>();
  /**
   * Índice de uma consulta gravada: os parâmetros viram leitura.
   *
   * Deixar os controles ativos permitiria mexer numa avaliação que já foi
   * assinada e ver o escore mudar na tela sem que nada disso chegue ao banco.
   */
  readonly viewOnly = input(false);

  private readonly store = inject(JointAssessmentService);

  protected readonly isCdai = computed(() => this.assessmentType() === 'CDAI');

  protected readonly tenderCount = this.store.tenderCount;
  protected readonly swollenCount = this.store.swollenCount;
  protected readonly parameters = this.store.parameters;

  private readonly outcome = computed(() => this.store.scoreFor(this.assessmentType()));

  protected readonly displayScore = computed(() => {
    const { score } = this.outcome();
    if (score === null) {
      return null;
    }
    return this.isCdai() ? score.toFixed(1) : score.toFixed(2);
  });

  protected readonly levelMeta = computed(() => {
    const level = this.outcome().level;
    return level === null ? null : DISEASE_ACTIVITY_META[level];
  });

  protected readonly acuteLabel = computed(() =>
    this.parameters().acutePhase === 'esr' ? 'VHS' : 'PCR',
  );
  protected readonly acuteUnit = computed(() =>
    this.parameters().acutePhase === 'esr' ? 'mm/h' : 'mg/L',
  );

  /** O teto que o backend cobra; o template o exibe e o usa no `max` do campo. */
  protected readonly maxAcuteValue = MAX_ACUTE_VALUE;

  protected setPatientGlobal(value: number): void {
    this.store.setParameter('patientGlobal', value);
  }

  protected setEvaluatorGlobal(value: number): void {
    this.store.setParameter('evaluatorGlobal', value);
  }

  protected setGlobalHealth(value: number): void {
    this.store.setParameter('globalHealth', value);
  }

  protected setAcutePhase(phase: Das28AcutePhase): void {
    this.store.setParameter('acutePhase', phase);
  }

  protected setAcuteValue(raw: string): void {
    const trimmed = raw.trim();
    if (trimmed === '') {
      this.store.setParameter('acuteValue', null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      this.store.setParameter('acuteValue', null);
      return;
    }
    // Limitado ao teto do schema do backend. Sem isto, um valor acima dele era
    // aceito aqui, o escore aparecia calculado na tela e só o `POST` do Finalizar
    // recusava com 422 — depois de o mapa corporal inteiro ter sido preenchido, e
    // com uma mensagem genérica que não apontava este campo. O campo reexibe o
    // valor limitado, então o que está na tela é o que será gravado.
    this.store.setParameter('acuteValue', Math.min(value, MAX_ACUTE_VALUE));
  }
}
