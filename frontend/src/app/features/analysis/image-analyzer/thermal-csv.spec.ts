import { parseThermalCsv } from './thermal-csv';

/** Builds a camera-like CSV: 16 metadata lines and a quoted, comma-decimal body. */
function buildCsv(dataLines: string[]): string {
  const header = Array.from({ length: 16 }, (_, i) => `Meta ${i},valor ${i}`);
  return [...header, ...dataLines].join('\n');
}

describe('parseThermalCsv', () => {
  it('parses quoted comma-decimal temperatures after the 16-line header', () => {
    const matrix = parseThermalCsv(buildCsv(['"25,1","25,2"', '"26,0","24,8"']));

    expect(matrix.width).toBe(2);
    expect(matrix.height).toBe(2);
    expect(matrix.values[0]).toBeCloseTo(25.1);
    expect(matrix.values[3]).toBeCloseTo(24.8);
  });

  it('drops trailing all-empty columns and marks gaps as NaN', () => {
    const matrix = parseThermalCsv(buildCsv(['"25,1",,"25,3",', '"26,0",,,']));

    // Column 1 (empty in one row only… here empty in both) and the trailing
    // separator column are dropped; the partial gap stays NaN.
    expect(matrix.width).toBe(2);
    expect(matrix.values[0]).toBeCloseTo(25.1);
    expect(matrix.values[1]).toBeCloseTo(25.3);
    expect(Number.isNaN(matrix.values[3])).toBe(true);
  });

  it('throws on a CSV without data rows', () => {
    expect(() => parseThermalCsv(buildCsv([]))).toThrow();
  });
});
