import {
  applyAffine,
  composeAffine,
  estimateSimilarityTransform,
  invertAffine,
  similarityScale,
  uniformScaleAffine,
} from './alignment';
import { Point } from './image-analyzer.model';

describe('invertAffine / composeAffine', () => {
  it('inverse composed with the original is the identity', () => {
    const m = { a: 0.4, b: -0.3, tx: 12, c: 0.3, d: 0.4, ty: -7 };
    const identity = composeAffine(invertAffine(m)!, m);
    const p = applyAffine(identity, 123, -45);
    expect(p.x).toBeCloseTo(123);
    expect(p.y).toBeCloseTo(-45);
  });

  it('returns null for a degenerate matrix', () => {
    expect(invertAffine({ a: 0, b: 0, tx: 1, c: 0, d: 0, ty: 1 })).toBeNull();
  });

  it('uniform scale behaves isotropically', () => {
    const p = applyAffine(uniformScaleAffine(2), 3, -4);
    expect(p).toEqual({ x: 6, y: -8 });
  });
});

describe('estimateSimilarityTransform', () => {
  const transform = (p: Point): Point => {
    // scale 0.5, rotation 30°, translation (10, -5)
    const s = 0.5;
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    return {
      x: s * (cos * p.x - sin * p.y) + 10,
      y: s * (sin * p.x + cos * p.y) - 5,
    };
  };

  it('recovers a known similarity transform from 3+ point pairs', () => {
    const src: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 60, y: 40 },
    ];
    const m = estimateSimilarityTransform(src, src.map(transform))!;

    expect(similarityScale(m)).toBeCloseTo(0.5);
    const probe = applyAffine(m, 250, -80);
    const expected = transform({ x: 250, y: -80 });
    expect(probe.x).toBeCloseTo(expected.x);
    expect(probe.y).toBeCloseTo(expected.y);
  });

  it('rejects mismatched or insufficient input', () => {
    expect(estimateSimilarityTransform([{ x: 0, y: 0 }], [{ x: 1, y: 1 }])).toBeNull();
    expect(
      estimateSimilarityTransform(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        [{ x: 0, y: 0 }],
      ),
    ).toBeNull();
  });

  it('rejects coincident source points', () => {
    const same = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(
      estimateSimilarityTransform(same, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toBeNull();
  });
});
