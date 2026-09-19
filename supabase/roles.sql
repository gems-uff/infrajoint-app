-- Roles são cluster-level: o `supabase db pull` NÃO os captura, então o `app_api`
-- criado no SQL Editor do projeto hospedado não existe no banco local.
-- Este arquivo é carregado pelo `supabase db reset` ("Seeding globals from roles.sql"),
-- antes das migrations, e vale SOMENTE para o ambiente local.
--
-- No projeto hospedado o mesmo role é criado manualmente, com senha forte gerada.
-- A senha abaixo é de desenvolvimento local, onde o Postgres só escuta em
-- 127.0.0.1:54322.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    -- noinherit: app_api pode VIRAR authenticated, mas não herda seus privilégios.
    -- Sem o `SET LOCAL ROLE authenticated` da db.py, toda query dá permission denied
    -- em vez de rodar com privilégio amplo e deixar a RLS inerte.
    create role app_api login noinherit password 'postgres';
  end if;
end
$$;

grant authenticated to app_api;
