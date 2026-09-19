import { applyAffine, similarityScale } from './alignment';
import { refineWithFiducials } from './fiducial-markers';
import { AffineMatrix, RgbPixels, ThermalMatrix } from './image-analyzer.model';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Blue backdrop, skin arms, and blue tape markers drawn on the arms. */
function rgbScene(width: number, height: number, arms: Rect[], markers: Rect[]): RgbPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = (r: Rect, cr: number, cg: number, cb: number): void => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const o = (y * width + x) * 4;
        data[o] = cr;
        data[o + 1] = cg;
        data[o + 2] = cb;
        data[o + 3] = 255;
      }
    }
  };
  fill({ x: 0, y: 0, w: width, h: height }, 30, 80, 220); // backdrop
  for (const arm of arms) {
    fill(arm, 205, 155, 120); // skin
  }
  for (const marker of markers) {
    fill(marker, 30, 80, 220); // blue tape
  }
  return { data, width, height };
}

/** Cold background, warm arms, and cold marker impressions inside them. */
function thermalScene(width: number, height: number, arms: Rect[], markers: Rect[]): ThermalMatrix {
  const values = new Float64Array(width * height).fill(20);
  const fill = (r: Rect, v: number): void => {
    for (let y = Math.round(r.y); y < Math.round(r.y + r.h); y++) {
      for (let x = Math.round(r.x); x < Math.round(r.x + r.w); x++) {
        values[y * width + x] = v;
      }
    }
  };
  for (const arm of arms) {
    fill(arm, 32);
  }
  for (const marker of markers) {
    fill(marker, 21);
  }
  return { width, height, values };
}

const mapRect = (r: Rect, s: number, tx: number, ty: number): Rect => ({
  x: r.x * s + tx,
  y: r.y * s + ty,
  w: r.w * s,
  h: r.h * s,
});

describe('refineWithFiducials', () => {
  const arms: Rect[] = [
    { x: 30, y: 30, w: 90, h: 180 },
    { x: 200, y: 30, w: 90, h: 180 },
  ];
  const markers: Rect[] = [
    { x: 60, y: 60, w: 16, h: 16 },
    { x: 230, y: 70, w: 16, h: 16 },
  ];

  it('recovers the exact transform from the marker pairs', () => {
    // True map: 0.5× + (4, −2). The coarse guess is off by a couple of cells.
    const pixels = rgbScene(320, 240, arms, markers);
    const matrix = thermalScene(
      160,
      120,
      arms.map((r) => mapRect(r, 0.5, 4, -2)),
      markers.map((r) => mapRect(r, 0.5, 4, -2)),
    );
    const coarse: AffineMatrix = { a: 0.5, b: 0, tx: 7, c: 0, d: 0.5, ty: -5 };

    const refined = refineWithFiducials(pixels, matrix, coarse)!;
    expect(refined).not.toBeNull();
    expect(similarityScale(refined.matrix)).toBeCloseTo(0.5, 2);

    // Marker centers must map onto their thermal impressions.
    for (const m of markers) {
      const p = applyAffine(refined.matrix, m.x + m.w / 2, m.y + m.h / 2);
      expect(Math.abs(p.x - ((m.x + m.w / 2) * 0.5 + 4))).toBeLessThanOrEqual(0.75);
      expect(Math.abs(p.y - ((m.y + m.h / 2) * 0.5 - 2))).toBeLessThanOrEqual(0.75);
    }
  });

  it('exposes the parts that reconstruct the reported magnitude', () => {
    // The UI shows one mean; these are the numbers that let a reader redo it.
    const pixels = rgbScene(320, 240, arms, markers);
    const matrix = thermalScene(
      160,
      120,
      arms.map((r) => mapRect(r, 0.5, 4, -2)),
      markers.map((r) => mapRect(r, 0.5, 4, -2)),
    );
    const coarse: AffineMatrix = { a: 0.5, b: 0, tx: 7, c: 0, d: 0.5, ty: -5 };

    const { correction, rgbPoints } = refineWithFiducials(pixels, matrix, coarse)!;
    expect(correction.predicted).toHaveLength(2);
    expect(correction.detected).toHaveLength(2);

    correction.offsets.forEach((offset, i) => {
      // `predicted` is where the coarse transform put the marker...
      const fromCoarse = applyAffine(coarse, rgbPoints[i].x, rgbPoints[i].y);
      expect(correction.predicted[i].x).toBeCloseTo(fromCoarse.x, 6);
      expect(correction.predicted[i].y).toBeCloseTo(fromCoarse.y, 6);
      // ...and the offset is exactly detected − predicted.
      expect(offset.x).toBeCloseTo(correction.detected[i].x - correction.predicted[i].x, 6);
      expect(offset.y).toBeCloseTo(correction.detected[i].y - correction.predicted[i].y, 6);
    });

    // The reported magnitude is the mean of the offset lengths — not the length
    // of the mean offset, and not a combination of shift, scale and rotation.
    const lengths = correction.offsets.map((o) => Math.hypot(o.x, o.y));
    expect(correction.magnitude).toBeCloseTo((lengths[0] + lengths[1]) / 2, 6);
    expect(correction.shiftX).toBeCloseTo(
      (correction.offsets[0].x + correction.offsets[1].x) / 2,
      6,
    );
    expect(correction.shiftY).toBeCloseTo(
      (correction.offsets[0].y + correction.offsets[1].y) / 2,
      6,
    );

    // Scale and rotation describe the same predicted → detected similarity.
    const span = (points: readonly { x: number; y: number }[]): number =>
      Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    expect(correction.scaleRatio).toBeCloseTo(
      span(correction.detected) / span(correction.predicted),
      6,
    );
  });

  it('finds a lukewarm impression when the window also contains background', () => {
    // V043 regression: the tape reads BETWEEN background and skin (lukewarm),
    // and the marker sits near the arm's edge so the local window holds cold
    // background too. The first local Otsu splits background vs body, hiding
    // the tape on the warm side — the warm-side second Otsu must reveal it.
    const edgeMarkers: Rect[] = [
      { x: 34, y: 60, w: 16, h: 16 }, // 4 px from the left arm's edge
      { x: 204, y: 70, w: 16, h: 16 },
    ];
    const pixels = rgbScene(320, 240, arms, edgeMarkers);
    const matrix = thermalScene(
      160,
      120,
      arms.map((r) => mapRect(r, 0.5, 4, -2)),
      [],
    );
    // Paint the impressions LUKEWARM (27 °C): warmer than the 20 °C background,
    // colder than the 32 °C skin, above the background/body Otsu split.
    for (const r of edgeMarkers.map((m) => mapRect(m, 0.5, 4, -2))) {
      for (let y = Math.round(r.y); y < Math.round(r.y + r.h); y++) {
        for (let x = Math.round(r.x); x < Math.round(r.x + r.w); x++) {
          matrix.values[y * matrix.width + x] = 27;
        }
      }
    }
    const coarse: AffineMatrix = { a: 0.5, b: 0, tx: 6, c: 0, d: 0.5, ty: -4 };

    const refined = refineWithFiducials(pixels, matrix, coarse)!;
    expect(refined).not.toBeNull();
    for (const m of edgeMarkers) {
      const p = applyAffine(refined.matrix, m.x + m.w / 2, m.y + m.h / 2);
      expect(Math.abs(p.x - ((m.x + m.w / 2) * 0.5 + 4))).toBeLessThanOrEqual(0.75);
      expect(Math.abs(p.y - ((m.y + m.h / 2) * 0.5 - 2))).toBeLessThanOrEqual(0.75);
    }
  });

  it('recovers an impression clipped by the search window border', () => {
    // V043: the tape sits on the diagonal and its impression spans ~24 cells,
    // while the coarse prediction may be off by up to MAX_PREDICTION_DIST. The
    // ±18-cell window then cuts the blob, the border rule discards it, and the
    // marker is lost — unless the search retries recentered on the clipped
    // blob's visible centroid.
    const bigMarkers: Rect[] = [
      { x: 50, y: 60, w: 40, h: 40 },
      { x: 220, y: 70, w: 40, h: 40 },
    ];
    const pixels = rgbScene(320, 240, arms, bigMarkers);
    const matrix = thermalScene(
      160,
      120,
      arms.map((r) => mapRect(r, 0.5, 4, -2)),
      bigMarkers.map((r) => mapRect(r, 0.5, 4, -2)),
    );
    // Coarse guess 12 cells off in x: the window clips both impressions.
    const coarse: AffineMatrix = { a: 0.5, b: 0, tx: 16, c: 0, d: 0.5, ty: -2 };

    const refined = refineWithFiducials(pixels, matrix, coarse)!;
    expect(refined).not.toBeNull();
    for (const m of bigMarkers) {
      const p = applyAffine(refined.matrix, m.x + m.w / 2, m.y + m.h / 2);
      expect(Math.abs(p.x - ((m.x + m.w / 2) * 0.5 + 4))).toBeLessThanOrEqual(0.75);
      expect(Math.abs(p.y - ((m.y + m.h / 2) * 0.5 - 2))).toBeLessThanOrEqual(0.75);
    }
  });

  it('ignores blue blobs on skin that have no thermal impression', () => {
    // A third saturated-blue patch (jewelry, nail art) sits on the left arm but
    // leaves no cold impression — only the two real markers must be used.
    const decoy: Rect = { x: 70, y: 150, w: 14, h: 14 };
    const pixels = rgbScene(320, 240, arms, [...markers, decoy]);
    const matrix = thermalScene(
      160,
      120,
      arms.map((r) => mapRect(r, 0.5, 4, -2)),
      markers.map((r) => mapRect(r, 0.5, 4, -2)), // decoy has no impression
    );
    const coarse: AffineMatrix = { a: 0.5, b: 0, tx: 6, c: 0, d: 0.5, ty: -4 };

    const refined = refineWithFiducials(pixels, matrix, coarse)!;
    expect(refined).not.toBeNull();
    for (const m of markers) {
      const p = applyAffine(refined.matrix, m.x + m.w / 2, m.y + m.h / 2);
      expect(Math.abs(p.x - ((m.x + m.w / 2) * 0.5 + 4))).toBeLessThanOrEqual(0.75);
      expect(Math.abs(p.y - ((m.y + m.h / 2) * 0.5 - 2))).toBeLessThanOrEqual(0.75);
    }
  });

  it('returns null when the photo has no markers', () => {
    const pixels = rgbScene(320, 240, arms, []);
    const matrix = thermalScene(
      160,
      120,
      arms.map((r) => mapRect(r, 0.5, 4, -2)),
      markers.map((r) => mapRect(r, 0.5, 4, -2)),
    );
    const coarse: AffineMatrix = { a: 0.5, b: 0, tx: 4, c: 0, d: 0.5, ty: -2 };
    expect(refineWithFiducials(pixels, matrix, coarse)).toBeNull();
  });

  it('returns null when the thermal impressions are missing', () => {
    const pixels = rgbScene(320, 240, arms, markers);
    const matrix = thermalScene(
      160,
      120,
      arms.map((r) => mapRect(r, 0.5, 4, -2)),
      [],
    );
    const coarse: AffineMatrix = { a: 0.5, b: 0, tx: 4, c: 0, d: 0.5, ty: -2 };
    expect(refineWithFiducials(pixels, matrix, coarse)).toBeNull();
  });
});
