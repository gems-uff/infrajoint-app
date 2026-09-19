import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  LucideArrowLeft,
  LucideStethoscope,
  LucideTrash2,
  LucideX,
  provideLucideIcons,
} from '@lucide/angular';

import { environment } from '../../../../../environments/environment';
import { PatientDetailPage } from './patient-detail-page';

const BASE = `${environment.apiBaseUrl}/patients`;

const DETALHE = {
  id: 'p1',
  full_name: 'Ana Souza',
  birth_date: '1978-04-02',
  sex: 'F',
  phone: null,
  diagnoses: [],
  study_group: null,
  created_at: '2026-08-09T12:00:00Z',
  updated_at: '2026-08-09T12:00:00Z',
  encounters: [],
};

function montar(patientId: string): {
  fixture: ComponentFixture<PatientDetailPage>;
  controller: HttpTestingController;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      // Os ícones não vêm do app.config no TestBed; sem eles o template quebra.
      provideLucideIcons(LucideArrowLeft, LucideStethoscope, LucideTrash2, LucideX),
    ],
  });

  const fixture = TestBed.createComponent(PatientDetailPage);
  fixture.componentRef.setInput('id', patientId);
  fixture.detectChanges();

  const controller = TestBed.inject(HttpTestingController);
  // O catálogo de diagnósticos é buscado uma vez, no construtor, para montar a lista de
  // escolha do formulário. Respondê-lo aqui evita que cada teste precise saber disso
  // para o `verify()` passar.
  controller.expectOne(`${environment.apiBaseUrl}/diagnoses`).flush([]);

  return { fixture, controller };
}

describe('PatientDetailPage', () => {
  // Regressão NG0950: carregar no construtor lia o signal input required antes do
  // binding e derrubava a página inteira ao abrir um paciente. Nem o typecheck nem o
  // build acusam — só a execução.
  it('carrega o paciente do id recebido pela rota', () => {
    const { controller } = montar('p1');

    const request = controller.expectOne(`${BASE}/p1`);
    expect(request.request.method).toBe('GET');
    request.flush(DETALHE);

    controller.verify();
  });

  it('recarrega quando a rota aponta para outro paciente', () => {
    const { fixture, controller } = montar('p1');
    controller.expectOne(`${BASE}/p1`).flush(DETALHE);

    fixture.componentRef.setInput('id', 'p2');
    fixture.detectChanges();

    const segundo = controller.expectOne(`${BASE}/p2`);
    expect(segundo.request.method).toBe('GET');
    segundo.flush({ ...DETALHE, id: 'p2', full_name: 'Bruno Lima' });

    controller.verify();
  });

  it('mostra mensagem quando o paciente não existe', () => {
    const { fixture, controller } = montar('sumido');

    controller
      .expectOne(`${BASE}/sumido`)
      .flush({ detail: 'não encontrado' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Registro não encontrado.');
    controller.verify();
  });
});
