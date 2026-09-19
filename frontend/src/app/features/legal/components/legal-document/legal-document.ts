import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideShieldCheck } from '@lucide/angular';

import { LegalSection } from '../../legal-document.model';

/**
 * Renders a legal document (privacy policy, terms of use, …) from a list of
 * sections: page header, sticky table of contents and the numbered sections.
 * Keeping it presentational lets every legal page share the same layout while
 * owning only its own content.
 */
@Component({
  selector: 'app-legal-document',
  imports: [RouterLink, LucideShieldCheck],
  templateUrl: './legal-document.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalDocument {
  /** Small uppercase label shown above the title. */
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly subtitle = input.required<string>();
  /** Human-readable update date, e.g. `6 de agosto de 2026`. */
  readonly lastUpdated = input.required<string>();
  /** Same date in ISO form, for the `<time datetime>` attribute. */
  readonly lastUpdatedIso = input.required<string>();
  readonly sections = input.required<LegalSection[]>();
}
