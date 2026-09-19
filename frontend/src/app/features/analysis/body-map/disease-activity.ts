/**
 * Disease-activity index calculations for rheumatoid arthritis.
 *
 * The 28-joint tender (TJC28) and swollen (SJC28) counts come from the body map;
 * the remaining parameters (global assessments and, for DAS28, an acute-phase
 * reactant) are entered by the clinician. All functions are pure so they can be
 * unit-tested and reused by future scores.
 */

export type DiseaseActivityLevel = 'remission' | 'low' | 'moderate' | 'high';

export interface DiseaseActivityLevelMeta {
  readonly level: DiseaseActivityLevel;
  /** pt-BR label. */
  readonly label: string;
  readonly hex: string;
}

export const DISEASE_ACTIVITY_META: Record<DiseaseActivityLevel, DiseaseActivityLevelMeta> = {
  remission: { level: 'remission', label: 'Remissão', hex: '#16A34A' },
  low: { level: 'low', label: 'Atividade baixa', hex: '#EAB308' },
  moderate: { level: 'moderate', label: 'Atividade moderada', hex: '#F97316' },
  high: { level: 'high', label: 'Atividade alta', hex: '#DC2626' },
};

// --- CDAI -------------------------------------------------------------------
// CDAI = TJC28 + SJC28 + PGA + EGA, where the global assessments are on a
// 0–10 cm visual analogue scale. Range 0–76.

export interface CdaiInput {
  readonly tenderCount: number;
  readonly swollenCount: number;
  /** Patient global assessment, 0–10. */
  readonly patientGlobal: number;
  /** Evaluator (physician) global assessment, 0–10. */
  readonly evaluatorGlobal: number;
}

export function calculateCdai(input: CdaiInput): number {
  return input.tenderCount + input.swollenCount + input.patientGlobal + input.evaluatorGlobal;
}

export function cdaiActivityLevel(score: number): DiseaseActivityLevel {
  if (score <= 2.8) {
    return 'remission';
  }
  if (score <= 10) {
    return 'low';
  }
  if (score <= 22) {
    return 'moderate';
  }
  return 'high';
}

// --- DAS28 ------------------------------------------------------------------
// Two validated variants, by acute-phase reactant:
//   DAS28-ESR = 0.56·√TJC + 0.28·√SJC + 0.70·ln(ESR) + 0.014·GH
//   DAS28-CRP = 0.56·√TJC + 0.28·√SJC + 0.36·ln(CRP+1) + 0.014·GH + 0.96
// GH = patient global health on a 0–100 mm VAS; ESR in mm/h; CRP in mg/L.

export type Das28AcutePhase = 'esr' | 'crp';

/**
 * Teto do reagente de fase aguda (VHS em mm/h, PCR em mg/L).
 *
 * Espelha `Das28Score.acute_value` (`le=300`) no backend, e não é escolha desta
 * camada: acima dele o `POST` da consulta volta 422 e o registro clínico não é
 * gravado. Com o valor limitado aqui, o DAS28 resultante também cabe no `le=10`
 * que o mesmo schema cobra — o pior caso (TJC=SJC=28, VHS=300, GH=100) dá 9,83.
 */
export const MAX_ACUTE_VALUE = 300;

export interface Das28Input {
  readonly tenderCount: number;
  readonly swollenCount: number;
  readonly acutePhase: Das28AcutePhase;
  /** ESR (mm/h) when `acutePhase` is `esr`, otherwise CRP (mg/L). */
  readonly acuteValue: number;
  /** Patient global health, 0–100. */
  readonly patientGlobalHealth: number;
}

export function calculateDas28(input: Das28Input): number {
  const tender = 0.56 * Math.sqrt(input.tenderCount);
  const swollen = 0.28 * Math.sqrt(input.swollenCount);
  const global = 0.014 * input.patientGlobalHealth;

  if (input.acutePhase === 'esr') {
    // ln is undefined at 0; clinically ESR is at least 1 mm/h.
    const esr = Math.max(input.acuteValue, 1);
    return tender + swollen + 0.7 * Math.log(esr) + global;
  }

  const crp = Math.max(input.acuteValue, 0);
  return tender + swollen + 0.36 * Math.log(crp + 1) + global + 0.96;
}

export function das28ActivityLevel(score: number): DiseaseActivityLevel {
  if (score < 2.6) {
    return 'remission';
  }
  if (score <= 3.2) {
    return 'low';
  }
  if (score <= 5.1) {
    return 'moderate';
  }
  return 'high';
}
