import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';

import { ImageAnalyzerPage } from '../../../analysis/pages/image-analyzer-page/image-analyzer-page';
import { messageFromError } from '../../data/api-error';
import { analysisBadgeOf } from '../../data/encounter-summary';
import { restoreCaptures } from '../../data/encounter-viewer';
import { EncounterDetail } from '../../data/patient.model';
import { PatientsService } from '../../data/patients.service';

/**
 * Os achados do analisador de imagens de uma consulta gravada.
 *
 * A tela **é** o analisador, hidratado com o que foi gravado — não uma cópia dele.
 * Foi a lição de tentar o contrário: uma segunda tela que precisa parecer com a
 * primeira diverge a cada rodada (tabela sem máximo e mínimo, curva com padrões
 * diferentes, ROIs sem manipulação). Reusando, não há o que replicar.
 *
 * Este componente faz três coisas e nada mais: busca a consulta, traduz as capturas
 * gravadas para o formato do analisador, e situa o leitor — de quem é esta consulta
 * e de que dia. O resto do contexto clínico mora na página da consulta, uma acima.
 */
@Component({
  selector: 'app-encounter-analysis-page',
  imports: [DatePipe, RouterLink, LucideDynamicIcon, ImageAnalyzerPage],
  templateUrl: './encounter-analysis-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EncounterAnalysisPage {
  /** Vem do `:encounterId` da rota, via withComponentInputBinding(). */
  readonly encounterId = input.required<string>();

  private readonly patients = inject(PatientsService);
  private readonly analyzer = viewChild(ImageAnalyzerPage);

  protected readonly detail = signal<EncounterDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  /** A consulta tem capturas gravadas, mas nenhum arquivo pôde ser lido do bucket. */
  protected readonly semImagens = signal(false);

  protected readonly analysisBadge = computed(() => {
    const encounter = this.detail();
    return encounter ? analysisBadgeOf(encounter) : null;
  });
  protected readonly hasCaptures = computed(() => (this.detail()?.captures.length ?? 0) > 0);

  /**
   * Guarda de hidratação. Campo comum, e **não** um sinal, de propósito.
   *
   * A versão anterior lia `restoring()` dentro do próprio effect: ligar a flag o
   * fazia rerodar, e o `finally` desligá-la o fazia rerodar de novo — só que agora
   * sem nada barrando. O resultado era um laço que rebaixava todos os arquivos
   * indefinidamente, com a mensagem de carregamento presa na tela.
   */
  private hidratada: string | null = null;

  constructor() {
    effect(() => this.load(this.encounterId()));

    // Hidrata quando a consulta chega E o analisador está na árvore. Lê só esses
    // dois sinais: qualquer outro criaria realimentação.
    effect(() => {
      const encounter = this.detail();
      const analisador = this.analyzer();
      if (!encounter || !analisador || encounter.captures.length === 0) {
        return;
      }
      if (this.hidratada === encounter.id) {
        return;
      }
      // Sem indicador próprio: quem avisa que está carregando é o analisador, que
      // já mostra "Carregando análise gravada…" enquanto `fromSaved` não abriu.
      // Dois avisos simultâneos para a mesma espera pareciam duas esperas.
      this.hidratada = encounter.id;
      restoreCaptures(encounter.captures)
        .then((capturas) => {
          // Nenhuma captura reconstruída: as URLs de leitura não vieram — R2 não
          // configurado, ou os objetos não estão mais lá. Sem isto o analisador
          // ficava para sempre em "Carregando análise gravada…", porque ele não
          // tem como saber que a hidratação terminou sem nada.
          if (capturas.length === 0) {
            this.semImagens.set(true);
            return undefined;
          }
          return analisador.restoreAnalysis(capturas);
        })
        .catch(() => this.error.set('Não foi possível carregar as imagens desta análise.'));
    });
  }

  private load(id: string): void {
    this.hidratada = null;
    this.loading.set(true);
    this.error.set(null);
    this.semImagens.set(false);
    this.patients.getEncounter(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      },
      error: (cause: unknown) => {
        this.error.set(messageFromError(cause));
        this.loading.set(false);
      },
    });
  }
}
