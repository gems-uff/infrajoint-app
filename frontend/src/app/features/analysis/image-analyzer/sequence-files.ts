/**
 * Batch-import grouping for the capture protocol's folder layout.
 *
 * A session folder (e.g. `V051/`) ships four kinds of files, recognized purely
 * by file name — the subfolder layout is not relied upon:
 *
 * - `V051_T1_Est_DAR.jpeg` / `V051_T1_Din07_DAR.jpeg` → optical photo
 * - `V051_T1_Est_IR.jpeg`  / `V051_T1_Din07_IR.jpeg`  → thermal render
 * - `V051_T1_Est.csv`      / `V051_T1_Din07.csv`      → temperature matrix
 * - `V051_T1_Din07.jpeg` (no suffix) → camera original, ignored
 *
 * Earlier sessions (e.g. `V014/`) carry an extra token between the trial and
 * the phase naming the support surface the hands rested on — `E` (blue EVA),
 * `EP` (EVA + paper) and `M` (wood): `V014_T1_E_Din00_IR.jpeg`,
 * `V014_T1_EP_Est.csv`. They are normalized onto the current protocol rather
 * than modeled as a variation of it, since only one of their acquisitions
 * matches it:
 *
 * - only `E` is kept — blue EVA is the surface the current protocol settled
 *   on, and the `EP`/`M` acquisitions are baseline-only surface trials;
 * - `Din00` is dropped — it is the same instant as `Est`, which the current
 *   naming records once.
 *
 * What is left is exactly a current-naming session (`Est` + `Din01…`), so a
 * legacy folder reviews and processes as `V014_T1` with no legacy concept
 * leaking downstream. The discards are counted for the review screen.
 *
 * Anything else (clinical spreadsheets, hidden files…) is ignored and only
 * counted, so the review screen can say what was skipped. Files never leave
 * the browser.
 */

import { ReviewCapture, SequenceReview } from './sequence.model';

const CAPTURE_FILE_RE =
  /^([A-Za-z0-9]+)_([A-Za-z0-9]+)(?:_([A-Za-z]{1,3}))?_(Est|Din(\d+))(?:_(DAR|IR))?\.(jpe?g|csv)$/i;

/** Legacy support surface kept on import: blue EVA, as in the current protocol. */
const KEPT_SURFACE = 'E';

type Modality = 'optical' | 'thermal' | 'matrix';

interface ParsedName {
  readonly subject: string;
  readonly trial: string;
  readonly label: string;
  readonly index: number; // 0 = baseline
  readonly modality: Modality | 'original';
  /** A legacy capture the current protocol has no place for — counted, not used. */
  readonly legacyDiscard: boolean;
}

function parseCaptureFileName(name: string): ParsedName | null {
  const match = CAPTURE_FILE_RE.exec(name);
  if (!match) {
    return null;
  }
  const [, subject, trial, surface, phase, dinIndex, suffix, ext] = match;
  const isCsv = ext.toLowerCase() === 'csv';
  if (isCsv && suffix) {
    return null; // e.g. *_DAR.csv — not part of the protocol
  }
  const modality: ParsedName['modality'] = isCsv
    ? 'matrix'
    : suffix?.toUpperCase() === 'DAR'
      ? 'optical'
      : suffix?.toUpperCase() === 'IR'
        ? 'thermal'
        : 'original';
  const isBaseline = dinIndex === undefined;
  const index = isBaseline ? 0 : Number.parseInt(dinIndex, 10);
  return {
    subject,
    trial,
    label: phase,
    index,
    modality,
    legacyDiscard:
      (surface !== undefined && surface.toUpperCase() !== KEPT_SURFACE) ||
      (!isBaseline && index === 0),
  };
}

/**
 * Groups a dropped/browsed file list into per-(subject, trial) sequence
 * reviews. Multiple sessions in one drop yield multiple reviews (the UI lets
 * the user pick one). Hidden files (`.DS_Store`…) are skipped silently.
 */
export function groupSequenceFiles(files: readonly File[]): SequenceReview[] {
  interface MutableCapture {
    kind: ReviewCapture['kind'];
    index: number;
    label: string;
    optical: File | null;
    thermal: File | null;
    matrix: File | null;
  }
  interface Group {
    subject: string;
    trial: string;
    captures: Map<number, MutableCapture>;
    ignoredOriginals: number;
    ignoredLegacy: number;
  }

  const groups = new Map<string, Group>();
  let ignoredOthers = 0;

  for (const file of files) {
    if (file.name.startsWith('.')) {
      continue;
    }
    const parsed = parseCaptureFileName(file.name);
    if (!parsed) {
      ignoredOthers++;
      continue;
    }
    const key = `${parsed.subject}_${parsed.trial}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        subject: parsed.subject,
        trial: parsed.trial,
        captures: new Map(),
        ignoredOriginals: 0,
        ignoredLegacy: 0,
      };
      groups.set(key, group);
    }
    if (parsed.modality === 'original') {
      // Unused in either naming, so it is an original before it is a discard.
      group.ignoredOriginals++;
      continue;
    }
    if (parsed.legacyDiscard) {
      group.ignoredLegacy++;
      continue;
    }
    let capture = group.captures.get(parsed.index);
    if (!capture) {
      capture = {
        kind: parsed.index === 0 ? 'baseline' : 'dynamic',
        index: parsed.index,
        label: parsed.label,
        optical: null,
        thermal: null,
        matrix: null,
      };
      group.captures.set(parsed.index, capture);
    }
    capture[parsed.modality] = file;
  }

  return [...groups.values()].map((group): SequenceReview => {
    const captures = [...group.captures.values()].sort((a, b) => a.index - b.index);
    const dynamicIndexes = captures.filter((c) => c.kind === 'dynamic').map((c) => c.index);
    const maxIndex = dynamicIndexes.length > 0 ? Math.max(...dynamicIndexes) : 0;
    const present = new Set(dynamicIndexes);
    const missingIndexes: number[] = [];
    for (let i = 1; i <= maxIndex; i++) {
      if (!present.has(i)) {
        missingIndexes.push(i);
      }
    }
    return {
      subject: group.subject,
      trial: group.trial,
      captures,
      missingIndexes,
      ignoredOriginals: group.ignoredOriginals,
      ignoredLegacy: group.ignoredLegacy,
      ignoredOthers,
    };
  });
}
