import { applyAffine } from './alignment';
import { polishTranslation } from './alignment-polish';
import { AffineMatrix, RgbPixels, ThermalMatrix } from './image-analyzer.model';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rgbScene(width: number, height: number, arms: Rect[]): RgbPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 30;
    data[i * 4 + 1] = 80;
    data[i * 4 + 2] = 220;
    data[i * 4 + 3] = 255;
  }
  for (const { x, y, w, h } of arms) {
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

function thermalScene(width: number, height: number, arms: Rect[]): ThermalMatrix {
  const values = new Float64Array(width * height).fill(20);
  for (const { x, y, w, h } of arms) {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
          values[yy * width + xx] = 32;
        }
      }
    }
  }
  return { width, height, values };
}

describe('polishTranslation', () => {
  // Large enough that both scan axes collect the MIN_PAIRS transitions the
  // real photos always provide.
  const arms: Rect[] = [
    { x: 60, y: 60, w: 220, h: 360 },
    { x: 340, y: 60, w: 220, h: 360 },
  ];

  it('cancels a small residual shift of the thermal layer', () => {
    const pixels = rgbScene(640, 480, arms);
    // Thermal truth is 0.5× + (4, −2), but the alignment in hand is off by
    // (−2, +1) RGB px — the thermal layer appears shifted left/down.
    const matrix = thermalScene(
      320,
      240,
      arms.map((r) => ({ x: r.x * 0.5 + 4, y: r.y * 0.5 - 2, w: r.w * 0.5, h: r.h * 0.5 })),
    );
    const offAlignment: AffineMatrix = { a: 0.5, b: 0, tx: 5, c: 0, d: 0.5, ty: -2.5 };

    const polished = polishTranslation(pixels, matrix, offAlignment)!;
    expect(polished).not.toBeNull();

    // A skin-edge point must now map onto the true thermal edge (±0.75 cell).
    const p = applyAffine(polished, 60, 240);
    expect(Math.abs(p.x - (60 * 0.5 + 4))).toBeLessThanOrEqual(0.75);
    expect(Math.abs(p.y - (240 * 0.5 - 2))).toBeLessThanOrEqual(0.75);
  });

  it('returns null when there are too few matchable edges', () => {
    const pixels = rgbScene(640, 480, []); // no skin at all
    const matrix = thermalScene(320, 240, [{ x: 40, y: 40, w: 80, h: 160 }]);
    const alignment: AffineMatrix = { a: 0.5, b: 0, tx: 0, c: 0, d: 0.5, ty: 0 };
    expect(polishTranslation(pixels, matrix, alignment)).toBeNull();
  });
});
