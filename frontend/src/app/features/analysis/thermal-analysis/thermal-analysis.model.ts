/**
 * Serialização do fluxo de Análise Térmica para o contrato da API clínica.
 *
 * Este arquivo é a fronteira: de um lado o modelo do body map (`JointId`,
 * `ScoreParameters`), do outro os DTOs em snake_case do backend. É o único lugar
 * do fluxo que conhece os dois.
 *
 * **Por que ele existe separado das features soltas.** `/mapa-corporal` e
 * `/analisador-de-imagens` não importam nada daqui — é isso que garante, por
 * construção e não por disciplina, que elas não persistem nada. Quem quiser
 * fazê-las gravar precisa adicionar um import, o que aparece em revisão.
 */

import {
  AssessmentResult,
  JointId,
  ScoreParameters,
  ScoreOutcome,
} from '../body-map/body-map.model';
import {
  CdaiScoreDto,
  Das28ScoreDto,
  EncounterCreate,
  JointEvaluationDto,
} from '../../patients/data/patient.model';

/** Um índice avaliado no fluxo, já com o resultado calculado pelo store. */
export interface AssessedIndex {
  readonly assessmentType: string;
  readonly outcome: ScoreOutcome;
}

function toJointEvaluations(
  joints: Partial<Record<JointId, { pain: boolean; swelling: boolean }>>,
): Record<string, JointEvaluationDto> | null {
  const entries = Object.entries(joints);
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(
    entries.map(([id, evaluation]) => [
      id,
      { pain: evaluation!.pain, swelling: evaluation!.swelling },
    ]),
  );
}

function toCdai(
  outcome: ScoreOutcome,
  parameters: ScoreParameters,
  tenderCount: number,
  swollenCount: number,
): CdaiScoreDto | null {
  if (outcome.score === null || outcome.level === null) {
    return null;
  }
  return {
    score: outcome.score,
    level: outcome.level,
    tender_count: tenderCount,
    swollen_count: swollenCount,
    patient_global: parameters.patientGlobal,
    evaluator_global: parameters.evaluatorGlobal,
  };
}

function toDas28(
  outcome: ScoreOutcome,
  parameters: ScoreParameters,
  tenderCount: number,
  swollenCount: number,
): Das28ScoreDto | null {
  // `acuteValue` nulo é justamente o que faz o store devolver score nulo; a
  // checagem dupla existe para o TypeScript, não por desconfiança.
  if (outcome.score === null || outcome.level === null || parameters.acuteValue === null) {
    return null;
  }
  return {
    score: outcome.score,
    level: outcome.level,
    tender_count: tenderCount,
    swollen_count: swollenCount,
    acute_phase: parameters.acutePhase,
    acute_value: parameters.acuteValue,
    patient_global_health: parameters.globalHealth,
  };
}

/**
 * Monta o corpo do POST a partir do que o fluxo acumulou.
 *
 * Índices sem escore fechado são simplesmente omitidos — um DAS28 sem VHS/PCR
 * não vira número inventado, e o body map continua salvável sem ele.
 */
export function toEncounterCreate(
  result: AssessmentResult,
  indexes: readonly AssessedIndex[],
  counts: { readonly tender: number; readonly swollen: number },
  reason?: string | null,
): EncounterCreate {
  const scores: Record<string, CdaiScoreDto | Das28ScoreDto> = {};

  for (const { assessmentType, outcome } of indexes) {
    const dto =
      assessmentType === 'CDAI'
        ? toCdai(outcome, result.parameters, counts.tender, counts.swollen)
        : toDas28(outcome, result.parameters, counts.tender, counts.swollen);
    if (dto) {
      scores[assessmentType] = dto;
    }
  }

  return {
    reason: reason?.trim() || null,
    joint_evaluations: toJointEvaluations(result.joints),
    scores: Object.keys(scores).length > 0 ? scores : null,
  };
}
