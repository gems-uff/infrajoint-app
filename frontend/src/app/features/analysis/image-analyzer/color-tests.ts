/**
 * Shared pixel-color classifiers for the capture protocol's scene: skin (any
 * tone) over a saturated blue mat, with blue tape fiducials on the forearms.
 */

/** Saturated blue (the backdrop mat / the tape markers): hue 180–280. */
export function isBlueRgb(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max <= 55 || delta === 0 || (delta / max) * 255 < 40) {
    return false;
  }
  let h: number;
  if (max === r) {
    h = 60 * (((g - b) / delta + 6) % 6);
  } else if (max === g) {
    h = 60 * ((b - r) / delta + 2);
  } else {
    h = 60 * ((r - g) / delta + 4);
  }
  return h >= 180 && h <= 280;
}

/**
 * Skin of any tone: red-dominant (r ≥ b holds for light and dark skin alike,
 * while the mat, its shadows and bluish nail polish all have b > r), bright
 * enough to exclude pen lines and deep shadows, and not saturated blue.
 * Dark skin can be as dim as ~40 on its brightest channel, hence the low bar.
 */
export function isSkinRgb(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) > 40 && r >= b && !isBlueRgb(r, g, b);
}
