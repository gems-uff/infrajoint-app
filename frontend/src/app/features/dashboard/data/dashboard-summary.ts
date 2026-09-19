/**
 * O que a lista de pacientes diz sobre a conta, e o que o dashboard oferece fazer.
 *
 * Funções puras, fora do componente: a página só as renderiza. Mesma divisão de
 * `encounter-summary.ts`, e pela mesma razão — assim o resumo é testável com um
 * objeto literal, sem montar componente nem HTTP.
 *
 * "Acervo", e não "conta": para o perfil de pesquisador `GET /patients` devolve
 * também os pacientes dos pares, então os números daqui contam o acervo compartilhado.
 * Para o médico os dois termos coincidem, porque o acervo dele é só o dele.
 *
 * O dashboard se apoia **só em `GET /patients`**. Não há endpoint que liste consultas
 * de todos os pacientes, e montar "consultas recentes" custaria uma requisição por
 * paciente. Um painel que fica lento à medida que a conta cresce é pior que um painel
 * que mostra menos.
 */

import { UserRole } from '../../../core/auth/profile.model';
import { Patient } from '../../patients/data/patient.model';

/** Janela do contador de cadastros recentes, em dias. */
export const JANELA_DIAS = 30;

/** Quantos pacientes aparecem na lista de recentes. */
export const LIMITE_RECENTES = 5;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** O `created_at` como número, ou `NaN` quando a data não puder ser lida. */
function cadastradoEm(patient: Patient): number {
  return new Date(patient.created_at).getTime();
}

/**
 * Quantos pacientes foram cadastrados na janela que termina em `agora`.
 *
 * `agora` entra por parâmetro para o teste não depender do relógio — a mesma razão
 * de `RecursosDoRelatorio.emitidoEm` receber a data em vez de chamar `new Date()`.
 */
export function cadastradosNaJanela(
  patients: readonly Patient[],
  agora: Date,
  dias = JANELA_DIAS,
): number {
  const limite = agora.getTime() - dias * MS_POR_DIA;
  return patients.filter((p) => {
    const quando = cadastradoEm(p);
    // Data ilegível não conta: um `NaN` em comparação é sempre falso, e contá-lo
    // como recente inflaria o número justamente onde ele não pode ser conferido.
    return Number.isFinite(quando) && quando >= limite;
  }).length;
}

/**
 * Os pacientes mais recentes primeiro.
 *
 * Ordena por `created_at`, e não por `updated_at`: editar o telefone de um paciente
 * antigo não o torna recente. Os de data ilegível vão para o fim, em vez de sumirem —
 * quem está na conta aparece na lista.
 */
export function maisRecentes(
  patients: readonly Patient[],
  limite = LIMITE_RECENTES,
): readonly Patient[] {
  return [...patients]
    .sort((a, b) => {
      const x = cadastradoEm(a);
      const y = cadastradoEm(b);
      if (!Number.isFinite(x)) {
        return Number.isFinite(y) ? 1 : 0;
      }
      if (!Number.isFinite(y)) {
        return -1;
      }
      return y - x;
    })
    .slice(0, limite);
}

/** Um atalho para as telas de trabalho. */
export interface AcaoRapida {
  readonly label: string;
  readonly descricao: string;
  /** Nome de ícone Lucide registrado em `app.config.ts`. */
  readonly icone: string;
  readonly rota: string;
  /** Quando definido, só quem tem um destes papéis vê a ação. */
  readonly papeis?: readonly UserRole[];
}

/**
 * Os atalhos do dashboard, na ordem em que aparecem.
 *
 * Os papéis espelham os da barra lateral de propósito: as duas primeiras são
 * ferramentas abertas que não gravam nada, e as duas últimas mexem em prontuário.
 */
export const ACOES_RAPIDAS: readonly AcaoRapida[] = [
  {
    label: 'Análise térmica',
    descricao: 'Captura, medição e registro na consulta do paciente.',
    icone: 'thermometer',
    rota: '/analise/analise-termica',
    papeis: ['medico', 'pesquisador', 'admin'],
  },
  {
    label: 'Pacientes',
    descricao: 'Cadastre e acompanhe os pacientes do seu acervo.',
    icone: 'user-round',
    rota: '/pacientes',
    papeis: ['medico', 'pesquisador', 'admin'],
  },
  {
    label: 'Analisador de imagens',
    descricao: 'Meça temperaturas a partir de imagens, sem gravar nada.',
    icone: 'camera',
    rota: '/analise/analisador-de-imagens',
  },
  {
    label: 'Mapa corporal',
    descricao: 'Avalie articulações e calcule CDAI e DAS28.',
    icone: 'person-standing',
    rota: '/analise/mapa-corporal',
  },
];

/**
 * Os atalhos que este papel enxerga.
 *
 * Esconder aqui é **cosmético**, exatamente como na barra lateral: não concede nem
 * nega acesso. A fronteira real é a RLS, e as rotas clínicas ainda passam pelo
 * `roleGuard`.
 */
export function acoesPara(papel: UserRole | undefined): readonly AcaoRapida[] {
  return ACOES_RAPIDAS.filter((acao) => !acao.papeis || (papel !== undefined && acao.papeis.includes(papel)));
}

/** Quem pode ver os painéis clínicos. Espelha `is_clinician()` no banco. */
export function ehClinico(papel: UserRole | undefined): boolean {
  return papel === 'medico' || papel === 'pesquisador' || papel === 'admin';
}
