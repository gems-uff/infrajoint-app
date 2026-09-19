import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

import { Point } from '../../image-analyzer.model';

/**
 * Image panel for manual marker calibration: click to add numbered reference
 * points (in native image coordinates). Equivalent of the verifier's
 * `_ClickPointLabel`; undo/clear live in the parent so both panels stay in
 * sync.
 */
@Component({
  selector: 'app-marker-picker',
  templateUrl: './marker-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerPicker {
  readonly image = input.required<CanvasImageSource>();
  readonly imageWidth = input.required<number>();
  readonly imageHeight = input.required<number>();
  /** Points already picked, in native image coordinates. */
  readonly points = input<readonly Point[]>([]);
  /** Crosshair color. */
  readonly color = input('#22c55e');

  readonly pointAdded = output<Point>();

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    effect(() => this.render());
  }

  protected onClick(ev: MouseEvent): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    this.pointAdded.emit({
      x: ((ev.clientX - rect.left) * canvas.width) / rect.width,
      y: ((ev.clientY - rect.top) * canvas.height) / rect.height,
    });
  }

  private render(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return;
    }
    const width = this.imageWidth();
    const height = this.imageHeight();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx || width === 0 || height === 0) {
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.image(), 0, 0);

    const unit = Math.max(6, width / 110);
    ctx.strokeStyle = this.color();
    ctx.fillStyle = this.color();
    ctx.lineWidth = Math.max(2, unit / 4);
    ctx.font = `bold ${Math.round(unit * 2)}px sans-serif`;

    this.points().forEach((p, i) => {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, unit, unit, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - unit * 1.6, p.y);
      ctx.lineTo(p.x + unit * 1.6, p.y);
      ctx.moveTo(p.x, p.y - unit * 1.6);
      ctx.lineTo(p.x, p.y + unit * 1.6);
      ctx.stroke();
      ctx.fillText(String(i + 1), p.x + unit * 1.4, p.y - unit * 1.4);
    });
  }
}
