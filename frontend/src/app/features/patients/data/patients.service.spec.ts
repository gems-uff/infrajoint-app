import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../../environments/environment';
import { PatientsService } from './patients.service';

describe('PatientsService', () => {
  let service: PatientsService;
  let controller: HttpTestingController;
  const base = `${environment.apiBaseUrl}/patients`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PatientsService);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('lista pacientes', () => {
    service.list().subscribe();
    const request = controller.expectOne(base);
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('busca o detalhe com as consultas embutidas', () => {
    service.get('abc').subscribe((detail) => {
      expect(detail.encounters).toHaveLength(1);
    });
    const request = controller.expectOne(`${base}/abc`);
    expect(request.request.method).toBe('GET');
    request.flush({ id: 'abc', full_name: 'Ana', encounters: [{ id: 'e1' }] });
  });

  it('cria paciente com POST', () => {
    service.create({ full_name: 'Ana', birth_date: '1970-01-01' }).subscribe();
    const request = controller.expectOne(base);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ full_name: 'Ana', birth_date: '1970-01-01' });
    request.flush({});
  });

  it('só manda allow_duplicate quando o médico confirma o homônimo', () => {
    service.create({ full_name: 'Ana', birth_date: '1970-01-01' }).subscribe();
    const primeira = controller.expectOne((request) => request.url === base);
    expect(primeira.request.params.has('allow_duplicate')).toBe(false);
    primeira.flush({});

    service.create({ full_name: 'Ana', birth_date: '1970-01-01' }, true).subscribe();
    const segunda = controller.expectOne((request) => request.url === base);
    expect(segunda.request.params.get('allow_duplicate')).toBe('true');
    segunda.flush({});
  });

  it('edita com PATCH, enviando só o que mudou', () => {
    service.update('abc', { phone: '11999' }).subscribe();
    const request = controller.expectOne(`${base}/abc`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ phone: '11999' });
    request.flush({});
  });

  it('exclui paciente com DELETE', () => {
    service.delete('abc').subscribe();
    const request = controller.expectOne(`${base}/abc`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('cria consulta na rota aninhada do paciente', () => {
    service.createEncounter('abc', { reason: 'dor' }).subscribe();
    const request = controller.expectOne(`${base}/abc/encounters`);
    expect(request.request.method).toBe('POST');
    request.flush({});
  });

  it('exclui consulta pela rota de consultas, não pela do paciente', () => {
    service.deleteEncounter('e1').subscribe();
    const request = controller.expectOne(`${environment.apiBaseUrl}/encounters/e1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
  });
});
