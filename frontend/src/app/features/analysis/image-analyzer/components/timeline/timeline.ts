import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { LucideDynamicIcon } from '@lucide/angular';

import { captureDisplayLabel, formatSeconds } from '../../sequence.model';

/** The slice of a capture the timeline renders. */
export interface TimelineCapture {
  readonly kind: 'baseline' | 'dynamic';
  readonly index: number;
  readonly timeSeconds: number;
  readonly thumbnail: string;
  readonly issue: string | null;
}

/** Milliseconds per frame at 1× playback. */
const BASE_FRAME_MS = 600;

/**
 * Sequence navigation: thermal filmstrip (baseline pinned first), a scrubbing
 * slider and play/pause with speed control. `activeIndex` is two-way bound;
 * ←/→ step frame-by-frame when the strip is focused. Playback stops at the
 * last frame or on any manual navigation.
 */
@Component({
  selector: 'app-timeline',
  imports: [LucideDynamicIcon],
  templateUrl: './timeline.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Timeline {
  readonly captures = input.required<readonly TimelineCapture[]>();
  readonly activeIndex = model(0);

  protected readonly playing = signal(false);
  protected readonly speed = signal(1);
  protected readonly speeds = [1, 2, 4];
  protected readonly displayLabel = captureDisplayLabel;

  protected readonly formatSeconds = formatSeconds;

  protected readonly active = computed(() => this.captures()[this.activeIndex()] ?? null);

  /**
   * Tooltip da miniatura. A basal não recebe `t =`: ela é anterior ao
   * resfriamento, e o eixo de tempo começa na primeira dinâmica — anunciar
   * "t = 0:00" aqui contradiria a curva, que não a desenha.
   */
  protected captureTitle(cap: TimelineCapture): string {
    const quando =
      cap.kind === 'baseline' ? 'antes do resfriamento' : `t = ${formatSeconds(cap.timeSeconds)}`;
    return `${captureDisplayLabel(cap)} · ${quando}${cap.issue ? ` · ⚠ ${cap.issue}` : ''}`;
  }


  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected select(index: number): void {
    this.stop();
    if (index >= 0 && index < this.captures().length) {
      this.activeIndex.set(index);
    }
  }

  protected onSliderInput(event: Event): void {
    this.select(Number((event.target as HTMLInputElement).value));
  }

  protected step(delta: number): void {
    this.select(this.activeIndex() + delta);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      this.step(-1);
      event.preventDefault();
    } else if (event.key === 'ArrowRight') {
      this.step(1);
      event.preventDefault();
    } else if (event.key === ' ') {
      this.togglePlay();
      event.preventDefault();
    }
  }

  protected togglePlay(): void {
    if (this.playing()) {
      this.stop();
      return;
    }
    // Restart from the beginning when already at the end.
    if (this.activeIndex() >= this.captures().length - 1) {
      this.activeIndex.set(0);
    }
    this.playing.set(true);
    this.schedule();
  }

  protected setSpeed(speed: number): void {
    this.speed.set(speed);
    if (this.playing()) {
      this.schedule(); // apply immediately
    }
  }

  private schedule(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      const next = this.activeIndex() + 1;
      if (next >= this.captures().length) {
        this.stop();
        return;
      }
      this.activeIndex.set(next);
    }, BASE_FRAME_MS / this.speed());
  }

  private stop(): void {
    this.playing.set(false);
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
