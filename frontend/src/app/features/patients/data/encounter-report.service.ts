/**
 * Gera e baixa o relatório PDF de uma consulta.
 *
 * É o lado impuro de `encounter-report.ts`: baixa as imagens do bucket, desenha o
 * gráfico num canvas solto e chama o pdfmake. A montagem do documento continua lá,
 * pura e testável — aqui só mora o que precisa de rede, DOM ou biblioteca.
 *
 * **O pdfmake entra por `import()` dinâmico.** São ~1,8 MB entre a biblioteca e as
 * fontes, e ninguém deve pagá-los ao abrir uma consulta que não vai exportar. O
 * import tardio também resolve o SSR: a biblioteca toca APIs de navegador no topo do
 * módulo, e no servidor ela nunca chega a ser avaliada.
 */

import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import {
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
} from 'chart.js';

import { imageToThumbnail, loadImage } from '../../analysis/image-analyzer/dom-images';
import { formatSeconds } from '../../analysis/image-analyzer/sequence.model';
import {
  CurvaDaMao,
  ImagemDoRelatorio,
  capturaFinal,
  capturaReferencia,
  curvasPorMao,
  montarRelatorio,
  nomeDoArquivo,
  quadrosDaCurva,
} from './encounter-report';
import { CaptureDetail, EncounterDetail } from './patient.model';

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend);

/** Mesmas cores do gráfico da tela: ciano à esquerda, âmbar à direita. */
const CORES: Record<CurvaDaMao['side'], string> = {
  Esquerda: '#06b6d4',
  Direita: '#f59e0b',
};

/**
 * Largura das imagens embutidas, em pixels.
 *
 * O dobro dos 236 pt que elas ocupam no papel — o suficiente para não pixelizar na
 * impressão sem carregar a resolução original, que sozinha faria o arquivo passar de
 * dezenas de MB numa sequência.
 */
const LARGURA_IMAGEM_PX = 560;

/** Canvas do gráfico. Grande, para o PDF reduzir e ganhar nitidez. */
const GRAFICO = { largura: 1000, altura: 420 } as const;

/** O módulo do pdfmake, como o TypeScript o conhece. */
type ModuloPdfMake = typeof import('pdfmake/build/pdfmake');

/**
 * Desembrulha o módulo do pdfmake, seja qual for a forma que o ambiente lhe deu.
 *
 * O build da biblioteca é UMD, e os dois ambientes o expõem diferente: no Node a
 * interop de CommonJS sintetiza os exports nomeados, e no navegador o esbuild não
 * consegue — o chunk termina em `export default` e nada mais. Sem isto,
 * `pdfMake.createPdf` chega `undefined` só no navegador, que é o pior lugar para a
 * diferença aparecer: o teste passa e o botão quebra.
 *
 * O `typeof` decide pelo valor, e não pelo tipo, porque é no valor que a diferença
 * está. O cast é inevitável — `@types/pdfmake` declara os nomeados e nenhum default,
 * então a forma que o navegador produz não é representável no tipo.
 */
export function moduloPdfMake(modulo: unknown): ModuloPdfMake {
  const carregado = modulo as ModuloPdfMake & { readonly default?: ModuloPdfMake };
  return typeof carregado.createPdf === 'function' ? carregado : (carregado.default as ModuloPdfMake);
}

@Injectable({ providedIn: 'root' })
export class EncounterReportService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * Monta o PDF da consulta e dispara o download.
   *
   * `medico` vem de fora, e é o responsável pela consulta, não necessariamente quem
   * está exportando: desde o acervo de pesquisa, um pesquisador abre e exporta a
   * consulta registrada por outro. Quem resolve os dois casos é a tela; este serviço
   * não precisa conhecer autenticação para escrever um nome no cabeçalho.
   */
  async download(detail: EncounterDetail, medico: string | null): Promise<void> {
    if (!this.isBrowser) {
      return;
    }

    const [imagens, grafico] = await Promise.all([
      this.imagensDoRelatorio(detail.captures),
      this.grafico(detail.captures),
    ]);

    const documento = montarRelatorio(detail, {
      imagens,
      grafico,
      medico,
      emitidoEm: new Date(),
    });

    const [pdf, fontes] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);
    const pdfMake = moduloPdfMake(pdf);
    // Roboto já é a fonte padrão do pdfmake 0.3; falta só entregar os arquivos dela,
    // e é ela que cobre a acentuação do português.
    pdfMake.addVirtualFileSystem(fontes.default);

    await pdfMake.createPdf(documento).download(nomeDoArquivo(detail));
  }

  /**
   * As imagens que vão para o documento.
   *
   * **Uma óptica só.** A mão não se move durante o reaquecimento, então a foto da
   * basal e a da final são a mesma imagem: mostrar as duas gastava meia fileira para
   * repetir o que já estava dito. O que evolui é a térmica, e dela vai um par.
   *
   * E são duas térmicas, não as 21. As capturas intermediárias são quase idênticas a
   * olho nu, porque o que muda entre elas são décimos de grau, que só a curva e a
   * tabela mostram. Embuti-las todas somaria dezenas de MB sem nada legível.
   */
  private async imagensDoRelatorio(
    captures: readonly CaptureDetail[],
  ): Promise<readonly ImagemDoRelatorio[]> {
    const referencia = capturaReferencia(captures);
    if (!referencia) {
      return [];
    }
    const final = capturaFinal(captures);

    const alvos: { readonly titulo: string; readonly url: string | null }[] = [
      { titulo: 'Óptica', url: referencia.files['optical']?.url ?? null },
      {
        titulo: final ? 'Térmica basal' : 'Térmica',
        url: referencia.files['thermal']?.url ?? null,
      },
    ];
    if (final) {
      alvos.push({
        titulo: `Térmica final (t = ${formatSeconds(final.elapsed_seconds ?? 0)})`,
        url: final.files['thermal']?.url ?? null,
      });
    }

    const baixadas = await Promise.all(
      alvos.map(async ({ titulo, url }) => ({ titulo, imagem: await this.baixarImagem(url) })),
    );
    // A que não voltou sai da fileira em vez de virar coluna vazia: as demais se
    // reacomodam sozinhas, porque a largura é calculada a partir da quantidade.
    return baixadas.filter((i): i is ImagemDoRelatorio => i.imagem !== null);
  }

  /**
   * Baixa e reduz uma imagem, ou devolve `null`.
   *
   * A falha é engolida de propósito: as URLs assinadas valem 15 minutos e o R2 pode
   * simplesmente não estar configurado. Um relatório sem foto ainda tem as
   * temperaturas, a curva e os achados — abortar tudo por uma imagem seria trocar um
   * documento incompleto por documento nenhum.
   */
  private async baixarImagem(url: string | null): Promise<string | null> {
    if (!url) {
      return null;
    }
    try {
      const resposta = await fetch(url);
      if (!resposta.ok) {
        return null;
      }
      const blob = await resposta.blob();
      const arquivo = new File([blob], 'captura.jpeg', { type: blob.type || 'image/jpeg' });
      return imageToThumbnail(await loadImage(arquivo), LARGURA_IMAGEM_PX);
    } catch {
      return null;
    }
  }

  /**
   * O gráfico da curva como PNG, ou `null` quando não há curva.
   *
   * Desenhado num canvas fora do documento: o Chart.js não exige estar montado, só
   * precisa de dimensões e de `responsive: false` — sem isso ele tentaria medir um
   * contêiner que não existe e desenharia num canvas de tamanho zero.
   */
  private async grafico(captures: readonly CaptureDetail[]): Promise<string | null> {
    const curvas = curvasPorMao(quadrosDaCurva(captures));
    if (curvas.length === 0 || captures.length < 2) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = GRAFICO.largura;
    canvas.height = GRAFICO.altura;

    // O canvas nasce transparente, e o PDF não garante fundo branco atrás da imagem.
    const fundoBranco = {
      id: 'fundo',
      beforeDraw: (chart: Chart) => {
        const ctx = chart.ctx;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      },
    };

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: curvas.map((curva) => ({
          label: `Mão ${curva.side.toLowerCase()}`,
          data: curva.points.map((p) => ({ x: p.timeSeconds, y: p.value })),
          clip: false,
          borderColor: CORES[curva.side],
          backgroundColor: CORES[curva.side],
          borderWidth: 3,
          pointRadius: 4,
          spanGaps: false,
        })),
      },
      plugins: [fundoBranco],
      options: {
        responsive: false,
        animation: false,
        // O canvas é reduzido ~2× no papel; sem aumentar a fonte aqui os rótulos
        // chegariam ao PDF com metade do tamanho do texto ao redor.
        font: { size: 18 },
        scales: {
          x: {
            type: 'linear',
            // Mesma razão do gráfico da tela (`rewarming-chart.ts`): sem isto a
            // escala arredonda o mínimo até 0 e abre um vazio antes da primeira
            // dinâmica, no lugar de onde a basal saiu. A margem das pontas vem
            // do `clip: false` do dataset, não de `grace` — ver o comentário lá.
            bounds: 'data',
            title: {
              display: true,
              text: 'Tempo desde o fim do resfriamento',
              font: { size: 18 },
            },
            ticks: { callback: (v) => formatSeconds(Number(v)), font: { size: 16 } },
          },
          y: {
            type: 'linear',
            title: { display: true, text: 'Temperatura (°C)', font: { size: 18 } },
            ticks: { font: { size: 16 } },
          },
        },
        plugins: {
          legend: { labels: { usePointStyle: true, font: { size: 18 } } },
        },
      },
    });

    const png = canvas.toDataURL('image/png');
    // Sem isto o Chart.js mantém o canvas vivo num registro interno, e uma segunda
    // exportação na mesma sessão encontraria o id já em uso.
    chart.destroy();
    return png;
  }
}
