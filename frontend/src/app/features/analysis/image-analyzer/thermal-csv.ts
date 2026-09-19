/**
 * Parsing of the thermal camera CSV export.
 *
 * Port of `load_thermal_csv` from `scripts/core.py`: the file is latin1-encoded,
 * has a 16-line metadata header, and the body is a comma-separated matrix whose
 * cells use comma as the decimal separator and may be double-quoted (e.g.
 * `"23,5"`).
 */

import { ThermalMatrix } from './image-analyzer.model';

/** Number of metadata lines before the temperature matrix begins. */
export const THERMAL_CSV_HEADER_ROWS = 16;

/** The camera never exports more than 480 matrix rows. */
const MAX_MATRIX_ROWS = 480;

export function decodeThermalCsv(buffer: ArrayBuffer): string {
  return new TextDecoder('latin1').decode(buffer);
}

/**
 * Splits a CSV line honoring double quotes, so `"23,5"` stays one field
 * (pandas does the same before the Python code strips quotes and swaps the
 * decimal comma).
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function cleanTemp(raw: string): number {
  const cleaned = raw.replace(/"/g, '').replace(',', '.').trim();
  if (cleaned === '') {
    return NaN;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Parses the temperature matrix, skipping the metadata header, dropping
 * columns that are entirely NaN (trailing separators) and capping at the
 * camera's 480 rows.
 */
export function parseThermalCsv(text: string, headerRows = THERMAL_CSV_HEADER_ROWS): ThermalMatrix {
  const lines = text.split(/\r\n|\r|\n/).slice(headerRows);

  const rows: number[][] = [];
  for (const line of lines) {
    if (rows.length >= MAX_MATRIX_ROWS) {
      break;
    }
    if (line.trim() === '') {
      continue;
    }
    rows.push(splitCsvLine(line).map(cleanTemp));
  }

  if (rows.length === 0) {
    throw new Error('CSV térmico sem linhas de dados após o cabeçalho.');
  }

  const rawWidth = Math.max(...rows.map((r) => r.length));

  // Keep only columns with at least one finite value (pandas dropna how='all').
  const keptColumns: number[] = [];
  for (let x = 0; x < rawWidth; x++) {
    if (rows.some((row) => Number.isFinite(row[x]))) {
      keptColumns.push(x);
    }
  }
  if (keptColumns.length === 0) {
    throw new Error('CSV térmico sem valores numéricos de temperatura.');
  }

  const width = keptColumns.length;
  const height = rows.length;
  const values = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < width; i++) {
      const cell = rows[y][keptColumns[i]];
      values[y * width + i] = cell === undefined ? NaN : cell;
    }
  }

  return { width, height, values };
}
