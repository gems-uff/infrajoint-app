-- As medições das ROIs saem do jsonb e viram linhas.
--
-- ─── O que era, e o que passa a ser
-- `analysis_captures.measurements` guardava um array com uma entrada por região medida:
--
--     [{"side":"Direita","landmarkId":0,"label":"Punho","key":"Direita:0",
--       "rgb":{...},"csv":{...},"stats":{"mean":34.75,...},"skinCoverage":1,...}, ...]
--
-- Passa a ser uma linha por articulação, por captura. São 22 por captura e até 21
-- capturas numa sequência dinâmica: cerca de 460 linhas por consulta com análise.
--
-- ─── Por que
-- É onde mora a pergunta central da pesquisa. "A temperatura da MCP 3 direita difere
-- entre quem tem a articulação inchada e quem não tem" exige cruzar esta medição com a
-- avaliação clínica, e documento não cruza com documento.
--
-- ─── A tradução de nomenclatura, e por que ela NÃO acontece aqui
-- O array guarda a identidade da ROI no vocabulário do detector: lado em português
-- ('Direita') mais o índice do landmark do MediaPipe. A tabela guarda `joint_id`, o
-- vocabulário do body map, que é o mesmo de `encounter_joint_evaluations` — e é
-- justamente essa igualdade que torna o cruzamento possível.
--
-- Daqui em diante quem traduz é o frontend, ao montar o payload, junto de onde o
-- MediaPipe é consumido. O de-para abaixo existe só para migrar o que já foi gravado:
-- é conhecimento de uma vez, não coluna permanente. Guardar `landmark_id` no schema
-- clínico seria gravar o esquema de indexação de uma biblioteca do frontend, que
-- sobreviveria à própria biblioteca.

create table public.capture_measurements (
  capture_id uuid not null references public.analysis_captures(id) on delete cascade,

  -- O mesmo catálogo que a avaliação articular referencia. É a coluna que faz
  -- temperatura e achado clínico se encontrarem.
  joint_id   text not null references public.joints(id),

  owner_id   uuid not null,

  -- As temperaturas apuradas dentro da região, em graus Celsius. `numeric` sem precisão
  -- declarada pelo mesmo motivo de `encounter_scores.score`: o valor vem calculado do
  -- navegador, e arredondar na gravação alteraria medição para caber num formato.
  t_mean   numeric,
  t_median numeric,
  t_min    numeric,
  t_max    numeric,

  -- Quantas células a região cobria, e quantas foram efetivamente agregadas. As duas
  -- juntas dizem se a medição é confiável: `sample_count` bem menor que `area` significa
  -- que boa parte da região não tinha leitura válida.
  area         integer,
  sample_count integer,

  -- Fração da região que era mesmo pele, de 0 a 1. Medição com pouca pele é suspeita.
  skin_coverage numeric,

  -- Geometria da região: forma, centro na foto (rgb) e na matriz de temperatura (csv), e
  -- os raios em células da matriz. Serve para redesenhar a ROI sobre a imagem quando a
  -- consulta é reaberta — é dado de reconstrução, não de análise.
  shape  text check (shape in ('circle', 'ellipse')),
  rgb_x  numeric,
  rgb_y  numeric,
  csv_x  numeric,
  csv_y  numeric,
  rx_csv numeric,
  ry_csv numeric,

  -- Se o operador moveu ou redimensionou a região em vez de aceitar a automática.
  -- Nenhuma decisão do sistema depende dela; ela existe como procedência da medição, que
  -- é informação de método: "X% das ROIs precisaram de ajuste manual" é frase de
  -- dissertação, e sem esta coluna o dado morre no fim da sessão.
  edited boolean not null default false,

  -- Uma medição por articulação, por captura.
  primary key (capture_id, joint_id)
);

create trigger capture_measurements_inherit_owner
  before insert or update on public.capture_measurements
  for each row execute function app.inherit_owner('public.analysis_captures', 'capture_id');

-- A consulta de pesquisa varre por articulação, não por captura.
create index on public.capture_measurements (joint_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Migração do que já existe
--
-- O de-para vive aqui dentro, e só aqui: 11 landmarks por mão, os dois lados. Os nomes
-- de lado vêm em português porque é assim que `HandSide` os representa no frontend, o
-- que é um problema à parte e conhecido — rótulo de exibição servindo de identidade.
-- ─────────────────────────────────────────────────────────────────────────────
with landmarks(landmark, sufixo) as (values
  (0, 'WRIST'),
  (2, 'MCP_1'), (3, 'PIP_1'),
  (5, 'MCP_2'), (6, 'PIP_2'),
  (9, 'MCP_3'), (10, 'PIP_3'),
  (13, 'MCP_4'), (14, 'PIP_4'),
  (17, 'MCP_5'), (18, 'PIP_5')
),
lados(side_pt, prefixo) as (values ('Direita', 'RIGHT'), ('Esquerda', 'LEFT'))
insert into public.capture_measurements
  (capture_id, joint_id, t_mean, t_median, t_min, t_max, area, sample_count,
   skin_coverage, shape, rgb_x, rgb_y, csv_x, csv_y, rx_csv, ry_csv, edited)
select c.id,
       l.prefixo || '_' || lm.sufixo,
       (m->'stats'->>'mean')::numeric,
       (m->'stats'->>'median')::numeric,
       (m->'stats'->>'min')::numeric,
       (m->'stats'->>'max')::numeric,
       (m->'stats'->>'area')::integer,
       (m->'stats'->>'count')::integer,
       (m->>'skinCoverage')::numeric,
       m->>'shape',
       (m->'rgb'->>'x')::numeric,
       (m->'rgb'->>'y')::numeric,
       (m->'csv'->>'x')::numeric,
       (m->'csv'->>'y')::numeric,
       (m->>'rxCsv')::numeric,
       (m->>'ryCsv')::numeric,
       coalesce((m->>'edited')::boolean, false)
  from public.analysis_captures c,
       jsonb_array_elements(c.measurements) as m,
       lados l,
       landmarks lm
 where m->>'side' = l.side_pt
   and (m->>'landmarkId')::int = lm.landmark;

-- Nenhuma medição pode ter ficado para trás: se um par (lado, landmark) não casasse com
-- o de-para, a linha sumiria em silêncio, que é a falha mais cara de perceber numa
-- migração de dado. Aqui ela vira erro.
do $$
declare no_jsonb bigint; na_tabela bigint;
begin
  select coalesce(sum(jsonb_array_length(measurements)), 0) into no_jsonb
    from public.analysis_captures;
  select count(*) into na_tabela from public.capture_measurements;

  assert no_jsonb = na_tabela,
    format('o jsonb tinha %s medições e a tabela ficou com %s', no_jsonb, na_tabela);
end $$;

alter table public.analysis_captures drop column measurements;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privilégios e RLS
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.capture_measurements from anon, authenticated;
grant select, insert, update, delete on public.capture_measurements to authenticated;

alter table public.capture_measurements enable row level security;

create policy capture_measurements_read on public.capture_measurements
  for select using (app.can_access(owner_id));

create policy capture_measurements_insert on public.capture_measurements
  for insert
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy capture_measurements_update on public.capture_measurements
  for update
  using      (app.can_curate(owner_id) and app.is_clinician())
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy capture_measurements_delete on public.capture_measurements
  for delete
  using (app.can_discard(owner_id) and app.is_clinician());
