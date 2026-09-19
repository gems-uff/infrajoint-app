import { BodySide, JointId } from './body-map.model';

/**
 * The eight evaluable hotspots defined by `body.svg`, expressed as percentages
 * of its 1023×1537 viewBox so they overlay the image at any size.
 *
 * The patient's right side is shown on the viewer's right, so the right-most
 * hotspots map to the patient's RIGHT joints.
 *
 * Six hotspots map directly to a large joint; the two hand hotspots open the
 * detailed hand view (direita.png / esquerda.png) instead.
 */

/** Path to the source body image. */
export const BODY_IMAGE = 'assets/images/body.png';

interface BodyJointHotspot {
  readonly kind: 'joint';
  readonly jointId: JointId;
  readonly xPct: number;
  readonly yPct: number;
}

interface BodyHandHotspot {
  readonly kind: 'hand';
  readonly side: BodySide;
  readonly label: string;
  readonly xPct: number;
  readonly yPct: number;
}

export type BodyHotspot = BodyJointHotspot | BodyHandHotspot;

export const BODY_HOTSPOTS: readonly BodyHotspot[] = [
  { kind: 'joint', jointId: 'LEFT_SHOULDER', xPct: 34.6, yPct: 20.95 },
  { kind: 'joint', jointId: 'RIGHT_SHOULDER', xPct: 64.42, yPct: 21.02 },
  { kind: 'joint', jointId: 'LEFT_ELBOW', xPct: 31.28, yPct: 36.3 },
  { kind: 'joint', jointId: 'RIGHT_ELBOW', xPct: 67.45, yPct: 36.3 },
  { kind: 'hand', side: 'left', label: 'Mão esquerda', xPct: 26.88, yPct: 48.14 },
  { kind: 'hand', side: 'right', label: 'Mão direita', xPct: 72.04, yPct: 47.95 },
  { kind: 'joint', jointId: 'LEFT_KNEE', xPct: 41.74, yPct: 65.06 },
  { kind: 'joint', jointId: 'RIGHT_KNEE', xPct: 56.99, yPct: 64.93 },
];
