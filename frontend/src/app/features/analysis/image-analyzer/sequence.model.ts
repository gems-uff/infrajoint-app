/**
 * Domain types for the temporal sequence analysis (rewarming protocol).
 *
 * A capture session ("V051_T1") holds one resting baseline (`Est`, taken before
 * the cooling and off the rewarming axis — see `rewarming-curve.ts`) and ~20
 * dynamic captures (`Din01`…`DinNN`) taken at a fixed interval during the
 * hands' rewarming after cold stress. Each capture is the same triplet the
 * individual analysis uses: optical photo (`*_DAR.jpeg`), thermal render
 * (`*_IR.jpeg`) and temperature matrix (`*.csv`).
 *
 * Legacy folders ("V014/") use a different file naming, normalized onto this
 * same shape on import; see `sequence-files.ts`.
 */

import { SilhouetteAgreement } from './alignment-quality';
import { FiducialCorrection } from './fiducial-markers';
import { AffineMatrix, DetectedHand, ThermalMatrix } from './image-analyzer.model';
import { JointRoi, JointRoiOverride } from './joint-rois';

export type CaptureKind = 'baseline' | 'dynamic';

/** Default seconds between dynamic captures (protocol default; user-editable). */
export const DEFAULT_CAPTURE_INTERVAL_SECONDS = 15;

/** One recognized capture of a reviewed batch, before processing. */
export interface ReviewCapture {
  readonly kind: CaptureKind;
  /** 0 for the baseline; the 1-based `Din` index for dynamics. */
  readonly index: number;
  /** Raw phase label from the file names (`Est`, `Din07`…). */
  readonly label: string;
  readonly optical: File | null;
  readonly thermal: File | null;
  readonly matrix: File | null;
}

/** Whether a reviewed capture has its full triplet and can be processed. */
export function isCompleteCapture(capture: ReviewCapture): boolean {
  return capture.optical !== null && capture.thermal !== null && capture.matrix !== null;
}

/** The grouping result for one (subject, trial) found in the dropped files. */
export interface SequenceReview {
  readonly subject: string;
  readonly trial: string;
  /** Sorted: baseline first, then dynamics by index. */
  readonly captures: readonly ReviewCapture[];
  /** `Din` indexes missing from an otherwise contiguous 1..max range. */
  readonly missingIndexes: readonly number[];
  /** Camera originals (`*_Din01.jpeg`, no `_DAR`/`_IR` suffix) — not used. */
  readonly ignoredOriginals: number;
  /**
   * Legacy captures the current protocol has no place for — the `EP`/`M`
   * support-surface acquisitions and `Din00` (same instant as `Est`). Counted
   * because they would otherwise be dropped silently.
   */
  readonly ignoredLegacy: number;
  /** Files outside the protocol naming (spreadsheets, etc.) — not used. */
  readonly ignoredOthers: number;
}

/** One processed capture of the active sequence. */
export interface SequenceCapture {
  readonly kind: CaptureKind;
  readonly index: number;
  readonly label: string;
  /**
   * Seconds on the rewarming axis: `DinNN` = NN × interval. The baseline keeps
   * 0, which is not a position on that axis — nothing reads it as an instant;
   * `kind`/`phase` is what identifies it. See `rewarming-curve.ts`.
   */
  readonly timeSeconds: number;
  readonly optical: File;
  readonly thermal: File;
  /** CSV de origem, retido para o upload das capturas. */
  readonly matrixFile: File;
  /** Parsed temperature matrix (kept in memory; ≈2.4 MB per capture). */
  readonly matrix: ThermalMatrix;
  /** RGB→CSV alignment fitted for this capture, or null when it failed. */
  readonly alignment: AffineMatrix | null;
  readonly autoMethod: 'fiducial' | 'silhouette' | 'manual' | null;
  /**
   * Silhouette agreement of `alignment`. Kept whole rather than reduced to the
   * displayed percentage: the acceptance threshold is not calibrated yet, and
   * founding it later means re-deriving it from these captures without
   * reprocessing them.
   */
  readonly agreement: SilhouetteAgreement | null;
  /** Marker correction, when the fiducial path produced this alignment. */
  readonly correction: FiducialCorrection | null;
  /** Hands landmarked on this capture's photo (per-frame re-anchoring). */
  readonly hands: readonly DetectedHand[];
  /**
   * Per-CSV-cell skin flag (1 = the cell's RGB counterpart is skin), sampled
   * with the same margin as the live skin test — feeds the curve statistics
   * without keeping 21 full-resolution photos in memory.
   */
  readonly skinMask: Uint8Array | null;
  /** Small thermal thumbnail (data URL) for the timeline strip. */
  readonly thumbnail: string;
  /** Manual per-joint adjustments made on this capture. */
  readonly jointOverrides: ReadonlyMap<string, JointRoiOverride>;
  /**
   * Medições vindas do banco, numa consulta reaberta.
   *
   * Quando presentes, substituem a detecção por landmarks como base das ROIs
   * articulares — `hands` fica vazio porque os landmarks não são persistidos, e
   * não precisam ser: o resultado deles já está aqui. É isto que faz a consulta
   * reaberta mostrar os números do dia, e não uma segunda detecção.
   */
  readonly restoredJoints?: readonly JointRoi[] | null;
  /** Human-readable processing problem, or null when the capture is healthy. */
  readonly issue: string | null;
}

/** Short display label: `Base` for the baseline, `Din 7` for dynamics. */
export function captureDisplayLabel(capture: Pick<SequenceCapture, 'kind' | 'index'>): string {
  return capture.kind === 'baseline' ? 'Base' : `Din ${capture.index}`;
}

/** `m:ss` formatting for the rewarming time axis (e.g. 105 → "1:45"). */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
