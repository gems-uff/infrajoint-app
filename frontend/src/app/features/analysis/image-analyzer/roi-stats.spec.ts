import { ThermalMatrix } from './image-analyzer.model';
import { computeRoiStats } from './roi-stats';

function matrixOf(rows: number[][]): ThermalMatrix {
  const height = rows.length;
  const width = rows[0].length;
  const values = new Float64Array(rows.flat());
  return { width, height, values };
}

describe('computeRoiStats', () => {
  const matrix = matrixOf([
    [30, 31, 32, 33],
    [34, 35, 36, 37],
    [38, 39, 40, 41],
    [42, 43, 44, 45],
  ]);

  it('aggregates the cells inside a circular ROI', () => {
    // r = 1 around (1, 1): plus-shaped mask {35, 31, 34, 36, 39}
    const stats = computeRoiStats(matrix, 'circle', 1, 1, 1, 1);
    expect(stats.mean).toBeCloseTo((35 + 31 + 34 + 36 + 39) / 5);
    expect(stats.median).toBe(35);
    expect(stats.max).toBe(39);
    expect(stats.min).toBe(31);
  });

  it('clamps the ROI to the matrix bounds', () => {
    const stats = computeRoiStats(matrix, 'circle', 0, 0, 1, 1);
    // Mask at the corner: (0,0), (1,0), (0,1)
    expect(stats.mean).toBeCloseTo((30 + 31 + 34) / 3);
  });

  it('supports elliptical ROIs with distinct radii', () => {
    // rx = 1.2, ry = 0.4 — ry² is clamped to 1 (as in the Python port), so the
    // mask covers the center row neighbors {34, 35, 36} plus (1, 0) = 31.
    const stats = computeRoiStats(matrix, 'ellipse', 1, 1, 1.2, 0.4);
    expect(stats.min).toBe(31);
    expect(stats.max).toBe(36);
  });

  it('ignores NaN cells and returns NaN when nothing valid remains', () => {
    const withGaps = matrixOf([
      [NaN, NaN],
      [NaN, 20],
    ]);
    expect(computeRoiStats(withGaps, 'circle', 1, 1, 1, 1).mean).toBe(20);
    expect(Number.isNaN(computeRoiStats(withGaps, 'circle', 0, 0, 0.5, 0.5).mean)).toBe(true);
  });

  it('returns NaN for an ROI completely outside the matrix', () => {
    expect(Number.isNaN(computeRoiStats(matrix, 'circle', 100, 100, 2, 2).mean)).toBe(true);
  });

  it('excludes cells rejected by the include predicate', () => {
    // Same plus-shaped mask around (1, 1), but only column x === 1 counts.
    const stats = computeRoiStats(matrix, 'circle', 1, 1, 1, 1, (x) => x === 1);
    expect(stats.min).toBe(31);
    expect(stats.max).toBe(39);
    expect(stats.mean).toBeCloseTo((31 + 35 + 39) / 3);
  });
});
