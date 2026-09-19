import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';

import {
  AffineMatrix,
  OverlayJointEdit,
  OverlayJointRoi,
  Point,
  RoiSelection,
  RoiShape,
} from '../../image-analyzer.model';

/** Minimum radius (in RGB px) below which a drag is discarded as a stray click. */
const MIN_ROI_RADIUS_PX = 3;

/** The geometry shared by manual ROIs and joint ROIs — all the editing math needs. */
interface Ellipse {
  readonly shape: RoiShape;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/** Which editable layer (and item) a drag is acting on. */
type DragTarget = { readonly layer: 'roi'; readonly id: number } | { readonly layer: 'joint'; readonly key: string };

type DragState =
  | { readonly kind: 'draw' }
  | { readonly kind: 'move'; readonly target: DragTarget; readonly offsetX: number; readonly offsetY: number }
  | {
      readonly kind: 'resize';
      readonly target: DragTarget;
      readonly base: Ellipse;
      readonly startX: number;
      readonly startY: number;
    };

/**
 * RGB photo with the thermal image warped on top (per the active alignment)
 * and interactive editing of two ROI layers:
 *
 * - **Manual ROIs** (green): drag on empty space to draw a new circle/ellipse,
 *   click to select, drag the body/center handle to move, the corner handle to
 *   resize; arrow keys nudge, +/− resize, Delete removes.
 * - **Joint ROIs** (per-side color): the automatic MediaPipe joints, drawn on
 *   the layer below. They can be selected and moved/resized the same way, but
 *   never created or deleted — Delete resets the joint to its detected default.
 *   Edits are emitted to the parent, which owns the per-joint overrides.
 *
 * Grab handles are a fixed screen size so even tiny ROIs stay easy to edit.
 * Equivalent of the verifier's `OverlayLabel` + `build_overlay`.
 */
@Component({
  selector: 'app-overlay-canvas',
  templateUrl: './overlay-canvas.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverlayCanvas {
  /** Visual photo, drawn at native resolution. */
  readonly rgb = input.required<HTMLImageElement>();
  /** Thermal display image (camera JPEG or colormap-rendered CSV). */
  readonly thermal = input<HTMLCanvasElement | null>(null);
  /** Affine mapping thermal-display pixels → RGB pixels. */
  readonly thermalToRgb = input<AffineMatrix | null>(null);
  /** Thermal blend opacity, 0–1. */
  readonly alpha = input(0.5);
  readonly shape = input<RoiShape>('circle');
  /** Confirmed manual ROIs in RGB pixel coordinates. */
  readonly rois = model<readonly RoiSelection[]>([]);
  /** Id of the manual ROI currently selected for editing, if any. */
  readonly selectedId = model<number | null>(null);

  /** Automatic joint ROIs (RGB px), interactive but owned by the parent. */
  readonly jointRois = input<readonly OverlayJointRoi[]>([]);
  /** Key of the joint ROI currently selected for editing, if any. */
  readonly selectedJointKey = model<string | null>(null);
  /** A committed joint move/resize (the parent updates its overrides). */
  readonly jointEdited = output<OverlayJointEdit>();
  /** A request to reset one joint back to its detected default. */
  readonly jointReset = output<string>();

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  /** Manual ROI being dragged, previewed live before it is committed to the list. */
  private readonly draft = signal<RoiSelection | null>(null);
  /** Joint ROI being dragged, previewed live before the edit is emitted. */
  private readonly jointDraft = signal<OverlayJointRoi | null>(null);
  private drag: DragState | null = null;

  protected readonly cursor = signal('crosshair');

  constructor() {
    effect(() => this.render());
  }

  protected onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) {
      return;
    }
    const p = this.toCanvasPoint(ev);
    if (!p) {
      return;
    }
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    this.canvasRef()?.nativeElement.focus();

    // A selected ROI's handles win, so its grab points stay reachable even when
    // they sit outside the shape. Only one layer can be selected at a time.
    const selRoi = this.selectedRoi();
    if (selRoi && this.startHandleDrag(selRoi, { layer: 'roi', id: selRoi.id }, p)) {
      this.draft.set(selRoi);
      return;
    }
    const selJoint = this.selectedJoint();
    if (selJoint && this.startHandleDrag(selJoint, { layer: 'joint', key: selJoint.key }, p)) {
      this.jointDraft.set(selJoint);
      return;
    }

    // Clicking inside an ROI selects it and starts a move — manual ROIs sit on
    // top of the joint layer, so they are hit-tested first.
    const roiHit = this.roiAt(p);
    if (roiHit) {
      this.selectRoi(roiHit.id);
      this.drag = { kind: 'move', target: { layer: 'roi', id: roiHit.id }, offsetX: roiHit.cx - p.x, offsetY: roiHit.cy - p.y };
      this.draft.set(roiHit);
      return;
    }
    const jointHit = this.jointAt(p);
    if (jointHit) {
      this.selectJoint(jointHit.key);
      this.drag = { kind: 'move', target: { layer: 'joint', key: jointHit.key }, offsetX: jointHit.cx - p.x, offsetY: jointHit.cy - p.y };
      this.jointDraft.set(jointHit);
      return;
    }

    // Empty space: start a brand-new manual ROI (joints are never created).
    const roi: RoiSelection = {
      id: this.nextId(),
      shape: this.shape(),
      cx: p.x,
      cy: p.y,
      rx: 0,
      ry: 0,
    };
    this.selectRoi(roi.id);
    this.drag = { kind: 'draw' };
    this.draft.set(roi);
  }

  protected onPointerMove(ev: PointerEvent): void {
    const p = this.toCanvasPoint(ev);
    if (!p) {
      return;
    }
    const drag = this.drag;
    if (!drag) {
      this.updateHoverCursor(p);
      return;
    }
    if (this.dragLayer(drag) === 'joint') {
      const live = this.jointDraft();
      if (live) {
        this.jointDraft.set({ ...live, ...this.resolveDrag(drag, live, p) });
      }
      return;
    }
    const live = this.draft();
    if (live) {
      this.draft.set({ ...live, ...this.resolveDrag(drag, live, p) });
    }
  }

  protected onPointerUp(ev: PointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    this.drag = null;
    const p = this.toCanvasPoint(ev);

    if (this.dragLayer(drag) === 'joint') {
      const live = this.jointDraft();
      if (live) {
        const finished = { ...live, ...(p ? this.resolveDrag(drag, live, p) : {}) };
        this.jointEdited.emit({
          key: finished.key,
          kind: drag.kind === 'resize' ? 'resize' : 'move',
          cx: finished.cx,
          cy: finished.cy,
          rx: finished.rx,
          ry: finished.ry,
        });
      }
      this.jointDraft.set(null);
      return;
    }

    const draft = this.draft();
    if (!draft) {
      return;
    }
    const finished = { ...draft, ...(p ? this.resolveDrag(drag, draft, p) : {}) };
    this.draft.set(null);
    if (drag.kind === 'draw' && Math.max(finished.rx, finished.ry) < MIN_ROI_RADIUS_PX) {
      // A stray click, not a drag: discard the nascent ROI.
      if (this.selectedId() === finished.id) {
        this.selectedId.set(null);
      }
      return;
    }
    this.commit(finished);
  }

  protected onPointerCancel(): void {
    this.drag = null;
    this.draft.set(null);
    this.jointDraft.set(null);
  }

  /** Arrow keys nudge, +/− resize; Delete removes a manual ROI / resets a joint. */
  protected onKeyDown(ev: KeyboardEvent): void {
    const selRoi = this.selectedRoi();
    if (selRoi) {
      this.onKeyDownRoi(ev, selRoi);
      return;
    }
    const selJoint = this.selectedJoint();
    if (selJoint) {
      this.onKeyDownJoint(ev, selJoint);
    }
  }

  private onKeyDownRoi(ev: KeyboardEvent, sel: RoiSelection): void {
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      this.rois.update((list) => list.filter((r) => r.id !== sel.id));
      this.selectedId.set(null);
      ev.preventDefault();
      return;
    }
    const next = this.nudge(sel, ev);
    if (next) {
      ev.preventDefault();
      this.commit({ ...sel, ...next });
    }
  }

  private onKeyDownJoint(ev: KeyboardEvent, sel: OverlayJointRoi): void {
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      this.jointReset.emit(sel.key);
      this.selectedJointKey.set(null);
      ev.preventDefault();
      return;
    }
    const next = this.nudge(sel, ev);
    if (next) {
      ev.preventDefault();
      this.jointEdited.emit({
        key: sel.key,
        kind: next.rx !== undefined ? 'resize' : 'move',
        cx: next.cx ?? sel.cx,
        cy: next.cy ?? sel.cy,
        rx: next.rx ?? sel.rx,
        ry: next.ry ?? sel.ry,
      });
    }
  }

  /** Keyboard move/resize deltas for an ellipse, or null for an unhandled key. */
  private nudge(e: Ellipse, ev: KeyboardEvent): Partial<Ellipse> | null {
    const step = ev.shiftKey ? 10 : 1;
    switch (ev.key) {
      case 'ArrowUp':
        return { cy: e.cy - step };
      case 'ArrowDown':
        return { cy: e.cy + step };
      case 'ArrowLeft':
        return { cx: e.cx - step };
      case 'ArrowRight':
        return { cx: e.cx + step };
      case '+':
      case '=':
        return { rx: e.rx + step, ry: e.ry + step };
      case '-':
      case '_':
        return { rx: Math.max(MIN_ROI_RADIUS_PX, e.rx - step), ry: Math.max(MIN_ROI_RADIUS_PX, e.ry - step) };
      default:
        return null;
    }
  }

  private commit(roi: RoiSelection): void {
    this.rois.update((list) => {
      const i = list.findIndex((r) => r.id === roi.id);
      if (i < 0) {
        return [...list, roi];
      }
      const copy = list.slice();
      copy[i] = roi;
      return copy;
    });
  }

  /** Starts a handle drag if the pointer grabbed one; false otherwise. */
  private startHandleDrag(e: Ellipse, target: DragTarget, p: Point): boolean {
    const handle = this.handleHit(e, p);
    if (handle === 'resize') {
      this.drag = { kind: 'resize', target, base: e, startX: p.x, startY: p.y };
      return true;
    }
    if (handle === 'move') {
      this.drag = { kind: 'move', target, offsetX: e.cx - p.x, offsetY: e.cy - p.y };
      return true;
    }
    return false;
  }

  private dragLayer(drag: DragState): 'roi' | 'joint' {
    return drag.kind === 'draw' ? 'roi' : drag.target.layer;
  }

  /** New cx/cy/rx/ry for the dragged ellipse under pointer `p`. */
  private resolveDrag(drag: DragState, live: Ellipse, p: Point): Pick<Ellipse, 'cx' | 'cy' | 'rx' | 'ry'> {
    if (drag.kind === 'move') {
      return { cx: p.x + drag.offsetX, cy: p.y + drag.offsetY, rx: live.rx, ry: live.ry };
    }
    if (drag.kind === 'resize') {
      // Resize by the pointer's displacement since grab, so there is no jump
      // even on tiny ROIs whose corner handle sits far from the true edge.
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      if (live.shape === 'circle') {
        const r = Math.max(MIN_ROI_RADIUS_PX, drag.base.rx + (dx + dy) / 2);
        return { cx: live.cx, cy: live.cy, rx: r, ry: r };
      }
      return {
        cx: live.cx,
        cy: live.cy,
        rx: Math.max(MIN_ROI_RADIUS_PX, drag.base.rx + dx),
        ry: Math.max(MIN_ROI_RADIUS_PX, drag.base.ry + dy),
      };
    }
    // draw: radius grows from the fixed center out to the pointer.
    const dx = p.x - live.cx;
    const dy = p.y - live.cy;
    if (live.shape === 'circle') {
      const r = Math.hypot(dx, dy);
      return { cx: live.cx, cy: live.cy, rx: r, ry: r };
    }
    return { cx: live.cx, cy: live.cy, rx: Math.abs(dx), ry: Math.abs(dy) };
  }

  private selectRoi(id: number): void {
    this.selectedId.set(id);
    this.selectedJointKey.set(null);
  }

  private selectJoint(key: string): void {
    this.selectedJointKey.set(key);
    this.selectedId.set(null);
  }

  private selectedRoi(): RoiSelection | null {
    const id = this.selectedId();
    return id === null ? null : (this.rois().find((r) => r.id === id) ?? null);
  }

  private selectedJoint(): OverlayJointRoi | null {
    const key = this.selectedJointKey();
    return key === null ? null : (this.jointRois().find((j) => j.key === key) ?? null);
  }

  private nextId(): number {
    return this.rois().reduce((m, r) => Math.max(m, r.id), 0) + 1;
  }

  private roiAt(p: Point): RoiSelection | null {
    const list = this.rois();
    for (let i = list.length - 1; i >= 0; i--) {
      if (this.isInside(list[i], p)) {
        return list[i];
      }
    }
    return null;
  }

  private jointAt(p: Point): OverlayJointRoi | null {
    const list = this.jointRois();
    for (let i = list.length - 1; i >= 0; i--) {
      if (this.isInside(list[i], p)) {
        return list[i];
      }
    }
    return null;
  }

  private isInside(e: Ellipse, p: Point): boolean {
    const rx = Math.max(e.rx, 1e-6);
    const ry = Math.max(e.ry, 1e-6);
    return Math.hypot((p.x - e.cx) / rx, (p.y - e.cy) / ry) <= 1;
  }

  private scale(): number {
    return (this.canvasRef()?.nativeElement.width ?? 1280) / 1280;
  }

  /** Grab radius (canvas px) of the move/resize handles — fixed on screen. */
  private handleRadius(): number {
    return Math.max(7, 9 * this.scale());
  }

  /** Corner handle position, pushed just outside the ellipse so it is grabbable. */
  private resizeHandlePos(e: Ellipse): Point {
    const pad = 10 * this.scale();
    return { x: e.cx + e.rx + pad, y: e.cy + e.ry + pad };
  }

  private handleHit(e: Ellipse, p: Point): 'resize' | 'move' | null {
    const r = this.handleRadius();
    const rh = this.resizeHandlePos(e);
    if (Math.hypot(p.x - rh.x, p.y - rh.y) <= r) {
      return 'resize';
    }
    if (Math.hypot(p.x - e.cx, p.y - e.cy) <= r) {
      return 'move';
    }
    return null;
  }

  private updateHoverCursor(p: Point): void {
    const sel = this.selectedRoi() ?? this.selectedJoint();
    if (sel) {
      const handle = this.handleHit(sel, p);
      if (handle === 'resize') {
        this.cursor.set('nwse-resize');
        return;
      }
      if (handle === 'move' || this.isInside(sel, p)) {
        this.cursor.set('move');
        return;
      }
    }
    this.cursor.set(this.roiAt(p) || this.jointAt(p) ? 'move' : 'crosshair');
  }

  private toCanvasPoint(ev: PointerEvent): Point | null {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      x: ((ev.clientX - rect.left) * canvas.width) / rect.width,
      y: ((ev.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  private render(): void {
    const canvas = this.canvasRef()?.nativeElement;
    const rgb = this.rgb();
    if (!canvas || !rgb.naturalWidth) {
      return;
    }
    if (canvas.width !== rgb.naturalWidth || canvas.height !== rgb.naturalHeight) {
      canvas.width = rgb.naturalWidth;
      canvas.height = rgb.naturalHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rgb, 0, 0);

    const thermal = this.thermal();
    const m = this.thermalToRgb();
    if (thermal && m) {
      ctx.save();
      ctx.globalAlpha = this.alpha();
      // Canvas setTransform(m11, m12, m21, m22, dx, dy) is column-major:
      // x' = m11·x + m21·y + dx — hence (a, c, b, d, tx, ty).
      ctx.setTransform(m.a, m.c, m.b, m.d, m.tx, m.ty);
      ctx.drawImage(thermal, 0, 0);
      ctx.restore();
    }

    const scale = canvas.width / 1280;

    // Joint ROIs sit on the layer below the manual ROIs.
    const jointDraft = this.jointDraft();
    const selectedJointKey = this.selectedJointKey();
    for (const joint of this.jointRois()) {
      const shown = jointDraft && jointDraft.key === joint.key ? jointDraft : joint;
      this.drawJoint(ctx, shown, shown.key === selectedJointKey, scale);
    }

    // Confirmed manual ROIs (the one being edited is replaced by its live draft).
    const selectedId = this.selectedId();
    const live = this.draft();
    const list = this.rois();
    list.forEach((roi, i) => {
      const shown = live && live.id === roi.id ? live : roi;
      this.drawRoi(ctx, shown, i + 1, shown.id === selectedId, scale);
    });
    // A brand-new ROI being drawn is not in the list yet.
    if (live && !list.some((roi) => roi.id === live.id)) {
      this.drawRoi(ctx, live, list.length + 1, true, scale);
    }
  }

  private drawRoi(
    ctx: CanvasRenderingContext2D,
    roi: RoiSelection,
    index: number,
    selected: boolean,
    scale: number,
  ): void {
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = Math.max(selected ? 3 : 2, (selected ? 3.5 : 2.5) * scale);
    ctx.beginPath();
    ctx.ellipse(roi.cx, roi.cy, Math.max(roi.rx, 1), Math.max(roi.ry, 1), 0, 0, Math.PI * 2);
    ctx.stroke();

    this.drawChip(ctx, roi, `#${index}`, selected ? '#16a34a' : 'rgba(34,197,94,0.85)', scale);
    if (selected) {
      this.drawSelectionHandles(ctx, roi, '#16a34a');
    }
  }

  private drawJoint(
    ctx: CanvasRenderingContext2D,
    joint: OverlayJointRoi,
    selected: boolean,
    scale: number,
  ): void {
    ctx.strokeStyle = joint.color;
    ctx.lineWidth = Math.max(selected ? 3 : 1.5, (selected ? 3.5 : 2) * scale);
    ctx.beginPath();
    ctx.ellipse(joint.cx, joint.cy, Math.max(joint.rx, 1), Math.max(joint.ry, 1), 0, 0, Math.PI * 2);
    ctx.stroke();

    if (selected) {
      const label = joint.edited ? `${joint.label} •` : joint.label;
      this.drawChip(ctx, joint, label, joint.color, scale);
      this.drawSelectionHandles(ctx, joint, joint.color);
    } else if (joint.edited) {
      // An edited-but-unselected joint keeps a small dot so the change is visible.
      const r = Math.max(2.5, 3 * scale);
      ctx.beginPath();
      ctx.arc(joint.cx, joint.cy, r, 0, Math.PI * 2);
      ctx.fillStyle = joint.color;
      ctx.fill();
    }
  }

  /** A numbered/labelled chip above the ellipse, in `bg`. */
  private drawChip(ctx: CanvasRenderingContext2D, e: Ellipse, label: string, bg: string, scale: number): void {
    const fs = Math.max(11, 13 * scale);
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.textBaseline = 'alphabetic';
    const pad = 3 * scale;
    const w = ctx.measureText(label).width;
    const bx = e.cx - e.rx;
    const by = e.cy - e.ry - 4 * scale;
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by - fs, w + pad * 2, fs + pad);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, bx + pad, by - pad);
  }

  private drawSelectionHandles(ctx: CanvasRenderingContext2D, e: Ellipse, color: string): void {
    const r = this.handleRadius();
    this.drawHandle(ctx, e.cx, e.cy, r, color);
    const rh = this.resizeHandlePos(e);
    this.drawHandle(ctx, rh.x, rh.y, r, color);
  }

  private drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}
