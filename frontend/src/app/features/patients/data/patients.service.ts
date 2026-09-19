import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  AnalysisCreate,
  DiagnosisCatalog,
  AnalysisCreated,
  Encounter,
  EncounterCreate,
  EncounterDetail,
  Patient,
  PatientCreate,
  PatientDetail,
  PatientUpdate,
} from './patient.model';

/** Único ponto do frontend que conhece as rotas da API clínica. */
@Injectable({ providedIn: 'root' })
export class PatientsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/patients`;
  private readonly encountersUrl = `${environment.apiBaseUrl}/encounters`;

  list(): Observable<Patient[]> {
    return this.http.get<Patient[]>(this.baseUrl);
  }

  /**
   * O catálogo de diagnósticos, para montar a escolha do formulário.
   *
   * Dado de referência: são cerca de 17 linhas que só mudam por migration, então não há
   * paginação nem filtro — a tela busca uma vez e usa.
   */
  listDiagnoses(): Observable<DiagnosisCatalog[]> {
    return this.http.get<DiagnosisCatalog[]>(`${environment.apiBaseUrl}/diagnoses`);
  }

  get(patientId: string): Observable<PatientDetail> {
    return this.http.get<PatientDetail>(`${this.baseUrl}/${patientId}`);
  }

  /**
   * Cria o paciente. Sem `allowDuplicate`, a API recusa com 409 quando já existe
   * homônimo — e manda no corpo quem já existe, para a tela poder oferecer abri-lo.
   *
   * Repetir com `allowDuplicate` é a confirmação do médico. Nome **e** data de
   * nascimento idênticos continuam recusados, aí pelo índice único do banco.
   */
  create(payload: PatientCreate, allowDuplicate = false): Observable<Patient> {
    return this.http.post<Patient>(this.baseUrl, payload, {
      params: allowDuplicate ? { allow_duplicate: true } : {},
    });
  }

  update(patientId: string, changes: PatientUpdate): Observable<Patient> {
    return this.http.patch<Patient>(`${this.baseUrl}/${patientId}`, changes);
  }

  /** Apaga o paciente e, em cascata, todas as consultas e análises dele. */
  delete(patientId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${patientId}`);
  }

  createEncounter(patientId: string, payload: EncounterCreate): Observable<Encounter> {
    return this.http.post<Encounter>(`${this.baseUrl}/${patientId}/encounters`, payload);
  }

  /** Reabre a consulta: paciente, body map, escores e capturas numa chamada. */
  getEncounter(encounterId: string): Observable<EncounterDetail> {
    return this.http.get<EncounterDetail>(`${this.encountersUrl}/${encounterId}`);
  }

  /**
   * Apaga a consulta: body map, escores e a análise de imagem inteira.
   *
   * As capturas somem por cascata no banco e os arquivos são apagados do bucket pelo
   * backend — não há nada a limpar por aqui.
   */
  deleteEncounter(encounterId: string): Observable<void> {
    return this.http.delete<void>(`${this.encountersUrl}/${encounterId}`);
  }

  /**
   * Cria a análise de imagem da consulta e recebe os PUTs assinados.
   *
   * **Nunca repita esta chamada.** A segunda recebe 409: criaria um segundo jogo de
   * capturas sob a mesma consulta, e as URLs da primeira ficariam órfãs. Se o upload
   * falhar, retome com as URLs que já estão em mãos.
   */
  createCaptures(encounterId: string, payload: AnalysisCreate): Observable<AnalysisCreated> {
    return this.http.post<AnalysisCreated>(
      `${this.encountersUrl}/${encounterId}/captures`,
      payload,
    );
  }

  /**
   * Fecha a análise em `ready`.
   *
   * **O backend não confere o bucket.** Quem sabe que os arquivos chegaram é este
   * lado, que viu a resposta de cada PUT — então só chame isto depois de `uploadAll`
   * não devolver nenhuma falha. Chamar antes deixa a consulta em `ready` com objeto
   * faltando, e o buraco só aparece na reabertura.
   */
  markAnalysisReady(encounterId: string): Observable<void> {
    return this.http.patch<void>(`${this.encountersUrl}/${encounterId}/analysis-status`, {});
  }
}
