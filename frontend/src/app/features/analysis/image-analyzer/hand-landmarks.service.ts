import { Injectable } from '@angular/core';

import { DetectedHand, HandSide, Point } from './image-analyzer.model';

type HandLandmarker = import('@mediapipe/tasks-vision').HandLandmarker;

/**
 * Which hand is which, decided by where each one sits in the frame.
 *
 * **Not by MediaPipe's handedness classifier**, which was the previous rule and
 * is a probability: on session V054 it scored the left-of-frame hand between
 * 0.51 and 0.81, so the label flipped from capture to capture, and on three of
 * the 21 it labelled *both* hands the same. That collapse is not a harmless
 * mislabel — `captureJointRois` keys ROIs by side, so one side goes missing
 * (a hole in the curve) while the other silently takes whichever hand came
 * first in MediaPipe's array. A wrong temperature drawn as if it were right.
 *
 * The rig is fixed: the camera faces the volunteer, so the hand on the left of
 * the frame is their **right** hand. Position is exact where the classifier was
 * a coin flip near 0.5 — across V054 and V031 (42 captures) this rule matches
 * the classifier on all 39 it decided confidently, and resolves the 3 it broke.
 *
 * With a single hand detected there is nothing to order against, so the frame's
 * midpoint decides; the hands sit at x ≈ 0.13 and x ≈ 0.86 of the width, which
 * leaves the margin enormous.
 *
 * Takes the at most two hands `numHands: 2` allows. Naming a third would have to
 * repeat a side, which is the very failure this replaced.
 */
export function sidesByPosition(
  wristXs: readonly number[],
  imageWidth: number,
): HandSide[] {
  if (wristXs.length === 1) {
    return [wristXs[0] < imageWidth / 2 ? 'Direita' : 'Esquerda'];
  }
  const byX = wristXs.map((_, i) => i).sort((a, b) => wristXs[a] - wristXs[b]);
  const sides: HandSide[] = [];
  byX.forEach((index, rank) => {
    sides[index] = rank === 0 ? 'Direita' : 'Esquerda';
  });
  return sides;
}

/**
 * Thin wrapper around MediaPipe's HandLandmarker (the same model used by
 * `scripts/core.py`, via `@mediapipe/tasks-vision` on the web). The wasm
 * runtime and the model are self-hosted under `public/mediapipe/` so the
 * feature works offline; both load lazily on first use (~19 MB total).
 */
@Injectable({ providedIn: 'root' })
export class HandLandmarksService {
  private landmarker: HandLandmarker | null = null;
  private loading: Promise<HandLandmarker> | null = null;

  /** Detects up to two hands; landmark coords are returned in RGB pixels. */
  async detect(image: HTMLImageElement): Promise<DetectedHand[]> {
    const landmarker = await this.ensureLandmarker();
    const result = landmarker.detect(image);
    const width = image.naturalWidth;
    const height = image.naturalHeight;

    const hands = result.landmarks.map((landmarks) =>
      landmarks.map((p): Point => ({ x: p.x * width, y: p.y * height })),
    );
    // Landmark 0 is the wrist. `handednesses` is deliberately unused — see
    // `sidesByPosition`.
    const sides = sidesByPosition(
      hands.map((landmarks) => landmarks[0]?.x ?? 0),
      width,
    );
    return hands.map((landmarks, i) => ({ side: sides[i], landmarks }));
  }

  private ensureLandmarker(): Promise<HandLandmarker> {
    if (this.landmarker) {
      return Promise.resolve(this.landmarker);
    }
    this.loading ??= (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task' },
        runningMode: 'IMAGE',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
      });
      return this.landmarker;
    })();
    return this.loading;
  }
}
