import { CaptureDetail } from './patient.model';
import { alignmentOf } from './encounter-reconstruct';

function captura(partial: Partial<CaptureDetail> = {}): CaptureDetail {
  return {
    id: 'c1',
    capture_index: 0,
    elapsed_seconds: 0,
    align_a: 0.5,
    align_b: 0,
    align_tx: 3,
    align_c: 0,
    align_d: 0.5,
    align_ty: 7,
    alignment_method: 'silhouette',
    agreement: null,
    fiducial_correction: null,
    measurements: [],
    issue: null,
    files: {},
    ...partial,
  };
}

describe('alignmentOf', () => {
  it('remonta a afim gravada, que é o que evita realinhar ao reabrir', () => {
    expect(alignmentOf(captura())).toEqual({ a: 0.5, b: 0, tx: 3, c: 0, d: 0.5, ty: 7 });
  });

  it('devolve null quando a captura não chegou a alinhar', () => {
    // Basta um componente ausente: uma afim pela metade seria pior que nenhuma.
    expect(alignmentOf(captura({ align_a: null }))).toBeNull();
    expect(alignmentOf(captura({ align_ty: null }))).toBeNull();
  });
});
