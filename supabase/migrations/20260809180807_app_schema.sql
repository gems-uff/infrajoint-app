-- Schema `app`: as funções de autorização usadas pelas policies de RLS.
--
-- Nenhuma tabela mora aqui. É só a camada que responde "este usuário pode ver esta linha?",
-- isolada num schema próprio para que a resposta tenha um único lugar onde mudar.

create schema if not exists app;

-- Lê o role do usuário corrente a partir de public.users.
--
-- SECURITY DEFINER é obrigatório: sem ele, chamar esta função de dentro de uma policy que
-- protege public.users reentraria na própria policy. Como efeito colateral desejável,
-- funções SECURITY DEFINER não são inlined pelo planner, o que garante a quebra do ciclo.
--
-- search_path fixo e vazio, com todo identificador qualificado — mesmo padrão já usado por
-- public.handle_new_user(). Sem isso, um search_path controlado pelo chamador poderia
-- resolver `users` para outra tabela e a função rodaria com os privilégios do dono.
create or replace function app.current_app_role()
  returns public.user_role
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select role from public.users where id = auth.uid()
$$;

-- Sem SECURITY DEFINER e sem SET search_path: rodam com os privilégios de quem consulta e
-- referenciam tudo qualificado. Omitir o SET é deliberado — ele impediria o inlining destas
-- duas no plano da query, e elas são avaliadas por linha na RLS.
create or replace function app.is_admin()
  returns boolean
  language sql
  stable
as $$
  select app.current_app_role() = 'admin'::public.user_role
$$;

-- ⭐ Único ponto de mudança da estratégia de tenancy.
-- Migrar de "dono é o médico" para "dono é a organização" mexe nesta função e em nada mais:
-- as policies do Passo 2 chamam só ela.
create or replace function app.can_access(owner uuid)
  returns boolean
  language sql
  stable
as $$
  select owner = auth.uid() or app.is_admin()
$$;

-- Expressões de policy são avaliadas como o usuário que consulta, então `authenticated`
-- precisa alcançar o schema. As default privileges herdadas do Supabase cobrem apenas o
-- schema public — USAGE em `app` não vem de graça.
grant usage on schema app to authenticated;
grant execute on function app.current_app_role() to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.can_access(uuid) to authenticated;
