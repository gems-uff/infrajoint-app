/**
 * Automatic joint ROIs — the port of `get_both_hands_rois_stats_from_rgb` /
 * `extract_thermal_roi_stats` from `scripts/core.py`.
 *
 * From the 21 MediaPipe hand landmarks, the same 11 joints per hand tracked by
 * the body map (Punho, MCP 1–5, IFP 1–5 — 22 in total for both hands) get a
 * fixed-size ROI in thermal-matrix space: an ellipse of 27×17 cells for the
 * wrist, a circle of radius 10 for the finger joints, exactly as in the
 * Python pipeline.
 */

import { applyAffine } from './alignment';
import {
  AffineMatrix,
  DetectedHand,
  HandSide,
  Point,
  RoiShape,
  RoiStats,
  ThermalMatrix,
} from './image-analyzer.model';
import { computeRoiStats } from './roi-stats';

export interface JointRoiDef {
  /** MediaPipe hand-landmark index (core.py's ROI_IDS). */
  readonly landmarkId: number;
  /** Body-map style label (pt-BR). */
  readonly label: string;
}

/** The 11 joints per hand, matching core.py's ROI_IDS and the body map. */
export const JOINT_ROI_DEFS: readonly JointRoiDef[] = [
  { landmarkId: 0, label: 'Punho' },
  { landmarkId: 2, label: 'MCP 1' },
  { landmarkId: 3, label: 'IFP 1' },
  { landmarkId: 5, label: 'MCP 2' },
  { landmarkId: 6, label: 'IFP 2' },
  { landmarkId: 9, label: 'MCP 3' },
  { landmarkId: 10, label: 'IFP 3' },
  { landmarkId: 13, label: 'MCP 4' },
  { landmarkId: 14, label: 'IFP 4' },
  { landmarkId: 17, label: 'MCP 5' },
  { landmarkId: 18, label: 'IFP 5' },
];

/** ROI size in CSV cells (core.py: wrist 27×17 ellipse, joints r=10 circle). */
export function jointRoiRadii(landmarkId: number): {
  readonly shape: RoiShape;
  readonly rx: number;
  readonly ry: number;
} {
  return landmarkId === 0
    ? { shape: 'ellipse', rx: 27, ry: 17 }
    : { shape: 'circle', rx: 10, ry: 10 };
}

export interface JointRoi {
  readonly side: HandSide;
  readonly landmarkId: number;
  readonly label: string;
  /** Stable identity (`side:landmarkId`), for override lookup and selection. */
  readonly key: string;
  /** Effective ROI center in RGB pixels — the user override, else the landmark. */
  readonly rgb: Point;
  /** Joint center mapped to CSV cells via the active alignment. */
  readonly csv: Point;
  readonly shape: RoiShape;
  readonly rxCsv: number;
  readonly ryCsv: number;
  readonly stats: RoiStats;
  /** Fraction of the ROI footprint that was actually skin (0–1). */
  readonly skinCoverage: number;
  /** True when a manual override moved or resized this ROI off its default. */
  readonly edited: boolean;
}

/**
 * A manual adjustment to one joint ROI. `rgb` overrides the landmark-derived
 * center (RGB px); `rxCsv`/`ryCsv` override the size (CSV cells) so the joint
 * no longer follows the global size slider. Any field left undefined keeps the
 * default, so a move-only override still tracks the slider for its size.
 */
export interface JointRoiOverride {
  readonly rgb?: Point;
  readonly rxCsv?: number;
  readonly ryCsv?: number;
}

/** Stable per-joint key used to look up overrides and drive selection. */
export function jointRoiKey(side: HandSide, landmarkId: number): string {
  return `${side}:${landmarkId}`;
}

export interface JointRoiOptions {
  /** Multiplier over the core.py ROI sizes (1 = original 27×17 / r=10). */
  readonly sizeScale?: number;
  /**
   * Optional per-cell filter in CSV coords — e.g. "is this cell's RGB
   * counterpart skin?". Cells failing it are excluded from the statistics,
   * so an ROI wider than the finger doesn't average in the background.
   */
  readonly skinTest?: (csvX: number, csvY: number) => boolean;
  /** Per-joint manual adjustments, keyed by {@link jointRoiKey}. */
  readonly overrides?: ReadonlyMap<string, JointRoiOverride>;
}

/**
 * Maps each tracked joint of each detected hand into the thermal matrix and
 * aggregates its temperatures.
 */
export function captureJointRois(
  hands: readonly DetectedHand[],
  matrix: ThermalMatrix,
  alignment: AffineMatrix,
  options: JointRoiOptions = {},
): JointRoi[] {
  const sizeScale = options.sizeScale ?? 1;
  const rois: JointRoi[] = [];
  for (const hand of hands) {
    for (const def of JOINT_ROI_DEFS) {
      const landmark = hand.landmarks[def.landmarkId];
      if (!landmark) {
        continue;
      }
      const key = jointRoiKey(hand.side, def.landmarkId);
      const override = options.overrides?.get(key);
      const rgb = override?.rgb ?? landmark;
      const csv = applyAffine(alignment, rgb.x, rgb.y);
      const { shape, rx, ry } = jointRoiRadii(def.landmarkId);
      const rxCsv = override?.rxCsv ?? rx * sizeScale;
      const ryCsv = override?.ryCsv ?? ry * sizeScale;
      const stats = computeRoiStats(matrix, shape, csv.x, csv.y, rxCsv, ryCsv, options.skinTest);
      rois.push({
        side: hand.side,
        landmarkId: def.landmarkId,
        label: def.label,
        key,
        rgb,
        csv,
        shape,
        rxCsv,
        ryCsv,
        stats,
        skinCoverage: stats.area > 0 ? stats.count / stats.area : 0,
        edited: override !== undefined,
      });
    }
  }
  return rois;
}

/**
 * Aplica ajustes manuais e a escala global sobre ROIs articulares **já calculadas**.
 *
 * Existe para o caminho em que as posições não vêm de landmarks: a consulta reaberta
 * parte das medições gravadas, e mover ou redimensionar uma ROI é mudar centro/raios
 * e recalcular a estatística da matriz — sem redetectar mão nenhuma.
 *
 * `captureJointRois` continua sendo o caminho da sessão viva, onde há landmarks. As
 * duas assinaturas são deliberadamente iguais a partir de `matrix`: a razão de o
 * slider global não funcionar em consulta reaberta era esta função não aceitar
 * `sizeScale`, e os chamadores não terem onde passá-lo. Divergir de novo agora exige
 * mudar uma assinatura que a outra função espelha.
 *
 * **`sizeScale` é relativo ao gravado**, não ao padrão do `core.py`: os raios da base
 * já embutem a escala em vigor quando a análise foi salva. 100% é o tamanho com que
 * se mediu, que é o que o registro clínico afirma.
 */
export function applyJointOverrides(
  base: readonly JointRoi[],
  matrix: ThermalMatrix,
  alignment: AffineMatrix,
  options: JointRoiOptions = {},
): readonly JointRoi[] {
  const sizeScale = options.sizeScale ?? 1;
  const overrides = options.overrides;
  // Sem ajuste manual e com o slider no tamanho gravado não há o que recalcular, e
  // devolver `base` é mais do que economia: preserva os números exatos do registro.
  // Recalcular aqui os reproduziria sob o teste de pele em vigor AGORA, que pode não
  // ser o de quando se mediu — e voltar o slider a 100% deixaria de restaurar o que
  // a consulta gravou.
  if (!overrides?.size && sizeScale === 1) {
    return base;
  }
  return base.map((roi) => {
    const ajuste = overrides?.get(roi.key);
    const rgb = ajuste?.rgb ?? roi.rgb;
    // Mesma precedência da sessão viva: quem redimensionou à mão fica fixo, quem só
    // moveu (ou nem tocou) continua seguindo o slider.
    const rxCsv = ajuste?.rxCsv ?? roi.rxCsv * sizeScale;
    const ryCsv = ajuste?.ryCsv ?? roi.ryCsv * sizeScale;
    const csv = applyAffine(alignment, rgb.x, rgb.y);
    const stats = computeRoiStats(matrix, roi.shape, csv.x, csv.y, rxCsv, ryCsv, options.skinTest);
    return {
      ...roi,
      rgb,
      csv,
      rxCsv,
      ryCsv,
      stats,
      // Recalculada junto com `stats`, e não herdada: mudar o raio muda a fração da
      // ROI que é pele, e a assimetria descarta o par abaixo de 40%. Herdar deixaria
      // esse corte decidido por uma cobertura que já não descreve a ROI desenhada.
      skinCoverage: stats.area > 0 ? stats.count / stats.area : 0,
      // Escala global não é edição: ela não fixa a ROI nem a destaca no overlay.
      edited: roi.edited || ajuste !== undefined,
    };
  });
}
