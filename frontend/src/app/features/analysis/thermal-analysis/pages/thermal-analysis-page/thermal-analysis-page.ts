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
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { JointAssessmentService } from '../../../body-map/joint-assessment.service';
import { ASSESSMENT_CONFIGS } from '../../../body-map/assessment-configs.data';
import { Patient } from '../../../../patients/data/patient.model';
import { PatientsService } from '../../../../patients/data/patients.service';
import { messageFromError } from '../../../../patients/data/api-error';
import { AssessedIndex, toEncounterCreate } from '../../thermal-analysis.model';
import { ImageAnalyzerPage } from '../../../pages/image-analyzer-page/image-analyzer-page';
import {
  CollectedAnalysis,
  collectSequenceAnalysis,
  collectSingleAnalysis,
  uploadKey,
} from '../../data/analyzer-collect';
import { PendingUpload, describeTimings, uploadAll } from '../../data/capture-upload';
import { BodyMapStep } from '../../steps/body-map-step/body-map-step';
import { PatientStep } from '../../steps/patient-step/patient-step';

import { environment } from '../../../../../../environments/environment';

/** Etapas do fluxo, na ordem em que acontecem. */
type Step = 'patient' | 'body-map' | 'analyzer';

/**
 * Fluxo de Análise Térmica: paciente → mapa corporal → analisador → gravar.
 *
 * **É o único lugar da seção Análise que persiste.** As telas soltas
 * `/mapa-corporal` e `/analisador-de-imagens` existem para qualquer um
 * experimentar e não gravam nada; elas nem importam `PatientsService`. A
 * separação é estrutural, não uma flag: os componentes de avaliação continuam
 * sem saber o que é paciente ou API, e quem sabe é este container.
 *
 * O `JointAssessmentService` é provido **aqui**, e não na etapa, para o estado
 * do body map sobreviver à navegação entre etapas e ainda poder ser serializado
 * no fim. Ele morre junto com o fluxo, como morre junto com a página solta.
 *
 * Nada vai ao banco antes de "Finalizar": a consulta nasce já completa, numa
 * chamada só. Abandonar o fluxo no meio não deixa consulta vazia no histórico.
 */
@Component({
  selector: 'app-thermal-analysis-page',
  imports: [PatientStep, BodyMapStep, ImageAnalyzerPage, DecimalPipe],
  providers: [JointAssessmentService],
  templateUrl: './thermal-analysis-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThermalAnalysisPage {
  /**
   * Paciente já escolhido, vindo de `?paciente=<id>`.
   *
   * É o que permite ao prontuário abrir "Nova consulta" sem gravar nada por
   * conta própria: ele delega para cá em vez de ter um caminho de criação
   * paralelo. Consulta nasce de um lugar só.
   */
  readonly paciente = input<string | undefined>(undefined);

  private readonly store = inject(JointAssessmentService);
  private readonly patients = inject(PatientsService);
  private readonly router = inject(Router);

  protected readonly step = signal<Step>('patient');
  protected readonly patient = signal<Patient | null>(null);
  protected readonly loadingPatient = signal(false);
  /** Progresso do envio, para a tela não ficar num 'Gravando…' opaco. */
  protected readonly uploadDone = signal(0);
  protected readonly uploadTotal = signal(0);
  protected readonly uploadMbDone = signal(0);
  protected readonly uploadMbTotal = signal(0);
  protected readonly uploadLast = signal('');
  /** Arquivos que não subiram, para o médico saber o que precisa refazer. */
  protected readonly uploadFailed = signal<readonly string[]>([]);

  /** A etapa 3 fica montada e escondida, então o viewChild existe desde então. */
  private readonly analyzer = viewChild(ImageAnalyzerPage);
  protected readonly reason = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Quantas articulações foram tocadas — decide se há body map a gravar. */
  protected readonly evaluatedCount = this.store.evaluatedCount;

  /**
   * Índices com escore fechado; o DAS28 some daqui enquanto faltar VHS/PCR.
   *
   * Sem articulação avaliada não há índice nenhum, e a checagem não é redundante com
   * a de `score !== null`: com o body map intocado o CDAI vale 0 + 0 + 0 + 0 = **0**,
   * que não é nulo — e uma consulta sem body map acabava gravada com "CDAI 0,0,
   * remissão", uma avaliação que ninguém fez. O DAS28 escapava por acaso, porque
   * `acuteValue` nasce nulo.
   */
  protected readonly closedIndexes = computed(() => {
    if (this.store.evaluatedCount() === 0) {
      return [];
    }
    return ASSESSMENT_CONFIGS.map((config) => ({
      assessmentType: config.assessmentType,
      outcome: this.store.scoreFor(config.assessmentType),
    })).filter((index): index is AssessedIndex => index.outcome.score !== null);
  });

  /**
   * O analisador tem resultado gravável?
   *
   * Espelha exatamente a condição que faz `collectSingleAnalysis` devolver `null`:
   * sem matriz e sem alinhamento não há medição, e sem os três arquivos a captura
   * fica incompleta. As duas precisam andar juntas — se esta afrouxar, o botão
   * habilita e o Finalizar descarta a análise em silêncio, tratando-a como etapa
   * não preenchida. Enquanto for falsa, a tela ainda está carregando arquivos.
   */
  protected readonly analysisReady = computed(() => {
    const analisador = this.analyzer();
    if (!analisador) {
      return false;
    }
    if (analisador.sequenceActive()) {
      return analisador.sequenceService.captures().length > 0;
    }
    return (
      analisador.matrix() !== null &&
      analisador.activeMatrix() !== null &&
      analisador.rgbFile() !== null &&
      analisador.jpegFile() !== null &&
      analisador.csvFile() !== null
    );
  });

  /**
   * Há achado a gravar?
   *
   * As duas etapas clínicas são opcionais **uma em relação à outra**, não as duas
   * ao mesmo tempo: sem body map e sem análise, "Finalizar" criaria no histórico
   * uma consulta que não registra nada — exatamente o que o fluxo evita ao só
   * gravar no fim.
   */
  protected readonly hasFindings = computed(
    () => this.evaluatedCount() > 0 || this.analysisReady(),
  );

  /**
   * A consulta desta tentativa já está gravada.
   *
   * Enquanto for nula, "Finalizar" cria. Preenchida, ele **retoma**: a consulta e o
   * body map já estão no banco, e o que resta é levar as imagens ao bucket.
   */
  private readonly encounterSalvo = signal<string | null>(null);

  /** Já existe consulta gravada, e o que falta é o envio. */
  protected readonly consultaSalva = computed(() => this.encounterSalvo() !== null);

  /**
   * O que ainda não chegou ao bucket, com as URLs já assinadas.
   *
   * É o que permite reenviar **só o que faltou**: numa sequência de 63 arquivos, um
   * erro no décimo não pode obrigar a subir os outros 62 de novo. As URLs valem 1 h.
   */
  private pendentes: readonly PendingUpload[] = [];

  /**
   * `POST /captures` já respondeu.
   *
   * Ele não pode ser repetido: a segunda chamada recebe 409, porque criaria um
   * segundo jogo de capturas sob a mesma consulta.
   */
  private capturasGravadas = false;

  /** A coleta do analisador, guardada para a retomada não depender de recoletá-la. */
  private coletado: CollectedAnalysis | null = null;

  /**
   * Finalizar só aparece quando não custa perder trabalho.
   *
   * Na etapa do analisador, clicar antes de processar gravaria a consulta e sairia
   * da tela — e a análise carregada iria junto, sem aviso. Fora dela, não há o que
   * perder: o body map já está em memória e é opcional por definição.
   */
  protected readonly canFinish = computed(() => {
    if (this.patient() === null || this.saving()) {
      return false;
    }
    // Retomada: a consulta já está no banco, então as condições que decidem se há o
    // que gravar não se aplicam mais — o que resta é reenviar o que faltou.
    if (this.consultaSalva()) {
      return true;
    }
    if (!this.hasFindings()) {
      return false;
    }
    if (this.step() !== 'analyzer') {
      return true;
    }
    return this.analysisReady();
  });

  /**
   * Último id já aplicado a partir da query string.
   *
   * Guardar isto — em vez de comparar com `patient()` — é o que impede o effect
   * de ler o paciente escolhido: se lesse, trocar de paciente pelo botão
   * "trocar" faria o effect rerodar e restaurar o da URL, desfazendo a escolha.
   * Assim ele só reage à query string mudar, que é o gatilho correto.
   */
  private lastPreselected: string | null = null;

  constructor() {
    effect(() => {
      const id = this.paciente();
      if (!id || id === this.lastPreselected) {
        return;
      }
      this.lastPreselected = id;
      this.loadingPatient.set(true);
      this.patients.get(id).subscribe({
        next: (detail) => {
          this.patient.set(detail);
          this.step.set('body-map');
          this.loadingPatient.set(false);
        },
        error: (cause: unknown) => {
          // Paciente inexistente ou de outro médico cai aqui como 404: o fluxo
          // volta para a etapa de escolha em vez de travar numa tela vazia.
          this.error.set(messageFromError(cause));
          this.loadingPatient.set(false);
        },
      });
    });
  }

  protected onPatientSelected(patient: Patient): void {
    this.patient.set(patient);
    this.step.set('body-map');
  }

  protected goTo(step: Step): void {
    if (step === 'patient' || this.patient()) {
      this.step.set(step);
    }
  }

  /**
   * Grava a consulta — ou **retoma** o envio, se ela já tiver sido gravada.
   *
   * A distinção não é cosmética. Sem ela, uma falha no upload devolvia o botão ao
   * estado inicial, e o segundo clique chamava `createEncounter` de novo: nascia uma
   * SEGUNDA consulta, com o mesmo body map e a mesma data, enquanto a primeira ficava
   * órfã em `uploading` com os arquivos pela metade. O prontuário terminava com duas
   * consultas para um exame só, e nada na tela dizia isso.
   *
   * Como a queda de rede no meio de dezenas de MB é a falha mais provável deste
   * fluxo, o caminho de erro precisa ser tão correto quanto o de sucesso.
   */
  protected finish(): void {
    const patient = this.patient();
    if (!patient || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);

    const jaSalva = this.encounterSalvo();
    if (jaSalva) {
      void this.enviarAnalise(jaSalva, patient.id, this.coletado);
      return;
    }

    // Coleta ANTES de qualquer coisa assíncrona, e a coleta viaja como parâmetro.
    //
    // Houve uma versão em que `saving` desmontava o analisador para liberar a thread
    // durante o envio. Nela, coletar depois encontrava `this.analyzer()` indefinido,
    // a análise virava `null` e a consulta era salva sem imagem nenhuma, em silêncio.
    // O desmonte foi revertido (ver o comentário da etapa 3 no template), mas a ordem
    // ficou: `enviarAnalise` recebe a coleta pronta em vez de buscá-la, e assim o bug
    // não volta se alguém desmontar o analisador de novo.
    //
    // Guardada no campo pelo mesmo motivo: a retomada não pode depender de o
    // analisador continuar montado e no mesmo estado.
    this.coletado = this.coletarAnalise();

    const payload = toEncounterCreate(
      this.store.toResult('CDAI', patient.id),
      this.closedIndexes(),
      { tender: this.store.tenderCount(), swollen: this.store.swollenCount() },
      this.reason(),
    );

    this.patients.createEncounter(patient.id, payload).subscribe({
      next: (encounter) => {
        // A partir daqui a consulta EXISTE. Registrar o id é o que impede a próxima
        // tentativa de criar outra.
        this.encounterSalvo.set(encounter.id);
        // A consulta e o body map já estão salvos. As imagens vêm depois, de
        // propósito: se o upload de dezenas de MB falhar, o registro clínico não
        // vai junto.
        void this.enviarAnalise(encounter.id, patient.id, this.coletado);
      },
      error: (cause: unknown) => {
        this.error.set(messageFromError(cause));
        this.saving.set(false);
      },
    });
  }

  /** Sai do fluxo para o prontuário. A consulta já está salva; o envio fica para depois. */
  protected verConsultaSalva(): void {
    const patient = this.patient();
    if (patient) {
      void this.router.navigate(['/pacientes', patient.id]);
    }
  }

  /** Lê o analisador — avulsa ou sequência — enquanto ele ainda está montado. */
  private coletarAnalise(): CollectedAnalysis | null {
    const analisador = this.analyzer();
    if (!analisador) {
      return null;
    }
    return analisador.sequenceActive()
      ? this.coletarSequencia(analisador)
      : collectSingleAnalysis({
          matrix: analisador.matrix(),
          activeMatrix: analisador.activeMatrix(),
          mode: analisador.mode(),
          autoMethod: analisador.autoMethod(),
          agreement: analisador.agreement(),
          correction: analisador.correction(),
          jointRois: analisador.jointRois(),
          opticalFile: analisador.rgbFile(),
          thermalFile: analisador.jpegFile(),
          matrixFile: analisador.csvFile(),
        });
  }

  /**
   * Lê a sequência do analisador, casando cada captura com as ROIs da curva.
   *
   * As medições gravadas passam a ser **as mesmas** que a curva desenhou, porque vêm
   * do mesmo `curveFrames`. Recalcular aqui abriria espaço para o prontuário mostrar
   * números diferentes dos que o médico viu na tela.
   *
   * Os dois arrays derivam de `sequenceService.captures()` dentro do mesmo computed,
   * então andam juntos por índice — a asserção existe para o dia em que não andarem.
   */
  private coletarSequencia(
    analisador: ImageAnalyzerPage,
  ): ReturnType<typeof collectSequenceAnalysis> {
    const capturas = analisador.sequenceService.captures();
    const frames = analisador.curveFrames();
    if (capturas.length === 0 || frames.length !== capturas.length) {
      return null;
    }

    return collectSequenceAnalysis(
      capturas.map((captura, i) => ({
        index: captura.index,
        timeSeconds: captura.timeSeconds,
        matrix: captura.matrix,
        alignment: captura.alignment,
        autoMethod: captura.autoMethod,
        agreement: captura.agreement,
        correction: captura.correction,
        issue: captura.issue,
        jointRois: frames[i].rois as never,
        opticalFile: captura.optical,
        thermalFile: captura.thermal,
        matrixFile: captura.matrixFile,
      })),
    );
  }

  /**
   * Segunda fase do Finalizar: capturas, upload e fechamento em `ready`.
   *
   * Recebe `coletado` pronto, e não o analisador, para não depender de ele continuar
   * montado durante o envio. Ver a ordem em `finish()`.
   */
  private async enviarAnalise(
    encounterId: string,
    patientId: string,
    coletado: CollectedAnalysis | null,
  ): Promise<void> {
    if (!coletado) {
      // Etapa opcional não preenchida: a consulta com o body map já basta.
      this.saving.set(false);
      void this.router.navigate(['/pacientes', patientId]);
      return;
    }

    try {
      // O POST das capturas acontece UMA vez por consulta. Repeti-lo responde 409 —
      // ele criaria um segundo jogo de capturas —, então numa retomada este bloco é
      // pulado e as URLs assinadas da primeira vez continuam valendo (1 h).
      if (!this.capturasGravadas) {
        const criada = await firstValueFrom(
          this.patients.createCaptures(encounterId, coletado.payload),
        );
        this.capturasGravadas = true;
        this.pendentes = criada.uploads.map((upload) => {
          const file = coletado.files.get(uploadKey(upload.capture_index, upload.kind))!;
          return {
            url: upload.url,
            body: file,
            contentType: file.type || 'application/octet-stream',
            // Índice nulo é a avulsa: "captura null" mandaria o médico procurar uma
            // posição que não existe na tela dele. Mesma regra do erro do backend.
            describe:
              upload.capture_index === null
                ? `captura avulsa: ${upload.kind}`
                : `captura ${upload.capture_index}: ${upload.kind}`,
          };
        });
      }

      if (this.pendentes.length > 0) {
        const desteEnvio = this.pendentes.length;
        this.uploadTotal.set(desteEnvio);
        this.uploadDone.set(0);
        this.uploadFailed.set([]);
        const resultado = await uploadAll(this.pendentes, {
          onProgress: (p) => {
            this.uploadDone.set(p.done);
            this.uploadMbDone.set(p.bytesDone / 1e6);
            this.uploadMbTotal.set(p.bytesTotal / 1e6);
            this.uploadLast.set(p.lastDescribe);
          },
        });

        // Diagnóstico, e só fora de produção: se o decorrido for muito maior que o
        // tempo somado dentro dos PUTs, o gargalo não é a rede, está na thread
        // principal. Para o médico isso não é acionável, então não vai ao console dele.
        if (!environment.production) {
          console.info('[upload]', describeTimings(resultado));
        }

        const { failed } = resultado;
        // A fila da próxima tentativa é só o que faltou — `uploadAll` não aborta na
        // primeira falha, então o que subiu está no bucket e não volta a subir.
        const faltaram = new Set(failed.map((f) => f.describe));
        this.pendentes = this.pendentes.filter((p) => faltaram.has(p.describe));

        if (failed.length > 0) {
          // A consulta e o body map estão salvos; `analysis_status` fica em
          // 'uploading', que o prontuário mostra como envio incompleto — e que o
          // botão de retomar, aqui, resolve sem criar consulta nova.
          this.uploadFailed.set(failed.map((f) => f.describe));
          this.saving.set(false);
          // Primeiro o que tranquiliza, depois o que falta. A instrução some: o
          // botão logo abaixo já diz "Tentar enviar novamente".
          this.error.set(
            'A consulta e o mapa corporal já estão salvos. ' +
              `Faltaram ${failed.length} de ${desteEnvio} arquivos.`,
          );
          return;
        }
      }

      await firstValueFrom(this.patients.markAnalysisReady(encounterId));
      this.saving.set(false);
      void this.router.navigate(['/pacientes', patientId]);
    } catch (cause: unknown) {
      // A consulta e o body map continuam salvos; o que falhou foi o arquivamento.
      // `analysis_status` fica em 'uploading', e o botão de retomar continua na tela.
      this.saving.set(false);
      const motivo = messageFromError(cause).replace(/[.\s]+$/, '');
      this.error.set(
        `A consulta e o mapa corporal já estão salvos, mas as imagens não subiram: ${motivo}.`,
      );
    }
  }
}
