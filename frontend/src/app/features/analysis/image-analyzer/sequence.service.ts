/**
 * State store + pre-processing pipeline of a temporal capture sequence.
 *
 * Lifecycle: `idle` → (`inspect`) → `review` → (`process`) → `ready`. During
 * processing each complete capture runs the same pipeline the individual
 * analysis uses — silhouette registration, fiducial refinement, parallax
 * polish, hand landmarking — plus a baked CSV-space skin mask and a timeline
 * thumbnail. Only the light artifacts stay in memory (matrix, alignment,
 * landmarks, mask, thumbnail ≈ 2.7 MB per capture); full photos are decoded
 * on demand with a small LRU cache while navigating.
 *
 * Provided by the analyzer page (not root) so leaving the page frees the
 * ~55 MB a 21-capture sequence holds.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { invertAffine, similarityScale } from './alignment';
import { polishTranslation } from './alignment-polish';
import { measureSilhouetteAgreement, SilhouetteAgreement } from './alignment-quality';
import { imageToCanvas, imageToPixels, imageToThumbnail, loadImage } from './dom-images';
import { FiducialCorrection, refineWithFiducials } from './fiducial-markers';
import { HandLandmarksService } from './hand-landmarks.service';
import { buildCsvSkinMask } from './skin-mask';
import { groupSequenceFiles } from './sequence-files';
import {
  DEFAULT_CAPTURE_INTERVAL_SECONDS,
  ReviewCapture,
  SequenceCapture,
  SequenceReview,
  isCompleteCapture,
} from './sequence.model';
import { registerSilhouettes } from './silhouette-registration';
import { decodeThermalCsv, parseThermalCsv } from './thermal-csv';

export type SequenceStatus = 'idle' | 'review' | 'processing' | 'ready';

export interface SequenceProgress {
  readonly done: number;
  readonly total: number;
  readonly label: string;
}

/** Decoded display assets of one capture (LRU-cached). */
export interface DecodedCapture {
  readonly optical: HTMLImageElement;
  readonly thermal: HTMLCanvasElement;
}

/** Fitted RGB→CSV scale sanity range (same as the individual analysis). */
const AUTO_SCALE_MIN = 0.3;
const AUTO_SCALE_MAX = 0.8;
/** Timeline thumbnail width in px. */
const THUMBNAIL_WIDTH = 96;
/** How many decoded captures stay cached while navigating. */
const DECODE_CACHE_SIZE = 6;

@Injectable()
export class SequenceService {
  private readonly handLandmarks = inject(HandLandmarksService);

  readonly status = signal<SequenceStatus>('idle');
  /** Groups found in the last inspected batch (one per subject/trial). */
  readonly reviews = signal<readonly SequenceReview[]>([]);
  readonly selectedReviewIndex = signal(0);
  readonly intervalSeconds = signal(DEFAULT_CAPTURE_INTERVAL_SECONDS);
  readonly progress = signal<SequenceProgress | null>(null);
  readonly captures = signal<readonly SequenceCapture[]>([]);
  /**
   * Bumped every time `captures` is replaced by a freshly processed batch —
   * never by `updateCapture`. Lets the viewer tell "the user came back from the
   * upload screen" from "another session was imported and processed", which
   * array identity cannot (per-capture edits also produce a new array).
   */
  readonly processedRunId = signal(0);
  readonly error = signal<string | null>(null);

  readonly selectedReview = computed<SequenceReview | null>(
    () => this.reviews()[this.selectedReviewIndex()] ?? null,
  );
  readonly sessionLabel = computed(() => {
    const review = this.selectedReview();
    return review ? `${review.subject}_${review.trial}` : '';
  });

  private cancelRequested = false;
  private readonly decodeCache = new Map<number, DecodedCapture>();
  private readonly decoding = new Map<number, Promise<DecodedCapture>>();
  /** Every file inspected so far, by name (newer selection replaces older). */
  private readonly inspectedFiles = new Map<string, File>();

  /**
   * Groups a dropped/browsed batch and enters the review step. With `append`,
   * the new files join the ones already inspected, so the optical images,
   * thermal images and matrices can be picked in independent selections (a
   * file with the same name replaces the previous one).
   */
  inspect(files: readonly File[], append = false): void {
    this.clearDerivedState();
    if (!append) {
      this.inspectedFiles.clear();
    }
    for (const file of files) {
      if (!file.name.startsWith('.')) {
        this.inspectedFiles.set(file.name, file);
      }
    }
    // Partial selections are fine (e.g. only the optical images): the review
    // opens showing what is still missing and more files can be added there.
    // Only "Processar" requires at least one complete triplet.
    const reviews = groupSequenceFiles([...this.inspectedFiles.values()]).filter(
      (r) => r.captures.length > 0,
    );
    if (reviews.length === 0) {
      this.error.set(
        'Nenhuma captura reconhecida. Selecione a pasta da sessão (ex.: V051) ou arquivos com o ' +
          'padrão do protocolo: imagens ópticas (_DAR), térmicas (_IR) e matrizes CSV.',
      );
      return;
    }
    // Largest session first (the dropped folder's own data).
    const sorted = [...reviews].sort((a, b) => b.captures.length - a.captures.length);
    this.reviews.set(sorted);
    this.selectedReviewIndex.set(0);
    this.status.set('review');
  }

  selectReview(index: number): void {
    if (index >= 0 && index < this.reviews().length) {
      this.selectedReviewIndex.set(index);
    }
  }

  setIntervalSeconds(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) {
      this.intervalSeconds.set(seconds);
    }
  }

  /** Runs the per-capture pipeline over the selected review. */
  async process(): Promise<void> {
    const review = this.selectedReview();
    if (!review || this.status() === 'processing') {
      return;
    }
    const pending = review.captures.filter(isCompleteCapture);
    this.status.set('processing');
    this.error.set(null);
    this.cancelRequested = false;
    const interval = this.intervalSeconds();
    const results: SequenceCapture[] = [];

    for (let i = 0; i < pending.length; i++) {
      if (this.cancelRequested) {
        this.progress.set(null);
        this.status.set('review');
        return;
      }
      const capture = pending[i];
      this.progress.set({
        done: i,
        total: pending.length,
        label: capture.label,
      });
      // Yield so the progress bar paints before the synchronous registration.
      await nextTask();
      try {
        results.push(await this.processCapture(capture, interval));
      } catch (err) {
        results.push(
          this.failedCapture(capture, interval, err instanceof Error ? err.message : 'Falha ao processar.'),
        );
      }
    }

    this.progress.set(null);
    this.captures.set(results);
    this.processedRunId.update((id) => id + 1);
    this.status.set('ready');
  }

  cancel(): void {
    this.cancelRequested = true;
  }

  /** Frees every capture and returns to the idle import state. */
  reset(): void {
    this.clearDerivedState();
    this.inspectedFiles.clear();
  }

  /** Clears everything derived from the inspected files (keeps them + interval). */
  private clearDerivedState(): void {
    this.cancelRequested = true;
    this.status.set('idle');
    this.reviews.set([]);
    this.selectedReviewIndex.set(0);
    this.progress.set(null);
    this.captures.set([]);
    this.error.set(null);
    this.decodeCache.clear();
    this.decoding.clear();
  }

  /** Immutably patches one capture (joint overrides, re-alignment…). */
  updateCapture(index: number, patch: Partial<SequenceCapture>): void {
    this.captures.update((list) => {
      if (index < 0 || index >= list.length) {
        return list;
      }
      const copy = list.slice();
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  }

  /** Decoded display assets of a capture, LRU-cached for smooth stepping. */
  decode(index: number): Promise<DecodedCapture> {
    const cached = this.decodeCache.get(index);
    if (cached) {
      // Refresh LRU position.
      this.decodeCache.delete(index);
      this.decodeCache.set(index, cached);
      return Promise.resolve(cached);
    }
    const inFlight = this.decoding.get(index);
    if (inFlight) {
      return inFlight;
    }
    const capture = this.captures()[index];
    if (!capture) {
      return Promise.reject(new Error(`Captura ${index} inexistente.`));
    }
    const promise = (async () => {
      const [optical, thermalImg] = await Promise.all([
        loadImage(capture.optical),
        loadImage(capture.thermal),
      ]);
      const decoded: DecodedCapture = { optical, thermal: imageToCanvas(thermalImg) };
      this.decodeCache.set(index, decoded);
      while (this.decodeCache.size > DECODE_CACHE_SIZE) {
        const oldest = this.decodeCache.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        this.decodeCache.delete(oldest);
      }
      return decoded;
    })();
    this.decoding.set(index, promise);
    void promise.finally(() => this.decoding.delete(index));
    return promise;
  }

  /** Fire-and-forget decode of the neighbors, for instant stepping. */
  prefetch(index: number): void {
    for (const i of [index - 1, index + 1]) {
      if (i >= 0 && i < this.captures().length && !this.decodeCache.has(i)) {
        void this.decode(i).catch(() => undefined);
      }
    }
  }

  // --- Pipeline ---------------------------------------------------------------

  private async processCapture(capture: ReviewCapture, interval: number): Promise<SequenceCapture> {
    const optical = capture.optical!;
    const thermal = capture.thermal!;
    const matrixFile = capture.matrix!;

    const [opticalImg, thermalImg, csvBuffer] = await Promise.all([
      loadImage(optical),
      loadImage(thermal),
      matrixFile.arrayBuffer(),
    ]);
    const matrix = parseThermalCsv(decodeThermalCsv(csvBuffer));
    const pixels = imageToPixels(opticalImg);
    if (!pixels) {
      throw new Error('Não foi possível ler os pixels da imagem óptica.');
    }

    // Same alignment cascade as the individual analysis.
    const registration = registerSilhouettes(pixels, matrix);
    let alignment = registration?.matrix ?? null;
    let autoMethod: SequenceCapture['autoMethod'] = null;
    let agreement: SilhouetteAgreement | null = null;
    let correction: FiducialCorrection | null = null;
    let issue: string | null = null;
    if (alignment && withinAutoScale(similarityScale(alignment))) {
      const fiducial = refineWithFiducials(pixels, matrix, alignment);
      const aligned = fiducial?.matrix ?? alignment;
      alignment = polishTranslation(pixels, matrix, aligned) ?? aligned;
      autoMethod = fiducial ? 'fiducial' : 'silhouette';
      correction = fiducial?.correction ?? null;
      agreement = measureSilhouetteAgreement(pixels, matrix, alignment);
    } else {
      alignment = null;
      issue = 'Alinhamento automático falhou nesta captura.';
    }

    const hands = await this.handLandmarks.detect(opticalImg);
    if (hands.length === 0) {
      issue = issue ?? 'Nenhuma mão detectada nesta captura.';
    }

    const toRgb = alignment ? invertAffine(alignment) : null;
    const skinMask = toRgb ? buildCsvSkinMask(pixels, matrix.width, matrix.height, toRgb) : null;

    return {
      kind: capture.kind,
      index: capture.index,
      label: capture.label,
      timeSeconds: capture.kind === 'baseline' ? 0 : capture.index * interval,
      optical,
      thermal,
      matrixFile,
      matrix,
      alignment,
      autoMethod,
      agreement,
      correction,
      hands,
      skinMask,
      thumbnail: imageToThumbnail(thermalImg, THUMBNAIL_WIDTH),
      jointOverrides: new Map(),
      issue,
    };
  }

  private failedCapture(capture: ReviewCapture, interval: number, message: string): SequenceCapture {
    return {
      kind: capture.kind,
      index: capture.index,
      label: capture.label,
      timeSeconds: capture.kind === 'baseline' ? 0 : capture.index * interval,
      optical: capture.optical!,
      thermal: capture.thermal!,
      matrixFile: capture.matrix!,
      matrix: { width: 0, height: 0, values: new Float64Array(0) },
      alignment: null,
      autoMethod: null,
      agreement: null,
      correction: null,
      hands: [],
      skinMask: null,
      thumbnail: '',
      jointOverrides: new Map(),
      issue: message,
    };
  }
}

function withinAutoScale(scale: number): boolean {
  return scale >= AUTO_SCALE_MIN && scale <= AUTO_SCALE_MAX;
}

/** Yields to the event loop so pending paints run between heavy frames. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
