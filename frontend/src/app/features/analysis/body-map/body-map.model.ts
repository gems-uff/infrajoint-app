/**
 * Domain model for the interactive joint-assessment body map.
 *
 * The model is deliberately index-agnostic: the 3D body and its joint hotspots
 * are described once in the catalog, while each rheumatology assessment (CDAI,
 * DAS28, …) simply selects which joints are evaluated. New scores can be added
 * by providing a different {@link AssessmentConfig} without touching the model.
 */

import type { DiseaseActivityLevel } from './disease-activity';

/** Stable, unique identifier for every joint the body map can render. */
export type JointId =
  // Wrists
  | 'RIGHT_WRIST'
  | 'LEFT_WRIST'
  // Metacarpophalangeal (MCP) joints
  | 'RIGHT_MCP_1'
  | 'RIGHT_MCP_2'
  | 'RIGHT_MCP_3'
  | 'RIGHT_MCP_4'
  | 'RIGHT_MCP_5'
  | 'LEFT_MCP_1'
  | 'LEFT_MCP_2'
  | 'LEFT_MCP_3'
  | 'LEFT_MCP_4'
  | 'LEFT_MCP_5'
  // Proximal interphalangeal (PIP/IFP) joints — digit 1 is the thumb IP joint
  | 'RIGHT_PIP_1'
  | 'RIGHT_PIP_2'
  | 'RIGHT_PIP_3'
  | 'RIGHT_PIP_4'
  | 'RIGHT_PIP_5'
  | 'LEFT_PIP_1'
  | 'LEFT_PIP_2'
  | 'LEFT_PIP_3'
  | 'LEFT_PIP_4'
  | 'LEFT_PIP_5'
  // Large joints
  | 'RIGHT_SHOULDER'
  | 'LEFT_SHOULDER'
  | 'RIGHT_ELBOW'
  | 'LEFT_ELBOW'
  | 'RIGHT_KNEE'
  | 'LEFT_KNEE';

/** Anatomical side, from the patient's perspective. */
export type BodySide = 'right' | 'left';

/** Coarse anatomical grouping used for labels and the assessment summary. */
export type JointGroup = 'wrist' | 'mcp' | 'pip' | 'shoulder' | 'elbow' | 'knee';

/** Per-joint clinical findings recorded by the physician. */
export interface JointEvaluation {
  readonly pain: boolean;
  readonly swelling: boolean;
}

/**
 * Visual/clinical state of a joint.
 * - `not-evaluated`: never assessed (gray)
 * - `normal`: assessed, no abnormality (green)
 * - `pain`: tender only (yellow)
 * - `swelling`: swollen/edema only (red)
 * - `both`: tender and swollen (purple)
 */
export type JointStatus = 'not-evaluated' | 'normal' | 'pain' | 'swelling' | 'both';

/** Clinical metadata describing a single evaluable joint. */
export interface JointDefinition {
  readonly id: JointId;
  /** Full, human-readable label (pt-BR), e.g. "MCP 3 (mão direita)". */
  readonly label: string;
  /** Compact label for chips and hotspots, e.g. "MCP 3". */
  readonly shortLabel: string;
  readonly side: BodySide;
  readonly group: JointGroup;
}

/** Configuration that drives which joints a given assessment evaluates. */
export interface AssessmentConfig {
  readonly assessmentType: string;
  /** Display name, e.g. "CDAI". */
  readonly label: string;
  /** Short clinical description shown in the UI. */
  readonly description: string;
  readonly joints: readonly JointId[];
}

/**
 * Clinical parameters the physician supplies on top of the joint counts.
 *
 * They live in {@link JointAssessmentService} rather than inside the score
 * component because they are *findings*, not view state: the Thermal Analysis
 * flow has to serialize them, and a component's private signals cannot be read
 * from outside. The standalone body map screen is unaffected — the store is
 * still provided per page and thrown away with it.
 */
export interface ScoreParameters {
  /** CDAI — patient global assessment, 0–10 VAS. */
  readonly patientGlobal: number;
  /** CDAI — evaluator (physician) global assessment, 0–10 VAS. */
  readonly evaluatorGlobal: number;
  /** DAS28 — which acute-phase reactant the lab value refers to. */
  readonly acutePhase: 'esr' | 'crp';
  /** DAS28 — ESR (mm/h) or CRP (mg/L); `null` until the clinician types it. */
  readonly acuteValue: number | null;
  /** DAS28 — patient global health, 0–100 VAS. */
  readonly globalHealth: number;
}

export const DEFAULT_SCORE_PARAMETERS: ScoreParameters = {
  patientGlobal: 0,
  evaluatorGlobal: 0,
  acutePhase: 'esr',
  acuteValue: null,
  globalHealth: 0,
};

/** A computed index: `null` on both sides while a required input is missing. */
export interface ScoreOutcome {
  readonly score: number | null;
  readonly level: DiseaseActivityLevel | null;
}

/**
 * Serializable assessment result, ready to be consumed by the CDAI/DAS28
 * disease-activity calculation algorithms (or persisted via a future API).
 */
export interface AssessmentResult {
  readonly patientId?: string;
  readonly assessmentType: string;
  readonly joints: Partial<Record<JointId, JointEvaluation>>;
  readonly parameters: ScoreParameters;
}

/** Visual metadata for each joint status, shared by the 3D scene and the UI. */
export interface JointStatusMeta {
  readonly status: JointStatus;
  /** Legend label (pt-BR). */
  readonly label: string;
  /** Hex colour used by both Three.js materials and the UI legend dots. */
  readonly hex: string;
}

export const JOINT_STATUS_META: Record<JointStatus, JointStatusMeta> = {
  'not-evaluated': { status: 'not-evaluated', label: 'Não avaliada', hex: '#9CA3AF' },
  normal: { status: 'normal', label: 'Sem alterações', hex: '#22C55E' },
  pain: { status: 'pain', label: 'Dor', hex: '#EAB308' },
  swelling: { status: 'swelling', label: 'Edema', hex: '#EF4444' },
  both: { status: 'both', label: 'Dor + Edema', hex: '#A855F7' },
};

/** Derive the visual status from an evaluation (absent = not evaluated). */
export function statusFromEvaluation(evaluation: JointEvaluation | undefined): JointStatus {
  if (!evaluation) {
    return 'not-evaluated';
  }
  if (evaluation.pain && evaluation.swelling) {
    return 'both';
  }
  if (evaluation.swelling) {
    return 'swelling';
  }
  if (evaluation.pain) {
    return 'pain';
  }
  return 'normal';
}

/**
 * Single colour used to mark a hotspot as "analyzed" — i.e. at least one related
 * joint has been evaluated. The body and hand maps are progress/completion
 * indicators, not severity indicators, so the colour never varies by finding.
 */
export const ANALYZED_COLOR = '#32B5FE';
