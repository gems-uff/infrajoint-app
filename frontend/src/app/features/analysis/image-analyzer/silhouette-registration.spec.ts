import { applyAffine, similarityScale } from './alignment';
import { measureSilhouetteAgreement } from './alignment-quality';
import { RgbPixels, ThermalMatrix } from './image-analyzer.model';
import { registerSilhouettes } from './silhouette-registration';

/** Blue backdrop with skin-colored rectangles (the arms/hands). */
function rgbScene(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number }[],
  skin: [number, number, number] = [205, 155, 120],
): RgbPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 30;
    data[i * 4 + 1] = 80;
    data[i * 4 + 2] = 220; // blue backdrop
    data[i * 4 + 3] = 255;
  }
  for (const { x, y, w, h } of rects) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const o = (yy * width + xx) * 4;
        data[o] = skin[0];
        data[o + 1] = skin[1];
        data[o + 2] = skin[2];
      }
    }
  }
  return { data, width, height };
}

/** Cold background with warm rectangles (the body silhouette). */
function thermalRects(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number }[],
): ThermalMatrix {
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

describe('registerSilhouettes', () => {
  it('recovers scale 0.5 + translation from matching silhouettes', () => {
    // Two "arms" in RGB; the same shapes in thermal at 0.5× plus (4, -2).
    const rgbRects = [
      { x: 40, y: 40, w: 80, h: 160 },
      { x: 200, y: 40, w: 80, h: 160 },
    ];
    const pixels = rgbScene(320, 240, rgbRects);
    const matrix = thermalRects(
      160,
      120,
      rgbRects.map((r) => ({ x: r.x * 0.5 + 4, y: r.y * 0.5 - 2, w: r.w * 0.5, h: r.h * 0.5 })),
    );

    const reg = registerSilhouettes(pixels, matrix)!;
    expect(reg).not.toBeNull();
    expect(similarityScale(reg.matrix)).toBeCloseTo(0.5, 1.5);
    // These synthetic silhouettes match exactly (no thermal bleed), so the
    // agreement should sit essentially at its ceiling.
    expect(measureSilhouetteAgreement(pixels, matrix, reg.matrix)!.normalized).toBeGreaterThan(0.9);

    // A point at an arm center must land on the corresponding thermal spot.
    const mapped = applyAffine(reg.matrix, 80, 120);
    expect(Math.abs(mapped.x - (80 * 0.5 + 4))).toBeLessThanOrEqual(3);
    expect(Math.abs(mapped.y - (120 * 0.5 - 2))).toBeLessThanOrEqual(3);
  });

  it('recovers a small rotation the grid search alone cannot (ICP refinement)', () => {
    // Same two arms, but the thermal silhouette is scaled 0.5, rotated ~5° and
    // translated. A scale+translation-only fit leaves the arm tips off; the ICP
    // contour refinement must add the rotation to land them.
    const rgbRects = [
      { x: 40, y: 40, w: 60, h: 170 },
      { x: 210, y: 40, w: 60, h: 170 },
    ];
    const pixels = rgbScene(320, 240, rgbRects);

    const s = 0.5;
    const theta = (5 * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const tx = 6;
    const ty = -3;
    const map = (x: number, y: number) => ({
      x: s * (cos * x - sin * y) + tx,
      y: s * (sin * x + cos * y) + ty,
    });

    // Rasterize the thermal body by inverse-mapping each cell into the rects.
    const tw = 160;
    const th = 120;
    const values = new Float64Array(tw * th).fill(20);
    for (let cy = 0; cy < th; cy++) {
      for (let cx = 0; cx < tw; cx++) {
        // Invert map: rgb = Rᵀ·((csv − t)/s).
        const ux = (cx - tx) / s;
        const uy = (cy - ty) / s;
        const rx = cos * ux + sin * uy;
        const ry = -sin * ux + cos * uy;
        for (const r of rgbRects) {
          if (rx >= r.x && rx < r.x + r.w && ry >= r.y && ry < r.y + r.h) {
            values[cy * tw + cx] = 32;
            break;
          }
        }
      }
    }
    const matrix: ThermalMatrix = { width: tw, height: th, values };

    const reg = registerSilhouettes(pixels, matrix)!;
    expect(reg).not.toBeNull();

    // Rotation is recovered: the grid search alone always yields b = c = 0,
    // so non-zero, correctly-signed off-diagonals prove the ICP refinement ran.
    expect(similarityScale(reg.matrix)).toBeCloseTo(0.5, 1.5);
    expect(reg.matrix.b).toBeLessThan(-0.02); // ≈ −s·sin θ
    expect(reg.matrix.c).toBeGreaterThan(0.02); // ≈ +s·sin θ

    // A far arm-tip corner lands close to its true thermal position — far
    // better than a rotation-free fit could at that distance from the center.
    const corner = { x: 270, y: 210 };
    const mapped = applyAffine(reg.matrix, corner.x, corner.y);
    const expected = map(corner.x, corner.y);
    expect(Math.hypot(mapped.x - expected.x, mapped.y - expected.y)).toBeLessThanOrEqual(5);
  });

  it('stays near the true transform when arms are cut by mismatched frame edges', () => {
    // Both arms run past the bottom of the frame, and the thermal camera's
    // narrower FOV cuts them earlier: the two cut lines do NOT correspond.
    // The refinement must not chase those artificial edges (regression: an
    // unconstrained ICP diverged here and the fitted scale left [0.3, 0.8]).
    const rgbRects = [
      { x: 40, y: 30, w: 80, h: 210 }, // extends to y = 240 (frame bottom)
      { x: 200, y: 30, w: 80, h: 210 },
    ];
    const pixels = rgbScene(320, 240, rgbRects);

    // True map: 0.5× + (4, 8). Thermal rects clipped at its own bottom (120),
    // 8 CSV cells before where the RGB cut line would land (128).
    const matrix = thermalRects(
      160,
      120,
      rgbRects.map((r) => ({
        x: r.x * 0.5 + 4,
        y: r.y * 0.5 + 8,
        w: r.w * 0.5,
        h: Math.min(r.h * 0.5, 120 - (r.y * 0.5 + 8)),
      })),
    );

    const reg = registerSilhouettes(pixels, matrix)!;
    expect(reg).not.toBeNull();
    expect(similarityScale(reg.matrix)).toBeGreaterThan(0.42);
    expect(similarityScale(reg.matrix)).toBeLessThan(0.58);

    // The arm top (a real, corresponding outline) stays within ~half the
    // 8-cell FOV mismatch — cropped outlines are genuinely ambiguous, but the
    // fit must not run away from the truth.
    const mapped = applyAffine(reg.matrix, 80, 30);
    expect(Math.abs(mapped.x - (80 * 0.5 + 4))).toBeLessThanOrEqual(3);
    expect(Math.abs(mapped.y - (30 * 0.5 + 8))).toBeLessThanOrEqual(5);
  });

  it('segments dark skin (dim but red-dominant) like light skin', () => {
    // Measured on the V049 capture: dark skin reads rgb ≈ (67–105, 62–90,
    // 55–75) — far below the old brightness bar but always red-dominant.
    const rgbRects = [
      { x: 40, y: 40, w: 80, h: 160 },
      { x: 200, y: 40, w: 80, h: 160 },
    ];
    const pixels = rgbScene(320, 240, rgbRects, [72, 64, 58]);
    const matrix = thermalRects(
      160,
      120,
      rgbRects.map((r) => ({ x: r.x * 0.5 + 4, y: r.y * 0.5 - 2, w: r.w * 0.5, h: r.h * 0.5 })),
    );

    const reg = registerSilhouettes(pixels, matrix)!;
    expect(reg).not.toBeNull();
    expect(similarityScale(reg.matrix)).toBeCloseTo(0.5, 1.5);

    const mapped = applyAffine(reg.matrix, 80, 120);
    expect(Math.abs(mapped.x - (80 * 0.5 + 4))).toBeLessThanOrEqual(3);
    expect(Math.abs(mapped.y - (120 * 0.5 - 2))).toBeLessThanOrEqual(3);
  });

  it('returns null when a silhouette is missing', () => {
    const pixels = rgbScene(320, 240, []); // all backdrop, no skin
    const matrix = thermalRects(160, 120, [{ x: 20, y: 10, w: 40, h: 80 }]);
    expect(registerSilhouettes(pixels, matrix)).toBeNull();
  });
});
