import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';

import { messageFromError } from '../../../../patients/data/api-error';
import { Encounter, Patient } from '../../../../patients/data/patient.model';
import { PatientsService } from '../../../../patients/data/patients.service';
import { Algorithm, AlgorithmResult } from '../../algorithm.model';
import { AlgorithmsService } from '../../algorithms.service';
import { AlgorithmResultView } from '../../components/algorithm-result-view/algorithm-result-view';

/**
 * A tela dos algoritmos de pesquisa: escolher, executar, ler o resultado.
 *
 * **É a única entrada para algoritmos.** Antes eles viviam dentro do analisador de
 * imagens e como etapa do fluxo de análise térmica, o que tinha duas consequências: um
 * algoritmo só existia onde havia imagem carregada, e nenhuma tela respondia "quais
 * algoritmos esta plataforma tem". Aqui a lista é a tela.
 *
 * A lista vem do servidor, nunca daqui. Acrescentar um algoritmo é escrever um arquivo
 * no backend e registrá-lo lá: esta página não muda, e é isso que a arquitetura plugável
 * significa deste lado.
 *
 * Nada é gravado. O resultado aparece e some, como já era antes.
 */
@Component({
  selector: 'app-algorithms-page',
  imports: [AlgorithmResultView, DatePipe],
  templateUrl: './algorithms-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlgorithmsPage {
  private readonly algorithms = inject(AlgorithmsService);
  private readonly patients = inject(PatientsService);

  protected readonly options = signal<readonly Algorithm[]>([]);
  protected readonly patientList = signal<readonly Patient[]>([]);
  protected readonly encounters = signal<readonly Encounter[]>([]);

  protected readonly selectedSlug = signal('');
  protected readonly selectedPatientId = signal('');
  protected readonly selectedEncounterId = signal('');

  protected readonly loading = signal(true);
  protected readonly loadingEncounters = signal(false);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly result = signal<AlgorithmResult | null>(null);
  /** Qual algoritmo produziu `result()`: o resultado precisa se identificar. */
  protected readonly ranAlgorithm = signal<Algorithm | null>(null);

  protected readonly selected = computed(() =>
    this.options().find((algorithm) => algorithm.slug === this.selectedSlug()),
  );

  /**
   * Algoritmo de coorte escolhido.
   *
   * Coorte não pede consulta: ela roda sobre todos os pacientes que este usuário pode
   * ver. É o `scope` declarado pelo algoritmo no servidor que decide isso, e não uma
   * lista fixa aqui — um algoritmo de coorte registrado lá passa a funcionar nesta tela
   * sem deploy do frontend.
   */
  protected readonly cohortSelecionado = computed(() => this.selected()?.scope === 'cohort');

  /** Por que não dá para executar agora, ou `null` quando dá. */
  protected readonly blocked = computed(() => {
    if (!this.selected()) {
      return 'Escolha um algoritmo.';
    }
    // Coorte não tem o que escolher: o recorte é o acervo inteiro deste usuário.
    if (this.cohortSelecionado()) {
      return null;
    }
    if (!this.selectedPatientId()) {
      return 'Escolha o paciente.';
    }
    if (this.loadingEncounters()) {
      return 'Carregando as consultas do paciente…';
    }
    if (this.encounters().length === 0) {
      return 'Este paciente não tem consulta com análise de imagem gravada.';
    }
    return this.selectedEncounterId() ? null : 'Escolha a consulta.';
  });

  constructor() {
    this.algorithms.list().subscribe({
      next: (lista) => {
        this.options.set(lista);
        this.selectedSlug.set(lista[0]?.slug ?? '');
        this.loading.set(false);
      },
      error: (erro) => {
        this.error.set(messageFromError(erro));
        this.loading.set(false);
      },
    });

    this.patients.list().subscribe({
      next: (lista) => this.patientList.set(lista),
      error: (erro) => this.error.set(messageFromError(erro)),
    });
  }

  protected selectAlgorithm(slug: string): void {
    this.selectedSlug.set(slug);
    this.limpar();
  }

  /**
   * Troca de paciente: busca as consultas dele e zera a escolha anterior.
   *
   * Só as consultas com análise `ready` entram. Em `uploading` os arquivos podem não ter
   * chegado ao bucket, e sem análise gravada o algoritmo só teria como responder que
   * faltam dados, o que faz a tela oferecer uma execução inútil.
   */
  protected selectPatient(patientId: string): void {
    this.selectedPatientId.set(patientId);
    this.selectedEncounterId.set('');
    this.encounters.set([]);
    this.limpar();
    if (!patientId) {
      return;
    }

    this.loadingEncounters.set(true);
    this.patients.get(patientId).subscribe({
      next: (detalhe) => {
        this.encounters.set(detalhe.encounters.filter((e) => e.analysis_status === 'ready'));
        this.loadingEncounters.set(false);
      },
      error: (erro) => {
        this.error.set(messageFromError(erro));
        this.loadingEncounters.set(false);
      },
    });
  }

  protected selectEncounter(encounterId: string): void {
    this.selectedEncounterId.set(encounterId);
    this.limpar();
  }

  protected run(): void {
    const algorithm = this.selected();
    if (!algorithm || this.blocked() || this.running()) {
      return;
    }
    // Coorte não manda consulta: o servidor ignoraria, e mandar sugeriria um recorte
    // que não é o que vai acontecer.
    const encounterId = this.cohortSelecionado() ? undefined : this.selectedEncounterId();

    this.running.set(true);
    this.error.set(null);
    this.algorithms.run(algorithm.slug, encounterId).subscribe({
      next: (resultado) => {
        this.result.set(resultado);
        this.ranAlgorithm.set(algorithm);
        this.running.set(false);
      },
      error: (erro) => {
        this.error.set(messageFromError(erro));
        this.running.set(false);
      },
    });
  }

  /** Mudou a escolha, o resultado anterior deixou de valer: ele descreve outra coisa. */
  private limpar(): void {
    this.result.set(null);
    this.ranAlgorithm.set(null);
    this.error.set(null);
  }
}
