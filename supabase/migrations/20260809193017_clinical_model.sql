-- Modelo clínico: 4 tabelas, os triggers de posse e a RLS.
--
--   patients ──1:N──▶ encounters ──1:N──▶ image_analyses ──1:N──▶ analysis_captures
--
-- Duas regras governam tudo aqui:
--   1. `owner_id` é o tenant e NUNCA vem do cliente — trigger deriva.
--   2. Toda policy chama app.can_access(owner_id), e só ela. Mudar a estratégia
--      de tenancy continua sendo editar uma função.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Endurece can_access() contra lógica de três valores
--
-- Verificado em produção: para um auth.uid() sem linha em public.users,
-- current_app_role() devolve NULL, então is_admin() e can_access() devolviam NULL
-- em vez de false. Dentro de policy é seguro (a RLS trata NULL como negação), mas
-- fora dela `not can_access(...)` também daria NULL — nunca true. Tornando a
-- função total, o valor de retorno passa a ser sempre booleano.
create or replace function app.can_access(owner uuid)
  returns boolean
  language sql
  stable
as $$
  select coalesce(owner = auth.uid() or app.is_admin(), false)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Triggers de posse
--
-- Nenhum é SECURITY DEFINER, e isso é deliberado: app.inherit_owner() precisa ler
-- a linha-pai SOB A RLS de quem está inserindo. É essa leitura que impede criar uma
-- consulta debaixo do paciente de outro médico — o pai fica invisível, a busca não
-- acha nada, e o insert falha. Com SECURITY DEFINER a checagem sumiria.

-- patients é a raiz da árvore: não tem pai de quem herdar, o dono é quem cria.
create or replace function app.own_row()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.owner_id := auth.uid();
  if new.owner_id is null then
    raise exception 'sem auth.uid(): owner_id indeterminado'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

-- Copia owner_id da linha-pai, ignorando o que o cliente tenha enviado.
-- Recebe por argumento a tabela-pai e a coluna de FK; ambos vêm desta migration,
-- nunca de dado, e o cast para regclass já garante a citação correta.
create or replace function app.inherit_owner()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  parent_owner uuid;
  fk_value     uuid;
begin
  execute format('select ($1).%I', tg_argv[1]) into fk_value using new;
  execute format('select owner_id from %s where id = $1', tg_argv[0]::regclass)
    into parent_owner using fk_value;

  if parent_owner is null then
    raise exception 'linha-pai inexistente ou inacessível em %', tg_argv[0]
      using errcode = 'insufficient_privilege';
  end if;

  new.owner_id := parent_owner;
  return new;
end
$$;

create or replace function app.touch_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Paciente
--
-- LGPD: sem CPF/RG. O identificador operacional é o número de prontuário;
-- full_name é o único dado diretamente identificante.
create table public.patients (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.users(id),
  full_name             text not null,
  birth_date            date,
  sex                   text check (sex in ('F','M','O','N')),
  medical_record_number text,
  phone                 text,
  primary_diagnosis     text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.patients (owner_id, created_at desc);

create trigger patients_own_row
  before insert on public.patients
  for each row execute function app.own_row();

create trigger patients_touch_updated_at
  before update on public.patients
  for each row execute function app.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Consulta (encounter = o atendimento que ocorreu, não o agendamento)
--
-- updated_at existe porque a gravação do body map (§2.5 do plano) o atualiza a
-- cada PUT de escore.
create table public.encounters (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete cascade,
  owner_id          uuid not null,
  occurred_at       timestamptz not null default now(),
  reason            text,
  clinical_notes    text,

  -- Body map: a observação articular é da consulta, e os escores são resultados
  -- calculados sobre ela. A chave do objeto JSON é o assessment_type, o que dá
  -- unicidade por tipo sem constraint nenhuma.
  joint_evaluations jsonb,
  scores            jsonb not null default '{}',

  created_by        uuid not null references public.users(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.encounters (patient_id, occurred_at desc);

create trigger encounters_inherit_owner
  before insert on public.encounters
  for each row execute function app.inherit_owner('public.patients', 'patient_id');

create trigger encounters_touch_updated_at
  before update on public.encounters
  for each row execute function app.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Análise de imagens — uma estrutura, 1..N capturas
--
-- Sem discriminador single/sequence: a cardinalidade de analysis_captures É a
-- diferença. Captura avulsa é um array de um elemento, não um segundo fluxo.
create table public.image_analyses (
  id                       uuid primary key default gen_random_uuid(),
  encounter_id             uuid not null references public.encounters(id) on delete cascade,
  owner_id                 uuid not null,
  subject_label            text,      -- 'V051'
  trial_label              text,      -- 'T1'
  capture_interval_seconds smallint,  -- NULL quando há uma captura só
  status                   text not null default 'uploading'
                             check (status in ('uploading','ready')),
  params                   jsonb not null default '{}',
  created_by               uuid not null references public.users(id) default auth.uid(),
  created_at               timestamptz not null default now()
);
create index on public.image_analyses (encounter_id, created_at desc);

create trigger image_analyses_inherit_owner
  before insert on public.image_analyses
  for each row execute function app.inherit_owner('public.encounters', 'encounter_id');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Captura
--
-- Continua sendo tabela, e não um array em image_analyses, por um motivo
-- operacional: a sequência são ~100 MB e uma captura que falhe precisa ser
-- regravada sozinha.
create table public.analysis_captures (
  id              uuid primary key default gen_random_uuid(),
  analysis_id     uuid not null references public.image_analyses(id) on delete cascade,
  owner_id        uuid not null,

  -- Posição na sequência. Os três são NULL no upload avulso: uma captura solta
  -- pode ser basal, pós-estresse ou teste de bancada — o banco precisa poder
  -- distinguir "não sei" de "é basal".
  capture_index   smallint not null,
  phase           text check (phase in ('baseline','dynamic')),
  label           text,
  elapsed_seconds numeric(8,2),

  -- Alinhamento: o que a tela usa para deformar a térmica sobre a óptica.
  align_a         double precision,
  align_b         double precision,
  align_tx        double precision,
  align_c         double precision,
  align_d         double precision,
  align_ty        double precision,
  alignment_mode   text check (alignment_mode in ('auto','manual')),
  alignment_method text check (alignment_method in ('silhouette','fiducial','manual')),
  matrix_width    int,   -- necessário para o csvScale do overlay
  matrix_height   int,

  -- Painéis exibidos na tela.
  agreement_normalized numeric(5,4),
  agreement            jsonb,
  fiducial_correction  jsonb,

  -- Resultados, gravados como vieram do domínio. São 22 itens por captura, lidos
  -- sempre por inteiro junto com ela; nada no MVP consulta uma articulação
  -- isolada. JointRoi[] já é exatamente esta forma.
  measurements  jsonb not null default '[]',
  manual_rois   jsonb not null default '[]',

  -- Declaração de tipo e tamanho enviada no POST. NÃO indica upload concluído —
  -- isso é image_analyses.status. A chave no R2 é derivada dos ids, não gravada.
  files         jsonb not null default '{}',

  issue         text,
  created_at    timestamptz not null default now(),

  unique (analysis_id, capture_index)
);

-- Uma sequência tem no máximo uma basal. Não dispara no avulso, onde phase é NULL.
create unique index analysis_captures_one_baseline
  on public.analysis_captures (analysis_id) where phase = 'baseline';

create trigger analysis_captures_inherit_owner
  before insert on public.analysis_captures
  for each row execute function app.inherit_owner('public.image_analyses', 'analysis_id');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Privilégios
--
-- A baseline do Supabase traz `ALTER DEFAULT PRIVILEGES ... GRANT ... TO anon`,
-- então toda tabela nova em public nasce com DML concedido ao anon. A RLS bloqueia
-- (auth.uid() nulo → can_access false), mas a anon key é pública por design: com o
-- grant, uma policy futura escrita errada viraria exposição na internet em vez de
-- exposição a usuários autenticados. Para dado clínico, não vale a superfície.
revoke all on public.patients          from anon;
revoke all on public.encounters        from anon;
revoke all on public.image_analyses    from anon;
revoke all on public.analysis_captures from anon;

-- Explícito mesmo já vindo das default privileges: a policy é a autorização, o
-- grant é o que torna a tabela alcançável. Ter os dois à vista evita depurar um
-- "permission denied" achando que é erro de policy.
grant select, insert, update, delete on public.patients          to authenticated;
grant select, insert, update, delete on public.encounters        to authenticated;
grant select, insert, update, delete on public.image_analyses    to authenticated;
grant select, insert, update, delete on public.analysis_captures to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — uma policy por tabela
--
-- Médico consultando o id de outro: a linha é invisível, a query devolve 0 linhas,
-- e a API responde 404. Nunca 403 — um 403 confirmaria que o id existe.
alter table public.patients          enable row level security;
alter table public.encounters        enable row level security;
alter table public.image_analyses    enable row level security;
alter table public.analysis_captures enable row level security;

-- patients é a única que checa role: criar paciente é o portão de entrada da
-- árvore clínica inteira. Como consulta, análise e captura só existem sob um
-- paciente que você possui, esta cláusula governa tudo por transitividade.
create policy patients_all on public.patients
  for all
  using (app.can_access(owner_id))
  with check (
    app.can_access(owner_id)
    and app.current_app_role() in ('medico','admin')
  );

create policy encounters_all on public.encounters
  for all
  using (app.can_access(owner_id))
  with check (app.can_access(owner_id));

create policy image_analyses_all on public.image_analyses
  for all
  using (app.can_access(owner_id))
  with check (app.can_access(owner_id));

create policy analysis_captures_all on public.analysis_captures
  for all
  using (app.can_access(owner_id))
  with check (app.can_access(owner_id));
