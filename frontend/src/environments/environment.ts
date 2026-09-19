/**
 * Modo VERIFICAÇÃO (opção B) — Supabase de produção, API ainda na sua máquina.
 *
 * Usado por `npm run start:prod`. Serve para conferir o comportamento com a
 * autenticação real antes de publicar. Aponte a API para a `DATABASE_URL` de produção
 * junto, senão você autentica em um banco e grava em outro.
 *
 * Neste modo você escreve no banco clínico de verdade.
 */
export const environment = {
  production: false,
  supabaseUrl: 'https://wbxaicjveebxlxsemayn.supabase.co',
  supabaseAnonKey: 'sb_publishable_NLq2fLg8L4DTyKlaZr09VQ_0tPEGd-b',
  /** Base da API clínica. O interceptor só anexa o JWT a URLs com este prefixo. */
  apiBaseUrl: 'http://localhost:8000',
};
