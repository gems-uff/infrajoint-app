import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Footer } from '../../../../shared/components/footer/footer';
import { Navbar } from '../../../../shared/components/navbar/navbar';
import { LegalDocument } from '../../components/legal-document/legal-document';
import {
  TERMS_OF_USE_LAST_UPDATED,
  TERMS_OF_USE_LAST_UPDATED_ISO,
  TERMS_OF_USE_SECTIONS,
} from '../../terms-of-use.data';

/** Public page rendering the terms of use from `terms-of-use.data.ts`. */
@Component({
  selector: 'app-terms-of-use-page',
  imports: [Navbar, Footer, LegalDocument],
  templateUrl: './terms-of-use-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsOfUsePage {
  protected readonly sections = TERMS_OF_USE_SECTIONS;
  protected readonly lastUpdated = TERMS_OF_USE_LAST_UPDATED;
  protected readonly lastUpdatedIso = TERMS_OF_USE_LAST_UPDATED_ISO;
}
