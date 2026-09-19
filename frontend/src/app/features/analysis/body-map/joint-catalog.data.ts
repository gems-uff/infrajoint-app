import { BodySide, JointDefinition, JointGroup, JointId } from './body-map.model';

/**
 * Clinical metadata for every joint the body map can evaluate. This is the
 * single source of truth for joint labels; the visual hotspot positions live in
 * the body/hand hotspot data, which references these by id.
 */

/** pt-BR side adjective. `feminine` is used for "Mão" (hand). */
function sideWord(side: BodySide, feminine = false): string {
  if (feminine) {
    return side === 'right' ? 'direita' : 'esquerda';
  }
  return side === 'right' ? 'direito' : 'esquerdo';
}

function handJoints(side: BodySide): JointDefinition[] {
  const prefix = side === 'right' ? 'RIGHT' : 'LEFT';
  const handWord = sideWord(side, true);
  const joints: JointDefinition[] = [
    {
      id: `${prefix}_WRIST` as JointId,
      label: `Punho ${sideWord(side)}`,
      shortLabel: 'Punho',
      side,
      group: 'wrist',
    },
  ];

  for (let digit = 1; digit <= 5; digit++) {
    joints.push({
      id: `${prefix}_MCP_${digit}` as JointId,
      label: `MCP ${digit} (mão ${handWord})`,
      shortLabel: `MCP ${digit}`,
      side,
      group: 'mcp',
    });
    joints.push({
      id: `${prefix}_PIP_${digit}` as JointId,
      label: `IFP/PIP ${digit} (mão ${handWord})`,
      shortLabel: `IFP ${digit}`,
      side,
      group: 'pip',
    });
  }

  return joints;
}

function largeJoints(): JointDefinition[] {
  const parts: { group: JointGroup; noun: string }[] = [
    { group: 'shoulder', noun: 'Ombro' },
    { group: 'elbow', noun: 'Cotovelo' },
    { group: 'knee', noun: 'Joelho' },
  ];

  const joints: JointDefinition[] = [];
  for (const part of parts) {
    for (const side of ['right', 'left'] as const) {
      const prefix = side === 'right' ? 'RIGHT' : 'LEFT';
      joints.push({
        id: `${prefix}_${part.group.toUpperCase()}` as JointId,
        label: `${part.noun} ${sideWord(side)}`,
        shortLabel: part.noun,
        side,
        group: part.group,
      });
    }
  }
  return joints;
}

/** All joints supported by the body map. */
export const JOINT_CATALOG: readonly JointDefinition[] = [
  ...largeJoints(),
  ...handJoints('right'),
  ...handJoints('left'),
];

/** Fast lookup by id. */
export const JOINT_BY_ID: ReadonlyMap<JointId, JointDefinition> = new Map(
  JOINT_CATALOG.map((joint) => [joint.id, joint]),
);
