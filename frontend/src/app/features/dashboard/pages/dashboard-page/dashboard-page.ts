import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { LucideDynamicIcon } from '@lucide/angular';

import { AuthService } from '../../../../core/auth/auth.service';
import { messageFromError } from '../../../patients/data/api-error';
import { Patient } from '../../../patients/data/patient.model';
import { PatientsService } from '../../../patients/data/patients.service';
import {
  JANELA_DIAS,
  acoesPara,
  cadastradosNaJanela,
  ehClinico,
  maisRecentes,
} from '../../data/dashboard-summary';

/**
 * A tela de entrada da área autenticada: onde a conta está e para onde ir.
 *
 * Não repete a saudação — quem cumprimenta é a barra lateral, e dois "olá" na mesma
 * dobra é ruído. O que esta página acrescenta é o que a barra não tem: quanta coisa
 * existe na conta e um caminho de um clique para as telas de trabalho.
 *
 * Os números saem de `GET /patients`, uma requisição só. Um painel de consultas
 * recentes exigiria uma requisição por paciente, porque não há endpoint que liste
 * consultas de toda a conta — e ficaria mais lento quanto mais o médico usasse.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, DatePipe, LucideDynamicIcon],
  templateUrl: './dashboard-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly patients = inject(PatientsService);

  private readonly lista = signal<readonly Patient[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly janelaDias = JANELA_DIAS;

  private readonly papel = computed(() => this.auth.profile()?.role);

  protected readonly clinico = computed(() => ehClinico(this.papel()));
  protected readonly acoes = computed(() => acoesPara(this.papel()));

  protected readonly total = computed(() => this.lista().length);
  protected readonly novos = computed(() => cadastradosNaJanela(this.lista(), new Date()));
  protected readonly recentes = computed(() => maisRecentes(this.lista()));

  constructor() {
    // Busca sempre, sem esperar o perfil: `GET /patients` não checa papel — a RLS
    // devolve lista vazia para quem não é dono de ninguém. Condicionar a requisição
    // ao perfil criaria uma corrida (ele chega depois) para economizar um request
    // que, para quem não é clínico, já volta vazio.
    this.load();
  }

  private load(): void {
    this.patients.list().subscribe({
      next: (patients) => {
        this.lista.set(patients);
        this.loading.set(false);
      },
      error: (cause: unknown) => {
        this.error.set(messageFromError(cause));
        this.loading.set(false);
      },
    });
  }
}
