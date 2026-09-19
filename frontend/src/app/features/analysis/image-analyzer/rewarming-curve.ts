/**
 * Rewarming-curve series: temperature × time per joint ROI across a capture
 * sequence. The axis carries the dynamic captures only, t = 0 being the end of
 * the cooling; frames where a joint is missing (failed alignment/detection,
 * hand out of frame) become gaps, not zeros.
 *
 * **The baseline is deliberately not on this axis.** It is taken before the
 * fans, and the protocol never measures how long before — the EXIF of a real
 * session put ~177 s between it and the first dynamic capture, against the 120 s
 * of cooling the protocol prescribes, and that slack is operator-dependent.
 * Plotting it at t = 0 sat two different origins on the same tick and drew a
 * slope across an interval nobody measured. Its temperatures are read from the
 * baseline capture itself (`phase = 'baseline'`), not from this series.
 */

import { HandSide } from './image-analyzer.model';
import { JOINT_ROI_DEFS } from './joint-rois';

export type CurveStatistic = 'mean' | 'max' | 'min';

export const CURVE_STATISTIC_LABELS: Record<CurveStatistic, string> = {
  mean: 'Média',
  max: 'Máxima',
  min: 'Mínima',
};

/** The slice of a JointRoi the curve needs (structurally satisfied by JointRoi). */
export interface CurveRoi {
  readonly side: HandSide;
  readonly landmarkId: number;
  readonly label: string;
  readonly stats: { readonly mean: number; readonly max: number; readonly min: number };
}

/** One capture's contribution: its position on the time axis plus its ROIs. */
export interface CurveFrame {
  readonly timeSeconds: number;
  readonly kind: 'baseline' | 'dynamic';
  readonly rois: readonly CurveRoi[];
}

export interface CurvePoint {
  readonly timeSeconds: number;
  /** Temperature in °C; NaN renders as a gap. */
  readonly value: number;
}

export interface RewarmingSeries {
  /** Stable identity (`side:landmarkId`). */
  readonly key: string;
  /** Chart label, e.g. "E MCP 3". */
  readonly label: string;
  readonly side: HandSide;
  readonly landmarkId: number;
  /** One per dynamic capture, sorted by time. The baseline is not among them. */
  readonly points: readonly CurvePoint[];
}

/**
 * Builds one series per (side, selected joint) across the dynamic frames,
 * sorted by time. Sides appear only when at least one dynamic frame detected
 * that hand: a hand seen in the baseline alone has no rewarming to plot.
 */
export function buildRewarmingSeries(
  frames: readonly CurveFrame[],
  landmarkIds: readonly number[],
  statistic: CurveStatistic,
): RewarmingSeries[] {
  const ordered = [...frames]
    .filter((f) => f.kind === 'dynamic')
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
  const series: RewarmingSeries[] = [];

  for (const side of ['Esquerda', 'Direita'] as const) {
    for (const landmarkId of landmarkIds) {
      const def = JOINT_ROI_DEFS.find((d) => d.landmarkId === landmarkId);
      if (!def) {
        continue;
      }
      const points = ordered.map((frame): CurvePoint => {
        const roi = frame.rois.find((r) => r.side === side && r.landmarkId === landmarkId);
        return { timeSeconds: frame.timeSeconds, value: roi ? roi.stats[statistic] : NaN };
      });
      if (points.every((p) => Number.isNaN(p.value))) {
        continue; // this hand never appeared — no series
      }
      series.push({
        key: `${side}:${landmarkId}`,
        label: `${side === 'Esquerda' ? 'E' : 'D'} ${def.label}`,
        side,
        landmarkId,
        points,
      });
    }
  }
  return series;
}
