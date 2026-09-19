import { Routes } from '@angular/router';

export const thermalAnalysisRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/thermal-analysis-page/thermal-analysis-page').then(
        (m) => m.ThermalAnalysisPage,
      ),
  },
];
