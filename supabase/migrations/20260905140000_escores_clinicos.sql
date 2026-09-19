-- Os escores de atividade da doença saem do jsonb e viram linhas.
--
-- ─── O que era, e o que passa a ser
-- `encounters.scores` guardava um documento com um objeto por índice calculado:
--
--     {"cdai": {"score": 12.5, "level": "moderate", ...}, "das28": {...}}
--
-- Passa a ser uma linha por índice, por consulta.
--
-- ─── Por que, se este era o caso mais defensável do jsonb
-- Porque a pergunta que ele bloqueia é boa: "todas as consultas com DAS28 acima de 5,1",
-- que é o limiar entre atividade moderada e alta. No documento, isso exige varrer a
-- tabela inteira e desserializar cada linha. Em coluna, é um `where` com índice.
--
-- ─── O problema que o jsonb resolvia de graça, e como ele é resolvido aqui
-- CDAI e DAS28 não pedem as mesmas informações. O CDAI usa as avaliações globais do
-- paciente e do avaliador; o DAS28 usa o reagente de fase aguda (VHS ou PCR), o valor
-- dele e a saúde global do paciente. Numa tabela única, as colunas do outro índice ficam
-- nulas.
--
-- Colunas nulas sem regra são desleixo: ninguém sabe se "vazio" quer dizer "não se
-- aplica" ou "esqueceram de preencher". `escore_completo` remove a ambiguidade — cada
-- linha preenche exatamente as colunas do seu índice e deixa as do outro em branco, e o
-- banco recusa qualquer mistura.
--
-- ─── Precisão
-- `score` é `numeric` sem precisão declarada, de propósito. O DAS28 é calculado no
-- navegador e chega com a precisão do ponto flutuante: a consulta que já existe no banco
-- tem 5.135703323944191. Declarar `numeric(5,2)` arredondaria para 5.14 na migração, ou
-- seja, alteraria dado clínico em silêncio para caber num formato. Arredondar é decisão
-- de exibição, e a tela já a toma; o banco guarda o que foi calculado.

create table public.encounter_scores (
  encounter_id  uuid not null references public.encounters(id) on delete cascade,

  -- Minúsculo, como o schema da borda normaliza: o frontend fala 'CDAI' e 'DAS28', o
  -- banco guarda 'cdai' e 'das28'. Era a chave do objeto JSON; agora é coluna, e a
  -- unicidade por tipo que vinha de graça passa a ser a chave primária composta.
  index_type    text not null check (index_type in ('cdai', 'das28')),

  owner_id      uuid not null,

  score         numeric not null,
  level         text not null check (level in ('remission', 'low', 'moderate', 'high')),

  -- Comuns aos dois índices: ambos contam articulações dolorosas e edemaciadas.
  tender_count  smallint not null,
  swollen_count smallint not null,

  -- Só o CDAI preenche. Escala visual analógica de 0 a 10.
  patient_global        numeric,
  evaluator_global      numeric,

  -- Só o DAS28 preenche. VHS em mm/h ou PCR em mg/L, e a saúde global de 0 a 100.
  acute_phase           text,
  acute_value           numeric,
  patient_global_health numeric,

  primary key (encounter_id, index_type),

  -- A regra que torna as colunas nulas intencionais. Escrita como `case`, ela cobre os
  -- dois tipos e nada mais: um `index_type` novo sem cláusula aqui devolve NULL, e um
  -- check que devolve NULL não recusa — por isso o `check (index_type in (...))` acima
  -- não é redundante, é o que garante que o `case` sempre casa.
  constraint escore_completo check (
    case index_type
      when 'cdai' then
        patient_global is not null and evaluator_global is not null
        and acute_phase is null and acute_value is null
        and patient_global_health is null
      when 'das28' then
        acute_phase in ('esr', 'crp') and acute_value is not null
        and patient_global_health is not null
        and patient_global is null and evaluator_global is null
    end),

  -- As mesmas faixas que o schema Pydantic cobra na borda. Espelhadas aqui pelo motivo
  -- de sempre neste projeto: a borda dá a mensagem clara, o banco é a fronteira real.
  -- O teto do escore difere por índice — CDAI vai a 76, DAS28 a 10.
  constraint escore_na_faixa check (
    tender_count between 0 and 28
    and swollen_count between 0 and 28
    and score >= 0
    and case index_type
          when 'cdai'  then score <= 76
          when 'das28' then score <= 10
        end)
);

create trigger encounter_scores_inherit_owner
  before insert or update on public.encounter_scores
  for each row execute function app.inherit_owner('public.encounters', 'encounter_id');

-- "Todas as consultas com DAS28 acima de 5,1" varre por tipo e valor, não pela consulta.
create index on public.encounter_scores (index_type, score);

-- ─────────────────────────────────────────────────────────────────────────────
-- Migração do que já existe
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.encounter_scores
  (encounter_id, index_type, score, level, tender_count, swollen_count,
   patient_global, evaluator_global, acute_phase, acute_value, patient_global_health)
select e.id, chave,
       (valor->>'score')::numeric,
       valor->>'level',
       (valor->>'tender_count')::smallint,
       (valor->>'swollen_count')::smallint,
       (valor->>'patient_global')::numeric,
       (valor->>'evaluator_global')::numeric,
       valor->>'acute_phase',
       (valor->>'acute_value')::numeric,
       (valor->>'patient_global_health')::numeric
  from public.encounters e, jsonb_each(e.scores) as t(chave, valor)
 where e.scores <> '{}'::jsonb;

alter table public.encounters drop column scores;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privilégios e RLS
--
-- As mesmas quatro regras da consulta que a tabela detalha. Revoke antes do grant pelo
-- motivo já registrado em `catalogo_de_articulacoes`: a tabela nasce com DML herdado das
-- default privileges do Supabase, e TRUNCATE não é alcançado pela RLS.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.encounter_scores from anon, authenticated;
grant select, insert, update, delete on public.encounter_scores to authenticated;

alter table public.encounter_scores enable row level security;

create policy encounter_scores_read on public.encounter_scores
  for select using (app.can_access(owner_id));

create policy encounter_scores_insert on public.encounter_scores
  for insert
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy encounter_scores_update on public.encounter_scores
  for update
  using      (app.can_curate(owner_id) and app.is_clinician())
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy encounter_scores_delete on public.encounter_scores
  for delete
  using (app.can_discard(owner_id) and app.is_clinician());
