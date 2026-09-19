import { Routes } from '@angular/router';

export const patientsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/patients-page/patients-page').then((m) => m.PatientsPage),
  },
  {
    // ANTES de `:id`: o Angular casa a primeira rota compatível, e `:id` engoliria
    // "consultas" como se fosse um uuid de paciente.
    path: 'consultas/:encounterId',
    loadComponent: () =>
      import('./pages/encounter-detail-page/encounter-detail-page').then(
        (m) => m.EncounterDetailPage,
      ),
  },
  {
    // Cada exame da consulta na sua rota, e não numa aba: são telas pesadas — a de
    // imagens baixa as capturas do bucket — e é o que dá um link direto para cada.
    path: 'consultas/:encounterId/mapa-corporal',
    loadComponent: () =>
      import('./pages/encounter-body-map-page/encounter-body-map-page').then(
        (m) => m.EncounterBodyMapPage,
      ),
  },
  {
    path: 'consultas/:encounterId/analisador-de-imagens',
    loadComponent: () =>
      import('./pages/encounter-analysis-page/encounter-analysis-page').then(
        (m) => m.EncounterAnalysisPage,
      ),
  },
  {
    // O `:id` chega no `input.required<string>()` da página via withComponentInputBinding().
    path: ':id',
    loadComponent: () =>
      import('./pages/patient-detail-page/patient-detail-page').then((m) => m.PatientDetailPage),
  },
];
