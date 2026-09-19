import { AffineMatrix, DetectedHand, Point, ThermalMatrix } from './image-analyzer.model';
import {
  JOINT_ROI_DEFS,
  JointRoi,
  JointRoiOverride,
  applyJointOverrides,
  captureJointRois,
  jointRoiKey,
  jointRoiRadii,
} from './joint-rois';

/** RGB → CSV half-scale, matching the camera's ~0.5 mapping. */
const HALF_SCALE: AffineMatrix = { a: 0.5, b: 0, tx: 0, c: 0, d: 0.5, ty: 0 };

function uniformMatrix(width: number, height: number, temp: number): ThermalMatrix {
  return { width, height, values: new Float64Array(width * height).fill(temp) };
}

/** A hand whose 21 landmarks are laid out on a grid inside the RGB frame. */
function handAt(side: DetectedHand['side'], originX: number, originY: number): DetectedHand {
  const landmarks: Point[] = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({ x: originX + (i % 5) * 40, y: originY + Math.floor(i / 5) * 40 });
  }
  return { side, landmarks };
}

describe('jointRoiRadii', () => {
  it('uses the core.py sizes: wrist ellipse 27×17, joints circle r=10', () => {
    expect(jointRoiRadii(0)).toEqual({ shape: 'ellipse', rx: 27, ry: 17 });
    expect(jointRoiRadii(5)).toEqual({ shape: 'circle', rx: 10, ry: 10 });
  });
});

describe('captureJointRois', () => {
  const matrix = uniformMatrix(640, 480, 30);

  it('captures the 11 body-map joints per hand, mapped by the alignment', () => {
    const hand = handAt('Esquerda', 200, 200);
    const rois = captureJointRois([hand], matrix, HALF_SCALE);

    expect(rois).toHaveLength(JOINT_ROI_DEFS.length);
    const wrist = rois.find((r) => r.landmarkId === 0)!;
    // Landmark 0 sits at (200, 200); linear alignment halves it.
    expect(wrist.csv).toEqual({ x: 100, y: 100 });
    expect(wrist.shape).toBe('ellipse');
    expect(wrist.stats.mean).toBeCloseTo(30);
    expect(rois.every((r) => r.side === 'Esquerda')).toBe(true);
    expect(rois.every((r) => Number.isFinite(r.stats.mean))).toBe(true);
  });

  it('captures 22 ROIs for two hands, keeping sides apart', () => {
    const rois = captureJointRois(
      [handAt('Esquerda', 100, 200), handAt('Direita', 700, 200)],
      matrix,
      HALF_SCALE,
    );
    expect(rois).toHaveLength(22);
    expect(rois.filter((r) => r.side === 'Esquerda')).toHaveLength(11);
    expect(rois.filter((r) => r.side === 'Direita')).toHaveLength(11);
  });

  it('scales the ROI sizes by the sizeScale option', () => {
    const rois = captureJointRois([handAt('Esquerda', 200, 200)], matrix, HALF_SCALE, {
      sizeScale: 0.5,
    });
    const wrist = rois.find((r) => r.landmarkId === 0)!;
    expect(wrist.rxCsv).toBe(13.5);
    expect(wrist.ryCsv).toBe(8.5);
  });

  it('applies a per-joint override: moved center and independent size', () => {
    const hand = handAt('Esquerda', 200, 200); // wrist landmark at (200, 200)
    const overrides = new Map<string, JointRoiOverride>([
      [jointRoiKey('Esquerda', 0), { rgb: { x: 300, y: 260 }, rxCsv: 20, ryCsv: 12 }],
    ]);
    const rois = captureJointRois([hand], matrix, HALF_SCALE, { sizeScale: 2, overrides });

    const wrist = rois.find((r) => r.landmarkId === 0)!;
    expect(wrist.rgb).toEqual({ x: 300, y: 260 });
    expect(wrist.csv).toEqual({ x: 150, y: 130 }); // overridden center, halved
    expect(wrist.rxCsv).toBe(20); // size override wins over sizeScale
    expect(wrist.ryCsv).toBe(12);
    expect(wrist.edited).toBe(true);

    // Untouched joints keep the landmark position and follow the size slider.
    const mcp = rois.find((r) => r.landmarkId === 5)!;
    expect(mcp.edited).toBe(false);
    expect(mcp.rxCsv).toBe(20); // r=10 × sizeScale 2
  });

  it('lets a move-only override keep following the global size slider', () => {
    const hand = handAt('Esquerda', 200, 200);
    const overrides = new Map<string, JointRoiOverride>([
      [jointRoiKey('Esquerda', 0), { rgb: { x: 240, y: 240 } }],
    ]);
    const rois = captureJointRois([hand], matrix, HALF_SCALE, { sizeScale: 0.5, overrides });

    const wrist = rois.find((r) => r.landmarkId === 0)!;
    expect(wrist.csv).toEqual({ x: 120, y: 120 });
    expect(wrist.rxCsv).toBe(13.5); // 27 × 0.5 — size still from the slider
    expect(wrist.edited).toBe(true);
  });

  it('excludes background cells via skinTest so stats reflect skin only', () => {
    // Warm skin (32 °C) only left of CSV x=105; cold background (20 °C) beyond.
    const split = { ...uniformMatrix(640, 480, 20), values: new Float64Array(640 * 480) };
    for (let y = 0; y < 480; y++) {
      for (let x = 0; x < 640; x++) {
        split.values[y * 640 + x] = x < 105 ? 32 : 20;
      }
    }
    const hand = handAt('Esquerda', 200, 200); // wrist lands at CSV (100, 100), on the edge

    const noMask = captureJointRois([hand], split, HALF_SCALE);
    const masked = captureJointRois([hand], split, HALF_SCALE, {
      skinTest: (x) => x < 105,
    });

    const wristNoMask = noMask.find((r) => r.landmarkId === 0)!;
    const wristMasked = masked.find((r) => r.landmarkId === 0)!;
    expect(wristNoMask.stats.mean).toBeLessThan(32); // background dragged it down
    expect(wristMasked.stats.mean).toBeCloseTo(32); // background excluded
    // Coverage reports how much of the footprint was skin.
    expect(wristNoMask.skinCoverage).toBe(1);
    expect(wristMasked.skinCoverage).toBeGreaterThan(0);
    expect(wristMasked.skinCoverage).toBeLessThan(1);
  });
});

describe('applyJointOverrides', () => {
  const matrix = uniformMatrix(640, 480, 30);

  /** O que a consulta gravou: uma ROI já medida, sem landmark por trás. */
  function gravada(overrides: Partial<JointRoi> = {}): JointRoi {
    return {
      side: 'Esquerda',
      landmarkId: 0,
      label: 'Punho',
      key: jointRoiKey('Esquerda', 0),
      rgb: { x: 200, y: 200 },
      csv: { x: 100, y: 100 },
      shape: 'ellipse',
      rxCsv: 27,
      ryCsv: 17,
      stats: { mean: 30, median: 30, max: 30, min: 30, area: 1, count: 1 },
      skinCoverage: 1,
      edited: false,
      ...overrides,
    };
  }

  it('escala as ROIs gravadas pelo slider global', () => {
    const [roi] = applyJointOverrides([gravada()], matrix, HALF_SCALE, { sizeScale: 0.5 });
    expect(roi.rxCsv).toBe(13.5); // 27 × 0.5, relativo ao raio GRAVADO
    expect(roi.ryCsv).toBe(8.5);
    expect(roi.stats.mean).toBeCloseTo(30); // remedida na matriz, não herdada
  });

  it('não marca como editada a ROI que só seguiu o slider', () => {
    const [roi] = applyJointOverrides([gravada()], matrix, HALF_SCALE, { sizeScale: 1.5 });
    expect(roi.edited).toBe(false);
  });

  it('devolve os números gravados intactos quando não há ajuste nem escala', () => {
    const base = [gravada()];
    expect(applyJointOverrides(base, matrix, HALF_SCALE)).toBe(base);
    expect(applyJointOverrides(base, matrix, HALF_SCALE, { sizeScale: 1 })).toBe(base);
  });

  it('fixa a ROI redimensionada à mão e deixa a movida seguir o slider', () => {
    const punho = gravada();
    const mcp = gravada({
      landmarkId: 5,
      label: 'MCP 2',
      key: jointRoiKey('Esquerda', 5),
      shape: 'circle',
      rxCsv: 10,
      ryCsv: 10,
    });
    const overrides = new Map<string, JointRoiOverride>([
      [punho.key, { rxCsv: 20, ryCsv: 12 }], // redimensionada: fica fixa
      [mcp.key, { rgb: { x: 300, y: 260 } }], // só movida: continua seguindo
    ]);

    const [comTamanho, soMovida] = applyJointOverrides([punho, mcp], matrix, HALF_SCALE, {
      sizeScale: 2,
      overrides,
    });

    expect(comTamanho.rxCsv).toBe(20); // o ajuste manual vence o slider
    expect(comTamanho.ryCsv).toBe(12);
    expect(soMovida.rxCsv).toBe(20); // 10 × 2, do slider
    expect(soMovida.csv).toEqual({ x: 150, y: 130 }); // centro movido, pelo alinhamento
    expect(comTamanho.edited).toBe(true);
    expect(soMovida.edited).toBe(true);
  });

  it('recalcula skinCoverage ao mudar o raio, em vez de herdar a gravada', () => {
    // Pele quente só à esquerda de CSV x=105; o resto é fundo frio.
    const split = uniformMatrix(640, 480, 20);
    for (let y = 0; y < 480; y++) {
      for (let x = 0; x < 640; x++) {
        split.values[y * 640 + x] = x < 105 ? 32 : 20;
      }
    }
    const [roi] = applyJointOverrides([gravada()], split, HALF_SCALE, {
      sizeScale: 1.5,
      skinTest: (x) => x < 105,
    });

    expect(roi.skinCoverage).toBeLessThan(1); // a gravada dizia 1
    expect(roi.skinCoverage).toBeCloseTo(roi.stats.count / roi.stats.area);
  });
});
