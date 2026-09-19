import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { AlgorithmsService } from './algorithms.service';

describe('AlgorithmsService', () => {
  let service: AlgorithmsService;
  let controller: HttpTestingController;
  const base = `${environment.apiBaseUrl}/algorithms`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AlgorithmsService);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('lista os algoritmos do servidor', () => {
    service.list().subscribe((algoritmos) => {
      expect(algoritmos).toHaveLength(1);
      expect(algoritmos[0].scope).toBe('encounter');
    });
    const request = controller.expectOne(base);
    expect(request.request.method).toBe('GET');
    request.flush([
      { slug: 'assimetria', title: 'Assimetria', description: '…', scope: 'encounter' },
    ]);
  });

  it('executa pelo slug, com a consulta no corpo', () => {
    service.run('assimetria', 'e1').subscribe();
    const request = controller.expectOne(`${base}/assimetria/run`);
    expect(request.request.method).toBe('POST');
    // O slug vai na URL e a consulta no corpo: é o que faz um algoritmo novo não
    // criar rota nenhuma.
    expect(request.request.body).toEqual({ encounter_id: 'e1' });
    request.flush({ status: 'ok', summary: 'ok', values: [] });
  });

  it('trata dados insuficientes como resposta de sucesso', () => {
    // Sequência sem par comparável é caso normal, não falha do pedido: se viesse
    // como erro HTTP, a tela mostraria "não foi possível completar a operação" no
    // lugar da frase que explica o que faltou.
    let recebido = false;
    service.run('assimetria', 'e1').subscribe({
      next: (resultado) => {
        recebido = true;
        expect(resultado.status).toBe('insufficient-data');
      },
      error: () => expect.unreachable('não deveria falhar'),
    });
    controller
      .expectOne(`${base}/assimetria/run`)
      .flush({ status: 'insufficient-data', summary: 'Sem par comparável.', values: [] });
    expect(recebido).toBe(true);
  });
});
