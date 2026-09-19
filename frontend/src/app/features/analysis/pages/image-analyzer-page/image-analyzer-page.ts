import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { LucideDynamicIcon } from '@lucide/angular';

import {
  applyAffine,
  composeAffine,
  estimateSimilarityTransform,
  invertAffine,
  similarityScale,
  uniformScaleAffine,
} from '../../image-analyzer/alignment';
import { MarkerPicker } from '../../image-analyzer/components/marker-picker/marker-picker';
import { OverlayCanvas } from '../../image-analyzer/components/overlay-canvas/overlay-canvas';
import { RewarmingChart } from '../../image-analyzer/components/rewarming-chart/rewarming-chart';
import { SequenceImport } from '../../image-analyzer/components/sequence-import/sequence-import';
import { Timeline } from '../../image-analyzer/components/timeline/timeline';
import { UploadCard } from '../../image-analyzer/components/upload-card/upload-card';
import { imageToCanvas, imageToPixels, loadImage } from '../../image-analyzer/dom-images';
import { HandLandmarksService } from '../../image-analyzer/hand-landmarks.service';
import {
  CURVE_STATISTIC_LABELS,
  CurveFrame,
  CurveStatistic,
  buildRewarmingSeries,
} from '../../image-analyzer/rewarming-curve';
import { SequenceService } from '../../image-analyzer/sequence.service';
import {
  SequenceCapture,
  captureDisplayLabel,
  formatSeconds,
} from '../../image-analyzer/sequence.model';
import { buildCsvSkinMask, isSkinNeighborhood } from '../../image-analyzer/skin-mask';
import {
  AffineMatrix,
  AlignmentMode,
  DetectedHand,
  OverlayJointEdit,
  OverlayJointRoi,
  Point,
  RoiSelection,
  RoiShape,
  ThermalMatrix,
} from '../../image-analyzer/image-analyzer.model';
import { polishTranslation } from '../../image-analyzer/alignment-polish';
import {
  measureSilhouetteAgreement,
  SilhouetteAgreement,
} from '../../image-analyzer/alignment-quality';
import { FiducialCorrection, refineWithFiducials } from '../../image-analyzer/fiducial-markers';
import {
  JOINT_ROI_DEFS,
  JointRoi,
  JointRoiOverride,
  applyJointOverrides,
  captureJointRois,
} from '../../image-analyzer/joint-rois';
import { computeRoiStats } from '../../image-analyzer/roi-stats';
import { registerSilhouettes } from '../../image-analyzer/silhouette-registration';
import { decodeThermalCsv, parseThermalCsv } from '../../image-analyzer/thermal-csv';

/** Thermal display image plus its scale relative to the CSV matrix. */
interface ThermalDisplay {
  readonly canvas: HTMLCanvasElement;
  /** Display pixels per CSV cell (1.5 for the camera JPEG). */
  readonly csvScale: number;
}

interface RoiResult {
  readonly id: number;
  readonly label: string;
  readonly mean: string;
  readonly median: string;
  readonly max: string;
  readonly min: string;
  readonly csvX: number;
  readonly csvY: number;
  readonly valid: boolean;
}

/** One joint side's reading plus whether it had enough skin to be trusted. */
interface JointCell {
  /** Override/selection key, or null when this side's joint was not detected. */
  readonly key: string | null;
  readonly min: string;
  readonly mean: string;
  readonly max: string;
  /** True when skin coverage was too low (ROI mostly background). */
  readonly unreliable: boolean;
  /** True when the ROI was manually moved/resized off its detected default. */
  readonly edited: boolean;
}

/** One table row: a joint with its per-side aggregated temperatures. */
interface JointRow {
  readonly label: string;
  readonly left: JointCell;
  readonly right: JointCell;
}

/** How the automatic alignment was actually solved (drives the active-method label). */
type AutoMethod = 'fiducial' | 'silhouette' | 'manual';

/** Fitted RGB→CSV scale is ~0.5; reject fits far outside that (core.py's diagnostic). */
const AUTO_SCALE_MIN = 0.3;
const AUTO_SCALE_MAX = 0.8;

function withinAutoScale(scale: number): boolean {
  return scale >= AUTO_SCALE_MIN && scale <= AUTO_SCALE_MAX;
}

const LEFT_ROI_COLOR = '#22d3ee';
const RIGHT_ROI_COLOR = '#f59e0b';

/** Below this skin coverage a joint ROI is flagged as unreliable. */
const MIN_SKIN_COVERAGE = 0.35;

/**
 * Web port of the thermal analysis scripts (`scripts/core.py` +
 * `scripts/manual_roi_verifier.py`): aligns the thermal matrix to the RGB
 * photo (automatic silhouette registration, or manual point calibration as a
 * fallback), overlays them, and measures temperatures either in a hand-drawn
 * ROI or automatically at the 22 body-map hand joints via MediaPipe hand
 * landmarks.
 *
 * Everything runs client-side; no data leaves the browser.
 */
@Component({
  selector: 'app-image-analyzer-page',
  imports: [
    LucideDynamicIcon,
    MarkerPicker,
    OverlayCanvas,
    RewarmingChart,
    SequenceImport,
    Timeline,
    UploadCard,
  ],
  providers: [SequenceService],
  templateUrl: './image-analyzer-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageAnalyzerPage {
  private readonly handLandmarks = inject(HandLandmarksService);

  /** Help dialog root, focused when the modal opens (accessibility). */
  private readonly helpDialog = viewChild<ElementRef<HTMLElement>>('helpDialog');
  private readonly focusHelpOnOpen = effect(() => {
    if (this.helpOpen()) {
      this.helpDialog()?.nativeElement.focus();
    }
  });

  // --- Loaded inputs -------------------------------------------------------
  /**
   * Renderizado dentro do fluxo de Análise Térmica, e não como página própria.
   *
   * Só afeta o elemento raiz: a página traz o próprio `<main>`, e aninhar um
   * dentro do `<main>` do fluxo é HTML inválido e atrapalha leitor de tela.
   */
  readonly embedded = input(false);

  /**
   * A página está mostrando uma consulta **gravada**, não uma sessão nova.
   *
   * Suprime a tela de upload: numa consulta reaberta ela não se aplica em momento
   * algum, e aparecer enquanto a hidratação não termina fazia parecer que abrir
   * uma consulta redirecionava para pedir arquivos.
   */
  readonly fromSaved = input(false);

  /**
   * Arquivos de origem, retidos para o upload das capturas.
   *
   * A tela solta nunca os envia — quem envia é o fluxo de Análise Térmica.
   * Retê-los aqui é só não jogar fora o que já foi lido do disco.
   */
  readonly rgbFile = signal<File | null>(null);
  readonly csvFile = signal<File | null>(null);
  readonly jpegFile = signal<File | null>(null);

  protected readonly rgbImage = signal<HTMLImageElement | null>(null);
  protected readonly rgbFileName = signal<string | null>(null);
  readonly matrix = signal<ThermalMatrix | null>(null);
  protected readonly csvFileName = signal<string | null>(null);
  protected readonly jpegFileName = signal<string | null>(null);
  private readonly jpegCanvas = signal<HTMLCanvasElement | null>(null);

  /** UI-only: per-file decode/parse in progress, for the upload cards. */
  protected readonly loadingRgb = signal(false);
  protected readonly loadingCsv = signal(false);
  protected readonly loadingJpeg = signal(false);

  /** UI-only: human-readable size of each loaded file, for the upload cards. */
  protected readonly rgbFileSize = signal<string | null>(null);
  protected readonly csvFileSize = signal<string | null>(null);
  protected readonly jpegFileSize = signal<string | null>(null);

  /** UI-only: per-card validation/decode error, shown inside each upload card. */
  protected readonly rgbError = signal<string | null>(null);
  protected readonly csvError = signal<string | null>(null);
  protected readonly jpegError = signal<string | null>(null);

  protected readonly error = signal<string | null>(null);
  protected readonly info = signal<string | null>(null);

  // --- Thermal display -----------------------------------------------------
  /** The camera thermal JPEG with its scale relative to the CSV matrix. */
  protected readonly thermalDisplay = computed<ThermalDisplay | null>(() => {
    const jpeg = this.jpegCanvas();
    const m = this.matrix();
    if (!jpeg) {
      return null;
    }
    return { canvas: jpeg, csvScale: m ? jpeg.width / m.width : 1.5 };
  });

  protected readonly ready = computed(
    () => this.rgbImage() !== null && this.matrix() !== null && this.jpegCanvas() !== null,
  );

  // --- Alignment -----------------------------------------------------------
  readonly mode = signal<AlignmentMode>('auto');
  protected readonly manualMatrix = signal<AffineMatrix | null>(null);
  protected readonly autoMatrix = signal<AffineMatrix | null>(null);
  /** UI-only: automatic alignment in progress (drives the busy overlay). */
  protected readonly aligning = signal(false);
  /** How the last automatic alignment was solved, for an accurate label. */
  readonly autoMethod = signal<AutoMethod | null>(null);
  /**
   * Silhouette agreement of the active alignment. It lives in the panel, not in
   * the result banner: the banner is dismissible and, in sequence mode, every
   * frame carries its own value, which has to survive stepping between captures.
   */
  readonly agreement = signal<SilhouetteAgreement | null>(null);

  /** The panel figure, or null when no alignment was measured (manual, failed). */
  protected readonly overlapPercent = computed(() => {
    const measured = this.agreement();
    return measured ? `${(measured.normalized * 100).toFixed(0)}%` : null;
  });

  /**
   * Tooltip for the figure above. Says what the number is about in the user's
   * terms and names its main limitation: the score is computed over *areas*, so
   * two silhouettes can overlap almost entirely while being internally
   * displaced. The normalization it carries ("of the attainable maximum") stays
   * out — that is a modelling detail for the method write-up, not a sidebar.
   * See `alignment-quality.ts`.
   */
  protected readonly OVERLAP_HELP =
    'Indica o quanto as regiões identificadas como mão na imagem óptica e na ' +
    'imagem térmica se sobrepõem depois do alinhamento. É uma medida de ' +
    'concordância espacial global entre as silhuetas e não representa a ' +
    'precisão ponto a ponto nem garante, isoladamente, a exatidão das ' +
    'temperaturas extraídas das ROIs.';

  /** Marker correction of the active alignment, when the fiducial path ran. */
  readonly correction = signal<FiducialCorrection | null>(null);
  /**
   * UI-only: which figure has its explanation open. A native `title` was tried
   * first and is the wrong tool here — it needs a long hover to appear, cannot
   * hold a breakdown, and makes a button look inert when clicked.
   */
  protected readonly openInfo = signal<'overlap' | 'correction' | null>(null);

  /** The panel figure — the same mean the breakdown reconstructs. */
  protected readonly correctionCells = computed(() => {
    const applied = this.correction();
    return applied ? applied.magnitude.toFixed(1).replace('.', ',') : null;
  });

  /**
   * Every number needed to redo the mean by hand: predicted, detected, their
   * difference and each marker's own length. Showing only the aggregate would
   * leave the user with a figure they cannot check, and showing only X/Y/scale/
   * rotation would not reconstruct it either — the mean comes from the vector
   * lengths, not from the components.
   */
  protected readonly correctionDetails = computed(() => {
    const applied = this.correction();
    if (!applied) {
      return null;
    }
    const markers = applied.offsets.map((offset, i) => {
      const predicted = applied.predicted[i];
      const detected = applied.detected[i];
      const length = Math.hypot(offset.x, offset.y);
      return {
        label: `Marcador ${i + 1}`,
        predictedX: cells(predicted?.x),
        predictedY: cells(predicted?.y),
        detectedX: cells(detected?.x),
        detectedY: cells(detected?.y),
        deltaX: cells(offset.x),
        deltaY: cells(offset.y),
        length: cells(length),
      };
    });
    return {
      markers,
      // The addends are the same rounded values shown per marker, so the line
      // reads as an arithmetic identity; the result is the exact mean.
      meanFormula: `(${markers.map((m) => m.length).join(' + ')}) / ${markers.length}`,
      mean: cells(applied.magnitude),
      shiftX: cells(applied.shiftX),
      shiftY: cells(applied.shiftY),
      scale: `${applied.scaleRatio.toFixed(3).replace('.', ',')}×`,
      rotation: `${applied.rotationDeg.toFixed(2).replace('.', ',')}°`,
    };
  });

  /** Human label for the active alignment, accurate to the method actually used. */
  protected readonly alignmentLabel = computed(() => {
    if (this.mode() === 'manual') {
      return 'Calibração manual';
    }
    switch (this.autoMethod()) {
      case 'fiducial':
        return 'Automático (marcadores)';
      case 'silhouette':
        return 'Automático (silhuetas)';
      case 'manual':
        return 'Calibração manual';
      default:
        return 'Automático';
    }
  });

  /** True once any alignment (automatic or manual) is in effect. */
  protected readonly aligned = computed(() => this.activeMatrix() !== null);

  /**
   * Active RGB → CSV transform, or null until an alignment exists. The only
   * automatic method is silhouette registration; manual calibration is the
   * fallback. Nothing is overlaid or measured until one of them has run.
   */
  readonly activeMatrix = computed<AffineMatrix | null>(() =>
    this.mode() === 'manual' ? this.manualMatrix() : this.autoMatrix(),
  );

  /** Thermal-display → RGB transform used to warp the overlay. */
  protected readonly thermalToRgb = computed<AffineMatrix | null>(() => {
    const display = this.thermalDisplay();
    const active = this.activeMatrix();
    if (!display || !active) {
      return null;
    }
    const inv = invertAffine(active);
    return inv ? composeAffine(inv, uniformScaleAffine(1 / display.csvScale)) : null;
  });

  // --- View controls -------------------------------------------------------
  /** UI-only: whether the user moved from the upload screen to the analyzer. */
  protected readonly analysisStarted = signal(false);
  /** UI-only: the help/tutorial dialog is open. */
  protected readonly helpOpen = signal(false);

  // --- Temporal sequence -----------------------------------------------------
  readonly sequenceService = inject(SequenceService);
  /** Upload screen path: one capture (current flow) or a protocol sequence. */
  protected readonly uploadMode = signal<'single' | 'sequence'>('single');
  /** True while the viewer is showing a processed sequence. */
  /**
   * Modo sequência ligado. Público porque o fluxo de Análise Térmica precisa
   * distinguir: hoje ele grava a análise avulsa, e a sequência exige as medições
   * por captura, que só existem para a captura ativa.
   */
  readonly sequenceActive = signal(false);
  /** `processedRunId` of the sequence currently loaded in the viewer. */
  private loadedRunId: number | null = null;
  /** Index of the capture shown in the viewer (0 = baseline). */
  protected readonly activeCaptureIndex = signal(0);
  /** Viewer tab in sequence mode: the frame image or the rewarming curves. */
  protected readonly viewerTab = signal<'image' | 'curves'>('image');
  /** Joints plotted on the rewarming curve (landmark ids; default MCP 3). */
  protected readonly curveJointIds = signal<readonly number[]>([9]);
  protected readonly curveStatistic = signal<CurveStatistic>('mean');
  protected readonly curveStatistics = Object.entries(CURVE_STATISTIC_LABELS) as readonly [
    CurveStatistic,
    string,
  ][];
  protected readonly jointDefs = JOINT_ROI_DEFS;
  protected readonly captureDisplayLabel = captureDisplayLabel;
  protected readonly formatSeconds = formatSeconds;

  protected readonly activeSequenceCapture = computed<SequenceCapture | null>(() =>
    this.sequenceActive()
      ? (this.sequenceService.captures()[this.activeCaptureIndex()] ?? null)
      : null,
  );
  /** Playhead position on the curve (the active capture's time). */
  protected readonly activeCaptureTime = computed(
    () => this.activeSequenceCapture()?.timeSeconds ?? null,
  );

  /**
   * Every capture's joint ROIs, re-anchored per frame — feeds the curves.
   *
   * Público porque o fluxo de Análise Térmica grava exatamente estes números: as
   * medições persistidas passam a ser as mesmas que a curva desenhou, em vez de um
   * segundo cálculo que poderia divergir.
   */
  readonly curveFrames = computed<CurveFrame[]>(() => {
    if (!this.sequenceActive()) {
      return [];
    }
    const sizeScale = this.jointSizePct() / 100;
    const ignoreBackground = this.ignoreBackground();
    return this.sequenceService.captures().map((capture) => ({
      timeSeconds: capture.timeSeconds,
      kind: capture.kind,
      rois: this.roisDaCaptura(capture, sizeScale, ignoreBackground),
    }));
  });

  /**
   * ROIs de uma captura: das medições gravadas quando a consulta foi reaberta, dos
   * landmarks quando é sessão viva.
   *
   * A precedência é do gravado. Numa consulta reaberta não há landmarks — e não
   * deveria haver: o que interessa é reproduzir o que foi medido, não medir de novo.
   */
  private roisDaCaptura(
    capture: SequenceCapture,
    sizeScale: number,
    ignoreBackground: boolean,
  ): readonly JointRoi[] {
    if (!capture.alignment || capture.matrix.width === 0) {
      return [];
    }
    const skinTest =
      ignoreBackground && capture.skinMask
        ? maskSkinTest(capture.skinMask, capture.matrix.width, capture.matrix.height)
        : undefined;

    if (capture.restoredJoints) {
      return applyJointOverrides(capture.restoredJoints, capture.matrix, capture.alignment, {
        sizeScale,
        skinTest,
        overrides: capture.jointOverrides,
      });
    }
    if (capture.hands.length === 0) {
      return [];
    }
    return captureJointRois(capture.hands, capture.matrix, capture.alignment, {
      sizeScale,
      skinTest,
      overrides: capture.jointOverrides,
    });
  }

  protected readonly rewarmingSeries = computed(() =>
    buildRewarmingSeries(this.curveFrames(), this.curveJointIds(), this.curveStatistic()),
  );
  protected readonly alphaPct = signal(50);
  protected readonly shape = signal<RoiShape>('circle');
  /** All user-drawn ROIs, in RGB pixel coordinates. */
  readonly rois = signal<readonly RoiSelection[]>([]);
  /** Id of the ROI currently selected for editing, if any. */
  protected readonly selectedRoiId = signal<number | null>(null);
  protected readonly alpha = computed(() => this.alphaPct() / 100);

  // --- Manual ROI results (one per drawn ROI) --------------------------------
  protected readonly roiResults = computed<readonly RoiResult[]>(() => {
    const matrix = this.matrix();
    const m = this.activeMatrix();
    const rois = this.rois();
    if (!matrix || !m || rois.length === 0) {
      return [];
    }
    const scale = similarityScale(m);
    return rois.map((roi, i) => {
      const center = applyAffine(m, roi.cx, roi.cy);
      const stats = computeRoiStats(
        matrix,
        roi.shape,
        center.x,
        center.y,
        roi.rx * scale,
        roi.ry * scale,
      );
      return {
        id: roi.id,
        label: `#${i + 1}`,
        mean: formatCelsius(stats.mean),
        median: formatCelsius(stats.median),
        max: formatCelsius(stats.max),
        min: formatCelsius(stats.min),
        csvX: Math.round(center.x),
        csvY: Math.round(center.y),
        valid: Number.isFinite(stats.mean),
      };
    });
  });

  // --- Automatic joint ROIs ---------------------------------------------------
  protected readonly detectedHands = signal<readonly DetectedHand[] | null>(null);
  protected readonly loadingJoints = signal(false);
  /** ROI size relative to the core.py defaults, in percent. */
  protected readonly jointSizePct = signal(100);
  /**
   * When true, the articular ROI statistics ignore the (cold) background and
   * count only the hand's skin; when false, the whole ROI footprint is measured.
   */
  protected readonly ignoreBackground = signal(true);
  /** Key of the joint ROI currently selected for editing (synced with canvas). */
  protected readonly selectedJointKey = signal<string | null>(null);
  /**
   * Manual per-joint adjustments (move/resize), keyed by {@link jointRoiKey}.
   * Empty until the user drags a joint; cleared on re-detection / new sources.
   */
  private readonly jointOverrides = signal<ReadonlyMap<string, JointRoiOverride>>(new Map());
  /** Full-resolution RGB pixels of the current photo, for skin sampling. */
  private readonly rgbData = signal<ImageData | null>(null);
  /** Medições gravadas, quando a página está mostrando uma consulta reaberta. */
  readonly restoredJoints = signal<readonly JointRoi[] | null>(null);

  /** Joint temperatures, recomputed whenever the alignment or size changes. */
  readonly jointRois = computed<readonly JointRoi[]>(() => {
    const hands = this.detectedHands();
    const matrix = this.matrix();
    const alignment = this.activeMatrix();
    if (!matrix || !alignment) {
      return [];
    }

    // Consulta reaberta: a base são as medições gravadas, e mover, redimensionar ou
    // escalar uma ROI recalcula a estatística da matriz. Sem landmarks, e sem
    // precisar deles — o slider vale aqui como na sessão viva, só que relativo ao
    // tamanho gravado.
    const restauradas = this.activeSequenceCapture()?.restoredJoints ?? this.restoredJoints();
    if (restauradas) {
      return applyJointOverrides(restauradas, matrix, alignment, {
        sizeScale: this.jointSizePct() / 100,
        skinTest: this.skinTestAtual(alignment),
        overrides: this.jointOverrides(),
      });
    }
    if (!hands) {
      return [];
    }

    // When "ignorar fundo" is on, only cells whose RGB counterpart is skin
    // enter the statistics, so ROIs wider than a finger don't average in the
    // (cold) background. Sampled at full RGB resolution (sharp finger/background
    // boundary) with a small margin against alignment jitter. The test is
    // color-based, not temperature-based — genuinely cold fingers still count.
    // With it off, every cell of the ROI footprint is measured (background too).
    // In sequence mode the active capture's baked mask replaces the live
    // sampling, so table and curve statistics agree exactly.
    return captureJointRois(hands, matrix, alignment, {
      sizeScale: this.jointSizePct() / 100,
      skinTest: this.skinTestAtual(alignment),
      overrides: this.jointOverrides(),
    });
  });

  /**
   * Teste de pele em vigor: a máscara assada da captura ativa, ou amostragem viva
   * do RGB. Extraído para os dois caminhos de ROI usarem exatamente o mesmo.
   */
  private skinTestAtual(
    alignment: AffineMatrix,
  ): ((csvX: number, csvY: number) => boolean) | undefined {
    if (!this.ignoreBackground()) {
      return undefined;
    }
    const capture = this.activeSequenceCapture();
    if (capture?.skinMask) {
      return maskSkinTest(capture.skinMask, capture.matrix.width, capture.matrix.height);
    }
    const rgb = this.rgbData();
    const toRgb = invertAffine(alignment);
    if (rgb && toRgb) {
      return (csvX, csvY) => {
        const p = applyAffine(toRgb, csvX, csvY);
        return isSkinNeighborhood(rgb, p.x | 0, p.y | 0);
      };
    }
    return undefined;
  }

  /** Interactive joint ROIs for the overlay, converted to RGB pixel radii. */
  protected readonly overlayJoints = computed<readonly OverlayJointRoi[]>(() => {
    const rois = this.jointRois();
    const alignment = this.activeMatrix();
    if (rois.length === 0 || !alignment) {
      return [];
    }
    const scale = similarityScale(alignment);
    if (scale <= 0) {
      return [];
    }
    return rois.map((roi) => ({
      key: roi.key,
      shape: roi.shape,
      cx: roi.rgb.x,
      cy: roi.rgb.y,
      rx: roi.rxCsv / scale,
      ry: roi.ryCsv / scale,
      color: roi.side === 'Esquerda' ? LEFT_ROI_COLOR : RIGHT_ROI_COLOR,
      label: `${roi.side === 'Esquerda' ? 'E' : 'D'} ${roi.label}`,
      edited: roi.edited,
    }));
  });

  protected readonly jointRows = computed<readonly JointRow[]>(() => {
    const rois = this.jointRois();
    if (rois.length === 0) {
      return [];
    }
    const toCell = (roi: JointRoi | undefined): JointCell => ({
      key: roi?.key ?? null,
      min: formatCelsius(roi?.stats.min ?? NaN),
      mean: formatCelsius(roi?.stats.mean ?? NaN),
      max: formatCelsius(roi?.stats.max ?? NaN),
      unreliable: roi ? roi.skinCoverage < MIN_SKIN_COVERAGE : true,
      edited: roi?.edited ?? false,
    });
    return JOINT_ROI_DEFS.map((def) => ({
      label: def.label,
      left: toCell(rois.find((r) => r.side === 'Esquerda' && r.landmarkId === def.landmarkId)),
      right: toCell(rois.find((r) => r.side === 'Direita' && r.landmarkId === def.landmarkId)),
    }));
  });

  /** Count of joints flagged unreliable (ROI mostly background). */
  protected readonly unreliableJointCount = computed(
    () => this.jointRois().filter((r) => r.skinCoverage < MIN_SKIN_COVERAGE).length,
  );

  /** Count of joint ROIs manually moved/resized off their detected default. */
  protected readonly editedJointCount = computed(
    () => this.jointRois().filter((r) => r.edited).length,
  );

  /** Whether hand joints have been detected (drives the articular empty state). */
  protected readonly jointsDetected = computed(() => (this.detectedHands()?.length ?? 0) > 0);

  // --- Manual calibration --------------------------------------------------
  protected readonly calibrating = signal(false);
  protected readonly rgbPoints = signal<readonly Point[]>([]);
  /**
   * Thermal calibration points, stored in CSV cells so they stay valid when
   * the display source (camera JPEG × palette rendering) changes.
   */
  private readonly thermalPointsCsv = signal<readonly Point[]>([]);
  /** The same points in current display pixels, for the picker panel. */
  protected readonly thermalPointsDisplay = computed<readonly Point[]>(() => {
    const display = this.thermalDisplay();
    if (!display) {
      return [];
    }
    return this.thermalPointsCsv().map((p) => ({
      x: p.x * display.csvScale,
      y: p.y * display.csvScale,
    }));
  });

  protected readonly pairedCount = computed(() =>
    Math.min(this.rgbPoints().length, this.thermalPointsCsv().length),
  );
  protected readonly canApplyCalibration = computed(
    () =>
      this.rgbPoints().length >= 3 && this.rgbPoints().length === this.thermalPointsCsv().length,
  );

  // --- File loading --------------------------------------------------------

  protected async loadRgb(file: File): Promise<void> {
    if (!isImageFile(file)) {
      this.rgbError.set('Selecione um arquivo de imagem (JPEG ou PNG).');
      return;
    }
    this.loadingRgb.set(true);
    this.rgbError.set(null);
    this.info.set(null);
    try {
      const img = await loadImage(file);
      this.rgbImage.set(img);
      this.rgbFileName.set(file.name);
      this.rgbFile.set(file);
      this.rgbFileSize.set(formatFileSize(file.size));
      this.afterSourceChange();
    } catch {
      this.rgbError.set('Não foi possível carregar a imagem óptica selecionada.');
    } finally {
      this.loadingRgb.set(false);
    }
  }

  protected async loadCsv(file: File): Promise<void> {
    if (!isCsvFile(file)) {
      this.csvError.set('Selecione um arquivo CSV.');
      return;
    }
    this.loadingCsv.set(true);
    this.csvError.set(null);
    this.info.set(null);
    try {
      const text = decodeThermalCsv(await file.arrayBuffer());
      const matrix = parseThermalCsv(text);
      this.matrix.set(matrix);
      this.csvFileName.set(file.name);
      this.csvFile.set(file);
      this.csvFileSize.set(formatFileSize(file.size));
      this.afterSourceChange();
    } catch (err) {
      this.csvError.set(
        err instanceof Error && err.message
          ? `CSV térmico inválido: ${err.message}`
          : 'Não foi possível interpretar o CSV térmico.',
      );
    } finally {
      this.loadingCsv.set(false);
    }
  }

  protected async loadJpeg(file: File): Promise<void> {
    if (!isImageFile(file)) {
      this.jpegError.set('Selecione um arquivo de imagem (JPEG ou PNG).');
      return;
    }
    this.loadingJpeg.set(true);
    this.jpegError.set(null);
    this.info.set(null);
    try {
      const img = await loadImage(file);
      this.jpegCanvas.set(imageToCanvas(img));
      this.jpegFileName.set(file.name);
      this.jpegFile.set(file);
      this.jpegFileSize.set(formatFileSize(file.size));
      this.afterSourceChange();
    } catch {
      this.jpegError.set('Não foi possível carregar a imagem térmica selecionada.');
    } finally {
      this.loadingJpeg.set(false);
    }
  }

  /**
   * A source file changed: calibration points, fitted matrices and detected
   * landmarks no longer correspond to what is on screen.
   */
  private afterSourceChange(): void {
    // Loading an individual file replaces whatever dataset was active —
    // including a processed sequence (a new import never needs a reload).
    if (this.sequenceActive() || this.sequenceService.status() !== 'idle') {
      this.sequenceActive.set(false);
      this.loadedRunId = null;
      this.sequenceService.reset();
    }
    this.error.set(null);
    this.info.set(null);
    this.rois.set([]);
    this.selectedRoiId.set(null);
    this.rgbPoints.set([]);
    this.thermalPointsCsv.set([]);
    this.manualMatrix.set(null);
    this.autoMatrix.set(null);
    this.autoMethod.set(null);
    this.agreement.set(null);
    this.setCorrection(null);
    this.detectedHands.set(null);
    this.jointOverrides.set(new Map());
    this.selectedJointKey.set(null);
    this.rgbData.set(null);
    this.mode.set('auto');
    this.calibrating.set(false);
  }

  // --- Controls ------------------------------------------------------------

  /**
   * Enters the analyzer and runs the automatic silhouette alignment there, so
   * all alignment feedback (busy state, result, errors) belongs to the analyzer
   * screen rather than flashing on the upload screen.
   */
  protected async startAnalysis(): Promise<void> {
    if (!this.ready() || this.aligning()) {
      return;
    }
    this.analysisStarted.set(true);
    if (!this.autoMatrix() && !this.manualMatrix()) {
      await this.autoAlign();
    }
  }

  /** Back to the upload screen so the user can swap the source files. */
  protected newAnalysis(): void {
    this.analysisStarted.set(false);
    if (this.sequenceActive()) {
      this.uploadMode.set('sequence');
    }
  }

  // --- Temporal sequence -------------------------------------------------------

  protected setUploadMode(mode: 'single' | 'sequence'): void {
    this.uploadMode.set(mode);
  }

  /** Opens the processed sequence in the viewer, starting at the baseline. */
  protected async enterSequenceAnalysis(): Promise<void> {
    const captures = this.sequenceService.captures();
    if (captures.length === 0) {
      return;
    }
    const runId = this.sequenceService.processedRunId();
    if (this.sequenceActive() && this.loadedRunId === runId) {
      // Came back from the upload screen without importing: keep viewer state.
      this.analysisStarted.set(true);
      return;
    }
    // A different session was processed — nothing from the previous one may
    // survive in the viewer (its frame is still on the canvas at this point).
    this.loadedRunId = runId;
    this.sequenceActive.set(true);
    // Os arquivos avulsos retidos deixam de corresponder ao que está na tela. Se
    // ficassem, o fluxo de Análise Térmica gravaria medições da sequência casadas
    // com os arquivos da análise anterior.
    this.rgbFile.set(null);
    this.csvFile.set(null);
    this.jpegFile.set(null);
    this.viewerTab.set('image');
    this.rois.set([]);
    this.rgbPoints.set([]);
    this.thermalPointsCsv.set([]);
    this.calibrating.set(false);
    await this.activateCapture(0);
    this.analysisStarted.set(true);
    const issues = captures.filter((c) => c.issue !== null).length;
    this.info.set(
      `Sequência ${this.sequenceService.sessionLabel()} carregada: ${captures.length} captura(s), ` +
        `intervalo de ${this.sequenceService.intervalSeconds()} s. As ROIs articulares foram ` +
        `detectadas em cada captura. Use a linha do tempo para navegar.` +
        (issues > 0 ? ` ⚠ ${issues} captura(s) com problema.` : ''),
    );
  }

  /** Timeline/curve navigation: shows another capture in the viewer. */
  protected onCaptureIndexChange(index: number): void {
    if (this.sequenceActive() && index !== this.activeCaptureIndex()) {
      void this.activateCapture(index);
    }
  }

  /** Curve click → jump to the capture nearest to the clicked time. */
  protected onCurveTimeSelected(timeSeconds: number): void {
    const captures = this.sequenceService.captures();
    let best = 0;
    let bestDist = Infinity;
    captures.forEach((capture, i) => {
      const dist = Math.abs(capture.timeSeconds - timeSeconds);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    this.onCaptureIndexChange(best);
  }

  protected setViewerTab(tab: 'image' | 'curves'): void {
    this.viewerTab.set(tab);
  }

  protected toggleCurveJoint(landmarkId: number): void {
    this.curveJointIds.update((ids) =>
      ids.includes(landmarkId) ? ids.filter((id) => id !== landmarkId) : [...ids, landmarkId],
    );
  }

  protected setCurveStatistic(statistic: CurveStatistic): void {
    this.curveStatistic.set(statistic);
  }

  /**
   * Hidrata a página com uma análise **gravada**, em vez de arquivos recém-lidos.
   *
   * É o que faz a consulta reaberta ser esta mesma tela, e não uma cópia dela: o
   * alinhamento, as medições e os parâmetros vêm do banco, e `activateCapture`
   * cuida do resto sem saber a diferença.
   *
   * `hands` vem vazio de propósito — landmarks não são persistidos, e as ROIs
   * articulares já estão prontas em `restoredJoints`.
   */
  async restoreAnalysis(capturas: readonly SequenceCapture[]): Promise<void> {
    if (capturas.length === 0) {
      return;
    }
    this.sequenceService.reset();
    this.sequenceService.captures.set(capturas);
    this.uploadMode.set('sequence');
    this.restoredJoints.set(null);
    // `loadedRunId = null` força o caminho completo: capturas restauradas não
    // passaram pelo processamento, então `processedRunId` continua em zero e o
    // atalho de "mesma sessão já carregada" acharia que não há o que fazer.
    this.loadedRunId = null;
    // Delegar em vez de repetir: é este método que sabe abrir uma sequência no
    // visualizador, incluindo o que o player precisa. Reimplementar parte dele foi
    // o que quebrou a navegação entre capturas.
    await this.enterSequenceAnalysis();
  }

  /** Loads one capture's assets into the viewer signals (the "active frame"). */
  private async activateCapture(index: number): Promise<void> {
    const capture = this.sequenceService.captures()[index];
    if (!capture) {
      return;
    }
    this.activeCaptureIndex.set(index);
    let decoded;
    try {
      decoded = await this.sequenceService.decode(index);
    } catch {
      this.error.set(`Não foi possível decodificar a captura ${captureDisplayLabel(capture)}.`);
      return;
    }
    // The user may have stepped again while this frame was decoding.
    if (this.activeCaptureIndex() !== index) {
      return;
    }
    this.rgbImage.set(decoded.optical);
    this.jpegCanvas.set(decoded.thermal);
    this.matrix.set(capture.matrix.width > 0 ? capture.matrix : null);
    this.autoMatrix.set(capture.alignment);
    this.autoMethod.set(capture.autoMethod === 'manual' ? 'manual' : capture.autoMethod);
    this.agreement.set(capture.agreement);
    this.setCorrection(capture.correction);
    this.manualMatrix.set(null);
    this.mode.set('auto');
    this.detectedHands.set(capture.hands.length > 0 ? capture.hands : null);
    this.jointOverrides.set(new Map(capture.jointOverrides));
    this.selectedJointKey.set(null);
    this.selectedRoiId.set(null);
    this.rgbData.set(null); // the baked skin mask replaces live sampling
    this.error.set(capture.issue);
    this.sequenceService.prefetch(index);
  }

  /** Persists the active frame's joint adjustments into its capture record. */
  private syncCaptureOverrides(): void {
    if (this.sequenceActive()) {
      this.sequenceService.updateCapture(this.activeCaptureIndex(), {
        jointOverrides: new Map(this.jointOverrides()),
      });
    }
  }

  /** Persists a re-alignment of the active frame (mask rebuilt to match). */
  private syncCaptureAlignment(
    alignment: AffineMatrix,
    method: AutoMethod,
    pixels: ImageData | null,
    agreement: SilhouetteAgreement | null = null,
    correction: FiducialCorrection | null = null,
  ): void {
    if (!this.sequenceActive()) {
      return;
    }
    const capture = this.sequenceService.captures()[this.activeCaptureIndex()];
    const toRgb = invertAffine(alignment);
    const skinMask =
      pixels && toRgb && capture
        ? buildCsvSkinMask(pixels, capture.matrix.width, capture.matrix.height, toRgb)
        : (capture?.skinMask ?? null);
    this.sequenceService.updateCapture(this.activeCaptureIndex(), {
      alignment,
      autoMethod: method,
      skinMask,
      agreement,
      correction,
      issue: null,
    });
  }

  /** Swaps the active correction, collapsing any breakdown of the previous one. */
  private setCorrection(value: FiducialCorrection | null): void {
    this.correction.set(value);
    this.openInfo.set(null);
  }

  /** Opens one explanation at a time; clicking the open one closes it. */
  protected toggleInfo(which: 'overlap' | 'correction'): void {
    this.openInfo.update((open) => (open === which ? null : which));
  }

  protected closeInfo(): void {
    this.openInfo.set(null);
  }

  protected openHelp(): void {
    this.helpOpen.set(true);
  }

  protected closeHelp(): void {
    this.helpOpen.set(false);
  }

  /** Dismisses the success/status message banner (user control & freedom). */
  protected dismissInfo(): void {
    this.info.set(null);
  }

  /** Dismisses the error banner. */
  protected dismissError(): void {
    this.error.set(null);
  }

  protected onAlphaInput(event: Event): void {
    this.alphaPct.set(Number((event.target as HTMLInputElement).value));
  }

  protected setShape(shape: RoiShape): void {
    this.shape.set(shape);
  }

  protected clearRois(): void {
    this.rois.set([]);
    this.selectedRoiId.set(null);
  }

  protected selectRoi(id: number): void {
    this.selectedRoiId.set(id);
    this.selectedJointKey.set(null);
  }

  protected deleteRoi(id: number): void {
    this.rois.update((list) => list.filter((r) => r.id !== id));
    if (this.selectedRoiId() === id) {
      this.selectedRoiId.set(null);
    }
  }

  protected onJointSizeInput(event: Event): void {
    this.jointSizePct.set(Number((event.target as HTMLInputElement).value));
  }

  /** Toggles whether the articular ROIs measure only skin or the whole region. */
  protected toggleIgnoreBackground(): void {
    this.ignoreBackground.update((v) => !v);
  }

  /** Selects one joint ROI (from the table), clearing any manual ROI selection. */
  protected selectJoint(key: string | null): void {
    this.selectedJointKey.set(key);
    if (key !== null) {
      this.selectedRoiId.set(null);
    }
  }

  /**
   * Persists a canvas move/resize as a per-joint override. A move stores only
   * the new center (so the ROI keeps following the global size slider); a
   * resize stores the size in CSV cells (pinning it), each preserving the other
   * dimension's existing override.
   */
  protected onJointEdited(edit: OverlayJointEdit): void {
    const alignment = this.activeMatrix();
    if (!alignment) {
      return;
    }
    const scale = similarityScale(alignment);
    if (scale <= 0) {
      return;
    }
    this.jointOverrides.update((map) => {
      const next = new Map(map);
      const prev = next.get(edit.key) ?? {};
      next.set(
        edit.key,
        edit.kind === 'move'
          ? { ...prev, rgb: { x: edit.cx, y: edit.cy } }
          : { ...prev, rxCsv: edit.rx * scale, ryCsv: edit.ry * scale },
      );
      return next;
    });
    this.syncCaptureOverrides();
  }

  /** Resets one joint ROI back to its detected landmark position and default size. */
  protected resetJoint(key: string | null): void {
    if (key === null) {
      return;
    }
    this.jointOverrides.update((map) => {
      if (!map.has(key)) {
        return map;
      }
      const next = new Map(map);
      next.delete(key);
      return next;
    });
    this.syncCaptureOverrides();
  }

  /** Clears every manual joint adjustment, restoring the detected ROIs. */
  protected resetAllJoints(): void {
    this.jointOverrides.set(new Map());
    this.syncCaptureOverrides();
  }

  // --- Automatic alignment ---------------------------------------------------

  /**
   * Aligns RGB → thermal by silhouette registration: thousands of
   * correspondence points from the hand outlines, so no single feature can
   * skew the fit. On failure, the user falls back to manual calibration.
   */
  protected async autoAlign(): Promise<void> {
    const rgb = this.rgbImage();
    const matrix = this.matrix();
    if (!rgb || !matrix || this.aligning()) {
      return;
    }
    // Choosing/redoing the automatic method leaves the manual calibration view.
    this.calibrating.set(false);
    this.aligning.set(true);
    this.error.set(null);
    this.info.set(null);
    // The registration below is synchronous and blocks the main thread;
    // yield first so the busy indicator gets painted.
    await nextPaint();
    try {
      const pixels = imageToCanvas(rgb)
        .getContext('2d')
        ?.getImageData(0, 0, rgb.naturalWidth, rgb.naturalHeight);
      if (!pixels) {
        this.error.set('Não foi possível ler os pixels da imagem RGB.');
        return;
      }
      this.rgbData.set(pixels); // reused by the joint ROI skin test

      const registration = registerSilhouettes(pixels, matrix);
      const coarse = registration?.matrix ?? null;
      if (!coarse || !withinAutoScale(similarityScale(coarse))) {
        this.autoMatrix.set(null);
        this.agreement.set(null);
        this.setCorrection(null);
        this.error.set(
          'O alinhamento automático falhou (não foi possível segmentar as mãos nas duas ' +
            'imagens). Use a calibração manual.',
        );
        return;
      }

      // The blue tape markers give true interior correspondences (the manual
      // method's accuracy); silhouettes remain the fallback when absent.
      const fiducial = refineWithFiducials(pixels, matrix, coarse);
      const aligned = fiducial?.matrix ?? coarse;
      // Final nudge: cancel the parallax offset between the marker plane and
      // the hands so the thermal layer sits pixel-on-pixel over the photo.
      const fitted = polishTranslation(pixels, matrix, aligned) ?? aligned;
      const scale = similarityScale(fitted);

      // Evaluated on the final transform, not the coarse one it started from.
      const agreement = measureSilhouetteAgreement(pixels, matrix, fitted);

      const method = fiducial ? 'fiducial' : 'silhouette';
      this.autoMatrix.set(fitted);
      this.autoMethod.set(method);
      this.agreement.set(agreement);
      this.setCorrection(fiducial?.correction ?? null);
      this.mode.set('auto');
      this.syncCaptureAlignment(fitted, method, pixels, agreement, fiducial?.correction ?? null);
      this.info.set(this.describeAutoAlignment(scale, method));
    } finally {
      this.aligning.set(false);
    }
  }

  /**
   * The alignment message: which method solved it, and the recovered scale.
   * The overlap figure and the marker correction are deliberately not here —
   * both belong to the panel, where they persist, follow the active capture and
   * carry their own explanation. The alignment is also never described as
   * *quality*: the metric does not see every geometric error, and it carries no
   * threshold or color, since none is calibrated yet.
   */
  private describeAutoAlignment(scale: number, method: 'fiducial' | 'silhouette'): string {
    const scaleText = `escala ${scale.toFixed(2).replace('.', ',')}`;
    return method === 'fiducial'
      ? `Alinhamento automático pelos marcadores fiduciais (${scaleText}).`
      : `Alinhamento automático por silhuetas (${scaleText}).`;
  }

  // --- Automatic joint ROIs ----------------------------------------------------

  /** Detects the hand landmarks and captures the 22 body-map joint ROIs. */
  protected async detectJoints(): Promise<void> {
    const rgb = this.rgbImage();
    if (!rgb || !this.matrix() || this.loadingJoints()) {
      return;
    }
    this.loadingJoints.set(true);
    this.error.set(null);
    this.info.set(null);
    try {
      const hands = await this.handLandmarks.detect(rgb);
      if (hands.length === 0) {
        this.error.set('Nenhuma mão foi detectada na imagem RGB.');
        return;
      }
      // New landmarks invalidate any manual adjustments to the previous ROIs.
      this.jointOverrides.set(new Map());
      this.selectedJointKey.set(null);
      // Numa consulta reaberta, as medições gravadas têm precedência sobre os
      // landmarks — é o que faz a tela mostrar os números do dia. Uma detecção
      // pedida pelo médico é a exceção explícita: sem soltá-las, o botão rodaria
      // o detector e não mudaria nada na tela. Nada é regravado, então o registro
      // no banco continua intacto; quem quiser os números do dia recarrega.
      this.restoredJoints.set(null);
      if (this.sequenceActive()) {
        this.sequenceService.updateCapture(this.activeCaptureIndex(), {
          hands,
          jointOverrides: new Map(),
          restoredJoints: null,
        });
      }
      if (!this.rgbData()) {
        const pixels = imageToCanvas(rgb)
          .getContext('2d')
          ?.getImageData(0, 0, rgb.naturalWidth, rgb.naturalHeight);
        this.rgbData.set(pixels ?? null);
      }
      this.detectedHands.set(hands);
      const sides = hands.map((h) => h.side.toLowerCase()).join(' e ');
      this.info.set(
        `${hands.length === 2 ? 'Duas mãos' : 'Uma mão'} detectada(s) (${sides}): ` +
          `${hands.length * JOINT_ROI_DEFS.length} ROIs articulares capturadas. As temperaturas ` +
          'seguem o alinhamento ativo e recalculam se ele mudar.',
      );
    } catch {
      this.error.set(
        'Falha ao carregar o detector de articulações (MediaPipe). Verifique se os arquivos ' +
          'em /mediapipe estão publicados e recarregue a página.',
      );
    } finally {
      this.loadingJoints.set(false);
    }
  }

  // --- Manual calibration --------------------------------------------------

  protected toggleCalibration(): void {
    this.calibrating.update((v) => !v);
  }

  protected onRgbPointAdded(point: Point): void {
    this.rgbPoints.update((pts) => [...pts, point]);
  }

  protected onThermalPointAdded(point: Point): void {
    const display = this.thermalDisplay();
    if (!display) {
      return;
    }
    this.thermalPointsCsv.update((pts) => [
      ...pts,
      { x: point.x / display.csvScale, y: point.y / display.csvScale },
    ]);
  }

  /** Removes the unpaired point if counts differ, otherwise the last pair. */
  protected undoLastPoint(): void {
    const rgbCount = this.rgbPoints().length;
    const thermalCount = this.thermalPointsCsv().length;
    if (rgbCount > thermalCount) {
      this.rgbPoints.update(dropLast);
    } else if (thermalCount > rgbCount) {
      this.thermalPointsCsv.update(dropLast);
    } else {
      this.rgbPoints.update(dropLast);
      this.thermalPointsCsv.update(dropLast);
    }
  }

  protected clearPoints(): void {
    this.rgbPoints.set([]);
    this.thermalPointsCsv.set([]);
  }

  protected applyCalibration(): void {
    if (!this.canApplyCalibration()) {
      return;
    }
    this.info.set(null);
    // Thermal points are stored in CSV cells, so the fitted matrix is
    // RGB → CSV, same convention as the Python pipeline.
    const matrix = estimateSimilarityTransform([...this.rgbPoints()], [...this.thermalPointsCsv()]);
    if (!matrix) {
      this.error.set('Não foi possível calcular o alinhamento com os pontos informados.');
      return;
    }
    this.error.set(null);
    this.manualMatrix.set(matrix);
    this.mode.set('manual');
    this.calibrating.set(false);
    // The stored figures measured the transform this one replaces; the manual
    // path does not produce new ones, so the panel shows none.
    this.agreement.set(null);
    this.setCorrection(null);
    if (this.sequenceActive()) {
      // The frame's record (and its skin mask) must follow the new alignment
      // so the rewarming curve reads this capture with the corrected mapping.
      const rgb = this.rgbImage();
      this.syncCaptureAlignment(matrix, 'manual', rgb ? imageToPixels(rgb) : null);
    }
    this.info.set(
      `Calibração manual aplicada com ${this.pairedCount()} pares de pontos. ` +
        'As temperaturas passam a usar este alinhamento.',
    );
  }
}

// --- Helpers ----------------------------------------------------------------

/** Whether the dropped/selected file is a raster image (JPEG/PNG/…). */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Whether the file looks like a CSV (drag-and-drop bypasses the accept filter). */
function isCsvFile(file: File): boolean {
  return file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv');
}

/** Human-readable byte size, e.g. "812 KB" or "1,2 MB" (pt-BR decimal comma). */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Skin test backed by a capture's baked CSV-space mask. */
function maskSkinTest(
  mask: Uint8Array,
  width: number,
  height: number,
): (csvX: number, csvY: number) => boolean {
  return (csvX, csvY) => {
    const x = csvX | 0;
    const y = csvY | 0;
    return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  };
}

function formatCelsius(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2).replace('.', ',')} °C` : '—';
}

/** CSV-cell figure for the correction breakdown, at the precision it is checked in. */
function cells(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(2).replace('.', ',') : '—';
}

function dropLast<T>(items: readonly T[]): readonly T[] {
  return items.slice(0, -1);
}

/** Resolves after the browser has painted the current frame. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
