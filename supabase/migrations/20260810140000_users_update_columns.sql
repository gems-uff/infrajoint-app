-- Restringe o UPDATE de public.users às duas colunas que o usuário pode mesmo editar.
--
-- O buraco, reproduzido no banco local:
--
--   set local role authenticated;
--   update public.users set role='admin' where id = auth.uid();   -- FUNCIONAVA
--
-- E `app.is_admin()` dá leitura dos pacientes de TODOS os tenants. Ou seja: qualquer
-- conta autenticada se promovia sozinha e passava a enxergar a base clínica inteira.
--
-- Por que só o local estava exposto: a baseline do Supabase traz
-- `alter default privileges ... grant all on tables to authenticated`, que dispara em
-- toda tabela NOVA em public. Local, public.users nasce da migration → recebe UPDATE de
-- tabela (todas as colunas, inclusive `role` e `id`). No projeto hospedado a tabela é
-- anterior a esse caminho e sempre teve só `update (avatar_url, full_name)`. Produção
-- não estava vulnerável; os dois ambientes é que discordavam — que é o pior estado
-- possível, porque valida-se a autorização no ambiente errado.
--
-- Repare que a policy `update_own_profile` NÃO ajuda aqui: ela restringe a LINHA
-- (`auth.uid() = id`), nunca a COLUNA. Contra escalada de privilégio quem protege é o
-- grant, e é por isso que ele passa a ser explícito em vez de herdado.
--
-- `revoke update` derruba também os grants de coluna, então o re-grant abaixo não é
-- decorativo: sem ele o usuário perde a edição do próprio perfil.
revoke update on public.users from authenticated;
grant update (full_name, avatar_url) on public.users to authenticated;

-- Idem para o anon, que nunca teve motivo para escrever aqui.
revoke update on public.users from anon;
