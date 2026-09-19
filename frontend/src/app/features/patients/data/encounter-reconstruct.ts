/**
 * Tradução do que foi gravado para o que o analisador consome.
 *
 * Só sobrou o alinhamento: a composição da sobreposição, a curva e as ROIs voltaram
 * a ser responsabilidade da própria `ImageAnalyzerPage`, que a consulta reaberta
 * agora reusa em vez de imitar.
 */

import { AffineMatrix } from '../../analysis/image-analyzer/image-analyzer.model';
import { CaptureDetail } from './patient.model';

/**
 * A afim RGB→CSV gravada, ou `null` quando a captura não chegou a alinhar.
 *
 * Vir do banco é o ponto: sem isto a consulta reaberta teria que realinhar, e duas
 * aberturas da mesma consulta poderiam mostrar números diferentes.
 */
export function alignmentOf(capture: CaptureDetail): AffineMatrix | null {
  const { align_a, align_b, align_tx, align_c, align_d, align_ty } = capture;
  if (
    align_a === null ||
    align_b === null ||
    align_tx === null ||
    align_c === null ||
    align_d === null ||
    align_ty === null
  ) {
    return null;
  }
  return { a: align_a, b: align_b, tx: align_tx, c: align_c, d: align_d, ty: align_ty };
}
