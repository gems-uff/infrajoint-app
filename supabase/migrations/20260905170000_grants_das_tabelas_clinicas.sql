-- Tira das tabelas clínicas os privilégios que nenhuma policy sustenta.
--
-- ─── O que está aberto, e por quê
-- A baseline do Supabase traz `alter default privileges ... grant all on tables`, então
-- toda tabela nova em public nasce com o pacote inteiro. `tenant_integrity` fechou essa
-- torneira para o `anon` e `users_grants` revogou o excesso em `public.users` para o
-- `authenticated` — mas as três tabelas clínicas ficaram com
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE, e o `anon` continuou
-- com DELETE, INSERT, SELECT e TRUNCATE em `public.users`.
--
-- ─── O grave é o TRUNCATE, e o motivo é o mesmo que `users_grants` já registrou
-- **RLS não se aplica a TRUNCATE.** É privilégio de tabela puro, sem WHERE onde a policy
-- possa entrar. Todo o isolamento que `rls_isolation.sql` prova linha a linha não vale
-- nada contra ele: um TRUNCATE em `public.patients` levaria consultas, escores,
-- avaliações, capturas e medições por cascata, de todos os tenants de uma vez.
--
-- ─── Por que agora, se não é alcançável hoje
-- Não é: a API nunca emite TRUNCATE e o PostgREST não o expõe. Isto é fechar a porta
-- antes de alguém construir o corredor, exatamente como a migration de `public.users`.
--
-- O que motivou fazê-lo agora foi a auditoria das tabelas novas: elas nasceram com
-- `revoke all` antes do `grant`, então estão restritas ao que as policies sustentam. Sem
-- esta migration, o schema fica com dois padrões convivendo, e o mais frouxo é
-- justamente o das tabelas que guardam o prontuário.
--
-- ─── O que NÃO é revogado
-- SELECT, INSERT, UPDATE e DELETE para `authenticated`: são os quatro que as policies
-- governam, e sem eles a aplicação para. Quem decide o que cada um alcança continua
-- sendo a RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. As tabelas clínicas
--
-- TRIGGER e REFERENCES entram junto pelo mesmo motivo que entraram em `users_grants`:
-- permitem anexar-se ao objeto sem ler dado, e nenhuma rota precisa deles.
-- ─────────────────────────────────────────────────────────────────────────────
revoke truncate, trigger, references
  on public.patients, public.encounters, public.analysis_captures
  from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O `anon` em public.users
--
-- `users_grants` revogou TRUNCATE, DELETE e INSERT do `authenticated` e, do `anon`,
-- apenas TRIGGER e REFERENCES. Sobraram DELETE, INSERT, SELECT e TRUNCATE para a chave
-- pública — barrados pela RLS por ausência de policy, menos o TRUNCATE, que ela não
-- alcança.
--
-- O `anon` não precisa de nada aqui: o perfil nasce por `public.handle_new_user()`, que
-- é SECURITY DEFINER e roda no trigger de auth.users, e toda leitura de perfil acontece
-- autenticada.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.users from anon;

-- E o mesmo par em `public.users` para o `authenticated`: `users_grants` os revogou só
-- do `anon`, e eles não servem a nenhuma rota aqui também. SELECT e
-- UPDATE(full_name, avatar_url) ficam intactos — são o perfil que a pessoa edita.
revoke references, trigger on public.users from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A causa, e não só o sintoma
--
-- `tenant_integrity` fechou as default privileges para o `anon`, o que fez as tabelas
-- desta normalização nascerem limpas desse lado. Para o `authenticated` a torneira
-- continua aberta: a próxima tabela em public vai nascer com TRUNCATE de novo, e quem a
-- escrever terá que lembrar do `revoke`.
--
-- Fechá-la aqui tira a lembrança da equação. As quatro operações que a aplicação usa
-- passam a ser concedidas explicitamente em cada tabela, que é como as cinco tabelas
-- novas já fazem.
alter default privileges for role postgres in schema public
  revoke all on tables from authenticated;

-- Conferência: nenhuma tabela de public pode ter sobrado com TRUNCATE.
do $$
declare abertas text;
begin
  select string_agg(distinct table_name, ', ')
    into abertas
    from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type = 'TRUNCATE';

  if abertas is not null then
    raise exception 'ainda há TRUNCATE concedido em: %', abertas;
  end if;
end $$;
