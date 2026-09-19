import { groupSequenceFiles } from './sequence-files';
import { isCompleteCapture } from './sequence.model';

/**
 * Builds the flat file list of a session folder like V051/. `variant` fills the
 * legacy support-surface token (V014_T1_E_…).
 */
function sessionFiles(
  subject: string,
  trial: string,
  dynamics: number[],
  variant?: string,
): File[] {
  const files: File[] = [];
  const phases = ['Est', ...dynamics.map((i) => `Din${String(i).padStart(2, '0')}`)];
  const prefix = [subject, trial, variant].filter(Boolean).join('_');
  for (const phase of phases) {
    const base = `${prefix}_${phase}`;
    files.push(new File([''], `${base}_DAR.jpeg`)); // Imagens_visuais/
    files.push(new File([''], `${base}_IR.jpeg`)); // Imagens_termicas/
    files.push(new File([''], `${base}.csv`)); // Matrizes/
    files.push(new File([''], `${base}.jpeg`)); // Arquivos_originais/
  }
  return files;
}

describe('groupSequenceFiles', () => {
  it('recognizes a full V051-style session: baseline + dynamics, originals ignored', () => {
    const dynamics = Array.from({ length: 20 }, (_, i) => i + 1);
    const files = [
      ...sessionFiles('V051', 'T1', dynamics),
      new File([''], 'Ficha_infrajoint_ID_TX.xlsx'),
      new File([''], '.DS_Store'),
    ];

    const reviews = groupSequenceFiles(files);
    expect(reviews).toHaveLength(1);
    const review = reviews[0];
    expect(review.subject).toBe('V051');
    expect(review.trial).toBe('T1');
    expect(review.captures).toHaveLength(21);
    // Baseline first, then Din01..Din20 in order.
    expect(review.captures[0].kind).toBe('baseline');
    expect(review.captures[0].label).toBe('Est');
    expect(review.captures[1].label).toBe('Din01');
    expect(review.captures[20].label).toBe('Din20');
    expect(review.captures.every(isCompleteCapture)).toBe(true);
    expect(review.missingIndexes).toEqual([]);
    // The 21 camera originals are counted but never used.
    expect(review.ignoredOriginals).toBe(21);
    // The clinical spreadsheet is ignored; .DS_Store is skipped silently.
    expect(review.ignoredOthers).toBe(1);
  });

  it('flags incomplete triplets and holes in the Din numbering', () => {
    const files = sessionFiles('V043', 'T1', [1, 2, 4]); // Din03 absent entirely
    // Din02 lost its CSV.
    const withoutCsv = files.filter((f) => f.name !== 'V043_T1_Din02.csv');

    const review = groupSequenceFiles(withoutCsv)[0];
    expect(review.captures).toHaveLength(4);
    const din02 = review.captures.find((c) => c.label === 'Din02')!;
    expect(isCompleteCapture(din02)).toBe(false);
    expect(din02.matrix).toBeNull();
    expect(din02.optical).not.toBeNull();
    expect(review.missingIndexes).toEqual([3]);
  });

  it('separates multiple sessions dropped together', () => {
    const files = [...sessionFiles('V051', 'T1', [1]), ...sessionFiles('V048', 'T1', [1, 2])];
    const reviews = groupSequenceFiles(files);
    expect(reviews.map((r) => `${r.subject}_${r.trial}`).sort()).toEqual(['V048_T1', 'V051_T1']);
    expect(reviews.find((r) => r.subject === 'V048')!.captures).toHaveLength(3);
  });

  it('ignores files outside the protocol naming', () => {
    const review = groupSequenceFiles([
      new File([''], 'V051_T1_Est_DAR.jpeg'),
      new File([''], 'notas.txt'),
      new File([''], 'V051_T1_Est_DAR.csv'), // csv with a modality suffix: invalid
    ])[0];
    expect(review.ignoredOthers).toBe(2);
    expect(review.captures).toHaveLength(1);
    expect(review.captures[0].optical).not.toBeNull();
    expect(review.captures[0].matrix).toBeNull();
  });

  describe('legacy naming (support-surface token)', () => {
    /** V014/: baseline on three surfaces, dynamics only on EVA, starting at Din00. */
    function v014Files(): File[] {
      return [
        ...sessionFiles(
          'V014',
          'T1',
          Array.from({ length: 21 }, (_, i) => i),
          'E',
        ),
        ...sessionFiles('V014', 'T1', [], 'EP'),
        ...sessionFiles('V014', 'T1', [], 'M'),
      ];
    }

    it('normalizes a V014 session onto the current protocol', () => {
      const reviews = groupSequenceFiles(v014Files());
      // One session, named as if it had been captured under the current naming.
      expect(reviews).toHaveLength(1);
      const review = reviews[0];
      expect(review.subject).toBe('V014');
      expect(review.trial).toBe('T1');
      // Est + Din01..Din20 — exactly the V051 shape.
      expect(review.captures).toHaveLength(21);
      expect(review.captures[0].kind).toBe('baseline');
      expect(review.captures[0].label).toBe('Est');
      expect(review.captures[0].matrix!.name).toBe('V014_T1_E_Est.csv');
      expect(review.captures[1].label).toBe('Din01');
      expect(review.captures[20].label).toBe('Din20');
      expect(review.captures.every(isCompleteCapture)).toBe(true);
      expect(review.missingIndexes).toEqual([]);
      // Discarded: the EP and M triplets, plus Din00 (same instant as Est).
      expect(review.ignoredLegacy).toBe(9);
      expect(review.ignoredOriginals).toBe(24);
    });

    it('keeps only the EVA surface', () => {
      const review = groupSequenceFiles([
        new File([''], 'V014_T1_E_Est_DAR.jpeg'),
        new File([''], 'V014_T1_EP_Est_DAR.jpeg'),
        new File([''], 'V014_T1_M_Est_DAR.jpeg'),
      ])[0];
      expect(review.captures).toHaveLength(1);
      expect(review.captures[0].optical!.name).toBe('V014_T1_E_Est_DAR.jpeg');
      expect(review.ignoredLegacy).toBe(2);
    });

    it('discards Din00 instead of merging it into the baseline', () => {
      const review = groupSequenceFiles([
        new File([''], 'V014_T1_E_Est.csv'),
        new File([''], 'V014_T1_E_Din00.csv'),
        new File([''], 'V014_T1_E_Din01.csv'),
      ])[0];
      expect(review.captures.map((c) => c.label)).toEqual(['Est', 'Din01']);
      expect(review.captures[0].matrix!.name).toBe('V014_T1_E_Est.csv');
      expect(review.ignoredLegacy).toBe(1);
    });

    it('merges legacy and current names of the same session', () => {
      const review = groupSequenceFiles([
        new File([''], 'V014_T1_E_Est_DAR.jpeg'),
        new File([''], 'V014_T1_Est_IR.jpeg'),
        new File([''], 'V014_T1_E_Est.csv'),
      ])[0];
      expect(review.captures).toHaveLength(1);
      expect(isCompleteCapture(review.captures[0])).toBe(true);
    });

    it('does not read a modality suffix as a surface token', () => {
      const review = groupSequenceFiles([
        new File([''], 'V051_T1_Est_DAR.jpeg'),
        new File([''], 'V051_T1_Din01_IR.jpeg'),
      ])[0];
      expect(review.captures).toHaveLength(2);
      expect(review.ignoredLegacy).toBe(0);
      expect(review.ignoredOthers).toBe(0);
    });
  });
});
