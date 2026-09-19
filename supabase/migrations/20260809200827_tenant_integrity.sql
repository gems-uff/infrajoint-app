-- Corrige quatro falhas encontradas auditando o modelo clínico.
--
-- 1. UPDATE permitia reparentar uma linha para o tenant de outro médico
-- 2. Médico rebaixado a leitor não podia editar, mas ainda podia APAGAR
-- 3. app.is_admin() devolvia NULL em vez de false para uid sem perfil
-- 4. Toda tabela nova em public nasce com DML concedido ao anon

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reparentamento cross-tenant o mais grave
--
-- app.inherit_owner() só estava em BEFORE INSERT. Em UPDATE nada re-derivava o
-- owner, e a policy continuava satisfeita porque owner_id não mudava. Resultado
-- reproduzido na auditoria: o médico A apontava a consulta dele para o paciente
-- do médico B, o B apagava o próprio paciente, e o ON DELETE CASCADE levava a
-- consulta do A junto. Um tenant destruía dado clínico de outro.
--
-- Passando o trigger a rodar também em UPDATE, o owner é re-derivado do pai a
-- cada gravação — e como a busca do pai acontece sob a RLS de quem escreve,
-- apontar para uma linha invisível levanta insufficient_privilege.
drop trigger encounters_inherit_owner        on public.encounters;
drop trigger image_analyses_inherit_owner    on public.image_analyses;
drop trigger analysis_captures_inherit_owner on public.analysis_captures;

create trigger encounters_inherit_owner
  before insert or update on public.encounters
  for each row execute function app.inherit_owner('public.patients', 'patient_id');

create trigger image_analyses_inherit_owner
  before insert or update on public.image_analyses
  for each row execute function app.inherit_owner('public.encounters', 'encounter_id');

create trigger analysis_captures_inherit_owner
  before insert or update on public.analysis_captures
  for each row execute function app.inherit_owner('public.image_analyses', 'analysis_id');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. is_admin() total
--
-- can_access() já recebeu coalesce, mas is_admin() continuava devolvendo NULL
-- quando auth.uid() não tem linha em public.users. Dentro de policy NULL nega,
-- mas `not is_admin()` também daria NULL — nunca true.
create or replace function app.is_admin()
  returns boolean
  language sql
  stable
as $$
  select coalesce(app.current_app_role() = 'admin'::public.user_role, false)
$$;

-- Quem pode escrever dado clínico. Total por construção, pelo mesmo motivo.
create or replace function app.is_clinician()
  returns boolean
  language sql
  stable
as $$
  select coalesce(
    app.current_app_role() in ('medico'::public.user_role, 'admin'::public.user_role),
    false)
$$;

grant execute on function app.is_clinician() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Leitura e escrita deixam de ser a mesma regra
--
-- A policy única `for all` fazia DELETE consultar só o USING, que não checava
-- role. Um médico rebaixado ficava impedido de editar e livre para apagar — a
-- operação destrutiva mais permissiva que a reversível.
--
-- Duas policies por tabela. Policies permissivas se somam (OR), então SELECT
-- passa pela _read, enquanto INSERT/UPDATE/DELETE só existem na _write:
--
--   ler    = a linha é minha (ou sou admin)
--   gravar = a linha é minha (ou sou admin)  E  sou clínico
--
-- Efeito: rebaixar alguém para 'user' o torna somente-leitura do próprio
-- histórico, em vez de deixá-lo com poder de destruição.
drop policy patients_all          on public.patients;
drop policy encounters_all        on public.encounters;
drop policy image_analyses_all    on public.image_analyses;
drop policy analysis_captures_all on public.analysis_captures;

create policy patients_read on public.patients
  for select using (app.can_access(owner_id));
create policy patients_write on public.patients
  for all
  using      (app.can_access(owner_id) and app.is_clinician())
  with check (app.can_access(owner_id) and app.is_clinician());

create policy encounters_read on public.encounters
  for select using (app.can_access(owner_id));
create policy encounters_write on public.encounters
  for all
  using      (app.can_access(owner_id) and app.is_clinician())
  with check (app.can_access(owner_id) and app.is_clinician());

create policy image_analyses_read on public.image_analyses
  for select using (app.can_access(owner_id));
create policy image_analyses_write on public.image_analyses
  for all
  using      (app.can_access(owner_id) and app.is_clinician())
  with check (app.can_access(owner_id) and app.is_clinician());

create policy analysis_captures_read on public.analysis_captures
  for select using (app.can_access(owner_id));
create policy analysis_captures_write on public.analysis_captures
  for all
  using      (app.can_access(owner_id) and app.is_clinician())
  with check (app.can_access(owner_id) and app.is_clinician());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Fecha a torneira das default privileges
--
-- A migration anterior revogou o anon tabela a tabela, mas a causa continuava
-- ativa: medido na auditoria, uma tabela nova em public nascia com 7 grants para
-- o anon. Revogar no default privileges resolve na origem, para tudo que vier.
--
-- Consequência a saber: uma tabela futura que precise mesmo ser lida pelo anon
-- passa a exigir GRANT explícito. Para app clínico é o padrão certo.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
