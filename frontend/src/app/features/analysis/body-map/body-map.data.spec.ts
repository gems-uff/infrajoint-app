import { JointGroup, JointId } from './body-map.model';
import { JOINT_BY_ID, JOINT_CATALOG } from './joint-catalog.data';
import { ASSESSMENT_CONFIGS, JOINTS_28 } from './assessment-configs.data';
import { BODY_HOTSPOTS } from './body-hotspots.data';
import { HAND_VIEWS } from './hand-hotspots.data';

describe('joint catalog', () => {
  it('exposes 28 joints', () => {
    expect(JOINT_CATALOG.length).toBe(28);
  });

  it('has unique joint ids', () => {
    const ids = JOINT_CATALOG.map((joint) => joint.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has the clinically expected joint group counts', () => {
    const count = (group: JointGroup) =>
      JOINT_CATALOG.filter((joint) => joint.group === group).length;

    expect(count('shoulder')).toBe(2);
    expect(count('elbow')).toBe(2);
    expect(count('wrist')).toBe(2);
    expect(count('mcp')).toBe(10);
    expect(count('pip')).toBe(10);
    expect(count('knee')).toBe(2);
  });
});

describe('body & hand hotspots', () => {
  const handJointIds = [...HAND_VIEWS.right.hotspots, ...HAND_VIEWS.left.hotspots].map(
    (spot) => spot.jointId,
  );
  const bodyJointIds = BODY_HOTSPOTS.filter(
    (spot): spot is Extract<typeof spot, { kind: 'joint' }> => spot.kind === 'joint',
  ).map((spot) => spot.jointId);

  it('together cover all 28 joints exactly once', () => {
    const all: JointId[] = [...bodyJointIds, ...handJointIds];
    expect(all.length).toBe(28);
    expect(new Set(all).size).toBe(28);
    expect(new Set(all)).toEqual(new Set(JOINT_CATALOG.map((joint) => joint.id)));
  });

  it('every hotspot references a joint that exists in the catalog', () => {
    for (const id of [...bodyJointIds, ...handJointIds]) {
      expect(JOINT_BY_ID.has(id)).toBe(true);
    }
  });

  it('exposes exactly two hand hotspots and eleven joints per hand', () => {
    expect(BODY_HOTSPOTS.filter((spot) => spot.kind === 'hand').length).toBe(2);
    expect(HAND_VIEWS.right.hotspots.length).toBe(11);
    expect(HAND_VIEWS.left.hotspots.length).toBe(11);
  });
});

describe('assessment configs', () => {
  it('CDAI and DAS28 both evaluate the 28 joints', () => {
    for (const config of ASSESSMENT_CONFIGS) {
      expect(config.joints.length).toBe(28);
    }
  });

  it('only references joints that exist in the catalog', () => {
    for (const config of ASSESSMENT_CONFIGS) {
      for (const id of config.joints) {
        expect(JOINT_BY_ID.has(id)).toBe(true);
      }
    }
  });

  it('JOINTS_28 contains no duplicates', () => {
    expect(new Set(JOINTS_28).size).toBe(28);
  });
});
