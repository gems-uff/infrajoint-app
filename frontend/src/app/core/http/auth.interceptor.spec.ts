import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { SupabaseService } from '../supabase/supabase.service';
import { authInterceptor } from './auth.interceptor';

function configure(accessToken: string | null): {
  http: HttpClient;
  controller: HttpTestingController;
  getSession: ReturnType<typeof vi.fn>;
} {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: accessToken ? { access_token: accessToken } : null },
  });

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: SupabaseService, useValue: { client: { auth: { getSession } } } },
    ],
  });

  return {
    http: TestBed.inject(HttpClient),
    controller: TestBed.inject(HttpTestingController),
    getSession,
  };
}

describe('authInterceptor', () => {
  it('anexa o token nas chamadas da API clínica', async () => {
    const { http, controller } = configure('token-abc');

    http.get(`${environment.apiBaseUrl}/patients`).subscribe();
    await Promise.resolve();

    const request = controller.expectOne(`${environment.apiBaseUrl}/patients`);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-abc');
    controller.verify();
  });

  // A regra que evita entregar a credencial do usuário a terceiros.
  it('NÃO anexa o token a hosts fora da API', async () => {
    const { http, controller, getSession } = configure('token-abc');

    http.get('https://outro-servico.example.com/dados').subscribe();
    await Promise.resolve();

    const request = controller.expectOne('https://outro-servico.example.com/dados');
    expect(request.request.headers.has('Authorization')).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
    controller.verify();
  });

  it('segue sem cabeçalho quando não há sessão', async () => {
    const { http, controller } = configure(null);

    http.get(`${environment.apiBaseUrl}/patients`).subscribe();
    await Promise.resolve();

    const request = controller.expectOne(`${environment.apiBaseUrl}/patients`);
    expect(request.request.headers.has('Authorization')).toBe(false);
    controller.verify();
  });

  it('consulta a sessão a cada request, sem cachear o token', async () => {
    const { http, controller, getSession } = configure('token-abc');

    http.get(`${environment.apiBaseUrl}/patients`).subscribe();
    await Promise.resolve();
    controller.expectOne(`${environment.apiBaseUrl}/patients`).flush([]);

    http.get(`${environment.apiBaseUrl}/patients`).subscribe();
    await Promise.resolve();
    controller.expectOne(`${environment.apiBaseUrl}/patients`).flush([]);

    expect(getSession).toHaveBeenCalledTimes(2);
    controller.verify();
  });
});
