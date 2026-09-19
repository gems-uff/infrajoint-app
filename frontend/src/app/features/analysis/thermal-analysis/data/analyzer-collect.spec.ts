import {
  AnalyzerReadout,
  SequenceReadout,
  collectSequenceAnalysis,
  collectSingleAnalysis,
  uploadKey,
} from './analyzer-collect';

function arquivo(nome: string, tipo: string): File {
  return new File(['conteúdo'], nome, { type: tipo });
}

function readout(overrides: Partial<AnalyzerReadout> = {}): AnalyzerReadout {
  return {
    matrix: { width: 640, height: 480, values: new Float64Array(1) },
    activeMatrix: { a: 1, b: 0, tx: 0, c: 0, d: 1, ty: 0 },
    mode: 'auto',
    autoMethod: 'silhouette',
    agreement: null,
    correction: null,
    jointRois: [],
    opticalFile: arquivo('v.jpeg', 'image/jpeg'),
    thermalFile: arquivo('t.jpeg', 'image/jpeg'),
    matrixFile: arquivo('m.csv', 'text/csv'),
    ...overrides,
  };
}

describe('collectSingleAnalysis', () => {
  it('declara os três arquivos e devolve o mapa para casar com as URLs', () => {
    const coletado = collectSingleAnalysis(readout())!;

    expect(coletado.payload.captures).toHaveLength(1);
    const captura = coletado.payload.captures[0] as Record<string, unknown>;
    expect(Object.keys(captura['files'] as object).sort()).toEqual([
      'matrix',
      'optical',
      'thermal',
    ]);
    // Chaveado por índice nulo, igual ao que o payload envia: é por esta chave que
    // a URL assinada reencontra o arquivo no envio.
    expect([...coletado.files.keys()].sort()).toEqual([
      uploadKey(null, 'matrix'),
      uploadKey(null, 'optical'),
      uploadKey(null, 'thermal'),
    ]);
  });

  it('declara o content_type do próprio arquivo', () => {
    // Precisa bater com o que o backend assina; divergir faz o R2 responder 403.
    const coletado = collectSingleAnalysis(readout())!;
    const files = (coletado.payload.captures[0] as Record<string, unknown>)['files'] as Record<
      string,
      { content_type: string }
    >;
    expect(files['matrix'].content_type).toBe('text/csv');
    expect(files['optical'].content_type).toBe('image/jpeg');
  });

  it.each(['opticalFile', 'thermalFile', 'matrixFile'] as const)(
    'devolve null sem o %s — a captura são os três arquivos',
    (ausente) => {
      // Um subconjunto grava uma análise que ninguém consegue reabrir, e o backend
      // já a recusa com 422 — depois de a consulta existir, presa em `uploading`.
      expect(collectSingleAnalysis(readout({ [ausente]: null }))).toBeNull();
    },
  );

  it('devolve null sem alinhamento — não há medição a gravar', () => {
    // Gravar assim deixaria a consulta presa em analysis_status='uploading'.
    expect(collectSingleAnalysis(readout({ activeMatrix: null }))).toBeNull();
    expect(collectSingleAnalysis(readout({ matrix: null }))).toBeNull();
  });

  it('traduz as medições, como o caminho da sequência', () => {
    // A regressão: os demais testes desta suíte usam `jointRois: []`, e com a lista
    // vazia o payload passa. Era exatamente por isso que ninguém via a avulsa mandar
    // `JointRoi[]` cru e o backend recusar com 422 — o caso da lista cheia, que é o
    // único útil, não era exercido em lugar nenhum.
    const rois = [
      {
        side: 'Direita',
        landmarkId: 9,
        label: 'MCP 3',
        key: 'Direita:9',
        rgb: { x: 10, y: 20 },
        csv: { x: 1, y: 2 },
        shape: 'circle',
        rxCsv: 10,
        ryCsv: 10,
        stats: { mean: 34.2, median: 34.1, max: 35, min: 33.5, area: 314, count: 300 },
        skinCoverage: 0.95,
        edited: false,
      },
    ] as never;

    const captura = collectSingleAnalysis(readout({ jointRois: rois }))!.payload
      .captures[0] as Record<string, unknown>;
    const medicoes = captura['measurements'] as readonly Record<string, unknown>[];

    expect(medicoes).toHaveLength(1);
    expect(medicoes[0]['joint_id']).toBe('RIGHT_MCP_3');
    expect(medicoes[0]['t_mean']).toBe(34.2);
    expect(medicoes[0]).not.toHaveProperty('landmarkId');
  });

  it('a captura avulsa não tem posição na sequência', () => {
    const captura = collectSingleAnalysis(readout())!.payload.captures[0] as Record<
      string,
      unknown
    >;
    // A avulsa se declara pelo índice nulo — não há mais uma `phase` ao lado.
    expect(captura['capture_index']).toBeNull();
    expect(captura['elapsed_seconds']).toBeNull();
  });
});

function captura(index: number, overrides: Partial<SequenceReadout> = {}): SequenceReadout {
  return {
    index,
    timeSeconds: index * 15,
    matrix: { width: 640, height: 480, values: new Float64Array(1) },
    alignment: { a: 0.5, b: 0, tx: 1, c: 0, d: 0.5, ty: 2 },
    autoMethod: 'silhouette',
    agreement: null,
    correction: null,
    issue: null,
    jointRois: [],
    opticalFile: arquivo(`v${index}.jpeg`, 'image/jpeg'),
    thermalFile: arquivo(`t${index}.jpeg`, 'image/jpeg'),
    matrixFile: arquivo(`m${index}.csv`, 'text/csv'),
    ...overrides,
  };
}

describe('collectSequenceAnalysis', () => {
  it('N capturas viram N payloads, sem discriminador', () => {
    const coletado = collectSequenceAnalysis(Array.from({ length: 21 }, (_, i) => captura(i)))!;

    expect(coletado.payload.captures).toHaveLength(21);
    // Três arquivos por captura, casados por índice com as URLs assinadas.
    expect(coletado.files.size).toBe(63);
    expect(coletado.files.get(uploadKey(7, 'matrix'))!.name).toBe('m7.csv');
  });

  it('preserva a posição de cada captura na sequência', () => {
    const coletado = collectSequenceAnalysis([captura(0), captura(1), captura(2)])!;
    const indices = coletado.payload.captures.map(
      (c) => (c as Record<string, unknown>)['capture_index'],
    );
    const tempos = coletado.payload.captures.map(
      (c) => (c as Record<string, unknown>)['elapsed_seconds'],
    );

    // Uma basal só: ela é o índice 0, e `unique (encounter_id, capture_index)` no
    // banco garante que não haja duas.
    expect(indices).toEqual([0, 1, 2]);
    expect(tempos).toEqual([0, 15, 30]);
  });

  it('grava a captura que falhou, com o motivo, em vez de descartá-la', () => {
    // Descartar esconderia por que a curva tem um buraco.
    const quebrada = captura(3, { alignment: null, autoMethod: null, issue: 'sem alinhamento' });
    const coletado = collectSequenceAnalysis([captura(0), quebrada])!;

    const registro = coletado.payload.captures[1] as Record<string, unknown>;
    expect(registro['issue']).toBe('sem alinhamento');
    expect(registro['align_a']).toBeNull();
    expect(registro['alignment_method']).toBeNull();
    // Os arquivos dela sobem assim mesmo — o dado bruto continua sendo o dado bruto.
    expect(coletado.files.has(uploadKey(3, 'optical'))).toBe(true);
  });

  it('as medições vêm prontas, só traduzidas', () => {
    const rois = [
      {
        side: 'Direita',
        landmarkId: 0,
        label: 'Punho',
        key: 'Direita:0',
        rgb: { x: 10, y: 20 },
        csv: { x: 1, y: 2 },
        shape: 'ellipse',
        rxCsv: 27,
        ryCsv: 17,
        stats: { mean: 34.75, median: 34.7, max: 35.4, min: 34, area: 1438, count: 1400 },
        skinCoverage: 1,
        edited: false,
      },
    ] as never;
    const coletado = collectSequenceAnalysis([captura(0, { jointRois: rois })])!;

    const medicoes = (coletado.payload.captures[0] as Record<string, unknown>)[
      'measurements'
    ] as readonly Record<string, unknown>[];

    // Os valores são os mesmos que a curva desenhou; recalcular abriria espaço para o
    // prontuário mostrar número diferente do que o médico viu. O que muda é só a
    // identidade: lado + landmark do MediaPipe viram o id do body map, porque é ele que
    // a API conhece e é ele que permite cruzar com a avaliação articular.
    expect(medicoes).toHaveLength(1);
    expect(medicoes[0]['joint_id']).toBe('RIGHT_WRIST');
    expect(medicoes[0]['t_mean']).toBe(34.75);
    expect(medicoes[0]['area']).toBe(1438);
    expect(medicoes[0]['sample_count']).toBe(1400);
  });

  it('sequência vazia não vira análise', () => {
    expect(collectSequenceAnalysis([])).toBeNull();
  });
});
