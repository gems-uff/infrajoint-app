-- Funde public.image_analyses em public.encounters.
--
-- Motivo: a análise de imagem é 1:1 com a consulta. Uma consulta tem UMA análise,
-- individual ou em sequência — e a diferença entre as duas continua sendo a
-- cardinalidade de analysis_captures, exatamente como a migration do modelo clínico
-- estabeleceu. Não há discriminador single/sequence aqui, como não havia lá.
--
-- Sendo 1:1, a tabela do meio só cobrava pedágio: um join, um trigger de posse, um
-- owner_id e um created_by redundantes com os da consulta, e um nível a mais na cadeia
-- de propriedade que toda policy tinha que atravessar.
--
-- O que NÃO muda, e por quê: analysis_captures continua tabela, não array jsonb.
-- Cada captura tem arquivo próprio no R2 com ciclo de vida próprio — o upload é por
-- arquivo, com retry por arquivo. Num array, reenviar uma captura viraria
-- read-modify-write do array inteiro, e dois retries simultâneos perderiam a escrita um
-- do outro. Além disso a chave do R2 é derivada dos ids, e as duas invariantes abaixo
-- (índice único e basal única) são cobradas pelo banco, coisa que array nenhum faz.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Guarda
--
-- Esta migration move estrutura assumindo que não há dado a migrar. Verificado que
-- as duas tabelas estão vazias nos dois ambientes (a Fase 5 não começou e nenhum
-- endpoint escreve nelas). A checagem existe para falhar alto se a premissa for
-- falsa, em vez de destruir dado clínico em silêncio.
do $$
declare
  n_analises  bigint;
  n_capturas  bigint;
begin
  select count(*) into n_analises from public.image_analyses;
  select count(*) into n_capturas from public.analysis_captures;
  if n_analises > 0 or n_capturas > 0 then
    raise exception
      'abortado: image_analyses=% analysis_captures=%; esta migration pressupõe tabelas vazias',
      n_analises, n_capturas;
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A consulta absorve os campos da análise
--
-- `analysis_status` é NULÁVEL de propósito, e o nulo tem significado: consulta sem
-- análise de imagem nenhuma. Só assim uma consulta que só tem body map não precisa
-- fingir um estado de upload que não existe.
--
-- Ele continua sendo a fonte da verdade sobre "os bytes chegaram" —
-- analysis_captures.files declara o que foi enviado, não o que foi concluído.
alter table public.encounters
  add column subject_label            text,      -- 'V051'
  add column trial_label              text,      -- 'T1'
  add column capture_interval_seconds smallint,  -- NULL quando há uma captura só
  add column analysis_status          text
    check (analysis_status in ('uploading','ready')),
  add column analysis_params          jsonb not null default '{}';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A captura passa a pendurar direto na consulta
alter table public.analysis_captures
  drop constraint analysis_captures_analysis_id_fkey,
  drop constraint analysis_captures_analysis_id_capture_index_key;

alter table public.analysis_captures
  rename column analysis_id to encounter_id;

alter table public.analysis_captures
  add constraint analysis_captures_encounter_id_fkey
    foreign key (encounter_id) references public.encounters(id) on delete cascade,
  add constraint analysis_captures_encounter_id_capture_index_key
    unique (encounter_id, capture_index);

-- Uma sequência tem no máximo uma basal. Não dispara no avulso, onde phase é NULL.
drop index if exists public.analysis_captures_one_baseline;
create unique index analysis_captures_one_baseline
  on public.analysis_captures (encounter_id) where phase = 'baseline';

-- O owner passa a ser herdado da consulta. Continua sem SECURITY DEFINER: a leitura
-- da linha-pai acontece sob a RLS de quem escreve, e é ela que impede anexar captura
-- à consulta de outro médico.
drop trigger analysis_captures_inherit_owner on public.analysis_captures;
create trigger analysis_captures_inherit_owner
  before insert or update on public.analysis_captures
  for each row execute function app.inherit_owner('public.encounters', 'encounter_id');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A tabela do meio sai
drop table public.image_analyses;
