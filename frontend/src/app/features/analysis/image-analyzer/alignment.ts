/**
 * RGB ↔ thermal affine-transform helpers.
 *
 * All matrices map RGB pixels → CSV cells (the convention of the Python
 * pipeline). The alignment itself is produced by silhouette registration
 * (automatic) or manual marker calibration (`estimateSimilarityTransform`).
 */

import { AffineMatrix, Point } from './image-analyzer.model';

export function applyAffine(m: AffineMatrix, x: number, y: number): Point {
  return { x: m.a * x + m.b * y + m.tx, y: m.c * x + m.d * y + m.ty };
}

export function invertAffine(m: AffineMatrix): AffineMatrix | null {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0 || !Number.isFinite(det)) {
    return null;
  }
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, tx: -(a * m.tx + b * m.ty), ty: -(c * m.tx + d * m.ty) };
}

/** Composition `outer ∘ inner`: applies `inner` first, then `outer`. */
export function composeAffine(outer: AffineMatrix, inner: AffineMatrix): AffineMatrix {
  return {
    a: outer.a * inner.a + outer.b * inner.c,
    b: outer.a * inner.b + outer.b * inner.d,
    tx: outer.a * inner.tx + outer.b * inner.ty + outer.tx,
    c: outer.c * inner.a + outer.d * inner.c,
    d: outer.c * inner.b + outer.d * inner.d,
    ty: outer.c * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

export function uniformScaleAffine(s: number): AffineMatrix {
  return { a: s, b: 0, tx: 0, c: 0, d: s, ty: 0 };
}

/**
 * Uniform scale factor of a similarity transform — the Python scripts'
 * `sqrt(M[0,0]² + M[1,0]²)`, used to scale ROI radii between spaces.
 */
export function similarityScale(m: AffineMatrix): number {
  return Math.hypot(m.a, m.c);
}

/**
 * Least-squares similarity transform (rotation + uniform scale + translation)
 * from `src` points to `dst` points — the closed-form equivalent of OpenCV's
 * `estimateAffinePartial2D` without RANSAC, used by manual marker calibration.
 *
 * Returns null with fewer than 2 pairs, mismatched lengths, or degenerate
 * (all-coincident) source points.
 */
export function estimateSimilarityTransform(src: Point[], dst: Point[]): AffineMatrix | null {
  const n = src.length;
  if (n < 2 || dst.length !== n) {
    return null;
  }

  let sxMean = 0;
  let syMean = 0;
  let dxMean = 0;
  let dyMean = 0;
  for (let i = 0; i < n; i++) {
    sxMean += src[i].x;
    syMean += src[i].y;
    dxMean += dst[i].x;
    dyMean += dst[i].y;
  }
  sxMean /= n;
  syMean /= n;
  dxMean /= n;
  dyMean /= n;

  // With centered coords, minimize Σ‖R·s − d‖² for R = [[p, −q], [q, p]]:
  // p = Σ(x·u + y·v) / Σ(x² + y²),  q = Σ(x·v − y·u) / Σ(x² + y²).
  let dot = 0;
  let cross = 0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i].x - sxMean;
    const y = src[i].y - syMean;
    const u = dst[i].x - dxMean;
    const v = dst[i].y - dyMean;
    dot += x * u + y * v;
    cross += x * v - y * u;
    norm += x * x + y * y;
  }
  if (norm === 0) {
    return null;
  }

  const p = dot / norm;
  const q = cross / norm;
  return {
    a: p,
    b: -q,
    tx: dxMean - p * sxMean + q * syMean,
    c: q,
    d: p,
    ty: dyMean - q * sxMean - p * syMean,
  };
}
