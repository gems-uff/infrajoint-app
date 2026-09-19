-- A avaliação articular sai do jsonb e vira linhas.
--
-- ─── O que era, e o que passa a ser
-- `encounters.joint_evaluations` guardava um documento com as articulações avaliadas e,
-- em cada uma, dor e inchaço:
--
--     {"RIGHT_MCP_3": {"pain": true, "swelling": true}, ...}
--
-- Passa a ser uma linha por articulação. O mesmo dado, consultável.
--
-- ─── Por que
-- A pergunta que motivou a revisão do esquema, e que o jsonb não responde sem varrer
-- toda consulta do banco e desserializar cada documento: **quais pacientes têm uma
-- determinada articulação inchada**. Com uma linha por achado, ela é um `where`.
--
-- E um ganho que não é sobre consulta: o id da articulação era validado só por formato
-- (o regex `[A-Z][A-Z0-9_]{2,39}` em presentation/schemas.py). Um `RIGHT_MPC_3` digitado
-- errado gravava em silêncio e sumia de qualquer agregação depois — não dava erro, dava
-- número errado. A chave estrangeira para `public.joints` fecha isso.
--
-- ─── O que NÃO muda
-- O contrato da API. O repositório distribui o dicionário em linhas na escrita e o
-- reagrupa na leitura, então `EncounterOut.joint_evaluations` continua saindo com a mesma
-- forma e nenhuma tela fica sabendo que o banco mudou.

create table public.encounter_joint_evaluations (
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  joint_id     text not null references public.joints(id),

  -- Denormalizado como em toda a árvore clínica: é o que as policies leem, e derivá-lo
  -- por join a cada linha custaria caro numa tabela que cresce 28 por consulta.
  owner_id     uuid not null,

  -- As duas perguntas do body map. `not null` porque a linha só existe se a articulação
  -- foi avaliada; ausência de avaliação é ausência de linha, não linha com nulos.
  pain         boolean not null,
  swelling     boolean not null,

  -- Uma avaliação por articulação, por consulta. É a unicidade que o jsonb dava de graça
  -- pela chave do objeto e que aqui precisa ser declarada.
  primary key (encounter_id, joint_id)
);

-- A consulta é o pai; a posse desce dela. Roda em UPDATE também, pelo mesmo motivo de
-- `tenant_integrity`: sem isso, reapontar a linha para a consulta de outro tenant
-- passaria despercebido, porque `owner_id` não mudaria.
create trigger encounter_joint_evaluations_inherit_owner
  before insert or update on public.encounter_joint_evaluations
  for each row execute function app.inherit_owner('public.encounters', 'encounter_id');

-- Consultar "quais consultas têm esta articulação inchada" varre por `joint_id`, e não
-- pela consulta. Sem este índice, a pergunta da orientadora é sequential scan.
create index on public.encounter_joint_evaluations (joint_id) where swelling;
create index on public.encounter_joint_evaluations (joint_id) where pain;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migração do que já existe
--
-- O banco de produção vai ser resetado, então isto serve ao ambiente local e a qualquer
-- instância que não for. Fan-out do documento para linhas, com a mesma leitura de chaves
-- que o repositório passa a fazer.
-- ─────────────────────────────────────────────────────────────────────────────

-- Antes de migrar, o catálogo cobra o que a validação por formato deixava passar. Se
-- houver um id fora dele, a migration para aqui com a lista na mensagem, em vez de
-- abortar com o nome cru de uma constraint.
do $$
declare desconhecidos text;
begin
  select string_agg(distinct chave, ', ')
    into desconhecidos
    from public.encounters e, jsonb_each(e.joint_evaluations) as t(chave, valor)
   where e.joint_evaluations is not null
     and not exists (select 1 from public.joints j where j.id = chave);

  if desconhecidos is not null then
    raise exception
      'ids de articulação fora do catálogo em encounters.joint_evaluations: %. '
      'Corrija-os antes de rodar esta migration.', desconhecidos;
  end if;
end $$;

insert into public.encounter_joint_evaluations (encounter_id, joint_id, pain, swelling)
select e.id, chave, (valor->>'pain')::boolean, (valor->>'swelling')::boolean
  from public.encounters e, jsonb_each(e.joint_evaluations) as t(chave, valor)
 where e.joint_evaluations is not null;

alter table public.encounters drop column joint_evaluations;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privilégios e RLS
--
-- As mesmas quatro regras da consulta que a tabela detalha, e pelos mesmos motivos:
-- ler é do dono, do admin e do par de pool; escrever é do dono e do par; apagar é do
-- dono e do admin. Ver `acervo_de_pesquisa`.
--
-- O revoke vem antes do grant porque a tabela nasce com DELETE, INSERT, UPDATE e
-- TRUNCATE herdados das default privileges do Supabase, e `grant` é aditivo. TRUNCATE é
-- o que mais importa tirar: RLS não se aplica a ele.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.encounter_joint_evaluations from anon, authenticated;
grant select, insert, update, delete
  on public.encounter_joint_evaluations to authenticated;

alter table public.encounter_joint_evaluations enable row level security;

create policy encounter_joint_evaluations_read on public.encounter_joint_evaluations
  for select using (app.can_access(owner_id));

create policy encounter_joint_evaluations_insert on public.encounter_joint_evaluations
  for insert
  with check (app.can_curate(owner_id) and app.is_clinician());

-- Não há endpoint que edite uma avaliação hoje: ela nasce junto com a consulta e não é
-- alterada. A policy existe assim mesmo porque descreve a REGRA, não o inventário atual
-- de rotas — e uma policy faltando não dá erro, devolve zero linhas, que é a falha mais
-- cara de diagnosticar quando o endpoint aparecer.
create policy encounter_joint_evaluations_update on public.encounter_joint_evaluations
  for update
  using      (app.can_curate(owner_id) and app.is_clinician())
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy encounter_joint_evaluations_delete on public.encounter_joint_evaluations
  for delete
  using (app.can_discard(owner_id) and app.is_clinician());
