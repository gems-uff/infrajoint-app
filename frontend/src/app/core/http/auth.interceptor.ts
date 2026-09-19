import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Anexa o JWT do Supabase às chamadas da API clínica.
 *
 * Duas decisões carregam o peso aqui:
 *
 * **Só URLs da nossa API recebem o token.** Sem esse recorte, qualquer `HttpClient`
 * apontando para outro host — um CDN, um serviço de mapas, um webhook — sairia com a
 * credencial do usuário no cabeçalho.
 *
 * **O token vem de `getSession()`, não de um signal.** O signal de sessão reflete o
 * último evento recebido; `getSession()` devolve uma sessão válida, renovando-a se o
 * access token tiver expirado. Como a renovação é do SDK, nada é cacheado aqui.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(environment.apiBaseUrl)) {
    return next(request);
  }

  const supabase = inject(SupabaseService).client;

  return from(supabase.auth.getSession()).pipe(
    switchMap(({ data }) => {
      const token = data.session?.access_token;
      if (!token) {
        // Sem sessão, segue sem cabeçalho: a API responde 401 e o erro é tratado
        // onde a chamada foi feita, em vez de falhar silenciosamente aqui.
        return next(request);
      }
      return next(
        request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
      );
    }),
  );
};
