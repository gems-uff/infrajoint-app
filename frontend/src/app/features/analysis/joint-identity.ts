/**
 * A ponte entre os dois vocabulários de articulação do sistema.
 *
 * O analisador de imagens identifica uma região medida pelo lado da mão e pelo índice do
 * landmark do MediaPipe (`Direita:9`). O body map identifica a mesma articulação por um
 * id clínico (`RIGHT_MCP_3`). As duas listas coincidem 1 para 1 nas 22 articulações de
 * mão, mas essa correspondência vivia só implícita, espalhada entre dois arquivos de
 * dados que ninguém ligava.
 *
 * **A tradução acontece aqui, e só aqui.** Da fronteira da API para dentro existe uma
 * nomenclatura só: o backend e o banco conhecem exclusivamente `joint_id`, e é essa
 * igualdade com a avaliação articular que torna possível cruzar temperatura com achado
 * clínico. O índice do landmark é detalhe do detector, então fica deste lado, junto de
 * onde o MediaPipe é consumido, e não no schema clínico — uma coluna nomeada por uma
 * biblioteca sobreviveria à própria biblioteca.
 *
 * O caminho de volta existe porque a consulta reaberta e o relatório remontam a
 * sobreposição sobre a imagem, e para isso precisam da ROI no formato do analisador.
 */

import { JointId } from './body-map/body-map.model';
import { JOINT_BY_ID } from './body-map/joint-catalog.data';
import { HandSide, Point, RoiShape } from './image-analyzer/image-analyzer.model';
import { JointRoi, jointRoiKey } from './image-analyzer/joint-rois';

/**
 * O sufixo do id do body map para cada landmark do MediaPipe.
 *
 * Espelha `JOINT_ROI_DEFS`, na mesma ordem: punho, e depois MCP e IFP de cada dedo.
 */
const SUFIXO_POR_LANDMARK: ReadonlyMap<number, string> = new Map([
  [0, 'WRIST'],
  [2, 'MCP_1'],
  [3, 'PIP_1'],
  [5, 'MCP_2'],
  [6, 'PIP_2'],
  [9, 'MCP_3'],
  [10, 'PIP_3'],
  [13, 'MCP_4'],
  [14, 'PIP_4'],
  [17, 'MCP_5'],
  [18, 'PIP_5'],
]);

const LANDMARK_POR_SUFIXO: ReadonlyMap<string, number> = new Map(
  [...SUFIXO_POR_LANDMARK].map(([landmark, sufixo]) => [sufixo, landmark]),
);

/** `'Direita'` é rótulo de exibição servindo de identidade; a tradução o normaliza. */
const PREFIXO_POR_LADO: Record<HandSide, string> = { Direita: 'RIGHT', Esquerda: 'LEFT' };
const LADO_POR_PREFIXO: Record<string, HandSide> = { RIGHT: 'Direita', LEFT: 'Esquerda' };

/**
 * O id do body map para uma ROI do analisador, ou `null` se o landmark não for um dos 22.
 *
 * `null` não é erro: o detector devolve 21 landmarks por mão e só 11 viram ROI. Quem
 * chama descarta o resto.
 */
export function jointIdFromRoi(side: HandSide, landmarkId: number): JointId | null {
  const sufixo = SUFIXO_POR_LANDMARK.get(landmarkId);
  return sufixo ? (`${PREFIXO_POR_LADO[side]}_${sufixo}` as JointId) : null;
}

/** A identidade da ROI a partir do id do body map. Inverso de `jointIdFromRoi`. */
export function roiIdentityOf(
  jointId: string,
): { side: HandSide; landmarkId: number; label: string; key: string } | null {
  const separador = jointId.indexOf('_');
  if (separador < 0) {
    return null;
  }

  const side = LADO_POR_PREFIXO[jointId.slice(0, separador)];
  const landmarkId = LANDMARK_POR_SUFIXO.get(jointId.slice(separador + 1));
  if (side === undefined || landmarkId === undefined) {
    return null;
  }

  // O rótulo curto do catálogo é o mesmo que o analisador usa ('MCP 3', 'Punho'), então
  // ele não precisa ser gravado nem duplicado aqui.
  const label = JOINT_BY_ID.get(jointId as JointId)?.shortLabel ?? jointId;
  return { side, landmarkId, label, key: jointRoiKey(side, landmarkId) };
}

/** Uma medição como a API a recebe e a devolve: identidade clínica e números. */
export interface MeasurementDto {
  readonly joint_id: string;
  readonly t_mean: number | null;
  readonly t_median: number | null;
  readonly t_min: number | null;
  readonly t_max: number | null;
  readonly area: number | null;
  readonly sample_count: number | null;
  readonly shape: RoiShape | null;
  readonly rgb_x: number | null;
  readonly rgb_y: number | null;
  readonly csv_x: number | null;
  readonly csv_y: number | null;
  readonly rx_csv: number | null;
  readonly ry_csv: number | null;
  readonly edited: boolean;
}

/**
 * A ROI medida, no formato que a API grava.
 *
 * As ROIs cujo landmark não tem articulação correspondente são descartadas: sem
 * `joint_id` não há o que gravar, e inventar um id faria a chave estrangeira recusar a
 * análise inteira por causa de uma região.
 */
export function toMeasurement(roi: JointRoi): MeasurementDto | null {
  const jointId = jointIdFromRoi(roi.side, roi.landmarkId);
  if (jointId === null) {
    return null;
  }

  return {
    joint_id: jointId,
    t_mean: roi.stats.mean,
    t_median: roi.stats.median,
    t_min: roi.stats.min,
    t_max: roi.stats.max,
    area: roi.stats.area,
    sample_count: roi.stats.count,
    shape: roi.shape,
    rgb_x: roi.rgb.x,
    rgb_y: roi.rgb.y,
    csv_x: roi.csv.x,
    csv_y: roi.csv.y,
    rx_csv: roi.rxCsv,
    ry_csv: roi.ryCsv,
    edited: roi.edited,
  };
}

/** As medições de uma captura, descartando ROI sem articulação correspondente. */
export function toMeasurements(rois: readonly JointRoi[]): readonly MeasurementDto[] {
  return rois.map(toMeasurement).filter((m): m is MeasurementDto => m !== null);
}

/** Ponto a partir de duas colunas que podem faltar. */
function ponto(x: number | null, y: number | null): Point {
  return { x: x ?? Number.NaN, y: y ?? Number.NaN };
}

/**
 * A ROI reconstruída a partir da medição gravada.
 *
 * Identidade (lado, landmark, rótulo, chave) sai do catálogo; o resto sai das colunas.
 * Números ausentes viram `NaN` em vez de zero: uma região sem leitura válida não mediu
 * zero grau, e zero entraria nas médias como se fosse medição. Os consumidores já leem
 * com tolerância a ausência.
 */
export function toJointRoi(medicao: MeasurementDto): JointRoi | null {
  const identidade = roiIdentityOf(medicao.joint_id);
  if (identidade === null) {
    return null;
  }

  const area = medicao.area ?? 0;

  return {
    side: identidade.side,
    landmarkId: identidade.landmarkId,
    label: identidade.label,
    key: identidade.key,
    rgb: ponto(medicao.rgb_x, medicao.rgb_y),
    csv: ponto(medicao.csv_x, medicao.csv_y),
    shape: medicao.shape ?? 'ellipse',
    rxCsv: medicao.rx_csv ?? Number.NaN,
    ryCsv: medicao.ry_csv ?? Number.NaN,
    stats: {
      mean: medicao.t_mean ?? Number.NaN,
      median: medicao.t_median ?? Number.NaN,
      max: medicao.t_max ?? Number.NaN,
      min: medicao.t_min ?? Number.NaN,
      area: medicao.area ?? 0,
      count: medicao.sample_count ?? 0,
    },
    // Recalculada, e não relida: a cobertura é `células válidas / células da região`,
    // e guardá-la ao lado das duas seria repetir a mesma informação. É a mesma conta
    // que `joint-rois.ts` faz ao medir.
    skinCoverage: area > 0 ? (medicao.sample_count ?? 0) / area : 0,
    edited: medicao.edited,
  };
}

/** As ROIs de uma captura, descartando o que não tiver articulação conhecida. */
export function toJointRois(medicoes: readonly MeasurementDto[]): readonly JointRoi[] {
  return medicoes
    .map(toJointRoi)
    .filter((roi): roi is JointRoi => roi !== null);
}
