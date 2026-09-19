import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { BodySide, JointId } from '../../body-map.model';
import { JOINT_BY_ID } from '../../joint-catalog.data';
import {
  ASSESSMENT_CONFIGS,
  DEFAULT_ASSESSMENT_TYPE,
  findAssessmentConfig,
} from '../../assessment-configs.data';
import { JointAssessmentService } from '../../joint-assessment.service';
import { BodyMapFigure } from '../../components/body-map-figure/body-map-figure';
import { HandDetail } from '../../components/hand-detail/hand-detail';
import { DiseaseActivityScore } from '../../components/disease-activity-score/disease-activity-score';
import { JointAssessmentPanel } from '../../components/joint-assessment-panel/joint-assessment-panel';
import { JointLegend } from '../../components/joint-legend/joint-legend';

/**
 * Body Map screen: an SVG/image-based joint assessment for rheumatology
 * disease-activity indexes (CDAI, DAS28, …).
 *
 * The main body (body.svg) exposes the large joints plus a hotspot per hand;
 * clicking a hand opens its detailed image where the individual finger joints
 * are evaluated. All findings flow through {@link JointAssessmentService}.
 */
@Component({
  selector: 'app-body-map-page',
  imports: [BodyMapFigure, HandDetail, DiseaseActivityScore, JointAssessmentPanel, JointLegend],
  providers: [JointAssessmentService],
  templateUrl: './body-map-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BodyMapPage {
  private readonly store = inject(JointAssessmentService);

  protected readonly configs = ASSESSMENT_CONFIGS;
  protected readonly assessmentType = signal<string>(DEFAULT_ASSESSMENT_TYPE);
  protected readonly config = computed(
    () => findAssessmentConfig(this.assessmentType()) ?? ASSESSMENT_CONFIGS[0],
  );

  /** Which detailed hand view is open, or `null` for the full body. */
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
