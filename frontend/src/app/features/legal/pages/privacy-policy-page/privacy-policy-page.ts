import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Footer } from '../../../../shared/components/footer/footer';
import { Navbar } from '../../../../shared/components/navbar/navbar';
import { LegalDocument } from '../../components/legal-document/legal-document';
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_LAST_UPDATED_ISO,
  PRIVACY_POLICY_SECTIONS,
} from '../../privacy-policy.data';

/**
 * Public page rendering the privacy policy. The content lives in
 * `privacy-policy.data.ts`, so the table of contents, the anchors and the
 * numbering are all derived from the same list of sections.
 */
@Component({
  selector: 'app-privacy-policy-page',
  imports: [Navbar, Footer, LegalDocument],
  templateUrl: './privacy-policy-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPolicyPage {
  protected readonly sections = PRIVACY_POLICY_SECTIONS;
  protected readonly lastUpdated = PRIVACY_POLICY_LAST_UPDATED;
  protected readonly lastUpdatedIso = PRIVACY_POLICY_LAST_UPDATED_ISO;
}
