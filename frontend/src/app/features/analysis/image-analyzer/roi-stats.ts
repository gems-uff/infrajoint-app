/**
 * ROI temperature aggregation over the thermal matrix.
 *
 * Port of `_roi_stats` (manual_roi_verifier.py) plus the median from
 * `extract_thermal_roi_stats` (core.py): clamps the bounding box to the
 * matrix, applies a circular/elliptical mask and aggregates ignoring NaNs.
 *
 * Cells are read straight out of the matrix at integer coordinates — no
 * interpolation, no resampling, no smoothing. The value reported is the
 * camera's own reading for that cell.
 *
 * Worth keeping in mind when interpreting the output: `min` and `max` are
 * **single-cell order statistics**, not averages of the coldest/hottest cells.
 * One stray cell moves them by the full contrast between skin and whatever it
 * came from (~6 °C against the mat, measured on V047), while `mean` moves by
 * that contrast times the *fraction* of cells swapped. That is why a small
 * alignment error shows up dramatically in `min` and mildly in `mean` — see
 * §4.11 of `src/escrita/analisador/texto-inicial.MD`.
 */

import { RoiShape, RoiStats, ThermalMatrix } from './image-analyzer.model';

function emptyStats(area: number): RoiStats {
  return { mean: NaN, median: NaN, max: NaN, min: NaN, area, count: 0 };
}

/**
 * Computes temperature statistics for an ROI given in CSV-cell coordinates.
 *
 * `include` optionally restricts which cells count — e.g. only cells whose
 * RGB counterpart is skin, so an ROI larger than the finger doesn't average
 * in the background.
 */
export function computeRoiStats(
  matrix: ThermalMatrix,
  shape: RoiShape,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  include?: (x: number, y: number) => boolean,
): RoiStats {
  const { width, height, values } = matrix;
  const y0 = Math.max(0, Math.trunc(cy - ry));
  const y1 = Math.min(height, Math.trunc(cy + ry + 1));
  const x0 = Math.max(0, Math.trunc(cx - rx));
  const x1 = Math.min(width, Math.trunc(cx + rx + 1));
  if (y0 >= y1 || x0 >= x1) {
    return emptyStats(0);
  }

  const r = Math.max(rx, ry);
  const r2 = Math.max(r * r, 1);
  const rx2 = Math.max(rx * rx, 1);
  const ry2 = Math.max(ry * ry, 1);

  let area = 0; // cells inside the shape and matrix bounds (before `include`)
  const inside: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inRoi =
        shape === 'circle' ? dx * dx + dy * dy <= r2 : (dx * dx) / rx2 + (dy * dy) / ry2 <= 1;
      if (!inRoi) {
        continue;
      }
      area++;
      if (include && !include(x, y)) {
        continue;
      }
      const v = values[y * width + x];
      if (Number.isFinite(v)) {
        inside.push(v);
      }
    }
  }

  if (inside.length === 0) {
    return emptyStats(area);
  }

  inside.sort((a, b) => a - b);
  const mid = inside.length >> 1;
  const median = inside.length % 2 === 1 ? inside[mid] : (inside[mid - 1] + inside[mid]) / 2;
  let sum = 0;
  for (const v of inside) {
    sum += v;
  }

  return {
    mean: sum / inside.length,
    median,
    max: inside[inside.length - 1],
    min: inside[0],
    area,
    count: inside.length,
  };
}
