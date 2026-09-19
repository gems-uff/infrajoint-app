/**
 * Low-level image operations used by silhouette registration: binary
 * morphology, connected-component labeling and Otsu thresholding.
 */

// --- Binary morphology (box kernel, zero border) ------------------------------

export function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return boxFilter(mask, width, height, radius, true);
}

export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return boxFilter(mask, width, height, radius, false);
}

/** Morphological opening: erosion followed by dilation. */
export function binaryOpen(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return dilate(erode(mask, width, height, radius), width, height, radius);
}

/** Separable binary box filter: `all` → erosion, otherwise dilation. */
function boxFilter(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  all: boolean,
): Uint8Array {
  const window = radius * 2 + 1;
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let count = 0;
      let span = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < width) {
          span++;
          count += mask[row + xx];
        }
      }
      // Zero border: an eroded pixel needs the full window inside the image.
      horizontal[row + x] = all ? (span === window && count === window ? 1 : 0) : count > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let count = 0;
      let span = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < height) {
          span++;
          count += horizontal[yy * width + x];
        }
      }
      out[y * width + x] = all ? (span === window && count === window ? 1 : 0) : count > 0 ? 1 : 0;
    }
  }
  return out;
}

// --- Connected components ------------------------------------------------------

export interface Blob {
  readonly area: number;
  /** Bounding box, [x0, x1) × [y0, y1). */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Linear indices of the blob's pixels. */
  readonly pixels: number[];
}

/** 8-connected component labeling over a 0/1 mask. */
export function connectedComponents(mask: Uint8Array, width: number, height: number): Blob[] {
  const visited = new Uint8Array(mask.length);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) {
      continue;
    }
    let area = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    const pixels: number[] = [];
    visited[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i / width) | 0;
      area++;
      pixels.push(i);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }
          const ni = ny * width + nx;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack.push(ni);
          }
        }
      }
    }
    blobs.push({ area, x0, y0, x1, y1, pixels });
  }
  return blobs;
}

// --- Otsu thresholding -----------------------------------------------------------

/**
 * Otsu's threshold over `values` (already known to span [min, max]): the level
 * that best splits a bimodal histogram into two classes — e.g. cold background
 * vs. warm body in a thermogram.
 */
export function otsuThreshold(values: number[], min: number, max: number): number {
  const BINS = 64;
  const span = max - min;
  const hist = new Array<number>(BINS).fill(0);
  for (const v of values) {
    hist[Math.min(BINS - 1, Math.floor(((v - min) / span) * BINS))]++;
  }

  let sumAll = 0;
  for (let i = 0; i < BINS; i++) {
    sumAll += i * hist[i];
  }
  const total = values.length;

  let weightBackground = 0;
  let sumBackground = 0;
  let bestVariance = -1;
  let threshBin = 0;
  for (let i = 0; i < BINS; i++) {
    weightBackground += hist[i];
    if (weightBackground === 0) {
      continue;
    }
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) {
      break;
    }
    sumBackground += i * hist[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > bestVariance) {
      bestVariance = between;
      threshBin = i;
    }
  }
  return min + ((threshBin + 0.5) / BINS) * span;
}

// --- Nearest-feature transform ------------------------------------------------

/**
 * For every cell, the index of the nearest set cell in `mask` (or -1 when the
 * mask is empty). Computed by a two-pass chamfer sweep that propagates the
 * source cell's coordinates and keeps the true Euclidean-nearest, so it is
 * accurate enough to drive the ICP correspondences in silhouette registration.
 */
export function nearestFeatureMap(
  mask: Uint8Array,
  width: number,
  height: number,
): Int32Array {
  const feature = new Int32Array(width * height).fill(-1);
  const best = new Float64Array(width * height).fill(Infinity);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      feature[i] = i;
      best[i] = 0;
    }
  }

  const relax = (i: number, j: number): void => {
    const f = feature[j];
    if (f < 0) {
      return;
    }
    const dx = (i % width) - (f % width);
    const dy = ((i / width) | 0) - ((f / width) | 0);
    const d2 = dx * dx + dy * dy;
    if (d2 < best[i]) {
      best[i] = d2;
      feature[i] = f;
    }
  };

  // Two forward+backward sweeps converge the propagated nearest source.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (x > 0) relax(i, i - 1);
        if (y > 0) relax(i, i - width);
        if (x > 0 && y > 0) relax(i, i - width - 1);
        if (x < width - 1 && y > 0) relax(i, i - width + 1);
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        if (x < width - 1) relax(i, i + 1);
        if (y < height - 1) relax(i, i + width);
        if (x < width - 1 && y < height - 1) relax(i, i + width + 1);
        if (x > 0 && y < height - 1) relax(i, i + width - 1);
      }
    }
  }
  return feature;
}
