import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  Chart,
  ChartDataset,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

import { RewarmingSeries } from '../../rewarming-curve';
import { formatSeconds } from '../../sequence.model';

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend);

/** Chart hues matching the app's side convention (cyan = left, amber = right). */
const SIDE_COLORS = { Esquerda: '#06b6d4', Direita: '#f59e0b' } as const;
/** Border dash per joint (order of selection) so same-side series stay apart. */
const JOINT_DASHES: readonly (readonly number[])[] = [[], [8, 4], [3, 3], [12, 4, 3, 4]];

interface LinePoint {
  x: number;
  y: number;
}

/**
 * Rewarming curve (temperature × time) rendered with Chart.js: one line per
 * (side, joint) series, colour for the hand and `borderDash` for the joint,
 * plus a vertical playhead synced with the timeline. Clicking the plot emits
 * the nearest capture time so the viewer can jump to that frame.
 *
 * The plot carries the dynamic captures and nothing else. A resting-level line
 * per series was tried and dropped: it doubled the strokes on a plot that
 * already spends colour and dash on two variables, and the resting value is
 * read from the baseline capture itself, in the timeline.
 */
@Component({
  selector: 'app-rewarming-chart',
  templateUrl: './rewarming-chart.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RewarmingChart {
  /** Curve series (already filtered to the user's joint selection). */
  readonly series = input.required<readonly RewarmingSeries[]>();
  /** Time (s) of the active capture — the playhead. Null hides it. */
  readonly activeTime = input<number | null>(null);
  /** Emitted when the user clicks the plot: the clicked series time (s). */
  readonly timeSelected = output<number>();

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private chart: Chart<'line', LinePoint[]> | null = null;
  /** Read by the playhead plugin at draw time (closure state). */
  private playheadTime: number | null = null;

  constructor() {
    effect(() => {
      const series = this.series();
      if (this.isBrowser) {
        this.render(series);
      }
    });
    effect(() => {
      this.playheadTime = this.activeTime();
      this.chart?.update('none');
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private render(series: readonly RewarmingSeries[]): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) {
      return;
    }
    const datasets = this.buildDatasets(series);
    // The canvas lives inside an @if: when it is re-created, the old chart
    // instance points at a detached element and must be rebuilt.
    if (this.chart && this.chart.canvas !== canvas) {
      this.chart.destroy();
      this.chart = null;
    }
    if (!this.chart) {
      this.chart = this.createChart(canvas);
    }
    this.chart.data.datasets = datasets;
    this.chart.update('none');
  }

  private buildDatasets(series: readonly RewarmingSeries[]): ChartDataset<'line', LinePoint[]>[] {
    const datasets: ChartDataset<'line', LinePoint[]>[] = [];
    const jointOrder = [...new Set(series.map((s) => s.landmarkId))];

    for (const s of series) {
      const color = SIDE_COLORS[s.side];
      const dash = JOINT_DASHES[jointOrder.indexOf(s.landmarkId) % JOINT_DASHES.length];
      datasets.push({
        label: s.label,
        data: s.points.map((p) => ({ x: p.timeSeconds, y: p.value })),
        // O primeiro e o último ponto ficam exatamente na borda da área de
        // plotagem; sem isto, o Chart.js corta metade de cada um.
        clip: false,
        borderColor: color,
        backgroundColor: color,
        borderDash: [...dash],
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        spanGaps: false,
        tension: 0.25,
      });
    }
    return datasets;
  }

  private createChart(canvas: HTMLCanvasElement): Chart<'line', LinePoint[]> {
    const playhead = {
      id: 'playhead',
      afterDatasetsDraw: (chart: Chart) => {
        const time = this.playheadTime;
        if (time === null) {
          return;
        }
        const x = chart.scales['x'].getPixelForValue(time);
        const { top, bottom } = chart.chartArea;
        if (!Number.isFinite(x) || x < chart.chartArea.left || x > chart.chartArea.right) {
          return;
        }
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.restore();
      },
    };

    return new Chart<'line', LinePoint[]>(canvas, {
      type: 'line',
      data: { datasets: [] },
      plugins: [playhead],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        onClick: (_event, elements, chart) => {
          const hit = elements[0];
          if (!hit) {
            return;
          }
          const point = chart.data.datasets[hit.datasetIndex].data[hit.index] as LinePoint;
          this.timeSelected.emit(point.x);
        },
        scales: {
          x: {
            type: 'linear',
            // `bounds: 'data'` porque o padrão ('ticks') arredonda o mínimo para
            // baixo até um número redondo: com a primeira dinâmica em 15 s, a
            // escala ia até 0 e abria um vazio no lugar exato de onde a basal
            // saiu — que é justamente a leitura de "captura faltando" que tirar
            // a basal do eixo veio evitar. Assim as pontas do eixo são a
            // primeira e a última captura, e os rótulos das pontas dizem isso.
            //
            // Sem `grace`: ele não é margem, é aumento da escala — e com
            // `bounds: 'data'` os extremos esticados viram os rótulos das
            // pontas (0:12, 5:03), instantes que não existem. A folga para o
            // ponto da borda não ser cortado vem do `clip: false` do dataset.
            bounds: 'data',
            title: { display: true, text: 'Tempo desde o fim do resfriamento' },
            ticks: { callback: (value) => formatSeconds(Number(value)) },
          },
          y: {
            type: 'linear',
            title: { display: true, text: 'Temperatura (°C)' },
          },
        },
        plugins: {
          legend: { labels: { usePointStyle: true } },
          tooltip: {
            callbacks: {
              title: (items) =>
                items.length ? `t = ${formatSeconds(items[0].parsed.x ?? 0)}` : '',
              label: (item) =>
                `${item.dataset.label}: ${(item.parsed.y ?? NaN).toFixed(2).replace('.', ',')} °C`,
            },
          },
        },
      },
    });
  }
}
