/**
 * Domain types for the image analyzer.
 *
 * Coordinate spaces (mirroring the Python pipeline in `scripts/core.py`):
 * - RGB: pixels of the visual photo (typically 1280×960).
 * - CSV: cells of the thermal temperature matrix (typically 640×480), where
 *   each value is a temperature in °C.
 * - Thermal display: pixels of whatever image represents the thermal view on
 *   screen — either the camera-rendered JPEG (1.5× the CSV, 960×720) or a
 *   colormap rendering of the CSV itself (1×).
 */

/** Thermal temperature matrix parsed from the camera CSV. Missing cells are NaN. */
export interface ThermalMatrix {
  readonly width: number;
  readonly height: number;
  /** Row-major values in °C; length = width × height. */
  readonly values: Float64Array;
}

/**
 * 2×3 affine transform, laid out as
 * ```
 * | a  b  tx |
 * | c  d  ty |
 * ```
 * so that (x, y) ↦ (a·x + b·y + tx, c·x + d·y + ty). Matches the row-major
 * matrices produced by OpenCV's `estimateAffinePartial2D` in the scripts.
 */
export interface AffineMatrix {
  readonly a: number;
  readonly b: number;
  readonly tx: number;
  readonly c: number;
  readonly d: number;
  readonly ty: number;
}

export type RoiShape = 'circle' | 'ellipse';

/** A user-drawn ROI, in RGB pixel coordinates. */
export interface RoiSelection {
  /** Stable identifier so ROIs can be tracked, selected and deleted. */
  readonly id: number;
  readonly shape: RoiShape;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/** Aggregated temperatures inside an ROI, in °C. NaN when the ROI is empty. */
export interface RoiStats {
  readonly mean: number;
  readonly median: number;
  readonly max: number;
  readonly min: number;
  /** Cells inside the ROI shape and matrix bounds (geometric footprint). */
  readonly area: number;
  /** Of those, the cells actually aggregated (finite and passing `include`). */
  readonly count: number;
}

/** A corresponding point pair used for manual marker calibration. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type AlignmentMode = 'auto' | 'manual';

/** A structural subset of ImageData (so pure code and tests avoid the DOM). */
export interface RgbPixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/**
 * An interactive automatic (joint) ROI drawn over the overlay, in RGB px. It
 * carries a stable `key` (so edits/selection target one joint) and its side
 * color/label, and can be moved and resized like a manual ROI.
 */
export interface OverlayJointRoi {
  readonly key: string;
  readonly shape: RoiShape;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly color: string;
  readonly label: string;
  /** True when a manual override moved/resized it — drives the "edited" badge. */
  readonly edited: boolean;
}

/**
 * A committed move/resize of one joint ROI, emitted by the overlay (RGB px).
 * `kind` lets the parent store only the changed dimension, so a moved joint
 * keeps following the global size slider while a resized one is pinned.
 */
export interface OverlayJointEdit {
  readonly key: string;
  readonly kind: 'move' | 'resize';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export type HandSide = 'Esquerda' | 'Direita';

/** A hand found by the landmark detector, in RGB pixel coordinates. */
export interface DetectedHand {
  readonly side: HandSide;
  /** The 21 MediaPipe hand landmarks, indexed by landmark id. */
  readonly landmarks: readonly Point[];
}
