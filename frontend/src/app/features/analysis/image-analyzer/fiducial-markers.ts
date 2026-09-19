/**
 * Automatic fiducial-marker refinement — the automated equivalent of manual
 * point calibration, using the capture protocol's blue tape markers.
 *
 * Each forearm carries a small blue tape square. In the RGB photo it is a blue
 * blob surrounded by skin; in the thermal matrix it blocks the skin's emission
 * and shows as a cold blob enclosed by the warm body. Those are true interior
 * correspondences, immune to the silhouette-edge bias (thermal bleed blurs and
 * dilates the body outline, which caps contour-based accuracy at ~2–4 cells).
 *
 * Detection is guided by a coarse transform (silhouette registration): each
 * RGB marker's predicted CSV position must land near a detected cold blob.
 * The two matched pairs then feed the same `estimateSimilarityTransform` used
 * by manual calibration, recovering rotation + sub-cell translation. When
 * markers are missing or ambiguous the caller keeps the coarse alignment.
 */

import { applyAffine, estimateSimilarityTransform, similarityScale } from './alignment';
import { isBlueRgb, isSkinRgb } from './color-tests';
import { AffineMatrix, Point, RgbPixels, ThermalMatrix } from './image-analyzer.model';
import { connectedComponents, otsuThreshold } from './image-ops';
import { environment } from '../../../../environments/environment';

export interface FiducialRefinement {
  /** RGB px → CSV cell similarity transform fitted on the marker pairs. */
  readonly matrix: AffineMatrix;
  /** Detected marker centroids, for diagnostics/overlay. */
  readonly rgbPoints: readonly Point[];
  readonly csvPoints: readonly Point[];
  /** How far this fit moved the coarse estimate. */
  readonly correction: FiducialCorrection;
}

/**
 * The gap between where the silhouettes predicted each marker and where its
 * impression actually is — i.e. **how much the marker refinement changed the
 * silhouette estimate**, not a residual of the fiducial fit. Two pairs give
 * four equations for a similarity's four degrees of freedom, so the fit is
 * exactly determined and its residual is identically zero, even when a marker
 * was detected wrong; there is no redundancy left to check.
 *
 * Those same four degrees of freedom are what the two discrepancy vectors
 * decompose into: their common part is translation, their differential part is
 * scale and rotation. Decomposing about the marker midpoint rather than the
 * image origin keeps the four independent — otherwise a pure rotation shows up
 * as a large spurious translation.
 *
 * The decomposition is exact, not an approximation. A similarity is fixed by
 * two point pairs, and this one maps every predicted position onto its detected
 * one, so it *is* `fitted ∘ coarse⁻¹` — the transform that carries the coarse
 * alignment to the final one. `scaleRatio` and `rotationDeg` are therefore the
 * scale and rotation of the correction itself, not of the final alignment.
 *
 * Two limits to carry into any analysis of these numbers: each offset is
 * censored at `MAX_PREDICTION_DIST` (impressions farther away are never
 * matched, so a bad alignment surfaces as *no fiducials* rather than as a large
 * correction — absent captures are censored, not missing at random), and the
 * markers sit on the forearms, so a scale correction anchored there displaces
 * the hand joints more than it displaced the markers.
 */
export interface FiducialCorrection {
  /** Where the coarse transform put each marker, in CSV cells. */
  readonly predicted: readonly Point[];
  /** Where its thermal impression actually is, in CSV cells. */
  readonly detected: readonly Point[];
  /** `detected − predicted` per marker, in CSV cells. */
  readonly offsets: readonly Point[];
  /**
   * Mean of the offset *lengths*: `Σ √(Δxᵢ² + Δyᵢ²) / n`. It is a summary of
   * the same vectors the components below decompose, not a fourth component —
   * it is never the sum of shift, scale and rotation.
   */
  readonly magnitude: number;
  /** Displacement of the marker-pair midpoint: the translation component. */
  readonly shiftX: number;
  readonly shiftY: number;
  /** Detected marker separation ÷ predicted separation. */
  readonly scaleRatio: number;
  /** Rotation of the marker axis, in degrees. */
  readonly rotationDeg: number;
}

/** RGB marker blob area in full-resolution pixels (tape ≈ 30–60 px wide). */
const RGB_AREA_MIN = 100;
const RGB_AREA_MAX = 12000;
/** Fraction of the surrounding ring that must look like skin. */
const MIN_SKIN_SURROUND = 0.5;
/** Max RGB marker candidates before the scene is considered too noisy. */
const MAX_RGB_CANDIDATES = 6;
/** Half-size of the local window searched for the thermal impression. */
const SEARCH_WINDOW = 18;
/** Thermal marker blob area in CSV cells. */
const CSV_AREA_MIN = 8;
const CSV_AREA_MAX = 900;
/** Max distance (CSV cells) between predicted and detected marker position. */
const MAX_PREDICTION_DIST = 15;
/** Min separation (CSV cells) between the two matched impressions. */
const MIN_PAIR_SEPARATION = 30;
/** The marker fit must stay near the coarse alignment (co-mounted sensors). */
const MAX_SCALE_DRIFT = 0.06;
const MAX_ROTATION_RAD = 0.06; // ≈ 3.4°

/**
 * Detects the two blue markers and their thermal impressions and returns the
 * similarity transform fitted on the pairs, or null when the markers cannot
 * be found unambiguously (the coarse alignment stays in effect).
 *
 * Extra blue-ish blobs on skin (painted nails, jewelry) are tolerated: every
 * candidate must be confirmed by a cold impression near its predicted CSV
 * position, and exactly two confirmed pairs must remain. The impression is
 * searched with a local threshold around the prediction, so markers that are
 * warmer than the global body/background split (thin tape) are still found.
 */
export function refineWithFiducials(
  pixels: RgbPixels,
  matrix: ThermalMatrix,
  coarse: AffineMatrix,
): FiducialRefinement | null {
  const candidates = findRgbMarkers(pixels);
  if (candidates.length < 2 || candidates.length > MAX_RGB_CANDIDATES) {
    debug(`descartado: ${candidates.length} candidato(s) RGB`, candidates);
    return null;
  }

  // Keep only candidates whose predicted CSV neighborhood holds a cold blob.
  const rgbMarkers: Point[] = [];
  const csvMarkers: Point[] = [];
  const predictions: Point[] = [];
  for (const candidate of candidates) {
    const predicted = applyAffine(coarse, candidate.x, candidate.y);
    const impression = findImpressionNear(matrix, predicted);
    debug(
      `candidato rgb(${candidate.x.toFixed(0)}, ${candidate.y.toFixed(0)}) → ` +
        `previsto csv(${predicted.x.toFixed(1)}, ${predicted.y.toFixed(1)}) → ` +
        (impression
          ? `impressão csv(${impression.x.toFixed(1)}, ${impression.y.toFixed(1)})`
          : 'sem impressão térmica'),
    );
    if (impression) {
      rgbMarkers.push(candidate);
      csvMarkers.push(impression);
      predictions.push(predicted);
    }
  }
  if (rgbMarkers.length !== 2) {
    debug(`descartado: ${rgbMarkers.length} par(es) confirmado(s), esperado 2`);
    return null;
  }
  const separation = Math.hypot(
    csvMarkers[0].x - csvMarkers[1].x,
    csvMarkers[0].y - csvMarkers[1].y,
  );
  if (separation < MIN_PAIR_SEPARATION) {
    debug(`descartado: impressões separadas por só ${separation.toFixed(1)} células`);
    return null; // both matched the same neighborhood: ambiguous
  }

  const fitted = estimateSimilarityTransform(rgbMarkers, csvMarkers);
  if (!fitted) {
    return null;
  }
  // A 2-point fit trusts both detections completely; reject anything that
  // disagrees with the coarse alignment more than the hardware allows.
  const drift = Math.abs(similarityScale(fitted) / similarityScale(coarse) - 1);
  const rotation = Math.abs(Math.atan2(fitted.c, fitted.a));
  if (drift > MAX_SCALE_DRIFT || rotation > MAX_ROTATION_RAD) {
    debug(
      `descartado: ajuste fora dos limites (deriva de escala ${(drift * 100).toFixed(1)}%, ` +
        `rotação ${((rotation * 180) / Math.PI).toFixed(2)}°)`,
    );
    return null;
  }
  debug('aplicado', { rgbMarkers, csvMarkers });
  return {
    matrix: fitted,
    rgbPoints: rgbMarkers,
    csvPoints: csvMarkers,
    correction: describeCorrection(predictions, csvMarkers),
  };
}

/** Decomposes the predicted → detected offsets about the marker midpoint. */
function describeCorrection(
  predicted: readonly Point[],
  detected: readonly Point[],
): FiducialCorrection {
  const offsets = detected.map((d, i) => ({
    x: d.x - predicted[i].x,
    y: d.y - predicted[i].y,
  }));
  const magnitude =
    offsets.reduce((sum, o) => sum + Math.hypot(o.x, o.y), 0) / offsets.length;
  // Midpoint displacement — the part common to both markers.
  const shiftX = offsets.reduce((sum, o) => sum + o.x, 0) / offsets.length;
  const shiftY = offsets.reduce((sum, o) => sum + o.y, 0) / offsets.length;

  const predictedAxis = { x: predicted[1].x - predicted[0].x, y: predicted[1].y - predicted[0].y };
  const detectedAxis = { x: detected[1].x - detected[0].x, y: detected[1].y - detected[0].y };
  const predictedLength = Math.hypot(predictedAxis.x, predictedAxis.y);
  const detectedLength = Math.hypot(detectedAxis.x, detectedAxis.y);
  const scaleRatio = predictedLength > 0 ? detectedLength / predictedLength : 1;
  const rotationDeg =
    predictedLength > 0 && detectedLength > 0
      ? ((Math.atan2(detectedAxis.y, detectedAxis.x) -
          Math.atan2(predictedAxis.y, predictedAxis.x) +
          Math.PI * 3) %
          (Math.PI * 2)) *
          (180 / Math.PI) -
        180
      : 0;

  return {
    predicted: [...predicted],
    detected: [...detected],
    offsets,
    magnitude,
    shiftX,
    shiftY,
    scaleRatio,
    rotationDeg,
  };
}

/**
 * Diagnostic trail for support, at the browser console's Info level.
 *
 * Silent in a production build. The trail exists to explain why a correction was
 * discarded while someone is working on the alignment, and that audience is always
 * running a development build. In production it was noise in the console of a user
 * who cannot act on it.
 */
function debug(message: string, detail?: unknown): void {
  if (environment.production) {
    return;
  }
  if (detail !== undefined) {
    console.info(`[fiducial] ${message}`, detail);
  } else {
    console.info(`[fiducial] ${message}`);
  }
}

// --- RGB marker detection -----------------------------------------------------

/**
 * Blue blobs of tape-like size, fully inside the frame and surrounded by skin
 * (which excludes every part of the blue backdrop). Returns their centroids,
 * or fewer/more than 2 when the scene does not match the protocol.
 */
function findRgbMarkers(pixels: RgbPixels): Point[] {
  const { data, width, height } = pixels;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (isBlueRgb(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])) {
      mask[i] = 1;
    }
  }

  const markers: Point[] = [];
  for (const blob of connectedComponents(mask, width, height)) {
    if (blob.area < RGB_AREA_MIN || blob.area > RGB_AREA_MAX) {
      continue;
    }
    let sx = 0;
    let sy = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let touchesBorder = false;
    for (const i of blob.pixels) {
      const x = i % width;
      const y = (i / width) | 0;
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) {
        touchesBorder = true;
        break;
      }
      sx += x;
      sy += y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (touchesBorder) {
      continue;
    }
    if (skinSurroundRatio(pixels, minX, minY, maxX, maxY) < MIN_SKIN_SURROUND) {
      continue; // blue patch on the backdrop, not on an arm
    }
    markers.push({ x: sx / blob.area, y: sy / blob.area });
  }
  return markers.sort((a, b) => a.x - b.x);
}

/** Fraction of a ring around the blob's box that is skin (bright, not blue). */
function skinSurroundRatio(
  pixels: RgbPixels,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  const { data, width, height } = pixels;
  const margin = Math.max(4, Math.round((maxX - minX + (maxY - minY)) / 4));
  const x0 = minX - margin;
  const x1 = maxX + margin;
  const y0 = minY - margin;
  const y1 = maxY + margin;
  let skin = 0;
  let total = 0;
  const sample = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    total++;
    const o = (y * width + x) * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (isSkinRgb(r, g, b)) {
      skin++;
    }
  };
  for (let x = x0; x <= x1; x++) {
    sample(x, y0);
    sample(x, y1);
  }
  for (let y = y0 + 1; y < y1; y++) {
    sample(x0, y);
    sample(x1, y);
  }
  return total === 0 ? 0 : skin / total;
}

// --- Thermal marker detection ---------------------------------------------------

/**
 * Centroid of the tape's cold impression near a predicted CSV position, or
 * null when none is found. The threshold is computed locally (Otsu over the
 * search window), because the tape often reads warmer than the global
 * body/background split — it is only cold *relative to the skin around it*.
 * The impression must not touch the window border: whatever does is the
 * background or the arm's edge, not a spot enclosed by warm skin.
 *
 * The impression can be larger than the window leaves room for (a tape square
 * on the diagonal spans ~24 cells while the prediction may be off by up to
 * MAX_PREDICTION_DIST), so a plausible blob clipped by the window border gets
 * one retry with the window recentered on its visible centroid. A true
 * background/arm-edge region keeps touching the border after recentering and
 * stays rejected.
 */
function findImpressionNear(matrix: ThermalMatrix, predicted: Point): Point | null {
  return searchImpression(matrix, predicted, predicted, 1);
}

function searchImpression(
  matrix: ThermalMatrix,
  center: Point,
  predicted: Point,
  retries: number,
): Point | null {
  const { width, height, values } = matrix;
  const x0 = Math.max(0, Math.round(center.x) - SEARCH_WINDOW);
  const y0 = Math.max(0, Math.round(center.y) - SEARCH_WINDOW);
  const x1 = Math.min(width - 1, Math.round(center.x) + SEARCH_WINDOW);
  const y1 = Math.min(height - 1, Math.round(center.y) + SEARCH_WINDOW);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 8 || h < 8) {
    return null;
  }

  const local: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = values[y * width + x];
      if (Number.isFinite(v)) {
        local.push(v);
        if (v < min) {
          min = v;
        }
        if (v > max) {
          max = v;
        }
      }
    }
  }
  if (local.length < 64 || max - min <= 0) {
    return null;
  }

  // Threshold cascade. The first Otsu splits the window's dominant modes —
  // but when the window straddles the arm's edge those modes are background
  // vs body, and a lukewarm tape hides on the warm side (it sits between the
  // two). The second chance re-runs Otsu on the warm side only, which then
  // separates skin from tape.
  const thresholds: number[] = [otsuThreshold(local, min, max)];
  const warm = local.filter((v) => v > thresholds[0]);
  if (warm.length >= 64) {
    let wMin = Infinity;
    let wMax = -Infinity;
    for (const v of warm) {
      if (v < wMin) {
        wMin = v;
      }
      if (v > wMax) {
        wMax = v;
      }
    }
    if (wMax - wMin > 0) {
      thresholds.push(otsuThreshold(warm, wMin, wMax));
    }
  }

  const clipped: Point[] = [];
  for (const threshold of thresholds) {
    const found = coldIslandNear(matrix, predicted, x0, y0, w, h, threshold, clipped);
    if (found) {
      return found;
    }
  }
  if (retries > 0) {
    clipped.sort(
      (a, b) =>
        Math.hypot(a.x - predicted.x, a.y - predicted.y) -
        Math.hypot(b.x - predicted.x, b.y - predicted.y),
    );
    for (const candidate of clipped) {
      const found = searchImpression(matrix, candidate, predicted, retries - 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Nearest cold island (≤ `threshold`) to `predicted` inside the window that
 * does not touch the window border (whatever does is background or the arm's
 * edge, not a spot enclosed by warm skin). Border-touching blobs of plausible
 * area near the prediction are reported through `clipped` so the caller can
 * retry with a recentered window.
 */
function coldIslandNear(
  matrix: ThermalMatrix,
  predicted: Point,
  x0: number,
  y0: number,
  w: number,
  h: number,
  threshold: number,
  clipped: Point[],
): Point | null {
  const { width, values } = matrix;
  const cold = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = values[(y0 + y) * width + (x0 + x)];
      if (!(Number.isFinite(v) && v > threshold)) {
        cold[y * w + x] = 1;
      }
    }
  }

  let best: Point | null = null;
  let bestDist = MAX_PREDICTION_DIST;
  for (const blob of connectedComponents(cold, w, h)) {
    if (blob.area < CSV_AREA_MIN || blob.area > CSV_AREA_MAX) {
      continue;
    }
    let sx = 0;
    let sy = 0;
    let touchesBorder = false;
    for (const i of blob.pixels) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        touchesBorder = true;
      }
      sx += x;
      sy += y;
    }
    const cx = x0 + sx / blob.area;
    const cy = y0 + sy / blob.area;
    const dist = Math.hypot(cx - predicted.x, cy - predicted.y);
    if (touchesBorder) {
      if (dist < MAX_PREDICTION_DIST) {
        clipped.push({ x: cx, y: cy });
      }
      continue;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: cx, y: cy };
    }
  }
  return best;
}
