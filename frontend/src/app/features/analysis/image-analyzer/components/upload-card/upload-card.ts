import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LucideDynamicIcon } from '@lucide/angular';

/**
 * A drag-and-drop file upload area for one analysis input. Shows a clear
 * dropzone with an upload icon and action text while empty, a success state
 * with the file name/size and a "trocar arquivo" action once loaded, plus
 * hover, drag-over and error states. The parent owns file validation and
 * processing; this component only surfaces the chosen file and the visual state.
 */
@Component({
  selector: 'app-upload-card',
  imports: [LucideDynamicIcon],
  templateUrl: './upload-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadCard {
  /** Field title, e.g. "Imagem Óptica". */
  readonly title = input.required<string>();
  /** Short description of accepted file types, e.g. "JPEG ou PNG". */
  readonly accepts = input.required<string>();
  /** `accept` attribute for the native file input. */
  readonly accept = input.required<string>();
  /** Name of the loaded file, or null when none is selected. */
  readonly fileName = input<string | null>(null);
  /** Human-readable size of the loaded file (e.g. "1,2 MB"). */
  readonly fileSize = input<string | null>(null);
  /** Whether the file is currently being decoded/parsed. */
  readonly loading = input(false);
  /** Error message for this field, or null. */
  readonly error = input<string | null>(null);

  /** Emitted when the user selects or drops a file. */
  readonly fileSelected = output<File>();

  /** UI-only: a file is being dragged over the card. */
  protected readonly dragging = signal(false);

  /** Container classes reflecting the current visual state. */
  protected readonly containerClass = computed(() => {
    const base = 'relative overflow-hidden rounded-2xl border-2 bg-white transition-colors';
    if (this.error()) {
      return `${base} border-solid border-red-300 bg-red-50/40`;
    }
    if (this.dragging()) {
      return `${base} border-dashed border-accent bg-brand-50/60`;
    }
    if (this.fileName()) {
      return `${base} border-solid border-accent`;
    }
    return `${base} border-dashed border-gray-200 hover:border-accent/60 hover:bg-brand-50/30`;
  });

  protected onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.fileSelected.emit(file);
    }
    // Allow re-selecting the same file (change wouldn't fire otherwise).
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(): void {
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      this.fileSelected.emit(file);
    }
  }
}
