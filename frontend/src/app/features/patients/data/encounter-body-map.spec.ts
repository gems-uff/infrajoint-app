import { DEFAULT_SCORE_PARAMETERS } from '../../analysis/body-map/body-map.model';
import { bodyMapOf } from './encounter-body-map';
import { Encounter } from './patient.model';

function encounter(partial: Partial<Encounter> = {}): Encounter {
  return {
    id: 'e1',
    patient_id: 'p1',
    occurred_at: '2026-08-15T12:00:00Z',
    reason: null,
    joint_evaluations: null,
    scores: {},
    analysis_status: null,
    capture_count: 0,
    created_at: '2026-08-15T12:00:00Z',
    can_edit: true,
    can_delete: true,
    ...partial,
  };
}

const CDAI = {
  score: 12.5,
  level: 'moderate',
  tender_count: 2,
  swollen_count: 1,
  patient_global: 5,
  evaluator_global: 4.5,
} as const;

const DAS28 = {
  score: 4.21,
  level: 'moderate',
  tender_count: 2,
  swollen_count: 1,
  acute_phase: 'crp',
  acute_value: 8,
  patient_global_health: 40,
} as const;

describe('bodyMapOf', () => {
  it('distingue consulta sem body map de body map vazio', () => {
    expect(bodyMapOf(encounter())).toBeNull();
    expect(bodyMapOf(encounter({ joint_evaluations: {} }))).toBeNull();
  });

  it('repõe os achados articulares', () => {
    const recorded = bodyMapOf(
      encounter({
        joint_evaluations: {
          RIGHT_KNEE: { pain: true, swelling: true },
          LEFT_MCP_3: { pain: true, swelling: false },
        },
      }),
    )!;

    expect(recorded.joints.size).toBe(2);
    expect(recorded.joints.get('RIGHT_KNEE')).toEqual({ pain: true, swelling: true });
    expect(recorded.joints.get('LEFT_MCP_3')).toEqual({ pain: true, swelling: false });
  });

  it('descarta articulação fora do catálogo sem perder o resto do mapa', () => {
    const recorded = bodyMapOf(
      encounter({
        joint_evaluations: {
          RIGHT_KNEE: { pain: true, swelling: false },
          LEFT_TOE_1: { pain: true, swelling: true },
        },
      }),
    )!;

    expect([...recorded.joints.keys()]).toEqual(['RIGHT_KNEE']);
  });

  it('tira os parâmetros de dentro dos escores gravados', () => {
    const recorded = bodyMapOf(
      encounter({
        joint_evaluations: { RIGHT_KNEE: { pain: true, swelling: false } },
        scores: { cdai: CDAI, das28: DAS28 },
      }),
    )!;

    expect(recorded.parameters).toEqual({
      patientGlobal: 5,
      evaluatorGlobal: 4.5,
      acutePhase: 'crp',
      acuteValue: 8,
      globalHealth: 40,
    });
    expect(recorded.assessmentTypes).toEqual(['CDAI', 'DAS28']);
  });

  it('body map sem índice fechado volta com os parâmetros padrão', () => {
    const recorded = bodyMapOf(
      encounter({ joint_evaluations: { RIGHT_KNEE: { pain: false, swelling: true } } }),
    )!;

    expect(recorded.parameters).toEqual(DEFAULT_SCORE_PARAMETERS);
    expect(recorded.assessmentTypes).toEqual([]);
  });

  it('só o índice gravado traz os parâmetros dele', () => {
    const recorded = bodyMapOf(
      encounter({
        joint_evaluations: { RIGHT_KNEE: { pain: true, swelling: false } },
        scores: { cdai: CDAI },
      }),
    )!;

    expect(recorded.assessmentTypes).toEqual(['CDAI']);
    expect(recorded.parameters.patientGlobal).toBe(5);
    // Sem DAS28 gravado, o VHS/PCR continua ausente — e não vira zero, que seria
    // um valor de laboratório inventado.
    expect(recorded.parameters.acuteValue).toBeNull();
  });
});
