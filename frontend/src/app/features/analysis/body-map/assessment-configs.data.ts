import { AssessmentConfig, JointId } from './body-map.model';

/**
 * The 28 joints shared by CDAI and DAS28: 2 shoulders, 2 elbows, 2 wrists,
 * 10 MCPs, 10 PIP/IFP joints and 2 knees. PIP digit 1 follows the clinical
 * convention of counting the thumb interphalangeal joint.
 */
export const JOINTS_28: readonly JointId[] = [
  'RIGHT_SHOULDER',
  'LEFT_SHOULDER',
  'RIGHT_ELBOW',
  'LEFT_ELBOW',
  'RIGHT_WRIST',
  'LEFT_WRIST',
  'RIGHT_MCP_1',
  'RIGHT_MCP_2',
  'RIGHT_MCP_3',
  'RIGHT_MCP_4',
  'RIGHT_MCP_5',
  'LEFT_MCP_1',
  'LEFT_MCP_2',
  'LEFT_MCP_3',
  'LEFT_MCP_4',
  'LEFT_MCP_5',
  'RIGHT_PIP_1',
  'RIGHT_PIP_2',
  'RIGHT_PIP_3',
  'RIGHT_PIP_4',
  'RIGHT_PIP_5',
  'LEFT_PIP_1',
  'LEFT_PIP_2',
  'LEFT_PIP_3',
  'LEFT_PIP_4',
  'LEFT_PIP_5',
  'RIGHT_KNEE',
  'LEFT_KNEE',
];

/**
 * Available assessment configurations. Adding a future rheumatology score is as
 * simple as appending an entry here with its own joint subset — the 3D model
 * and components do not change.
 */
export const ASSESSMENT_CONFIGS: readonly AssessmentConfig[] = [
  {
    assessmentType: 'CDAI',
    label: 'CDAI',
    description: 'Clinical Disease Activity Index, 28 articulações',
    joints: JOINTS_28,
  },
  {
    assessmentType: 'DAS28',
    label: 'DAS28',
    description: 'Disease Activity Score, 28 articulações',
    joints: JOINTS_28,
  },
];

/** Look up an assessment configuration by its type. */
export function findAssessmentConfig(assessmentType: string): AssessmentConfig | undefined {
  return ASSESSMENT_CONFIGS.find((config) => config.assessmentType === assessmentType);
}

/** Default assessment shown when the page first opens. */
export const DEFAULT_ASSESSMENT_TYPE = 'CDAI';
