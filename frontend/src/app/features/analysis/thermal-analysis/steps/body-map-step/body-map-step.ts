import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { BodySide, JointId } from '../../../body-map/body-map.model';
import { JOINT_BY_ID } from '../../../body-map/joint-catalog.data';
import {
  ASSESSMENT_CONFIGS,
  DEFAULT_ASSESSMENT_TYPE,
  findAssessmentConfig,
} from '../../../body-map/assessment-configs.data';
import { JointAssessmentService } from '../../../body-map/joint-assessment.service';
import { BodyMapFigure } from '../../../body-map/components/body-map-figure/body-map-figure';
import { HandDetail } from '../../../body-map/components/hand-detail/hand-detail';
import { DiseaseActivityScore } from '../../../body-map/components/disease-activity-score/disease-activity-score';
import { JointAssessmentPanel } from '../../../body-map/components/joint-assessment-panel/joint-assessment-panel';
import { JointLegend } from '../../../body-map/components/joint-legend/joint-legend';

/**
 * Etapa de body map dentro do fluxo de Análise Térmica.
 *
 * Reusa os mesmos componentes da tela solta `/mapa-corporal` e **não** injeta
 * nenhum serviço de dados: continua sem saber o que é paciente ou API. A
 * diferença é só de onde vem o store — aqui ele é provido pelo container do
 * fluxo, para o estado sobreviver à troca de etapa e poder ser serializado no
 * fim. Na tela solta, é provido pela página e morre com ela.
 */
@Component({
  selector: 'app-body-map-step',
  imports: [BodyMapFigure, HandDetail, DiseaseActivityScore, JointAssessmentPanel, JointLegend],
  templateUrl: './body-map-step.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BodyMapStep {
  private readonly store = inject(JointAssessmentService);

  protected readonly configs = ASSESSMENT_CONFIGS;
  protected readonly assessmentType = signal<string>(DEFAULT_ASSESSMENT_TYPE);
  protected readonly config = computed(
    () => findAssessmentConfig(this.assessmentType()) ?? ASSESSMENT_CONFIGS[0],
  );

  protected readonly handView = signal<BodySide | null>(null);
  protected readonly selectedJointId = signal<JointId | null>(null);

  protected readonly selectedJoint = computed(() => {
    const id = this.selectedJointId();
    return id ? (JOINT_BY_ID.get(id) ?? null) : null;
  });
  protected readonly selectedEvaluation = computed(() => {
    const id = this.selectedJointId();
    return id ? this.store.evaluations().get(id) : undefined;
  });

  protected readonly evaluatedIds = this.store.evaluatedIds;
  protected readonly tenderCount = this.store.tenderCount;
  protected readonly swollenCount = this.store.swollenCount;
  protected readonly evaluatedCount = this.store.evaluatedCount;
  protected readonly totalCount = this.store.totalCount;

  constructor() {
    effect(() => this.store.setActiveJoints(this.config().joints));
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

  protected onPainChange(pain: boolean): void {
    const id = this.selectedJointId();
    if (id) {
      this.store.setPain(id, pain);
    }
  }

  protected onSwellingChange(swelling: boolean): void {
    const id = this.selectedJointId();
    if (id) {
      this.store.setSwelling(id, swelling);
    }
  }

  protected onClear(): void {
    const id = this.selectedJointId();
    if (id) {
      this.store.clearEvaluation(id);
    }
  }

  protected onClosePanel(): void {
    this.selectedJointId.set(null);
  }

  protected resetAll(): void {
    this.store.reset();
    this.selectedJointId.set(null);
  }
}
