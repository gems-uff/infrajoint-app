import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { Algorithm, AlgorithmResult, AlgorithmRun } from './algorithm.model';

/**
 * Único ponto do frontend que conhece as rotas dos algoritmos.
 *
 * São duas, e continuam sendo duas por mais algoritmos que existam: acrescentar um é
 * mexer no registry do servidor, e nada aqui muda. É o que a arquitetura plugável
 * significa na prática deste lado.
 */
@Injectable({ providedIn: 'root' })
export class AlgorithmsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/algorithms`;

  /** Os algoritmos que o servidor tem registrados. A tela nunca mantém a própria lista. */
  list(): Observable<Algorithm[]> {
    return this.http.get<Algorithm[]>(this.baseUrl);
  }

  /**
   * Executa e devolve o resultado. Nada é gravado: o achado vive na tela e some.
   *
   * `insufficient-data` chega como resposta de sucesso, e não como erro HTTP: sequência
   * sem par comparável é caso normal, não falha do pedido.
   */
  run(slug: string, encounterId?: string): Observable<AlgorithmResult> {
    const body: AlgorithmRun = encounterId ? { encounter_id: encounterId } : {};
    return this.http.post<AlgorithmResult>(`${this.baseUrl}/${slug}/run`, body);
  }
}
