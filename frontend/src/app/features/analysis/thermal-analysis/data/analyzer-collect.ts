/**
 * Lê o estado do analisador e produz o que a gravação precisa: o corpo do POST e os
 * arquivos a subir, casados por captura e tipo.
 *
 * Recebe uma leitura estrutural, não o componente: assim é testável sem montar a
 * página inteira, e a página não precisa saber que isto existe.
 */

import {
  AlignmentMethod,
  CaptureFileDeclaration,
  CaptureFilesPayload,
  captureFromSingle,
} from '../../image-analyzer/analysis-payload';
import { AffineMatrix, ThermalMatrix } from '../../image-analyzer/image-analyzer.model';
import { SilhouetteAgreement } from '../../image-analyzer/alignment-quality';
import { FiducialCorrection } from '../../image-analyzer/fiducial-markers';
import { JointRoi } from '../../image-analyzer/joint-rois';
import { AnalysisCreate, CaptureFileKind } from '../../../patients/data/patient.model';
import { toMeasurements } from '../../joint-identity';

/** O que o fluxo lê do analisador. Espelha os signais públicos da página. */
export interface AnalyzerReadout {
  readonly matrix: ThermalMatrix | null;
  readonly activeMatrix: AffineMatrix | null;
  readonly mode: 'auto' | 'manual';
  readonly autoMethod: AlignmentMethod | null;
  readonly agreement: SilhouetteAgreement | null;
  readonly correction: FiducialCorrection | null;
  readonly jointRois: readonly JointRoi[];
  readonly opticalFile: File | null;
  readonly thermalFile: File | null;
  readonly matrixFile: File | null;
}

/** Chave que casa uma URL assinada com o arquivo dela. */
export function uploadKey(captureIndex: number | null, kind: CaptureFileKind): string {
  // O nulo da avulsa precisa atravessar a chave sem virar 0: o backend devolve o
  // `capture_index` como o gravou, e é por esta chave que a URL assinada reencontra
  // o arquivo. Normalizar aqui e não lá faria o `get` devolver undefined no envio.
  return `${captureIndex ?? 'avulsa'}:${kind}`;
}

export interface CollectedAnalysis {
  readonly payload: AnalysisCreate;
  readonly files: ReadonlyMap<string, File>;
}

/**
 * Declara os três arquivos de uma captura e os registra no mapa de envio.
 *
 * Os dois fluxos passam por aqui, e é o que garante que nenhum deles declare um
 * subconjunto: o parâmetro exige os três, então uma captura incompleta não chega a
 * compilar. O backend recusa o subconjunto com 422, mas só depois de a consulta já
 * existir — e ela ficaria presa em `uploading`.
 */
function declararTres(
  captureIndex: number | null,
  files: { readonly optical: File; readonly thermal: File; readonly matrix: File },
  destino: Map<string, File>,
): CaptureFilesPayload {
  const declarar = (kind: CaptureFileKind, file: File): CaptureFileDeclaration => {
    destino.set(uploadKey(captureIndex, kind), file);
    return {
      size: file.size,
      // Precisa ser o mesmo que o backend assina e o browser envia; divergir dá 403.
      content_type: file.type || 'application/octet-stream',
    };
  };
  return {
    optical: declarar('optical', files.optical),
    thermal: declarar('thermal', files.thermal),
    matrix: declarar('matrix', files.matrix),
  };
}

/** Uma captura da sequência, já processada, com as ROIs que a curva desenhou. */
export interface SequenceReadout {
  /** Posição na sequência: 0 é a basal. Sozinho, já diz o que `kind` dizia. */
  readonly index: number;
  readonly timeSeconds: number;
  readonly matrix: ThermalMatrix;
  readonly alignment: AffineMatrix | null;
  readonly autoMethod: AlignmentMethod | null;
  readonly agreement: SilhouetteAgreement | null;
  readonly correction: FiducialCorrection | null;
  readonly issue: string | null;
  readonly jointRois: readonly JointRoi[];
  readonly opticalFile: File;
  readonly thermalFile: File;
  readonly matrixFile: File;
}

/**
 * Monta a análise em sequência.
 *
 * O payload é montado aqui, e não por `captureFrom`: a sequência precisa de duas
 * coisas que `CapturePayload` não expressa, alinhamento nulo e `issue`, que juntas
 * são como uma captura que falhou no processamento continua sendo gravada. O que as
 * duas montagens compartilham é `declararTres`, que é onde estaria o erro de declarar
 * um subconjunto de arquivos.
 *
 * Uma captura que falhou no processamento entra assim mesmo, com `issue` preenchido e
 * medições vazias. Descartá-la esconderia por que a curva tem um buraco.
 */
export function collectSequenceAnalysis(
  capturas: readonly SequenceReadout[],
): CollectedAnalysis | null {
  if (capturas.length === 0) {
    return null;
  }

  const arquivos = new Map<string, File>();
  const payloads = capturas.map((captura) => {
    const declarados = declararTres(
      captura.index,
      { optical: captura.opticalFile, thermal: captura.thermalFile, matrix: captura.matrixFile },
      arquivos,
    );

    const alinhamento = captura.alignment;
    return {
      capture_index: captura.index,
      elapsed_seconds: captura.timeSeconds,

      align_a: alinhamento?.a ?? null,
      align_b: alinhamento?.b ?? null,
      align_tx: alinhamento?.tx ?? null,
      align_c: alinhamento?.c ?? null,
      align_d: alinhamento?.d ?? null,
      align_ty: alinhamento?.ty ?? null,
      alignment_method: captura.autoMethod,

      agreement: captura.agreement,
      fiducial_correction: captura.correction,
      // Traduzido aqui, na fronteira da persistência: as ROIs do analisador são
      // identificadas por lado + landmark do MediaPipe, e a API só conhece o id do
      // body map. Ver `analysis/joint-identity.ts`.
      measurements: toMeasurements(captura.jointRois),
      issue: captura.issue,
      files: declarados,
    } as unknown as Record<string, unknown>;
  });

  return { payload: { captures: payloads }, files: arquivos };
}

/**
 * Monta a análise avulsa, ou `null` quando não há o que gravar.
 *
 * Sem matriz ou sem alinhamento não existe medição — e gravar uma análise vazia
 * deixaria a consulta presa em `analysis_status='uploading'` para sempre.
 */
export function collectSingleAnalysis(readout: AnalyzerReadout): CollectedAnalysis | null {
  if (!readout.matrix || !readout.activeMatrix) {
    return null;
  }

  // Os três, ou nenhum. Declarar um subconjunto gravaria uma análise que ninguém
  // consegue reabrir, e o backend a recusa com 422 — mas só depois de a consulta já
  // existir, deixando-a presa em `uploading`. Barrar antes do POST é o que evita isso.
  const { opticalFile, thermalFile, matrixFile } = readout;
  if (!opticalFile || !thermalFile || !matrixFile) {
    return null;
  }

  const arquivos = new Map<string, File>();
  // Índice nulo, o mesmo que `captureFromSingle` vai enviar: é por essa chave que a
  // URL assinada reencontra o arquivo no envio.
  const declarados = declararTres(
    null,
    { optical: opticalFile, thermal: thermalFile, matrix: matrixFile },
    arquivos,
  );

  const [captura] = captureFromSingle({
    matrix: readout.matrix,
    alignment: readout.activeMatrix,
    mode: readout.mode,
    autoMethod: readout.autoMethod,
    agreement: readout.agreement,
    correction: readout.correction,
    jointRois: readout.jointRois,
    files: declarados,
  });

  return {
    payload: { captures: [captura as unknown as Record<string, unknown>] },
    files: arquivos,
  };
}
