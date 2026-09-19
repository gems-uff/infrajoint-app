/**
 * Final alignment polish — corrects the residual parallax shift.
 *
 * The fiducial markers sit on the forearm, a few centimeters above the mat,
 * while the hands lie flat on it. With the two lenses mounted side by side,
 * an alignment anchored on the marker plane leaves the hand layer displaced
 * by a small, roughly constant offset (~1–2 RGB px, mostly horizontal).
 *
 * This pass measures that offset directly where the user looks: it scans the
 * photo line by line, pairs each optical skin↔background transition with the
 * nearest same-direction warm↔cold transition of the warped thermal matrix,
 * and averages the difference. Averaging entering and leaving edges together
 * cancels the thermal halo (which dilates the warm silhouette symmetrically),
 * isolating the true shift. Scale and rotation are left untouched — only the
 * translation is nudged, and only within a small clamp.
 */

import { applyAffine } from './alignment';
import { isSkinRgb } from './color-tests';
import { AffineMatrix, RgbPixels, ThermalMatrix } from './image-analyzer.model';
import { otsuThreshold } from './image-ops';

/** Scanline spacing in RGB px (transitions are abundant; no need for every row). */
const SCAN_STRIDE = 4;
/** Max distance (RGB px) between paired optical and thermal transitions. */
const MAX_PAIR_DIST = 14;
/** Minimum matched transition pairs per axis for a trustworthy estimate. */
const MIN_PAIRS = 100;
/** The correction is a small parallax nudge; anything larger is distrusted. */
const MAX_SHIFT_PX = 6;

/**
 * Returns `fitted` with its translation nudged so the warped thermal edges
 * coincide with the optical skin edges, or null when there are not enough
 * matched edges (the caller keeps the unpolished alignment).
 */
export function polishTranslation(
  pixels: RgbPixels,
  matrix: ThermalMatrix,
  fitted: AffineMatrix,
): AffineMatrix | null {
  const warm = warmTest(matrix);
  if (!warm) {
    return null;
  }
  const shiftX = axisShift(pixels, warm, fitted, 'x');
  const shiftY = axisShift(pixels, warm, fitted, 'y');
  if (shiftX === null || shiftY === null) {
    return null;
  }
  const sx = clamp(shiftX, MAX_SHIFT_PX);
  const sy = clamp(shiftY, MAX_SHIFT_PX);
  // The thermal layer appears displaced by (sx, sy) in RGB space; sampling at
  // r + shift moves it back onto the photo: fitted'(r) = fitted(r + shift).
  return {
    ...fitted,
    tx: fitted.tx + fitted.a * sx + fitted.b * sy,
    ty: fitted.ty + fitted.c * sx + fitted.d * sy,
  };
}

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

/** Warm/cold test per CSV cell (Otsu over the finite values). */
function warmTest(matrix: ThermalMatrix): ((cx: number, cy: number) => boolean) | null {
  const { width, height, values } = matrix;
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
  if (finite.length === 0 || max - min <= 0) {
    return null;
  }
  const threshold = otsuThreshold(finite, min, max);
  return (cx, cy) =>
    cx >= 0 && cx < width && cy >= 0 && cy < height && values[cy * width + cx] > threshold;
}

/**
 * Mean (thermal − optical) edge offset along one axis, from paired scanline
 * transitions. Entering and leaving edges are averaged separately and then
 * combined, so the symmetric thermal dilation cancels out.
 */
function axisShift(
  pixels: RgbPixels,
  warm: (cx: number, cy: number) => boolean,
  fitted: AffineMatrix,
  axis: 'x' | 'y',
): number | null {
  const outer = axis === 'x' ? pixels.height : pixels.width;
  const inner = axis === 'x' ? pixels.width : pixels.height;
  let enterSum = 0;
  let enterN = 0;
  let leaveSum = 0;
  let leaveN = 0;

  const skinT: { pos: number; dir: 1 | -1 }[] = [];
  const warmT: { pos: number; dir: 1 | -1 }[] = [];
  for (let j = 8; j < outer - 8; j += SCAN_STRIDE) {
    skinT.length = 0;
    warmT.length = 0;
    let prevSkin = false;
    let prevWarm = false;
    for (let i = 8; i < inner - 8; i++) {
      const x = axis === 'x' ? i : j;
      const y = axis === 'x' ? j : i;
      const skin = isSkinPixel(pixels, x, y);
      const p = applyAffine(fitted, x, y);
      const isWarm = warm(p.x | 0, p.y | 0);
      if (skin !== prevSkin) {
        skinT.push({ pos: i, dir: skin ? 1 : -1 });
        prevSkin = skin;
      }
      if (isWarm !== prevWarm) {
        warmT.push({ pos: i, dir: isWarm ? 1 : -1 });
        prevWarm = isWarm;
      }
    }
    for (const st of skinT) {
      let bestD = MAX_PAIR_DIST;
      let bestPos: number | null = null;
      for (const wt of warmT) {
        if (wt.dir !== st.dir) {
          continue;
        }
        const d = Math.abs(wt.pos - st.pos);
        if (d < bestD) {
          bestD = d;
          bestPos = wt.pos;
        }
      }
      if (bestPos === null) {
        continue;
      }
      if (st.dir === 1) {
        enterSum += bestPos - st.pos;
        enterN++;
      } else {
        leaveSum += bestPos - st.pos;
        leaveN++;
      }
    }
  }

  if (enterN < MIN_PAIRS || leaveN < MIN_PAIRS) {
    return null;
  }
  return (enterSum / enterN + leaveSum / leaveN) / 2;
}

/** Same skin criterion as the silhouette segmentation (any skin tone). */
function isSkinPixel(pixels: RgbPixels, x: number, y: number): boolean {
  const o = (y * pixels.width + x) * 4;
  return isSkinRgb(pixels.data[o], pixels.data[o + 1], pixels.data[o + 2]);
}
