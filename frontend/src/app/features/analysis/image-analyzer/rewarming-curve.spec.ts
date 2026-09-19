import { CurveFrame, CurveRoi, buildRewarmingSeries } from './rewarming-curve';

function roi(side: CurveRoi['side'], landmarkId: number, mean: number): CurveRoi {
  return { side, landmarkId, label: `#${landmarkId}`, stats: { mean, max: mean + 1, min: mean - 1 } };
}

describe('buildRewarmingSeries', () => {
  // Baseline at t0 warm, cold at Din01, rewarming by Din02 (MCP 3 = landmark 9).
  const frames: CurveFrame[] = [
    { timeSeconds: 0, kind: 'baseline', rois: [roi('Esquerda', 9, 32), roi('Direita', 9, 31.5)] },
    { timeSeconds: 15, kind: 'dynamic', rois: [roi('Esquerda', 9, 24), roi('Direita', 9, 23)] },
    { timeSeconds: 30, kind: 'dynamic', rois: [roi('Esquerda', 9, 27), roi('Direita', 9, 26)] },
  ];

  it('plots the dynamic captures only, leaving the baseline off the axis', () => {
    const series = buildRewarmingSeries(frames, [9], 'mean');
    expect(series.map((s) => s.key)).toEqual(['Esquerda:9', 'Direita:9']);
    const left = series[0];
    expect(left.label).toBe('E MCP 3');
    expect(left.points.map((p) => p.timeSeconds)).toEqual([15, 30]);
    expect(left.points.map((p) => p.value)).toEqual([24, 27]);
  });

  it('honors the selected statistic', () => {
    const series = buildRewarmingSeries(frames, [9], 'max');
    expect(series[0].points[0].value).toBe(25); // Din01 mean 24 + 1
  });

  it('drops a hand that only ever appeared in the baseline', () => {
    const baselineOnly: CurveFrame[] = [
      frames[0],
      { ...frames[1], rois: frames[1].rois.filter((r) => r.side === 'Esquerda') },
      { ...frames[2], rois: frames[2].rois.filter((r) => r.side === 'Esquerda') },
    ];
    // 'Direita' is in the baseline but in no dynamic capture: no rewarming to plot.
    expect(buildRewarmingSeries(baselineOnly, [9], 'mean').map((s) => s.side)).toEqual([
      'Esquerda',
    ]);
  });

  it('turns missing joints into gaps (NaN) and drops absent hands', () => {
    const withHole: CurveFrame[] = [
      frames[0],
      { timeSeconds: 15, kind: 'dynamic', rois: [] }, // detection failed on Din01
      frames[2],
    ];
    const series = buildRewarmingSeries(withHole, [9], 'mean');
    expect(series).toHaveLength(2);
    expect(Number.isNaN(series[0].points[0].value)).toBe(true); // Din01 is now the first

    // A hand that never appears yields no series at all.
    const leftOnly = frames.map((f) => ({ ...f, rois: f.rois.filter((r) => r.side === 'Esquerda') }));
    expect(buildRewarmingSeries(leftOnly, [9], 'mean').map((s) => s.side)).toEqual(['Esquerda']);
  });

  it('sorts frames by time regardless of input order', () => {
    const series = buildRewarmingSeries([frames[2], frames[0], frames[1]], [9], 'mean');
    expect(series[0].points.map((p) => p.timeSeconds)).toEqual([15, 30]);
  });
});
