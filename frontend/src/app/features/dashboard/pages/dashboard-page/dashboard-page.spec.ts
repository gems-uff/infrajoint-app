import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  LucideArrowRight,
  LucideCamera,
  LucidePersonStanding,
  LucideThermometer,
  LucideUserRound,
  provideLucideIcons,
} from '@lucide/angular';

import { AuthService } from '../../../../core/auth/auth.service';
import { UserProfile, UserRole } from '../../../../core/auth/profile.model';
import { environment } from '../../../../../environments/environment';
import { DashboardPage } from './dashboard-page';

const BASE = `${environment.apiBaseUrl}/patients`;

const PACIENTES = [
  {
    id: 'p1',
    full_name: 'Ana Souza',
    birth_date: '1970-01-01',
    sex: null,
    phone: null,
    diagnoses: [{ code: 'M06.9', label: 'Artrite reumatoide', is_primary: true }],
    study_group: 'caso',
    created_at: '2026-08-20T12:00:00Z',
    updated_at: '2026-08-20T12:00:00Z',
  },
  {
    id: 'p2',
    full_name: 'Bruno Lima',
    birth_date: '1970-01-01',
    sex: null,
    phone: null,
    diagnoses: [],
    study_group: null,
    created_at: '2026-01-05T12:00:00Z',
    updated_at: '2026-01-05T12:00:00Z',
  },
];

function montar(papel: UserRole | undefined): {
  fixture: ComponentFixture<DashboardPage>;
  controller: HttpTestingController;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      // Os ícones não vêm do app.config no TestBed; sem eles o template quebra.
      provideLucideIcons(
        LucideArrowRight,
        LucideCamera,
        LucidePersonStanding,
        LucideThermometer,
        LucideUserRound,
      ),
      {
        provide: AuthService,
        useValue: {
          user: signal(null),
          profile: signal<UserProfile | null>(papel ? ({ role: papel } as UserProfile) : null),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(DashboardPage);
  fixture.detectChanges();

  return { fixture, controller: TestBed.inject(HttpTestingController) };
}

function texto(fixture: ComponentFixture<DashboardPage>): string {
  return fixture.nativeElement.textContent as string;
}

describe('DashboardPage', () => {
  it('mostra contagens e pacientes recentes para o médico', () => {
    const { fixture, controller } = montar('medico');
    controller.expectOne(BASE).flush(PACIENTES);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Pacientes recentes');
    expect(texto(fixture)).toContain('Ana Souza');
    expect(texto(fixture)).toContain('Bruno Lima');
    controller.verify();
  });

  it('esconde os painéis clínicos de quem não é clínico', () => {
    const { fixture, controller } = montar('user');
    // A requisição acontece de qualquer forma: a RLS devolve vazio para quem não é
    // dono de ninguém, e condicioná-la ao perfil criaria uma corrida.
    controller.expectOne(BASE).flush([]);
    fixture.detectChanges();

    expect(texto(fixture)).not.toContain('Pacientes recentes');
    expect(texto(fixture)).not.toContain('Cadastrados nos últimos');
    // As ferramentas abertas continuam oferecidas.
    expect(texto(fixture)).toContain('Analisador de imagens');
    expect(texto(fixture)).not.toContain('Análise térmica');
    controller.verify();
  });

  it('mostra o estado vazio quando a conta não tem paciente', () => {
    const { fixture, controller } = montar('medico');
    controller.expectOne(BASE).flush([]);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Nenhum paciente cadastrado ainda.');
    controller.verify();
  });

  it('mostra a falha sem derrubar as ações rápidas', () => {
    const { fixture, controller } = montar('medico');
    controller.expectOne(BASE).flush(null, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Não foi possível completar a operação.');
    expect(texto(fixture)).toContain('Ações rápidas');
    controller.verify();
  });
});
