-- O diagnóstico sai do texto livre e vira relação; o paciente ganha o papel no estudo.
--
-- ─── O que era, e o que passa a ser
-- `patients.primary_diagnosis` era um campo de texto, um diagnóstico por paciente, sem
-- código. Para o banco, "Artrite reumatoide", "artrite reumatóide" e "AR" eram três
-- diagnósticos diferentes, e a consulta possível era `ilike '%reumat%'`, que pega
-- "febre reumática" junto e perde quem abreviou.
--
-- Passa a ser um catálogo de códigos da CID-10 e uma tabela ligando paciente a
-- diagnóstico. Resolve as duas limitações de uma vez: consulta exata por código, e mais
-- de um diagnóstico por paciente, que é regra em reumatologia, não exceção.
--
-- ─── O recorte, e por que não a CID-10 inteira
-- São os diagnósticos que a pesquisa usa, não as ~14 mil linhas da classificação. O
-- catálogo cresce por `insert`, uma linha por vez, conforme a necessidade aparecer.
-- Todos os códigos são da CID-10; não há coluna dizendo de qual classificação cada um
-- vem, porque hoje só existe uma, e isso fica declarado na documentação do projeto.
--
-- ─── Grupo de estudo NÃO é diagnóstico
-- Ser controle é papel no estudo, não achado clínico. Uma linha em `patient_diagnoses`
-- dizendo que alguém "tem" o diagnóstico Controle seria uma afirmação falsa num banco
-- que outras pessoas vão analisar, e obrigaria toda consulta de diagnóstico a lembrar de
-- excluir um código mágico. Numa coluna própria, as duas perguntas ficam independentes:
-- um controle pode receber um diagnóstico incidental sem deixar de ser controle.
--
-- Nula significa "ainda não classificado", que é diferente de controle. É a distinção
-- que o campo de texto não conseguia fazer.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O catálogo
--
-- Dado de referência, como `public.joints`: sem `owner_id`, sem trigger de posse, sem as
-- quatro policies. Leitura para todo autenticado, escrita para ninguém.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.diagnoses (
  -- O código da CID-10. Convenção externa e estável, como o id da articulação: não é
  -- número sorteado, e é ele que torna a consulta de coorte exata.
  code  text primary key,
  label text not null
);

insert into public.diagnoses (code, label) values
  ('M05',   'Artrite reumatoide soropositiva'),
  ('M06.0', 'Artrite reumatoide soronegativa'),
  ('M06.9', 'Artrite reumatoide não especificada'),
  ('M07',   'Artropatia psoriásica'),
  ('M45',   'Espondilite ancilosante'),
  ('M08',   'Artrite idiopática juvenil'),
  ('M02',   'Artropatias reativas'),
  ('M13.0', 'Poliartrite não especificada'),
  ('M32',   'Lúpus eritematoso sistêmico'),
  ('M34',   'Esclerose sistêmica'),
  ('M35.0', 'Síndrome de Sjögren'),
  ('M35.3', 'Polimialgia reumática'),
  ('M33',   'Dermatopolimiosite'),
  ('M10',   'Gota'),
  ('M15',   'Poliartrose'),
  ('M18',   'Artrose da primeira articulação carpometacarpiana'),
  ('M79.7', 'Fibromialgia');

revoke all on public.diagnoses from anon, authenticated;
grant select on public.diagnoses to authenticated;

alter table public.diagnoses enable row level security;

create policy diagnoses_read on public.diagnoses
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O vínculo
--
-- Este sim é dado clínico do paciente, com as mesmas quatro regras de acesso do resto da
-- árvore: ler é do dono, do admin e do par de pool; escrever é do dono e do par; apagar
-- é do dono e do admin.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.patient_diagnoses (
  patient_id     uuid not null references public.patients(id) on delete cascade,
  diagnosis_code text not null references public.diagnoses(code),
  owner_id       uuid not null,

  -- Qual deles é o principal, já que agora cabem vários. O índice parcial abaixo garante
  -- que haja no máximo um por paciente: sem ele, "principal" perderia o sentido.
  is_primary     boolean not null default false,

  -- Quando foi diagnosticado, se for coletado.
  diagnosed_at   date,

  primary key (patient_id, diagnosis_code)
);

create unique index patient_diagnoses_um_principal
  on public.patient_diagnoses (patient_id)
  where is_primary;

create trigger patient_diagnoses_inherit_owner
  before insert or update on public.patient_diagnoses
  for each row execute function app.inherit_owner('public.patients', 'patient_id');

-- "Todos os pacientes com CID M05" varre por código, não por paciente.
create index on public.patient_diagnoses (diagnosis_code);

revoke all on public.patient_diagnoses from anon, authenticated;
grant select, insert, update, delete on public.patient_diagnoses to authenticated;

alter table public.patient_diagnoses enable row level security;

create policy patient_diagnoses_read on public.patient_diagnoses
  for select using (app.can_access(owner_id));

create policy patient_diagnoses_insert on public.patient_diagnoses
  for insert
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy patient_diagnoses_update on public.patient_diagnoses
  for update
  using      (app.can_curate(owner_id) and app.is_clinician())
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy patient_diagnoses_delete on public.patient_diagnoses
  for delete
  using (app.can_discard(owner_id) and app.is_clinician());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O papel no estudo
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.patients
  add column study_group text check (study_group in ('caso', 'controle'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Migração do texto livre
--
-- O de-para cobre o que existe hoje. Um texto que não casar interrompe a migration com a
-- lista na mensagem, em vez de sumir junto com a coluna: perder diagnóstico em silêncio é
-- exatamente o que esta mudança existe para impedir, e seria irônico começar assim.
--
-- "Artrite", sem qualificação, vira M13.0 (poliartrite não especificada): é o código que
-- a CID reserva para artrite sem outra especificação, e traduzir para M05 seria inventar
-- uma sorologia que ninguém registrou.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare nao_mapeados text;
begin
  select string_agg(distinct primary_diagnosis, ' | ')
    into nao_mapeados
    from public.patients p
   where p.primary_diagnosis is not null
     and app.normalized_name(p.primary_diagnosis) not in (
       app.normalized_name('Artrite reumatoide'),
       app.normalized_name('Artrite'),
       app.normalized_name('Artrite psoriásica'),
       app.normalized_name('Osteoartrite de mãos')
     );

  if nao_mapeados is not null then
    raise exception
      'diagnósticos em texto livre sem código correspondente: %. '
      'Acrescente-os ao de-para desta migration ou ao catálogo antes de aplicá-la.',
      nao_mapeados;
  end if;
end $$;

with de_para(texto, code) as (values
  ('Artrite reumatoide',   'M06.9'),
  ('Artrite',              'M13.0'),
  ('Artrite psoriásica',   'M07'),
  ('Osteoartrite de mãos', 'M18')
)
insert into public.patient_diagnoses (patient_id, diagnosis_code, is_primary)
select p.id, d.code, true
  from public.patients p
  join de_para d on app.normalized_name(d.texto) = app.normalized_name(p.primary_diagnosis)
 where p.primary_diagnosis is not null;

alter table public.patients drop column primary_diagnosis;
