import { CaptureSource, captureFromSingle } from './analysis-payload';
import { AffineMatrix, ThermalMatrix } from './image-analyzer.model';
import { JointRoi } from './joint-rois';

const IDENTIDADE: AffineMatrix = { a: 1, b: 0, tx: 0, c: 0, d: 1, ty: 0 };

const MATRIZ: ThermalMatrix = { width: 640, height: 480, values: new Float64Array(1) };

/** `landmarkId` importa: é dele e do lado que sai o `joint_id` do body map. */
function jointRoi(label: string, landmarkId = 0): JointRoi {
  return {
    side: 'Direita',
    landmarkId,
    label,
    key: `Direita:${landmarkId}`,
    rgb: { x: 10, y: 10 },
    csv: { x: 5, y: 5 },
    shape: 'circle',
    rxCsv: 10,
    ryCsv: 10,
    stats: { mean: 33, median: 33, max: 34, min: 32, area: 80, count: 78 },
    skinCoverage: 0.9,
    edited: false,
  } as JointRoi;
}

function source(overrides: Partial<CaptureSource> = {}): CaptureSource {
  return {
    matrix: MATRIZ,
    alignment: IDENTIDADE,
    mode: 'auto',
    autoMethod: 'silhouette',
    agreement: null,
    correction: null,
    jointRois: [jointRoi('Punho')],
    files: {
      optical: { size: 100, content_type: 'image/jpeg' },
      thermal: { size: 200, content_type: 'image/jpeg' },
      matrix: { size: 300, content_type: 'text/csv' },
    },
    ...overrides,
  };
}

describe('analysis-payload', () => {
  it('avulsa é uma sequência de um elemento, com posição nula', () => {
    const [captura] = captureFromSingle(source());

    // Índice nulo, e não 0: o banco precisa distinguir "não sei em que fase" de
    // "é basal", e 0 agora significa exatamente basal.
    expect(captura.capture_index).toBeNull();
    expect(captura.elapsed_seconds).toBeNull();
  });

  it('achata a afim nas seis colunas de alinhamento', () => {
    const [captura] = captureFromSingle(
      source({ alignment: { a: 0.5, b: 0.1, tx: 3, c: -0.1, d: 0.5, ty: 7 } }),
    );

    expect({
      a: captura.align_a,
      b: captura.align_b,
      tx: captura.align_tx,
      c: captura.align_c,
      d: captura.align_d,
      ty: captura.align_ty,
    }).toEqual({ a: 0.5, b: 0.1, tx: 3, c: -0.1, d: 0.5, ty: 7 });
  });

  it('modo manual registra o método como manual, não o automático anterior', () => {
    const [auto] = captureFromSingle(source({ mode: 'auto', autoMethod: 'fiducial' }));
    const [manual] = captureFromSingle(source({ mode: 'manual', autoMethod: 'fiducial' }));

    expect(auto.alignment_method).toBe('fiducial');
    expect(manual.alignment_method).toBe('manual');
  });

  it('traduz as medições para o vocabulário do body map', () => {
    const rois = [jointRoi('Punho', 0), jointRoi('MCP 3', 9)];
    const [captura] = captureFromSingle(source({ jointRois: rois }));

    // A regressão que este teste tranca: enviar `JointRoi[]` cru daqui fazia o
    // `POST /encounters/{id}/captures` responder 422 — `CaptureMeasurementIn` exige
    // `joint_id` e é `extra="forbid"`. E só quebrava quando havia ROI detectada,
    // porque com a lista vazia o payload passa. Por isso a asserção é sobre a
    // identidade traduzida, e não sobre a contagem.
    expect(captura.measurements.map((m) => m.joint_id)).toEqual(['RIGHT_WRIST', 'RIGHT_MCP_3']);
    // Os números são os que a tela mediu; o que muda é só a identidade.
    expect(captura.measurements[0].t_mean).toBe(33);
    expect(captura.measurements[0].sample_count).toBe(78);
    expect(captura.measurements[0].area).toBe(80);
    // Nenhum campo do formato interno do analisador atravessa: eles são exatamente
    // os que o `extra="forbid"` do backend recusa.
    expect(Object.keys(captura.measurements[0])).not.toContain('landmarkId');
    expect(Object.keys(captura.measurements[0])).not.toContain('stats');
  });

  it('descarta a ROI cujo landmark não é articulação do catálogo', () => {
    // O detector devolve 21 landmarks por mão e só 11 viram articulação. Inventar um
    // id faria a chave estrangeira recusar a análise inteira por causa de uma região.
    const [captura] = captureFromSingle(
      source({ jointRois: [jointRoi('Punho', 0), jointRoi('desconhecido', 7)] }),
    );

    expect(captura.measurements.map((m) => m.joint_id)).toEqual(['RIGHT_WRIST']);
  });

  it('mantém nulos quando não houve concordância nem correção fiducial', () => {
    const [captura] = captureFromSingle(source());
    expect(captura.agreement).toBeNull();
    expect(captura.fiducial_correction).toBeNull();
  });
});
