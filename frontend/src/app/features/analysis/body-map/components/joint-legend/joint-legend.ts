import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ANALYZED_COLOR } from '../../body-map.model';

/** Colour key for the body/hand map's analyzed vs. not-analyzed markers. */
@Component({
  selector: 'app-joint-legend',
  templateUrl: './joint-legend.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JointLegend {
  protected readonly analyzedColor = ANALYZED_COLOR;
}
