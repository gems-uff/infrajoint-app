/**
 * Serialização de uma análise de imagens para o contrato da API clínica.
 *
 * Módulo puro, **fora** da página do analisador: ele recebe valores já lidos dos
 * signals e devolve o payload. É o que permite testá-lo sem montar a página inteira,
 * e é o que impede a página de crescer mais um pedaço.
 *
 * **Avulsa e sequência não são dois fluxos.** A diferença entre elas é a
 * *cardinalidade* do array de capturas — uma avulsa é uma sequência de um
 * elemento, com `captureIndex` e `elapsedSeconds` nulos. É a mesma decisão que
 * o banco toma ao não ter discriminador `single`/`sequence`.
 *
 * O que este módulo monta, porém, é só a captura **avulsa**. A sequência monta o
 * payload dela em `thermal-analysis/data/analyzer-collect.ts`, porque precisa de
 * duas coisas que `CapturePayload` não expressa: alinhamento nulo e `issue`, que
 * é como uma captura que falhou no processamento continua sendo gravada.
 *
 * Houve aqui um `captureFromSequence` que prometia o caminho único e não era
 * chamado por ninguém além do próprio teste. Ele saiu: o custo de mantê-lo não
 * era o código morto, era a divergência silenciosa entre os dois caminhos — foi
 * exatamente por ela que a tradução de `measurements` para `joint_id` chegou ao
 * da sequência e não ao daqui, e a análise avulsa passou a responder 422.
 *
 * Este módulo **não** persiste nada nem conhece HTTP. Quem grava é o fluxo de
 * Análise Térmica; a tela solta do analisador continua sem caminho até a API.
 */

import { MeasurementDto, toMeasurements } from '../joint-identity';
import { AffineMatrix, AlignmentMode, ThermalMatrix } from './image-analyzer.model';
import { SilhouetteAgreement } from './alignment-quality';
import { FiducialCorrection } from './fiducial-markers';
import { JointRoi } from './joint-rois';

/** Como o alinhamento foi obtido. Espelha o check de `alignment_method`. */
export type AlignmentMethod = 'silhouette' | 'fiducial' | 'manual';

/** O arquivo declarado no POST — tipo e tamanho, não conteúdo. */
export interface CaptureFileDeclaration {
  readonly size: number;
  /** O mesmo que o backend assina e o browser envia; divergir dá 403 no R2. */
  readonly content_type: string;
}

/**
 * Os arquivos declarados no POST. Os três, sempre: uma captura é o conjunto.
 *
 * Nenhum é opcional porque uma captura sem a matriz não tem medição e uma sem as
 * duas imagens não tem o que alinhar. O backend recusa o subconjunto com 422, e o
 * tipo opcional aqui deixava esse 422 só aparecer em produção.
 */
export interface CaptureFilesPayload {
  readonly optical: CaptureFileDeclaration;
  readonly thermal: CaptureFileDeclaration;
  readonly matrix: CaptureFileDeclaration;
}

/** O corpo de uma captura no `POST /encounters/{id}/captures`. */
export interface CapturePayload {
  /**
   * Posição da captura, e o único lugar onde ela é declarada.
   *
   * `null` = avulsa, `0` = basal, `N` = dinâmica N. Havia uma `phase` ao lado
   * dizendo o mesmo por outro caminho; as duas podiam divergir, e a coluna saiu.
   */
  readonly capture_index: number | null;
  readonly elapsed_seconds: number | null;

  readonly align_a: number;
  readonly align_b: number;
  readonly align_tx: number;
  readonly align_c: number;
  readonly align_d: number;
  readonly align_ty: number;
  /**
   * Como o alinhamento foi obtido. Não há um `alignment_mode` ao lado: 'manual' já é
   * um dos valores daqui, e a segunda coluna só podia discordar desta.
   */
  readonly alignment_method: AlignmentMethod | null;

  readonly agreement: SilhouetteAgreement | null;
  readonly fiducial_correction: FiducialCorrection | null;

  readonly measurements: readonly MeasurementDto[];
  readonly files: CaptureFilesPayload;
}

/** Estado de uma captura, lido dos signals da página. */
export interface CaptureSource {
  readonly matrix: ThermalMatrix;
  readonly alignment: AffineMatrix;
  readonly mode: AlignmentMode;
  readonly autoMethod: AlignmentMethod | null;
  readonly agreement: SilhouetteAgreement | null;
  readonly correction: FiducialCorrection | null;
  readonly jointRois: readonly JointRoi[];
  readonly files: CaptureFilesPayload;
}

/** Onde a captura fica na sequência. Tudo nulo na avulsa. */
export interface CapturePosition {
  readonly captureIndex: number | null;
  readonly elapsedSeconds: number | null;
}

/** Constrói a captura a partir do estado do analisador. */
export function captureFrom(source: CaptureSource, position: CapturePosition): CapturePayload {
  const { alignment } = source;
  return {
    capture_index: position.captureIndex,
    elapsed_seconds: position.elapsedSeconds,

    align_a: alignment.a,
    align_b: alignment.b,
    align_tx: alignment.tx,
    align_c: alignment.c,
    align_d: alignment.d,
    align_ty: alignment.ty,
    // No modo manual não há método automático a registrar.
    alignment_method: source.mode === 'manual' ? 'manual' : source.autoMethod,

    agreement: source.agreement,
    fiducial_correction: source.correction,

    // Traduzido aqui, na fronteira da persistência, exatamente como o caminho da
    // sequência faz: as ROIs do analisador são identificadas por lado + landmark do
    // MediaPipe, e a API só conhece o id do body map. Ver `analysis/joint-identity.ts`.
    //
    // Passar `JointRoi[]` cru daqui era o que fazia a análise avulsa responder 422:
    // `CaptureMeasurementIn` exige `joint_id` e é `extra="forbid"`, então o payload
    // era recusado inteiro — mas só quando havia ROI detectada, que é o caso útil.
    measurements: toMeasurements(source.jointRois),
    files: source.files,
  };
}

/**
 * Análise avulsa: uma captura só, sem posição na sequência.
 *
 * `captureIndex` nulo é significativo, e não "índice zero por falta de coisa
 * melhor": uma captura solta pode ser basal, pós-estresse ou teste de bancada, e
 * o nulo é o que distingue isso de `0`, que agora significa exatamente "é basal".
 */
export function captureFromSingle(source: CaptureSource): CapturePayload[] {
  return [captureFrom(source, { captureIndex: null, elapsedSeconds: null })];
}
