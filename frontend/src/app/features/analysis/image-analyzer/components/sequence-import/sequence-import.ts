import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { LucideDynamicIcon } from '@lucide/angular';

import { SequenceService } from '../../sequence.service';
import { formatSeconds, isCompleteCapture } from '../../sequence.model';

/**
 * Batch import of a capture session (folder like `V051/`): dropzone (folder
 * picker + drag-and-drop with directory traversal), review of what was
 * recognized (complete/incomplete triplets, ignored files, capture interval)
 * and the processing progress. State lives in {@link SequenceService}; a new
 * import can always start over without reloading the app.
 */
@Component({
  selector: 'app-sequence-import',
  imports: [LucideDynamicIcon],
  templateUrl: './sequence-import.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SequenceImport {
  protected readonly sequence = inject(SequenceService);

  /** The processed sequence should open in the analyzer. */
  readonly enter = output<void>();

  protected readonly dragging = signal(false);
  protected readonly formatSeconds = formatSeconds;
  protected readonly isComplete = isCompleteCapture;

  protected readonly completeCount = computed(
    () => this.sequence.selectedReview()?.captures.filter(isCompleteCapture).length ?? 0,
  );
  protected readonly incompleteCount = computed(() => {
    const review = this.sequence.selectedReview();
    return review ? review.captures.length - this.completeCount() : 0;
  });
  protected readonly hasBaseline = computed(
    () =>
      this.sequence
        .selectedReview()
        ?.captures.some((c) => c.kind === 'baseline' && isCompleteCapture(c)) ?? false,
  );
  protected readonly progressPct = computed(() => {
    const p = this.sequence.progress();
    return p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  });
  protected readonly issueCount = computed(
    () => this.sequence.captures().filter((c) => c.issue !== null).length,
  );

  /** Folder picker, loose-files picker and the review's "add files" share this. */
  protected onFilesSelected(event: Event, append = false): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? [...input.files] : [];
    if (files.length > 0) {
      this.sequence.inspect(files, append);
    }
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(): void {
    this.dragging.set(false);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    const files = await collectDroppedFiles(event.dataTransfer);
    if (files.length > 0) {
      this.sequence.inspect(files);
    }
  }

  protected onIntervalInput(event: Event): void {
    this.sequence.setIntervalSeconds(Number((event.target as HTMLInputElement).value));
  }

  protected onReviewSelected(event: Event): void {
    this.sequence.selectReview(Number((event.target as HTMLSelectElement).value));
  }

  protected async process(): Promise<void> {
    await this.sequence.process();
    if (this.sequence.status() === 'ready') {
      this.enter.emit();
    }
  }

  /** Interval mapped to a capture's clock, for the review rows. */
  protected captureTime(kind: 'baseline' | 'dynamic', index: number): string {
    return formatSeconds(kind === 'baseline' ? 0 : index * this.sequence.intervalSeconds());
  }
}

/** Flattens a drop payload, walking directories via the FileSystem API. */
async function collectDroppedFiles(dataTransfer: DataTransfer | null): Promise<File[]> {
  if (!dataTransfer) {
    return [];
  }
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
    }
  }
  if (entries.length === 0) {
    return [...dataTransfer.files];
  }
  const files: File[] = [];
  for (const entry of entries) {
    await walkEntry(entry, files);
  }
  return files;
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
    );
    if (file) {
      out.push(file);
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns batches; keep reading until an empty batch.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      );
      if (batch.length === 0) {
        break;
      }
      for (const child of batch) {
        await walkEntry(child, out);
      }
    }
  }
}
