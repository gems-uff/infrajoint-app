import { Routes } from '@angular/router';
import { PrivacyPolicyPage } from './pages/privacy-policy-page/privacy-policy-page';
import { TermsOfUsePage } from './pages/terms-of-use-page/terms-of-use-page';

export const privacyPolicyRoutes: Routes = [
  {
    path: '',
    component: PrivacyPolicyPage,
  },
];

export const termsOfUseRoutes: Routes = [
  {
    path: '',
    component: TermsOfUsePage,
  },
];
