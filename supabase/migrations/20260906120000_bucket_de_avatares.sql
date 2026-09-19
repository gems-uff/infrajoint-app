-- O bucket `avatars` e as policies dele, que até aqui só existiam no dashboard.
--
-- ─── Por que isto é uma migration, e não um clique
-- Era o único lugar do sistema com uma regra de autorização fora do repositório.
-- Todas as outras — pacientes, consultas, capturas, escores, medições — estão em
-- migration e são cobertas por `tests/rls_isolation.sql`. Esta não estava em lugar
-- nenhum: não dava para revisar quem pode escrever no avatar de quem sem abrir o
-- painel do Supabase, e `supabase db reset` deixava o upload de avatar quebrado em
-- desenvolvimento, porque o bucket simplesmente não existia.
--
-- ─── ATENÇÃO ao aplicar no projeto hospedado
-- Policies de RLS são somadas, nunca subtraídas: elas se combinam por OR. Se lá já
-- existir uma policy permissiva criada à mão (uma do tipo `bucket_id = 'avatars'`
-- sem recorte de pasta, por exemplo), **esta migration não a anula** — as duas
-- passam a valer, e a mais frouxa é que decide. Confira o que existe hoje com:
--
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--    where c.relname = 'objects';
--
-- e apague no dashboard o que não estiver aqui. Este arquivo passa a ser a lista
-- completa do que deve existir.
--
-- ─── O que o bucket guarda
-- Uma imagem por usuário, em `<uid>/avatar` (ver `AuthService.uploadAvatar`). O
-- caminho é estável de propósito: cada upload sobrescreve o mesmo objeto em vez de
-- criar um arquivo por extensão, o que deixaria o anterior órfão.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O bucket
--
-- `public = true` não é descuido: a tela lê o avatar por `getPublicUrl()`, e uma URL
-- assinada não serviria — ela expira, e o `<img>` do cabeçalho fica na tela enquanto
-- a sessão durar. O que está exposto é uma foto de perfil sob um uuid não
-- adivinhável, e nada mais: o bucket não guarda dado clínico.
--
-- Os dois limites espelham o que o formulário já cobra (`profile-page.ts`: 2 MB e
-- `image/*`). Estando só na tela, eles eram sugestão — qualquer chamada direta com a
-- anon key passava por baixo. Aqui viram regra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/*'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. As policies
--
-- O recorte é a primeira pasta do caminho: `storage.foldername(name))[1]` de
-- `<uid>/avatar` é o uuid do dono. Sem ele, qualquer autenticado sobrescreveria o
-- avatar de qualquer outro — o bucket é um só, e `bucket_id = 'avatars'` sozinho não
-- separa ninguém de ninguém.
--
-- `drop if exists` antes de cada `create` para a migration poder ser reaplicada; os
-- nomes são os desta migration, e é por eles que a conferência acima se orienta.
-- ─────────────────────────────────────────────────────────────────────────────

-- Leitura: o bucket é público, então o objeto já sai pela rota `/object/public/`
-- sem passar por policy. Esta existe para a tabela não depender de ausência de
-- policy para se comportar, mesmo princípio de `joints_read`.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select
  using (bucket_id = 'avatars');

-- Escrita: só na própria pasta. O `upsert: true` do SDK precisa das duas, INSERT e
-- UPDATE — ele grava por INSERT e cai no UPDATE quando o objeto já existe.
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
