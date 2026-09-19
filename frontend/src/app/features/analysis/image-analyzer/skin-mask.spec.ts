import { RgbPixels } from './image-analyzer.model';
import { buildCsvSkinMask, isSkinNeighborhood } from './skin-mask';

/** Blue backdrop with a centered skin rectangle. */
function scene(width: number, height: number, skin: { x: number; y: number; w: number; h: number }): RgbPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inSkin = x >= skin.x && x < skin.x + skin.w && y >= skin.y && y < skin.y + skin.h;
      data[o] = inSkin ? 205 : 30;
      data[o + 1] = inSkin ? 155 : 80;
      data[o + 2] = inSkin ? 120 : 220;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('isSkinNeighborhood', () => {
  const pixels = scene(60, 60, { x: 20, y: 20, w: 20, h: 20 });

  it('accepts a pixel whose whole margin is skin and rejects edges/background', () => {
    expect(isSkinNeighborhood(pixels, 30, 30)).toBe(true);
    expect(isSkinNeighborhood(pixels, 20, 30)).toBe(false); // margin leaks onto the mat
    expect(isSkinNeighborhood(pixels, 5, 5)).toBe(false);
  });
});

describe('buildCsvSkinMask', () => {
  it('marks exactly the cells whose RGB counterpart (with margin) is skin', () => {
    // RGB 60×60, CSV 30×30, alignment = 0.5× ⇒ toRgb = 2×.
    const pixels = scene(60, 60, { x: 20, y: 20, w: 20, h: 20 });
    const toRgb = { a: 2, b: 0, tx: 0, c: 0, d: 2, ty: 0 };
    const mask = buildCsvSkinMask(pixels, 30, 30, toRgb);

    // Cell (15,15) → RGB (30,30): deep inside the skin patch.
    expect(mask[15 * 30 + 15]).toBe(1);
    // Cell (10,15) → RGB (20,30): on the skin edge, margin fails.
    expect(mask[15 * 30 + 10]).toBe(0);
    // Cell (2,2) → RGB (4,4): background.
    expect(mask[2 * 30 + 2]).toBe(0);
    // Mask agrees with the live test on every cell.
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        expect(mask[y * 30 + x]).toBe(isSkinNeighborhood(pixels, x * 2, y * 2) ? 1 : 0);
      }
    }
  });
});
