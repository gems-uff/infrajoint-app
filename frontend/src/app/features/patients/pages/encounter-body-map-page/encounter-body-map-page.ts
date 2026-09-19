import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';

import { BodySide, JointId } from '../../../analysis/body-map/body-map.model';
import {
  ASSESSMENT_CONFIGS,
  DEFAULT_ASSESSMENT_TYPE,
  findAssessmentConfig,
} from '../../../analysis/body-map/assessment-configs.data';
import { JOINT_BY_ID } from '../../../analysis/body-map/joint-catalog.data';
import { JointAssessmentService } from '../../../analysis/body-map/joint-assessment.service';
import { BodyMapFigure } from '../../../analysis/body-map/components/body-map-figure/body-map-figure';
import { HandDetail } from '../../../analysis/body-map/components/hand-detail/hand-detail';
import { DiseaseActivityScore } from '../../../analysis/body-map/components/disease-activity-score/disease-activity-score';
import { JointAssessmentPanel } from '../../../analysis/body-map/components/joint-assessment-panel/joint-assessment-panel';
import { JointLegend } from '../../../analysis/body-map/components/joint-legend/joint-legend';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';

import { messageFromError } from '../../data/api-error';
import { bodyMapOf } from '../../data/encounter-body-map';
import { EncounterDetail } from '../../data/patient.model';
import { PatientsService } from '../../data/patients.service';

/**
 * O mapa corporal e os índices de uma consulta gravada.
 *
 * Mesmo princípio da tela de análise de imagens ao lado: reusa os componentes de
 * `/mapa-corporal` em vez de desenhar um segundo mapa que precisaria acompanhar
 * o primeiro. A diferença é só de origem e de permissão — os achados vêm do
 * banco pelo `JointAssessmentService`, e nada aqui os altera: a consulta não tem
 * caminho de edição, então oferecer os controles seria oferecer o que não existe.
 *
 * O escore não é lido do banco pronto: os parâmetros gravados repovoam o store e
 * o índice é recalculado dos mesmos números. Assim o total exibido é o mesmo que
 * o médico consegue conferir na tela — NAD, NAE e parâmetros, todos à vista.
 */
@Component({
  selector: 'app-encounter-body-map-page',
  imports: [
    DatePipe,
    RouterLink,
    LucideDynamicIcon,
    BodyMapFigure,
    HandDetail,
    DiseaseActivityScore,
    JointAssessmentPanel,
    JointLegend,
  ],
  providers: [JointAssessmentService],
  templateUrl: './encounter-body-map-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EncounterBodyMapPage {
  /** Vem do `:encounterId` da rota, via withComponentInputBinding(). */
  readonly encounterId = input.required<string>();

  private readonly patients = inject(PatientsService);
  private readonly store = inject(JointAssessmentService);

  protected readonly detail = signal<EncounterDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private readonly bodyMap = computed(() => {
    const encounter = this.detail();
    return encounter ? bodyMapOf(encounter) : null;
  });

  protected readonly hasBodyMap = computed(() => this.bodyMap() !== null);

  /** Índices com escore gravado. Vazio = mapa sem índice fechado. */
  protected readonly recordedTypes = computed(() => this.bodyMap()?.assessmentTypes ?? []);

  /**
   * Índice em exibição. Começa no primeiro gravado — e não num padrão fixo, que
   * abriria numa aba vazia sempre que a consulta tivesse só o outro.
   */
  protected readonly assessmentType = linkedSignal<string>(
    () => this.recordedTypes()[0] ?? DEFAULT_ASSESSMENT_TYPE,
  );
  protected readonly config = computed(
    () => findAssessmentConfig(this.assessmentType()) ?? ASSESSMENT_CONFIGS[0],
  );

  /** Qual mão está aberta em detalhe, ou `null` para o corpo inteiro. */
  protected readonly handView = signal<BodySide | null>(null);
  protected readonly selectedJointId = signal<JointId | null>(null);

  protected readonly selectedJoint = computed(() => {
    const id = this.selectedJointId();
    return id ? (JOINT_BY_ID.get(id) ?? null) : null;
  });
  protected readonly selectedEvaluation = computed(() => {
    const id = this.selectedJointId();
    const evaluations = this.store.evaluations();
    return id ? evaluations.get(id) : undefined;
  });

  protected readonly evaluatedIds = this.store.evaluatedIds;
  protected readonly tenderCount = this.store.tenderCount;
  protected readonly swollenCount = this.store.swollenCount;
  protected readonly evaluatedCount = this.store.evaluatedCount;
  protected readonly totalCount = this.store.totalCount;

  constructor() {
    effect(() => this.load(this.encounterId()));
    effect(() => this.store.setActiveJoints(this.config().joints));
    effect(() => {
      const recorded = this.bodyMap();
      if (recorded) {
        this.store.restore(recorded.joints, recorded.parameters);
      }
    });
  }

  protected onAssessmentChange(assessmentType: string): void {
    if (assessmentType === this.assessmentType()) {
      return;
    }
    this.assessmentType.set(assessmentType);
    this.handView.set(null);
    this.selectedJointId.set(null);
  }

  protected onJointSelected(id: JointId): void {
    this.selectedJointId.set(id);
  }

  protected onHandSelected(side: BodySide): void {
    this.handView.set(side);
    this.selectedJointId.set(null);
  }

  protected onBackToBody(): void {
    this.handView.set(null);
    this.selectedJointId.set(null);
  }

  protected onClosePanel(): void {
    this.selectedJointId.set(null);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
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
