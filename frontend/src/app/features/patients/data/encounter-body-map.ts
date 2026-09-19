/**
 * Leitura do body map gravado numa consulta.
 *
 * É o contraponto de `features/analysis/thermal-analysis/thermal-analysis.model.ts`:
 * lá o mapa vira DTO, aqui o DTO volta a ser mapa. Ficando junto de
 * `encounter-summary.ts`, o prontuário continua sendo o único lado que conhece as
 * duas representações — o body map segue sem saber o que é consulta.
 */

import {
  DEFAULT_SCORE_PARAMETERS,
  JointEvaluation,
  JointId,
  ScoreParameters,
} from '../../analysis/body-map/body-map.model';
import { JOINT_BY_ID } from '../../analysis/body-map/joint-catalog.data';
import { Encounter } from './patient.model';

/** O body map de uma consulta, no formato que o `JointAssessmentService` repõe. */
export interface RecordedBodyMap {
  readonly joints: ReadonlyMap<JointId, JointEvaluation>;
  readonly parameters: ScoreParameters;
  /**
   * Índices com escore fechado na consulta, em ordem estável. Vazio quando o
   * mapa foi gravado sem nenhum — o DAS28 sem VHS/PCR nunca chega ao banco.
   */
  readonly assessmentTypes: readonly string[];
}

/**
 * O body map gravado, ou `null` quando a consulta não tem um.
 *
 * Articulações desconhecidas são descartadas em vez de derrubarem a tela: o
 * catálogo pode encolher entre versões, e um id órfão não deve custar ao médico
 * o resto do mapa.
 */
export function bodyMapOf(encounter: Encounter): RecordedBodyMap | null {
  const joints = new Map<JointId, JointEvaluation>();
  for (const [id, finding] of Object.entries(encounter.joint_evaluations ?? {})) {
    if (JOINT_BY_ID.has(id as JointId)) {
      joints.set(id as JointId, { pain: finding.pain, swelling: finding.swelling });
    }
  }
  if (joints.size === 0) {
    return null;
  }

  const { cdai, das28 } = encounter.scores ?? {};
  // Os parâmetros não são gravados sozinhos: eles moram dentro de cada escore.
  // Repô-los é o que faz a tela recalcular exatamente o número do dia da consulta,
  // em vez de exibi-lo como um total sem como ser conferido.
  const parameters: ScoreParameters = {
    ...DEFAULT_SCORE_PARAMETERS,
    ...(cdai && { patientGlobal: cdai.patient_global, evaluatorGlobal: cdai.evaluator_global }),
    ...(das28 && {
      acutePhase: das28.acute_phase,
      acuteValue: das28.acute_value,
      globalHealth: das28.patient_global_health,
    }),
  };

  return {
    joints,
    parameters,
    assessmentTypes: [...(cdai ? ['CDAI'] : []), ...(das28 ? ['DAS28'] : [])],
  };
}
