import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideDynamicIcon } from '@lucide/angular';

import { ANALYZED_COLOR, BodySide, JointId } from '../../body-map.model';
import { JOINT_BY_ID } from '../../joint-catalog.data';
import { HAND_VIEWS } from '../../hand-hotspots.data';

interface HandHotspotViewModel {
  readonly jointId: JointId;
  readonly xPct: number;
  readonly yPct: number;
  readonly label: string;
  /** Whether this joint has been evaluated. */
  readonly analyzed: boolean;
  readonly selected: boolean;
}

/**
 * Detailed hand view: shows the hand image with one hotspot over each
 * red-highlighted joint. Each hotspot is a binary progress indicator — it
 * switches to a single "analyzed" colour once the joint has been evaluated.
 */
@Component({
  selector: 'app-hand-detail',
  imports: [LucideDynamicIcon],
  templateUrl: './hand-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandDetail {
  readonly side = input.required<BodySide>();
  readonly evaluatedJoints = input<ReadonlySet<JointId>>(new Set());
  readonly selectedJoint = input<JointId | null>(null);

  readonly jointSelected = output<JointId>();
  readonly back = output<void>();

  protected readonly analyzedColor = ANALYZED_COLOR;

  protected readonly title = computed(() =>
    this.side() === 'right' ? 'Mão direita' : 'Mão esquerda',
  );
  protected readonly image = computed(() => HAND_VIEWS[this.side()].image);

  protected readonly hotspots = computed<HandHotspotViewModel[]>(() => {
    const evaluated = this.evaluatedJoints();
    const selected = this.selectedJoint();

    return HAND_VIEWS[this.side()].hotspots.map((spot) => ({
      jointId: spot.jointId,
      xPct: spot.xPct,
      yPct: spot.yPct,
      label: JOINT_BY_ID.get(spot.jointId)?.label ?? spot.jointId,
      analyzed: evaluated.has(spot.jointId),
      selected: selected === spot.jointId,
    }));
  });
}
