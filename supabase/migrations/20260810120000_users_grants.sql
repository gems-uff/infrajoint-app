-- Tira de public.users os grants que nenhuma policy sustenta.
--
-- A baseline do Supabase concedeu ao `authenticated`:
--   DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE
-- mas a tabela só tem duas policies: select_own_profile e update_own_profile.
--
-- O grave é o TRUNCATE. RLS **não se aplica a TRUNCATE** — é privilégio de tabela puro,
-- sem WHERE onde a policy possa entrar. Hoje não é alcançável (a API nunca emite
-- TRUNCATE e o PostgREST não o expõe), então isto é fechar a porta antes de alguém
-- construir o corredor, não conter um vazamento.
--
-- DELETE e INSERT hoje são barrados pela RLS por ausência de policy. Revogá-los alinha
-- o grant à intenção: uma policy futura escrita sem cuidado deixa de virar exposição.
--
-- Nada depende deles:
--   · o perfil nasce por public.handle_new_user(), que é SECURITY DEFINER e roda no
--     trigger de auth.users — não usa o grant do authenticated;
--   · o frontend só faz select e update(full_name, avatar_url) em public.users
--     (core/auth/auth.service.ts);
--   · a API só faz `select role from public.users` (presentation/deps.py).
--
-- SELECT e UPDATE(avatar_url, full_name) continuam intactos.
revoke truncate, delete, insert on public.users from authenticated;

-- O anon nunca leu nada aqui de fato (auth.uid() nulo → nenhuma linha passa na policy),
-- mas TRIGGER e REFERENCES permitem anexar-se ao objeto sem ler dado. Não servem à
-- anon key, que é pública por design.
revoke trigger, references on public.users from anon;
