import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ANALYZED_COLOR, BodySide, JointId } from '../../body-map.model';
import { JOINT_BY_ID } from '../../joint-catalog.data';
import { BODY_HOTSPOTS, BODY_IMAGE } from '../../body-hotspots.data';
import { HAND_VIEWS } from '../../hand-hotspots.data';

interface BodyHotspotViewModel {
  readonly key: string;
  readonly xPct: number;
  readonly yPct: number;
  /** Short visible label (e.g. "Joelho", "Mão D"). */
  readonly label: string;
  /** Full label for screen readers (e.g. "Joelho direito"). */
  readonly ariaLabel: string;
  /** Whether at least one related joint has been evaluated. */
  readonly analyzed: boolean;
  readonly selected: boolean;
  readonly isHand: boolean;
  readonly badge?: string;
  readonly jointId?: JointId;
  readonly side?: BodySide;
}

/**
 * Main body map: renders `body.png` with the eight evaluable hotspots overlaid.
 * Each hotspot is a binary progress indicator that switches to a single
 * "analyzed" colour — a large joint once it is evaluated, a hand only once all
 * of its joints are evaluated. It does not convey pain/swelling severity.
 */
@Component({
  selector: 'app-body-map-figure',
  templateUrl: './body-map-figure.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BodyMapFigure {
  readonly evaluatedJoints = input<ReadonlySet<JointId>>(new Set());
  readonly selectedJoint = input<JointId | null>(null);

  readonly jointSelected = output<JointId>();
  readonly handSelected = output<BodySide>();

  protected readonly bodyImage = BODY_IMAGE;
  protected readonly analyzedColor = ANALYZED_COLOR;

  protected readonly hotspots = computed<BodyHotspotViewModel[]>(() => {
    const evaluated = this.evaluatedJoints();
    const selected = this.selectedJoint();

    return BODY_HOTSPOTS.map((spot) => {
      if (spot.kind === 'joint') {
        const definition = JOINT_BY_ID.get(spot.jointId);
        return {
          key: spot.jointId,
          xPct: spot.xPct,
          yPct: spot.yPct,
          label: definition?.shortLabel ?? spot.jointId,
          ariaLabel: definition?.label ?? spot.jointId,
          analyzed: evaluated.has(spot.jointId),
          selected: selected === spot.jointId,
          isHand: false,
          jointId: spot.jointId,
        };
      }

      const handJoints = HAND_VIEWS[spot.side].hotspots;
      const analyzedCount = handJoints.filter((joint) => evaluated.has(joint.jointId)).length;
      return {
        key: `hand-${spot.side}`,
        xPct: spot.xPct,
        yPct: spot.yPct,
        label: `Mão ${spot.side === 'right' ? 'D' : 'E'}`,
        ariaLabel: spot.label,
        // A hand counts as analyzed only once every one of its joints is done.
        analyzed: analyzedCount === handJoints.length,
        selected: false,
        isHand: true,
        badge: `${analyzedCount}/${handJoints.length}`,
        side: spot.side,
      };
    });
  });

  protected activate(spot: BodyHotspotViewModel): void {
    if (spot.isHand && spot.side) {
      this.handSelected.emit(spot.side);
    } else if (spot.jointId) {
      this.jointSelected.emit(spot.jointId);
    }
  }
}
