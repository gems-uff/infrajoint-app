/**
 * Automatic RGB ↔ thermal alignment by **silhouette registration** — the
 * automated equivalent of the manual point calibration, using the whole hand
 * outline instead of clicked pairs.
 *
 * Both modalities segment easily: in the photo the skin stands out against the
 * blue backdrop; in the matrix the warm body stands out against the cold
 * background (Otsu). The RGB → CSV mapping is then found by searching the
 * scale + translation (no rotation — the sensors are co-mounted and
 * axis-aligned) that maximizes the overlap between the warped skin silhouette
 * and the thermal body silhouette. Thousands of silhouette pixels act as
 * correspondence points, so a mis-detected marker cannot skew the result.
 *
 * Validated against real camera data (V047): lands both fiducial markers on
 * their thermal impressions within ~2 CSV cells without using them in the fit.
 *
 * The grid search only recovers scale + translation. A final ICP refinement of
 * the two contours reuses the manual calibration's `estimateSimilarityTransform`
 * to add rotation and sub-cell precision, matching the manual method's accuracy
 * — but is kept only when it tightens the outline fit, so it never regresses.
 */

import { applyAffine, estimateSimilarityTransform, similarityScale } from './alignment';
import { isSkinRgb } from './color-tests';
import { AffineMatrix, Point, RgbPixels, ThermalMatrix } from './image-analyzer.model';
import { connectedComponents, binaryOpen, nearestFeatureMap, otsuThreshold } from './image-ops';

export interface SilhouetteRegistration {
  /** RGB → CSV scale + translation. */
  readonly matrix: AffineMatrix;
}

/** Work on a decimated grid: RGB sampled every 4 px, CSV every 2 px. */
export const RGB_STRIDE = 4;
const CSV_STRIDE = 2;
/** Max silhouette sample points used to score a candidate transform. */
const MAX_POINTS = 6000;

/** A binary mask over a decimated pixel grid. */
export interface GridMask {
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Skin silhouette on the decimated grid (any skin tone; see `isSkinRgb`),
 * opened to drop specks, keeping the two largest components (one arm+hand
 * per side).
 */
export function segmentRgbSkin(pixels: RgbPixels): GridMask {
  const { data } = pixels;
  const width = Math.floor(pixels.width / RGB_STRIDE);
  const height = Math.floor(pixels.height / RGB_STRIDE);
  let mask: Uint8Array = new Uint8Array(width * height);

  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      const o = (gy * RGB_STRIDE * pixels.width + gx * RGB_STRIDE) * 4;
      if (isSkinRgb(data[o], data[o + 1], data[o + 2])) {
        mask[gy * width + gx] = 1;
      }
    }
  }

  mask = binaryOpen(mask, width, height, 1);

  // Keep the two largest components (left and right arm+hand); drops the odd
  // non-blue clutter such as a table edge at the frame border.
  const blobs = connectedComponents(mask, width, height)
    .sort((a, b) => b.area - a.area)
    .slice(0, 2);
  const kept = new Uint8Array(width * height);
  for (const blob of blobs) {
    for (const i of blob.pixels) {
      kept[i] = 1;
    }
  }
  return { mask: kept, width, height };
}

/** Warm-body silhouette on the decimated grid (Otsu over the whole matrix). */
export function segmentThermalBody(matrix: ThermalMatrix): GridMask {
  const { values } = matrix;
  const finite: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      finite.push(v);
      if (v < min) {
        min = v;
      }
      if (v > max) {
        max = v;
      }
    }
  }
  const width = Math.floor(matrix.width / CSV_STRIDE);
  const height = Math.floor(matrix.height / CSV_STRIDE);
  const mask = new Uint8Array(width * height);
  if (finite.length === 0 || max - min <= 0) {
    return { mask, width, height };
  }
  const threshold = otsuThreshold(finite, min, max);
  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      const v = values[gy * CSV_STRIDE * matrix.width + gx * CSV_STRIDE];
      if (Number.isFinite(v) && v > threshold) {
        mask[gy * width + gx] = 1;
      }
    }
  }
  return { mask, width, height };
}

/**
 * Finds the RGB → CSV scale + translation maximizing silhouette overlap.
 * Coarse grid search around the camera's nominal scale (0.5) followed by a
 * local refinement. Null when either silhouette is degenerate.
 */
export function registerSilhouettes(
  pixels: RgbPixels,
  matrix: ThermalMatrix,
): SilhouetteRegistration | null {
  const rgb = segmentRgbSkin(pixels);
  const thermal = segmentThermalBody(matrix);

  // Silhouette sample points in RGB grid coords.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < rgb.mask.length; i++) {
    if (rgb.mask[i]) {
      xs.push(i % rgb.width);
      ys.push((i / rgb.width) | 0);
    }
  }
  let thermalCount = 0;
  for (const m of thermal.mask) {
    thermalCount += m;
  }
  if (xs.length < 500 || thermalCount < 500) {
    return null; // not enough silhouette on one of the sides
  }

  const step = Math.max(1, Math.ceil(xs.length / MAX_POINTS));
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < xs.length; i += step) {
    px.push(xs[i]);
    py.push(ys[i]);
  }

  // In grid coords: p_csvGrid = s'·p_rgbGrid + t' with s' = s·RGB_STRIDE/CSV_STRIDE
  // (nominal s ≈ 0.5 → s' ≈ 1) and t' = t/CSV_STRIDE.
  //
  // This is the search *objective*, not a quality figure: the denominator mixes
  // the subsampled point set with the full thermal mask, which is fine for
  // ranking candidates (both terms are constant within a capture) but is not a
  // Dice coefficient and must never be reported. See `alignment-quality.ts`.
  const dice = (s: number, tx: number, ty: number): number => {
    let inter = 0;
    for (let i = 0; i < px.length; i++) {
      const x = (s * px[i] + tx) | 0;
      const y = (s * py[i] + ty) | 0;
      if (x >= 0 && x < thermal.width && y >= 0 && y < thermal.height) {
        inter += thermal.mask[y * thermal.width + x];
      }
    }
    return (2 * inter) / (px.length + thermalCount);
  };

  let best = { score: -1, s: 1, tx: 0, ty: 0 };
  for (let s = 0.84; s <= 1.165; s += 0.02) {
    for (let tx = -30; tx <= 30; tx += 3) {
      for (let ty = -30; ty <= 30; ty += 3) {
        const score = dice(s, tx, ty);
        if (score > best.score) {
          best = { score, s, tx, ty };
        }
      }
    }
  }
  const coarse = best;
  for (let s = coarse.s - 0.02; s <= coarse.s + 0.021; s += 0.005) {
    for (let tx = coarse.tx - 3; tx <= coarse.tx + 3; tx += 1) {
      for (let ty = coarse.ty - 3; ty <= coarse.ty + 3; ty += 1) {
        const score = dice(s, tx, ty);
        if (score > best.score) {
          best = { score, s, tx, ty };
        }
      }
    }
  }

  // Grid result as a grid-space affine (RGB grid → CSV grid), the ICP seed.
  const coarseGrid: AffineMatrix = {
    a: best.s,
    b: 0,
    tx: best.tx,
    c: 0,
    d: best.s,
    ty: best.ty,
  };
  const refinedGrid = refineByIcp(rgb, thermal, coarseGrid) ?? coarseGrid;

  return { matrix: gridToCsvMatrix(refinedGrid) };
}

/** Grid-space affine (RGB grid → CSV grid) to the RGB px → CSV cell matrix. */
function gridToCsvMatrix(g: AffineMatrix): AffineMatrix {
  const k = CSV_STRIDE / RGB_STRIDE;
  return {
    a: g.a * k,
    b: g.b * k,
    tx: g.tx * CSV_STRIDE,
    c: g.c * k,
    d: g.d * k,
    ty: g.ty * CSV_STRIDE,
  };
}

/** Max contour points fed to the ICP fit (per iteration). */
const ICP_MAX_POINTS = 3000;
const ICP_ITERATIONS = 12;
/**
 * Correspondence gate in grid cells: pairs farther apart than this are
 * outliers (frame cuts, FOV mismatch) and are excluded from the fit. Shrinks
 * linearly to `ICP_GATE_END` as the iterations converge.
 */
const ICP_GATE_START = 8;
const ICP_GATE_END = 3;
/** Refinement must stay near the grid-search seed: the sensors are co-mounted. */
const ICP_MAX_SCALE_DRIFT = 0.08;
const ICP_MAX_ROTATION_RAD = 0.14; // ≈ 8°

/**
 * Refines a grid-space RGB → CSV transform by iteratively matching the RGB
 * contour to its nearest thermal-contour points and re-fitting a similarity
 * transform (rotation + scale + translation). Robust against real-camera
 * artifacts: frame-cut edges are not contours, far correspondences are gated
 * out, and any fit drifting from the grid-search seed (scale or rotation) is
 * rejected. Returns the refined transform only when it lowers the mean
 * contour distance, otherwise null (the caller keeps the seed).
 */
function refineByIcp(
  rgb: GridMask,
  thermal: GridMask,
  seed: AffineMatrix,
): AffineMatrix | null {
  const src = sampleContour(rgb, ICP_MAX_POINTS);
  const thermalEdge = contourMask(thermal);
  if (src.length < 50) {
    return null;
  }
  const feature = nearestFeatureMap(thermalEdge, thermal.width, thermal.height);

  const seedScale = similarityScale(seed);
  // ICP against a blurred thermal outline drifts after it converges (thermal
  // bleed dilates the silhouette), so keep the best iterate, not the last.
  let current = seed;
  let best = seed;
  let bestDist = meanContourDist(src, seed, feature, thermal);
  const seedDist = bestDist;
  for (let iter = 0; iter < ICP_ITERATIONS; iter++) {
    const t = iter / (ICP_ITERATIONS - 1);
    const gate = ICP_GATE_START + (ICP_GATE_END - ICP_GATE_START) * t;
    const srcIn: Point[] = [];
    const dstIn: Point[] = [];
    for (const s of src) {
      const p = applyAffine(current, s.x, s.y);
      const x = p.x | 0;
      const y = p.y | 0;
      if (x < 0 || x >= thermal.width || y < 0 || y >= thermal.height) {
        continue; // outside the thermal FOV: no correspondence can exist
      }
      const f = feature[y * thermal.width + x];
      if (f < 0) {
        continue;
      }
      const fx = f % thermal.width;
      const fy = (f / thermal.width) | 0;
      if (Math.hypot(p.x - fx, p.y - fy) > gate) {
        continue; // outlier pair: frame cut or FOV mismatch, not a real match
      }
      srcIn.push(s);
      dstIn.push({ x: fx, y: fy });
    }
    if (srcIn.length < 50) {
      break;
    }
    const next = estimateSimilarityTransform(srcIn, dstIn);
    if (!next) {
      break;
    }
    // A fit wandering off in scale or rotation is chasing outliers — stop and
    // keep the last sane transform rather than diverge.
    const drift = Math.abs(similarityScale(next) / seedScale - 1);
    const rotation = Math.abs(Math.atan2(next.c, next.a));
    if (drift > ICP_MAX_SCALE_DRIFT || rotation > ICP_MAX_ROTATION_RAD) {
      break;
    }
    current = next;
    const dist = meanContourDist(src, current, feature, thermal);
    if (dist < bestDist) {
      bestDist = dist;
      best = current;
    }
  }

  return bestDist < seedDist ? best : null;
}

/**
 * Mean distance from each transformed contour point to the nearest thermal
 * edge cell, with each distance capped at `ICP_GATE_START` so unmatched
 * stretches (frame cuts, FOV mismatch) cannot dominate the comparison.
 */
function meanContourDist(
  src: readonly Point[],
  g: AffineMatrix,
  feature: Int32Array,
  thermal: GridMask,
): number {
  let sum = 0;
  for (const s of src) {
    const p = applyAffine(g, s.x, s.y);
    const x = Math.min(thermal.width - 1, Math.max(0, p.x | 0));
    const y = Math.min(thermal.height - 1, Math.max(0, p.y | 0));
    const f = feature[y * thermal.width + x];
    if (f < 0) {
      sum += ICP_GATE_START;
      continue;
    }
    const dx = p.x - (f % thermal.width);
    const dy = p.y - ((f / thermal.width) | 0);
    sum += Math.min(Math.hypot(dx, dy), ICP_GATE_START);
  }
  return sum / src.length;
}

/**
 * The mask's boundary cells: set cells with at least one unset 4-neighbor.
 * Cells on the image border are excluded — an arm cut by the frame edge is an
 * artifact of the field of view, not part of the real outline, and the two
 * cameras crop differently.
 */
function contourMask(m: GridMask): Uint8Array {
  const { mask, width, height } = m;
  const edge = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!mask[i]) {
        continue;
      }
      if (!mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width]) {
        edge[i] = 1;
      }
    }
  }
  return edge;
}

/** Boundary points of a mask, subsampled to at most `max` points. */
function sampleContour(m: GridMask, max: number): Point[] {
  const edge = contourMask(m);
  const pts: Point[] = [];
  for (let i = 0; i < edge.length; i++) {
    if (edge[i]) {
      pts.push({ x: i % m.width, y: (i / m.width) | 0 });
    }
  }
  if (pts.length <= max) {
    return pts;
  }
  const step = Math.ceil(pts.length / max);
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push(pts[i]);
  }
  return out;
}
