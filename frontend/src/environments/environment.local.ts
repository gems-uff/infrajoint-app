/**
 * Modo LOCAL (opção A) — Supabase do Docker, API na sua máquina.
 *
 * Usado por `npm start`, via fileReplacement da configuração `local` no angular.json.
 * Nenhum arquivo precisa ser editado para alternar de modo.
 *
 * As credenciais abaixo são as chaves fixas do Supabase CLI, iguais em toda instalação
 * e alcançáveis apenas em 127.0.0.1. Não são segredo — confira com `supabase status`.
 *
 * Contas semeadas por supabase/seed.sql (senha `SenhaLocal123!`):
 *   medico-a@local.test · medico-b@local.test · leitor@local.test · admin@local.test
 */
export const environment = {
  production: false,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  /** Base da API clínica. O interceptor só anexa o JWT a URLs com este prefixo. */
  apiBaseUrl: 'http://localhost:8000',
};
