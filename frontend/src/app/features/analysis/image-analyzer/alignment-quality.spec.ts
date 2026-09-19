import { SilhouetteAgreement, measureSilhouetteAgreement } from './alignment-quality';
import { AffineMatrix, RgbPixels, ThermalMatrix } from './image-analyzer.model';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Blue backdrop with skin-colored rectangles (the arms/hands). */
function rgbScene(width: number, height: number, rects: Rect[]): RgbPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 30;
    data[i * 4 + 1] = 80;
    data[i * 4 + 2] = 220;
    data[i * 4 + 3] = 255;
  }
  for (const { x, y, w, h } of rects) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const o = (yy * width + xx) * 4;
        data[o] = 205;
        data[o + 1] = 155;
        data[o + 2] = 120;
      }
    }
  }
  return { data, width, height };
}

/** Cold background with warm rectangles (the thermal silhouette). */
function thermalRects(width: number, height: number, rects: Rect[]): ThermalMatrix {
  const values = new Float64Array(width * height).fill(20);
  for (const { x, y, w, h } of rects) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        values[yy * width + xx] = 32;
      }
    }
  }
  return { width, height, values };
}

function scaled(s: number, tx = 0, ty = 0): AffineMatrix {
  return { a: s, b: 0, tx, c: 0, d: s, ty };
}

const ARMS: Rect[] = [
  { x: 40, y: 40, w: 80, h: 160 },
  { x: 200, y: 40, w: 80, h: 160 },
];
/** The same arms in the matrix at 0.5×. */
const HALF: Rect[] = ARMS.map((r) => ({ x: r.x / 2, y: r.y / 2, w: r.w / 2, h: r.h / 2 }));
/** Grown by `by` cells on every side — stands in for the thermal halo. */
function grown(rects: Rect[], by: number): Rect[] {
  return rects.map((r) => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by }));
}

/**
 * O `ceiling` e o `dice`, recalculados a partir dos três campos guardados.
 *
 * Existem aqui, e não no módulo, porque é exatamente isto que os testes abaixo
 * precisam afirmar: que reduzir a forma persistida a três campos não perdeu
 * nada. Se alguma das fórmulas de `SilhouetteAgreement` estiver errada, é aqui
 * que quebra.
 */
function ceilingDe(a: SilhouetteAgreement): number {
  return (2 * Math.min(a.opticalArea, a.thermalArea)) / (a.opticalArea + a.thermalArea);
}
function diceDe(a: SilhouetteAgreement): number {
  return a.normalized * ceilingDe(a);
}

describe('measureSilhouetteAgreement', () => {
  it('scores identical silhouettes at their ceiling', () => {
    const pixels = rgbScene(320, 240, ARMS);
    const matrix = thermalRects(160, 120, HALF);

    const agreement = measureSilhouetteAgreement(pixels, matrix, scaled(0.5))!;
    expect(agreement).not.toBeNull();
    expect(diceDe(agreement)).toBeGreaterThan(0.9);
    expect(agreement.normalized).toBeGreaterThan(0.98);
  });

  it('normalizes away the thermal halo: a dilated silhouette still reaches 100%', () => {
    // Real captures never reach Dice 1 because thermal bleed makes the warm
    // mask strictly larger. Normalizing by the ceiling is what stops that
    // shape difference from being reported as misalignment.
    const pixels = rgbScene(320, 240, ARMS);
    const matrix = thermalRects(160, 120, grown(HALF, 4));

    const agreement = measureSilhouetteAgreement(pixels, matrix, scaled(0.5))!;
    expect(agreement.thermalArea).toBeGreaterThan(agreement.opticalArea);
    expect(diceDe(agreement)).toBeLessThan(0.9); // raw Dice punishes the halo
    expect(agreement.normalized).toBeGreaterThan(0.99); // the ceiling absorbs it
  });

  it('normalizes the same way when the warm mask is the smaller one', () => {
    // The commoner case on real captures (4 of the 7 references): Otsu leaves
    // cold fingertips out of the warm mask, so it ends up smaller than the
    // photo's skin mask. The ceiling has to work in this direction too.
    const pixels = rgbScene(320, 240, ARMS);
    const matrix = thermalRects(160, 120, grown(HALF, -4));

    const agreement = measureSilhouetteAgreement(pixels, matrix, scaled(0.5))!;
    expect(agreement.thermalArea).toBeLessThan(agreement.opticalArea);
    expect(diceDe(agreement)).toBeLessThan(0.95);
    expect(agreement.normalized).toBeGreaterThan(0.99);
  });

  it('falls off on a scale error', () => {
    const pixels = rgbScene(320, 240, ARMS);
    const matrix = thermalRects(160, 120, HALF);

    const aligned = measureSilhouetteAgreement(pixels, matrix, scaled(0.5))!;
    const wrongScale = measureSilhouetteAgreement(pixels, matrix, scaled(0.45))!;
    expect(wrongScale.normalized).toBeLessThan(aligned.normalized - 0.1);
  });

  it('is blind to a translation that keeps the optical mask inside the halo', () => {
    // Documented limitation, not an accident: while the shifted mask stays
    // contained, the intersection is unchanged and the score cannot move. On
    // the fiducial path the marker correction is what covers this.
    const pixels = rgbScene(320, 240, ARMS);
    const matrix = thermalRects(160, 120, grown(HALF, 4));

    const aligned = measureSilhouetteAgreement(pixels, matrix, scaled(0.5))!;
    const shifted = measureSilhouetteAgreement(pixels, matrix, scaled(0.5, 2, 0))!;
    expect(shifted.normalized).toBeCloseTo(aligned.normalized, 2);
  });

  it('returns null when the thermal silhouette is degenerate', () => {
    const pixels = rgbScene(320, 240, ARMS);
    const flat: ThermalMatrix = {
      width: 160,
      height: 120,
      values: new Float64Array(160 * 120).fill(25),
    };
    expect(measureSilhouetteAgreement(pixels, flat, scaled(0.5))).toBeNull();
  });
});
