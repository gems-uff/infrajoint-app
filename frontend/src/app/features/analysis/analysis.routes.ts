import { Routes } from '@angular/router';

import { roleGuard } from '../../core/auth/auth.guard';

/**
 * "Análise" section routes. Groups the analysis tools shown under the sidebar's
 * Análise menu. Add new analysis modules here as their own child route.
 */
export const analysisRoutes: Routes = [
  { path: '', redirectTo: 'analisador-de-imagens', pathMatch: 'full' },
  {
    path: 'analisador-de-imagens',
    loadComponent: () =>
      import('./pages/image-analyzer-page/image-analyzer-page').then((m) => m.ImageAnalyzerPage),
  },
  {
    // Prontuário: lista pacientes e roda sobre consulta gravada, então segue a
    // mesma regra de /pacientes. O guard é UX — a RLS continua sendo a recusa real.
    path: 'algoritmos',
    canActivate: [roleGuard],
    data: { roles: ['medico', 'pesquisador', 'admin'] },
    loadComponent: () =>
      import('./algorithms/pages/algorithms-page/algorithms-page').then((m) => m.AlgorithmsPage),
  },
  {
    path: 'mapa-corporal',
    loadChildren: () => import('./body-map/body-map.routes').then((m) => m.bodyMapRoutes),
  },
  {
    // Esconder do menu não basta: a rota é alcançável digitando a URL. O guard
    // é UX — a autorização real continua na RLS —, mas evita que um leitor
    // atravesse metade de um fluxo clínico para bater em 403 no fim.
    path: 'analise-termica',
    canActivate: [roleGuard],
    data: { roles: ['medico', 'pesquisador', 'admin'] },
    loadChildren: () =>
      import('./thermal-analysis/thermal-analysis.routes').then((m) => m.thermalAnalysisRoutes),
  },
];
