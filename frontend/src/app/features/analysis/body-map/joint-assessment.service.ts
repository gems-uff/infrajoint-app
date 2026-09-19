import { Injectable, computed, signal } from '@angular/core';

import {
  calculateCdai,
  calculateDas28,
  cdaiActivityLevel,
  das28ActivityLevel,
} from './disease-activity';

import {
  AssessmentResult,
  DEFAULT_SCORE_PARAMETERS,
  JointEvaluation,
  JointId,
  JointStatus,
  ScoreOutcome,
  ScoreParameters,
  statusFromEvaluation,
} from './body-map.model';

/**
 * Signal-based store for an in-progress joint assessment.
 *
 * Holds the per-joint findings, derives the visual status map consumed by the
 * 3D viewer, and exposes the tender/swollen joint counts that feed the CDAI and
 * DAS28 disease-activity algorithms. Provided at the page level so each
 * assessment screen owns an isolated, disposable state.
 */
@Injectable()
export class JointAssessmentService {
  private readonly evaluationsSig = signal<ReadonlyMap<JointId, JointEvaluation>>(new Map());
  private readonly activeJointsSig = signal<readonly JointId[]>([]);
  private readonly parametersSig = signal<ScoreParameters>(DEFAULT_SCORE_PARAMETERS);

  /** Clinical parameters the physician types in (globals and the acute-phase lab). */
  readonly parameters = this.parametersSig.asReadonly();

  /** Current per-joint evaluations (only joints the physician has touched). */
  readonly evaluations = this.evaluationsSig.asReadonly();

  /** Ids of every evaluated joint — drives the analyzed/not-analyzed markers. */
  readonly evaluatedIds = computed<ReadonlySet<JointId>>(
    () => new Set(this.evaluationsSig().keys()),
  );

  /** Tender Joint Count (TJC) over the active assessment's joints. */
  readonly tenderCount = computed(() => this.countWhere((evaluation) => evaluation.pain));

  /** Swollen Joint Count (SJC) over the active assessment's joints. */
  readonly swollenCount = computed(() => this.countWhere((evaluation) => evaluation.swelling));

  /** How many of the active assessment's joints have been evaluated. */
  readonly evaluatedCount = computed(() => {
    const active = new Set(this.activeJointsSig());
    let count = 0;
    for (const id of this.evaluationsSig().keys()) {
      if (active.has(id)) {
        count++;
      }
    }
    return count;
  });

  /** Total joints required by the active assessment. */
  readonly totalCount = computed(() => this.activeJointsSig().length);

  /** Declares which joints the current assessment evaluates (drives counts). */
  setActiveJoints(joints: readonly JointId[]): void {
    this.activeJointsSig.set([...joints]);
  }

  evaluationOf(id: JointId): JointEvaluation | undefined {
    return this.evaluationsSig().get(id);
  }

  statusOf(id: JointId): JointStatus {
    return statusFromEvaluation(this.evaluationsSig().get(id));
  }

  /** Records both findings for a joint at once. */
  setEvaluation(id: JointId, evaluation: JointEvaluation): void {
    const next = new Map(this.evaluationsSig());
    next.set(id, { ...evaluation });
    this.evaluationsSig.set(next);
  }

  setPain(id: JointId, pain: boolean): void {
    const current = this.evaluationsSig().get(id) ?? { pain: false, swelling: false };
    this.setEvaluation(id, { ...current, pain });
  }

  setSwelling(id: JointId, swelling: boolean): void {
    const current = this.evaluationsSig().get(id) ?? { pain: false, swelling: false };
    this.setEvaluation(id, { ...current, swelling });
  }

  /** Removes a joint's evaluation, returning it to the not-evaluated state. */
  clearEvaluation(id: JointId): void {
    const next = new Map(this.evaluationsSig());
    if (next.delete(id)) {
      this.evaluationsSig.set(next);
    }
  }

  /**
   * Repõe um body map inteiro de uma vez — o caminho de volta de {@link toResult}.
   *
   * Existe para a consulta reaberta: sem ele, restaurar seria uma sequência de
   * `setEvaluation`/`setParameter`, e cada chamada publicaria um estado
   * intermediário que nunca foi avaliado por ninguém.
   */
  restore(joints: ReadonlyMap<JointId, JointEvaluation>, parameters: ScoreParameters): void {
    this.evaluationsSig.set(new Map([...joints].map(([id, e]) => [id, { ...e }])));
    this.parametersSig.set({ ...parameters });
  }

  /** Clears every evaluation and the typed-in parameters. */
  reset(): void {
    this.evaluationsSig.set(new Map());
    this.parametersSig.set(DEFAULT_SCORE_PARAMETERS);
  }

  /** Replaces one clinical parameter, leaving the others untouched. */
  setParameter<K extends keyof ScoreParameters>(key: K, value: ScoreParameters[K]): void {
    this.parametersSig.set({ ...this.parametersSig(), [key]: value });
  }

  /**
   * Score and activity band for one index, or `null` while an input is missing.
   *
   * A method rather than a `computed` because the active index is the caller's
   * state, not the store's: the Thermal Analysis flow serializes CDAI *and*
   * DAS28 from the same findings, so it asks for both. Reading signals inside
   * keeps it reactive when called from a `computed`.
   */
  scoreFor(assessmentType: string): ScoreOutcome {
    const tenderCount = this.tenderCount();
    const swollenCount = this.swollenCount();
    const parameters = this.parametersSig();

    if (assessmentType === 'CDAI') {
      const score = calculateCdai({
        tenderCount,
        swollenCount,
        patientGlobal: parameters.patientGlobal,
        evaluatorGlobal: parameters.evaluatorGlobal,
      });
      return { score, level: cdaiActivityLevel(score) };
    }

    const { acuteValue } = parameters;
    if (acuteValue === null || acuteValue < 0) {
      // DAS28 sem VHS/PCR não existe. Devolver null é o que deixa a etapa do body
      // map ser salva sem escore fechado, em vez de gravar um número inventado.
      return { score: null, level: null };
    }
    const score = calculateDas28({
      tenderCount,
      swollenCount,
      acutePhase: parameters.acutePhase,
      acuteValue,
      patientGlobalHealth: parameters.globalHealth,
    });
    return { score, level: das28ActivityLevel(score) };
  }

  /** Serializes the current state for the disease-activity algorithms / API. */
  toResult(assessmentType: string, patientId?: string): AssessmentResult {
    const joints: Partial<Record<JointId, JointEvaluation>> = {};
    for (const [id, evaluation] of this.evaluationsSig()) {
      joints[id] = { ...evaluation };
    }
    return { patientId, assessmentType, joints, parameters: this.parametersSig() };
  }

  private countWhere(predicate: (evaluation: JointEvaluation) => boolean): number {
    const active = new Set(this.activeJointsSig());
    let count = 0;
    for (const [id, evaluation] of this.evaluationsSig()) {
      if (active.has(id) && predicate(evaluation)) {
        count++;
      }
    }
    return count;
  }
}
