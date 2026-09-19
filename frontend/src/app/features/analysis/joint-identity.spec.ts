import { JOINTS_28 } from './body-map/assessment-configs.data';
import { JointRoi } from './image-analyzer/joint-rois';
import {
  MeasurementDto,
  jointIdFromRoi,
  roiIdentityOf,
  toJointRoi,
  toMeasurement,
} from './joint-identity';

/** Os 11 landmarks que viram ROI, iguais aos de `JOINT_ROI_DEFS`. */
const LANDMARKS = [0, 2, 3, 5, 6, 9, 10, 13, 14, 17, 18];

function roi(side: 'Direita' | 'Esquerda', landmarkId: number): JointRoi {
  return {
    side,
    landmarkId,
    label: 'irrelevante',
    key: `${side}:${landmarkId}`,
    rgb: { x: 10, y: 20 },
    csv: { x: 1, y: 2 },
    shape: 'ellipse',
    rxCsv: 27,
    ryCsv: 17,
    stats: { mean: 34.75, median: 34.7, max: 35.4, min: 34, area: 1438, count: 1400 },
    skinCoverage: 0.98,
    edited: false,
  } as JointRoi;
}

describe('jointIdFromRoi', () => {
  it('traduz os 22 pares para articulações que existem no body map', () => {
    // O catálogo do banco é semeado a partir de JOINTS_28. Se esta tradução produzisse
    // um id fora dele, a chave estrangeira recusaria a análise inteira na gravação.
    const traduzidos = new Set<string>();
    for (const side of ['Direita', 'Esquerda'] as const) {
      for (const landmarkId of LANDMARKS) {
        const id = jointIdFromRoi(side, landmarkId);
        expect(id).not.toBeNull();
        expect(JOINTS_28).toContain(id!);
        traduzidos.add(id!);
      }
    }
    // 22 pares, 22 articulações distintas: nenhuma ROI cai em cima de outra.
    expect(traduzidos.size).toBe(22);
  });

  it('devolve null para landmark que não vira ROI', () => {
    // O detector entrega 21 landmarks por mão e só 11 são medidos. Os demais não são
    // erro: quem chama descarta.
    expect(jointIdFromRoi('Direita', 1)).toBeNull();
    expect(jointIdFromRoi('Direita', 20)).toBeNull();
  });

  it('separa os lados', () => {
    expect(jointIdFromRoi('Direita', 9)).toBe('RIGHT_MCP_3');
    expect(jointIdFromRoi('Esquerda', 9)).toBe('LEFT_MCP_3');
  });
});

describe('roiIdentityOf', () => {
  it('desfaz a tradução dos 22 pares', () => {
    for (const side of ['Direita', 'Esquerda'] as const) {
      for (const landmarkId of LANDMARKS) {
        const id = jointIdFromRoi(side, landmarkId)!;
        expect(roiIdentityOf(id)).toMatchObject({ side, landmarkId });
      }
    }
  });

  it('devolve o rótulo curto do catálogo, que é o que o analisador usa', () => {
    expect(roiIdentityOf('RIGHT_WRIST')?.label).toBe('Punho');
    expect(roiIdentityOf('LEFT_MCP_3')?.label).toBe('MCP 3');
  });

  it('reconstrói a chave no formato do analisador', () => {
    expect(roiIdentityOf('RIGHT_MCP_3')?.key).toBe('Direita:9');
  });

  it('devolve null para articulação sem ROI térmica', () => {
    // Ombro, cotovelo e joelho existem no body map e não são medidos: a captura é de
    // mãos. Pedir a identidade de ROI deles não tem resposta.
    expect(roiIdentityOf('RIGHT_KNEE')).toBeNull();
    expect(roiIdentityOf('LEFT_SHOULDER')).toBeNull();
    expect(roiIdentityOf('COISA_NENHUMA')).toBeNull();
  });
});

describe('ida e volta', () => {
  it('preserva identidade e números', () => {
    const original = roi('Direita', 9);
    const medicao = toMeasurement(original)!;

    expect(medicao.joint_id).toBe('RIGHT_MCP_3');
    expect(medicao.t_mean).toBe(34.75);
    expect(medicao.sample_count).toBe(1400);
    expect(medicao.area).toBe(1438);

    const voltou = toJointRoi(medicao)!;
    expect(voltou.side).toBe('Direita');
    expect(voltou.landmarkId).toBe(9);
    expect(voltou.stats).toEqual(original.stats);
    expect(voltou.rgb).toEqual(original.rgb);
    // A cobertura não é gravada: volta calculada de `sample_count / area`, que é a
    // mesma conta que o analisador faz ao medir.
    expect(voltou.skinCoverage).toBeCloseTo(1400 / 1438);
  });

  it('a ROI sem articulação correspondente não vira medição', () => {
    // Gravar um id inventado faria a chave estrangeira recusar a análise inteira por
    // causa de uma região; descartar perde só ela.
    expect(toMeasurement(roi('Direita', 1))).toBeNull();
  });

  it('número ausente volta como NaN, não como zero', () => {
    // Uma região sem leitura válida não mediu zero grau. Zero entraria nas médias como
    // se fosse medição.
    const vazia: MeasurementDto = {
      joint_id: 'RIGHT_WRIST',
      t_mean: null,
      t_median: null,
      t_min: null,
      t_max: null,
      area: null,
      sample_count: null,
      shape: null,
      rgb_x: null,
      rgb_y: null,
      csv_x: null,
      csv_y: null,
      rx_csv: null,
      ry_csv: null,
      edited: true,
    };
    const voltou = toJointRoi(vazia)!;

    expect(Number.isNaN(voltou.stats.mean)).toBe(true);
    // Sem região medida não há cobertura a calcular, e zero é a verdade aqui.
    expect(voltou.skinCoverage).toBe(0);
    // Contagem é cardinalidade, e nesse caso zero é a verdade: nenhuma célula agregada.
    expect(voltou.stats.count).toBe(0);
    expect(voltou.edited).toBe(true);
  });
});
