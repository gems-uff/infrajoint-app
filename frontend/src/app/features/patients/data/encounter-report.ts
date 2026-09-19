/**
 * O relatório PDF de uma consulta, como definição de documento do pdfmake.
 *
 * Módulo **puro**: recebe a consulta e os recursos já resolvidos (imagens e gráfico
 * como data URL) e devolve a definição. Nada aqui busca rede, toca DOM ou conhece
 * componente — é o que permite testá-lo com um objeto literal, como já faz
 * `analysis-payload.ts`. Quem resolve os recursos e chama o pdfmake é
 * `encounter-report.service.ts`.
 *
 * **Avulsa e sequência não são dois relatórios.** A diferença é a cardinalidade das
 * capturas, como já é no banco e no payload de escrita: uma avulsa não tem curva, não
 * tem coluna Final nem Δ, e mostra uma imagem em vez de duas. O resto do documento é
 * idêntico, e é por isso que não há dois construtores.
 */

import type {
  Column,
  Content,
  ContentTable,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import { DISEASE_ACTIVITY_META } from '../../analysis/body-map/disease-activity';
import { JointId } from '../../analysis/body-map/body-map.model';
import { JOINT_BY_ID } from '../../analysis/body-map/joint-catalog.data';
import { HandSide } from '../../analysis/image-analyzer/image-analyzer.model';
import { JOINT_ROI_DEFS, JointRoi } from '../../analysis/image-analyzer/joint-rois';
import { CurveFrame, buildRewarmingSeries } from '../../analysis/image-analyzer/rewarming-curve';
import { formatSeconds } from '../../analysis/image-analyzer/sequence.model';
import { CaptureDetail, EncounterDetail, Patient } from './patient.model';
import { toJointRois } from '../../analysis/joint-identity';

// --- Paleta e medidas -------------------------------------------------------
// Cinzas próprios, e não os tokens do Tailwind: o PDF não tem tema, não herda CSS
// e vai ser impresso — os valores precisam ser literais e ter contraste no papel.

const TINTA = '#1f2937';
const TINTA_FRACA = '#6b7280';
const REGUA = '#d1d5db';
const DESTAQUE = '#1b3a57';

/** Largura útil da página: A4 menos as duas margens de 40 pt. */
const LARGURA_UTIL = 515;

/** Vão entre as imagens da fileira, em pontos PDF. */
const VAO_IMAGENS = 12;

// --- Formatação -------------------------------------------------------------

/**
 * Número em pt-BR, ou travessão quando não é finito.
 *
 * Medição ausente vira `n/d`, e nunca `0,0`: uma articulação que não foi detectada e
 * uma que mediu zero são coisas diferentes, e o relatório é justamente onde essa
 * diferença precisa sobreviver.
 */
export function numero(valor: number, casas: number): string {
  return Number.isFinite(valor) ? valor.toFixed(casas).replace('.', ',') : 'n/d';
}

/** Delta com sinal explícito: `+2,6` lê melhor que `2,6` numa coluna de variação. */
export function delta(valor: number): string {
  if (!Number.isFinite(valor)) {
    return 'n/d';
  }
  return `${valor > 0 ? '+' : ''}${numero(valor, 1)}`;
}

function dataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

function data(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

/**
 * O rótulo do catálogo, com o id cru como último recurso.
 *
 * O catálogo já guarda `MCP 3 (mão direita)`, então não há mais conversão a fazer.
 * Houve: ele guardava o lado depois de um travessão, e este módulo o reescrevia só
 * para o documento. O travessão saiu do catálogo, que é onde ele incomodava a tela
 * também, e sobrou a busca com fallback.
 */
export function rotuloArticulacao(id: string): string {
  return JOINT_BY_ID.get(id as JointId)?.label ?? id;
}

const SEXO: Record<string, string> = {
  F: 'Feminino',
  M: 'Masculino',
  O: 'Outro',
  N: 'Não informado',
};

/**
 * Idade em anos na data da consulta, não na data de hoje.
 *
 * Um relatório reemitido dois anos depois precisa dizer a idade que o paciente tinha
 * quando foi examinado, senão ele deixa de descrever o exame que descreve.
 */
export function idadeNaConsulta(nascimento: string | null, consulta: string): number | null {
  if (!nascimento) {
    return null;
  }
  const nasceu = new Date(nascimento);
  const naquele = new Date(consulta);
  if (Number.isNaN(nasceu.getTime()) || Number.isNaN(naquele.getTime())) {
    return null;
  }
  let anos = naquele.getUTCFullYear() - nasceu.getUTCFullYear();
  const mes = naquele.getUTCMonth() - nasceu.getUTCMonth();
  if (mes < 0 || (mes === 0 && naquele.getUTCDate() < nasceu.getUTCDate())) {
    anos -= 1;
  }
  return anos >= 0 ? anos : null;
}

// --- Leitura das capturas ---------------------------------------------------

/**
 * As medições gravadas, reconstruídas no formato do analisador.
 *
 * Mesma conversão que `encounter-viewer.ts` faz, e pela mesma razão: a API devolve a
 * medição com a identidade clínica (`joint_id`) e os números em colunas, e o relatório
 * desenha a partir da ROI. Os campos são lidos adiante com tolerância a ausência,
 * porque uma medição restaurada de uma consulta antiga pode não tê-los todos.
 */
function medicoes(capture: CaptureDetail): readonly JointRoi[] {
  return toJointRois(capture.measurements);
}

/** A captura de referência: a basal da sequência, ou a única da avulsa. */
export function capturaReferencia(
  captures: readonly CaptureDetail[],
): CaptureDetail | null {
  return captures.find((c) => c.capture_index === 0) ?? captures[0] ?? null;
}

/**
 * A última captura no eixo de reaquecimento, ou `null` quando não há sequência.
 *
 * `null` para uma captura só é o que apaga as colunas Final e Δ — a avulsa não tem
 * desfecho a comparar, e uma coluna de travessões seria pior que coluna nenhuma.
 */
export function capturaFinal(captures: readonly CaptureDetail[]): CaptureDetail | null {
  const dinamicas = captures.filter((c) => c.elapsed_seconds !== null);
  if (captures.length < 2 || dinamicas.length === 0) {
    return null;
  }
  return dinamicas.reduce((maior, c) =>
    (c.elapsed_seconds ?? 0) > (maior.elapsed_seconds ?? 0) ? c : maior,
  );
}

/** Os quadros que a curva consome. Vazio na avulsa, que não tem eixo de tempo. */
export function quadrosDaCurva(captures: readonly CaptureDetail[]): CurveFrame[] {
  return captures
    // Índice nulo é a avulsa, que não tem eixo de tempo e portanto não tem curva.
    .filter((c) => c.capture_index !== null && c.elapsed_seconds !== null)
    .map((c) => ({
      timeSeconds: c.elapsed_seconds as number,
      kind: (c.capture_index === 0 ? 'baseline' : 'dynamic') as 'baseline' | 'dynamic',
      rois: medicoes(c),
    }));
}

/** Uma linha da tabela de medições. Campos não medidos são NaN, nunca zero. */
export interface LinhaMedicao {
  readonly side: HandSide;
  readonly label: string;
  readonly min: number;
  readonly mean: number;
  readonly max: number;
  /** Média na última captura. NaN na avulsa e quando a articulação sumiu. */
  readonly finalMean: number;
  /** `finalMean - mean`. NaN quando qualquer um dos dois falta. */
  readonly variacao: number;
}

function acharRoi(rois: readonly JointRoi[], side: HandSide, landmarkId: number) {
  return rois.find((r) => r?.side === side && r?.landmarkId === landmarkId);
}

function estatistica(roi: JointRoi | undefined, campo: 'min' | 'mean' | 'max'): number {
  const valor = roi?.stats?.[campo];
  return typeof valor === 'number' ? valor : NaN;
}

/**
 * As 22 linhas da tabela, em ordem estável: mão esquerda e depois direita, cada uma
 * na ordem do catálogo de ROIs.
 *
 * A ordem vem de `JOINT_ROI_DEFS`, e não da ordem em que as medições foram gravadas,
 * para que duas consultas do mesmo paciente possam ser lidas lado a lado.
 */
export function linhasDeMedicao(
  referencia: CaptureDetail | null,
  final: CaptureDetail | null,
): readonly LinhaMedicao[] {
  if (!referencia) {
    return [];
  }
  const roisRef = medicoes(referencia);
  const roisFim = final ? medicoes(final) : [];
  const linhas: LinhaMedicao[] = [];

  for (const side of ['Esquerda', 'Direita'] as const) {
    for (const def of JOINT_ROI_DEFS) {
      const roi = acharRoi(roisRef, side, def.landmarkId);
      const fim = acharRoi(roisFim, side, def.landmarkId);
      const mean = estatistica(roi, 'mean');
      const finalMean = final ? estatistica(fim, 'mean') : NaN;
      linhas.push({
        side,
        label: def.label,
        min: estatistica(roi, 'min'),
        mean,
        max: estatistica(roi, 'max'),
        finalMean,
        variacao: finalMean - mean,
      });
    }
  }
  // Uma mão que não apareceu em nenhuma captura sai inteira: 11 linhas de travessão
  // dizem menos que a ausência da seção, e a seção some sozinha ao filtrar aqui.
  const viu = (side: HandSide) =>
    linhas.some((l) => l.side === side && Number.isFinite(l.mean));
  return linhas.filter((l) => viu(l.side));
}

/** Uma curva média por mão, para o gráfico. */
export interface CurvaDaMao {
  readonly side: HandSide;
  readonly points: readonly { readonly timeSeconds: number; readonly value: number }[];
}

/**
 * Média das articulações, por mão, ao longo do tempo.
 *
 * Vinte e duas séries num gráfico de meia página é emaranhado, não informação — e o
 * número por articulação já está na tabela logo abaixo. Duas linhas mostram o que a
 * curva tem a dizer: se a mão reaqueceu, quando, e se as duas fizeram o mesmo.
 *
 * Sai de `buildRewarmingSeries` em vez de percorrer os quadros aqui porque é lá que
 * moram a ordenação por tempo e a semântica de lacuna (articulação ausente vira NaN,
 * e NaN é pulado na média em vez de virar zero).
 */
export function curvasPorMao(frames: readonly CurveFrame[]): readonly CurvaDaMao[] {
  if (frames.length === 0) {
    return [];
  }
  const series = buildRewarmingSeries(
    frames,
    JOINT_ROI_DEFS.map((d) => d.landmarkId),
    'mean',
  );
  const curvas: CurvaDaMao[] = [];

  for (const side of ['Esquerda', 'Direita'] as const) {
    const daMao = series.filter((s) => s.side === side);
    if (daMao.length === 0) {
      continue;
    }
    const points = daMao[0].points.map((ponto, i) => {
      const validos = daMao
        .map((s) => s.points[i]?.value ?? NaN)
        .filter((v) => Number.isFinite(v));
      return {
        timeSeconds: ponto.timeSeconds,
        value: validos.length > 0 ? validos.reduce((a, b) => a + b, 0) / validos.length : NaN,
      };
    });
    curvas.push({ side, points });
  }
  return curvas;
}

const METODO: Record<string, string> = {
  silhouette: 'silhueta',
  fiducial: 'marcadores fiduciais',
  manual: 'ajuste manual',
};

/**
 * A qualidade do dado em uma frase.
 *
 * **A concordância de silhueta não entra aqui, e a ausência é a decisão.** Ela não
 * tem limiar clínico definido, e um número sem escala num laudo convida a uma
 * interpretação que o número não sustenta — o leitor não tem como saber se 0,72 é
 * bom. Ela continua gravada em `agreement`, para quem for analisar a série com o
 * contexto que o laudo não tem.
 */
export function linhaDeQualidade(captures: readonly CaptureDetail[]): string {
  if (captures.length === 0) {
    return '';
  }
  const partes: string[] = [];

  const porMetodo = new Map<string, number>();
  for (const c of captures) {
    if (c.alignment_method) {
      porMetodo.set(c.alignment_method, (porMetodo.get(c.alignment_method) ?? 0) + 1);
    }
  }
  const metodos = [...porMetodo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([metodo, n]) => `${METODO[metodo] ?? metodo} em ${n} de ${captures.length}`);
  partes.push(metodos.length > 0 ? `Alinhamento por ${metodos.join(', ')}` : 'Sem alinhamento registrado');

  const comRessalva = captures.filter((c) => c.issue).length;
  if (comRessalva > 0) {
    partes.push(`${comRessalva} ${comRessalva === 1 ? 'captura' : 'capturas'} com ressalva`);
  }

  return `${partes.join('; ')}.`;
}

// --- Recursos resolvidos fora ----------------------------------------------

/** Uma imagem do documento, já baixada e reduzida. */
export interface ImagemDoRelatorio {
  /** Rótulo da coluna: `Óptica`, `Térmica basal`, `Térmica final (t = 10:00)`. */
  readonly titulo: string;
  readonly imagem: string;
}

/**
 * O que o documento precisa e o módulo puro não sabe produzir.
 *
 * Tudo opcional de propósito: uma URL assinada expira em 15 minutos, e um relatório
 * que falha inteiro porque uma imagem não voltou é pior que um relatório sem imagem.
 */
export interface RecursosDoRelatorio {
  /**
   * As imagens, na ordem em que aparecem.
   *
   * A foto óptica entra **uma vez**, e não uma por captura: a mão não se move durante
   * o reaquecimento, então a óptica da basal e a da final são a mesma imagem. O que
   * muda ao longo da sequência é a térmica, e é dela que vai um par.
   */
  readonly imagens: readonly ImagemDoRelatorio[];
  /** O gráfico da curva como PNG data URL. `null` na avulsa e se o canvas falhar. */
  readonly grafico: string | null;
  /** Nome do médico responsável, do perfil autenticado. */
  readonly medico: string | null;
  /** Quando o documento foi emitido. Injetado para o teste não depender do relógio. */
  readonly emitidoEm: Date;
}

// --- Blocos do documento ----------------------------------------------------

function titulo(texto: string): Content {
  return { text: texto, style: 'h2', margin: [0, 16, 0, 6] };
}

function paragrafo(texto: string): Content {
  return { text: texto, margin: [0, 0, 0, 2] };
}

function identificacao(detail: EncounterDetail, recursos: RecursosDoRelatorio): Content {
  const { patient: paciente } = detail;
  const idade = idadeNaConsulta(paciente.birth_date, detail.occurred_at);
  const nascimento = paciente.birth_date
    ? `${data(paciente.birth_date)}${idade !== null ? ` (${idade} anos)` : ''}`
    : 'não informado';

  const par = (rotulo: string, valor: string): Content[] => [
    { text: rotulo, style: 'rotulo' },
    { text: valor },
  ];

  const ausente = 'não informado';

  /**
   * Os diagnósticos numa linha, o principal primeiro.
   *
   * O código vai junto do nome porque o relatório sai do sistema: quem o lê depois
   * precisa do CID para reencontrar a coorte, e o nome sozinho não identifica.
   */
  function diagnosticos(p: Patient): string | null {
    if (p.diagnoses.length === 0) {
      return null;
    }
    return p.diagnoses.map((d) => `${d.label} (${d.code})`).join('; ');
  }

  return {
    table: {
      widths: ['auto', '*', 'auto', '*'],
      body: [
        [...par('Paciente', paciente.full_name), ...par('Consulta', dataHora(detail.occurred_at))],
        [...par('Nascimento', nascimento), ...par('Responsável', recursos.medico ?? ausente)],
        [
          ...par('Sexo', paciente.sex ? (SEXO[paciente.sex] ?? paciente.sex) : ausente),
          ...par('Emitido em', dataHora(recursos.emitidoEm.toISOString())),
        ],
        [
          ...par('Diagnóstico', diagnosticos(paciente) ?? ausente),
          { text: '' },
          { text: '' },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 4],
  } satisfies ContentTable;
}

function resumoClinico(detail: EncounterDetail): Content[] {
  const blocos: Content[] = [titulo('Resumo')];

  blocos.push(paragrafo(`Motivo: ${detail.reason || 'não informado'}`));

  const avaliacoes = Object.entries(detail.joint_evaluations ?? {});
  if (avaliacoes.length > 0) {
    const dolorosas = avaliacoes.filter(([, f]) => f.pain).length;
    const edemaciadas = avaliacoes.filter(([, f]) => f.swelling).length;
    blocos.push(
      paragrafo(
        `Mapa corporal: ${avaliacoes.length} articulações avaliadas · ` +
          `${dolorosas} dolorosas · ${edemaciadas} edemaciadas.`,
      ),
    );
  } else {
    blocos.push(paragrafo('Mapa corporal: não registrado nesta consulta.'));
  }

  const { cdai, das28 } = detail.scores ?? {};
  const indices: Content[] = [];
  if (cdai) {
    const faixa = DISEASE_ACTIVITY_META[cdai.level];
    indices.push({
      // A faixa vai em cor **e** por extenso: o relatório vai ser impresso, e cor
      // não pode ser o único portador de informação em papel preto e branco.
      text: [
        { text: 'CDAI ', bold: true },
        { text: numero(cdai.score, 1), bold: true },
        { text: ` (${faixa.label})`, color: faixa.hex },
      ],
    });
  }
  if (das28) {
    const faixa = DISEASE_ACTIVITY_META[das28.level];
    indices.push({
      text: [
        { text: 'DAS28 ', bold: true },
        { text: numero(das28.score, 2), bold: true },
        { text: ` (${faixa.label})`, color: faixa.hex },
      ],
    });
  }
  if (indices.length > 0) {
    blocos.push({ columns: indices, margin: [0, 6, 0, 0] });
  }

  // `uploading` precisa ser dito, e não virar silêncio. A consulta TEM análise: as
  // capturas estão gravadas e só os arquivos não foram confirmados no bucket. Omitir
  // a linha faria o relatório afirmar, por ausência, que não houve exame de imagem —
  // que é justamente a distinção que a tela também faz questão de mostrar.
  if (detail.analysis_status === 'uploading') {
    blocos.push(
      paragrafo(
        `Imagem térmica: ${detail.capture_count} capturas gravadas, com envio de imagens ` +
          'incompleto: as medições não podem ser apresentadas.',
      ),
    );
  } else if (detail.captures.length > 0) {
    const sequencia = detail.captures.length > 1;
    blocos.push(
      paragrafo(
        sequencia
          ? `Imagem térmica: sequência de ${detail.captures.length} capturas.`
          : 'Imagem térmica: captura avulsa.',
      ),
    );
  }

  return blocos;
}

function avaliacaoArticular(detail: EncounterDetail): Content[] {
  const avaliacoes = Object.entries(detail.joint_evaluations ?? {});
  if (avaliacoes.length === 0) {
    return [];
  }

  const blocos: Content[] = [titulo('Avaliação articular')];

  const afetadas = avaliacoes
    .filter(([, f]) => f.pain || f.swelling)
    .map(([id, f]) => ({ id, ...f }))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (afetadas.length === 0) {
    blocos.push(paragrafo('Nenhuma articulação com dor ou edema entre as avaliadas.'));
    return blocos;
  }

  blocos.push({
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto'],
      body: [
        [
          { text: 'Articulação', style: 'th' },
          { text: 'Dor', style: 'th', alignment: 'center' },
          { text: 'Edema', style: 'th', alignment: 'center' },
        ],
        ...afetadas.map((j) => [
          { text: rotuloArticulacao(j.id) },
          { text: j.pain ? 'sim' : 'não', alignment: 'center' as const },
          { text: j.swelling ? 'sim' : 'não', alignment: 'center' as const },
        ]),
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 6, 0, 0],
  } satisfies ContentTable);

  return blocos;
}

/**
 * Largura de cada imagem para a fileira caber na página.
 *
 * O teto de 240 pt existe para o caso de uma imagem só não crescer até ocupar meia
 * página sozinha: ela seria a coisa maior do documento sem ser a mais importante.
 */
export function larguraImagem(quantidade: number): number {
  if (quantidade <= 0) {
    return 0;
  }
  return Math.min(240, (LARGURA_UTIL - VAO_IMAGENS * (quantidade - 1)) / quantidade);
}

function fileiraDeImagens(recursos: RecursosDoRelatorio): Content[] {
  const { imagens } = recursos;
  if (imagens.length === 0) {
    return [];
  }
  const largura = larguraImagem(imagens.length);
  const coluna = (img: ImagemDoRelatorio): Column => ({
    stack: [
      { text: img.titulo, style: 'rotulo', margin: [0, 0, 0, 3] },
      { image: img.imagem, width: largura },
    ],
    width: 'auto',
  });

  return [{ columns: imagens.map(coluna), columnGap: VAO_IMAGENS, margin: [0, 8, 0, 0] }];
}

function tabelaDeMedicoes(linhas: readonly LinhaMedicao[], temFinal: boolean): Content[] {
  if (linhas.length === 0) {
    return [];
  }
  const cabecalho = [
    { text: 'Articulação', style: 'th' },
    { text: 'Mín', style: 'th', alignment: 'right' as const },
    { text: 'Média', style: 'th', alignment: 'right' as const },
    { text: 'Máx', style: 'th', alignment: 'right' as const },
    ...(temFinal
      ? [
          { text: 'Final', style: 'th', alignment: 'right' as const },
          { text: 'Δ', style: 'th', alignment: 'right' as const },
        ]
      : []),
  ];
  const colunas = cabecalho.length;
  const corpo: TableCell[][] = [cabecalho];

  for (const side of ['Esquerda', 'Direita'] as const) {
    const daMao = linhas.filter((l) => l.side === side);
    if (daMao.length === 0) {
      continue;
    }
    corpo.push([
      {
        text: `Mão ${side.toLowerCase()}`,
        style: 'subcabecalho',
        colSpan: colunas,
      },
      ...Array.from({ length: colunas - 1 }, () => ({ text: '' })),
    ]);
    for (const l of daMao) {
      corpo.push([
        { text: l.label },
        { text: numero(l.min, 1), alignment: 'right' },
        { text: numero(l.mean, 1), alignment: 'right' },
        { text: numero(l.max, 1), alignment: 'right' },
        ...(temFinal
          ? [
              { text: numero(l.finalMean, 1), alignment: 'right' as const },
              { text: delta(l.variacao), alignment: 'right' as const },
            ]
          : []),
      ]);
    }
  }

  return [
    {
      table: {
        // Repete o cabeçalho quando a tabela quebra de página — 22 linhas mais os
        // subcabeçalhos raramente cabem no que sobra da página das imagens.
        headerRows: 1,
        widths: ['*', ...Array.from({ length: colunas - 1 }, () => 'auto' as const)],
        body: corpo,
      },
      layout: 'lightHorizontalLines',
      margin: [0, 8, 0, 0],
    } satisfies ContentTable,
    {
      text: 'Temperaturas em °C. Mín, média e máx são da captura de referência.',
      style: 'nota',
      margin: [0, 4, 0, 0],
    },
  ];
}

function termografia(detail: EncounterDetail, recursos: RecursosDoRelatorio): Content[] {
  if (detail.analysis_status !== 'ready' || detail.captures.length === 0) {
    return [];
  }
  const captures = detail.captures;
  const sequencia = captures.length > 1;
  const referencia = capturaReferencia(captures);
  const final = capturaFinal(captures);

  const blocos: Content[] = [titulo('Análise termográfica')];

  if (sequencia) {
    const duracao = final?.elapsed_seconds ?? 0;
    blocos.push(
      paragrafo(
        `Sequência de ${captures.length} capturas: uma basal e ` +
          `${captures.length - 1} dinâmicas ao longo de ${formatSeconds(duracao)} de reaquecimento.`,
      ),
    );
  } else {
    blocos.push(paragrafo('Captura avulsa, sem eixo de reaquecimento.'));
  }
  blocos.push({ text: linhaDeQualidade(captures), style: 'nota', margin: [0, 2, 0, 0] });

  blocos.push(...fileiraDeImagens(recursos));

  if (recursos.grafico) {
    blocos.push({
      image: recursos.grafico,
      width: 484,
      margin: [0, 12, 0, 0],
    });
    blocos.push({
      text:
        'Média das articulações de cada mão nas capturas dinâmicas. O eixo conta desde o ' +
        'fim do resfriamento e começa na primeira captura dinâmica, não em 0:00. A basal, ' +
        'registrada antes do resfriamento, está na tabela abaixo.',
      style: 'nota',
      margin: [0, 3, 0, 0],
    });
  }

  blocos.push(...tabelaDeMedicoes(linhasDeMedicao(referencia, final), final !== null));

  return blocos;
}

// --- O documento ------------------------------------------------------------

/** Nome do arquivo: paciente e data, para o download não virar `consulta (3).pdf`. */
export function nomeDoArquivo(detail: EncounterDetail): string {
  const nome = detail.patient.full_name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `consulta-${nome || 'paciente'}-${detail.occurred_at.slice(0, 10)}.pdf`;
}

/**
 * Monta o relatório inteiro.
 *
 * As seções vazias somem em vez de virarem "não registrado" — uma consulta só com
 * body map não deve produzir três páginas de cabeçalhos anunciando ausências. A
 * exceção é o resumo, onde a ausência do mapa é dita, porque ali ela é o achado.
 */
export function montarRelatorio(
  detail: EncounterDetail,
  recursos: RecursosDoRelatorio,
): TDocumentDefinitions {
  const faixa = `${detail.patient.full_name} · ${dataHora(detail.occurred_at)}`;

  return {
    info: {
      title: `Relatório de consulta de ${detail.patient.full_name}`,
      author: recursos.medico ?? 'InfraJoint',
    },
    pageSize: 'A4',
    pageMargins: [40, 56, 40, 48],

    header: () => ({
      columns: [
        { text: 'InfraJoint · Relatório de consulta', style: 'faixa' },
        { text: faixa, style: 'faixa', alignment: 'right' },
      ],
      margin: [40, 24, 40, 0],
    }),

    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: 'Documento gerado automaticamente. As medições termográficas são medida física, não diagnóstico.',
          style: 'faixa',
        },
        { text: `${currentPage} / ${pageCount}`, style: 'faixa', alignment: 'right', width: 40 },
      ],
      margin: [40, 12, 40, 0],
    }),

    defaultStyle: { font: 'Roboto', fontSize: 9, color: TINTA, lineHeight: 1.25 },

    styles: {
      h1: { fontSize: 16, bold: true, color: DESTAQUE },
      h2: { fontSize: 11, bold: true, color: DESTAQUE },
      th: { bold: true, fontSize: 8, color: TINTA_FRACA },
      subcabecalho: { bold: true, fontSize: 8, color: DESTAQUE, margin: [0, 3, 0, 1] },
      rotulo: { fontSize: 8, color: TINTA_FRACA },
      nota: { fontSize: 8, color: TINTA_FRACA },
      faixa: { fontSize: 7, color: TINTA_FRACA },
    },

    content: [
      { text: 'Relatório de consulta', style: 'h1' },
      {
        canvas: [{ type: 'line', x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 1, lineColor: REGUA }],
        margin: [0, 2, 0, 8],
      },
      identificacao(detail, recursos),
      ...resumoClinico(detail),
      ...avaliacaoArticular(detail),
      ...termografia(detail, recursos),
    ],
  };
}
