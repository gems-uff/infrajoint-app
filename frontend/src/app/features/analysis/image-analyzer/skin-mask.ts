/**
 * Skin sampling shared by the live joint-ROI statistics and the sequence
 * pre-processing.
 *
 * The joint ROIs exclude cells whose RGB counterpart is not skin, sampled at
 * full photo resolution with a small margin against alignment jitter. For a
 * 21-capture sequence the photos cannot all stay in memory, so each capture
 * bakes this test once into a per-CSV-cell mask (~300 KB) that later feeds the
 * rewarming-curve statistics.
 */

import { applyAffine } from './alignment';
import { isSkinRgb } from './color-tests';
import { AffineMatrix, RgbPixels } from './image-analyzer.model';

/** Skin-test margin in RGB px: the mapped point and this neighborhood must be skin. */
export const SKIN_MARGIN_PX = 2;

/** Whether the pixel and its ±margin neighborhood are all skin (any tone). */
export function isSkinNeighborhood(
  pixels: RgbPixels,
  x: number,
  y: number,
  margin = SKIN_MARGIN_PX,
): boolean {
  const { data, width, height } = pixels;
  for (let dy = -margin; dy <= margin; dy++) {
    for (let dx = -margin; dx <= margin; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) {
        return false;
      }
      const o = (py * width + px) * 4;
      if (!isSkinRgb(data[o], data[o + 1], data[o + 2])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Bakes the skin test into a CSV-space mask: `mask[y·width + x] = 1` when the
 * cell's RGB counterpart (via `toRgb`, the inverse alignment) is skin. Must
 * use the same margin as the live test so curve and table stats agree.
 */
export function buildCsvSkinMask(
  pixels: RgbPixels,
  csvWidth: number,
  csvHeight: number,
  toRgb: AffineMatrix,
): Uint8Array {
  const mask = new Uint8Array(csvWidth * csvHeight);
  for (let y = 0; y < csvHeight; y++) {
    for (let x = 0; x < csvWidth; x++) {
      const p = applyAffine(toRgb, x, y);
      if (isSkinNeighborhood(pixels, p.x | 0, p.y | 0)) {
        mask[y * csvWidth + x] = 1;
      }
    }
  }
  return mask;
}
