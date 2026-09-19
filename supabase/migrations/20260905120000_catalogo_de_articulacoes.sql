-- O catálogo das 28 articulações do body map.
--
-- ─── Por que uma tabela, se o catálogo já existe no frontend
-- Porque hoje ele existe SÓ lá. `encounters.joint_evaluations` é um jsonb cujas chaves
-- são ids de articulação validados apenas por formato (o regex
-- `[A-Z][A-Z0-9_]{2,39}` em presentation/schemas.py). Um `RIGHT_MPC_3` digitado errado
-- grava sem erro e depois some de qualquer agregação: não dá erro, dá número errado.
-- Com esta tabela como alvo de chave estrangeira, o banco passa a recusar.
--
-- O rótulo vem junto pelo mesmo motivo que motivou a normalização inteira: o banco
-- precisa responder à pergunta de pesquisa sozinho. Um join devolve "MCP 3 (mão
-- direita)" para quem analisar os dados por fora da aplicação, em vez de um id cru.
--
-- ─── Por que ela vem ANTES das tabelas que a usam
-- É o alvo da chave estrangeira de `encounter_joint_evaluations` (avaliação articular) e
-- de `capture_measurements` (medições das ROIs). Sem ela, as duas nasceriam aceitando
-- qualquer texto, que é exatamente o que estamos removendo.
--
-- ─── Uma nomenclatura só, e o que ficou de fora por causa disso
-- O sistema tem hoje três representações da mesma articulação:
--
--   body map          RIGHT_MCP_3                  (JOINT_CATALOG)
--   ROI térmica       lado 'Direita' + landmark 9  (JOINT_ROI_DEFS)
--   lado, nas ROIs    'Esquerda' | 'Direita'       — rótulo de exibição virando identidade
--
-- Houve uma versão desta migration com uma coluna `landmark_id` fazendo a ponte entre as
-- duas primeiras. Ela saiu, e a decisão vale registrar: `landmark_id` é o índice do
-- landmark do **MediaPipe**, uma biblioteca do frontend. Guardá-lo aqui seria gravar no
-- schema clínico o esquema de indexação de uma dependência externa, e a coluna
-- sobreviveria a ela: trocado o detector, restaria um campo nomeado por algo que não
-- existe mais.
--
-- A convergência acontece antes, no frontend: ao montar o payload das medições, a
-- análise térmica traduz lado + landmark para o id do body map, e da fronteira da API
-- para dentro existe **uma nomenclatura só**. O mapeamento fica em
-- `image-analyzer/joint-rois.ts`, ao lado de onde o MediaPipe é consumido, que é onde
-- conhecimento de MediaPipe pertence. Ver a etapa das medições.
--
-- ─── Por que NÃO tem owner_id
-- É dado de referência, não prontuário. As 28 linhas são as mesmas para todo mundo, não
-- pertencem a médico nem a pesquisador, e ninguém as escreve pela aplicação. Por isso
-- esta tabela foge do padrão das clínicas: sem `owner_id`, sem `app.inherit_owner()`,
-- sem as quatro policies. A RLS fica ligada assim mesmo, com uma policy de leitura, para
-- a tabela não depender de ausência de policy para estar protegida.

create table public.joints (
  -- O id do body map, e não um surrogate: é o vocabulário que o frontend já usa e o que
  -- torna a consulta de pesquisa legível sem join (`where joint_id = 'RIGHT_MCP_3'`).
  id          text primary key,

  -- `shortLabel` NÃO vem junto: tem um consumidor só, o rótulo do hotspot na figura do
  -- body map, que continua lendo do catálogo do frontend. Seria dado de interface
  -- duplicado no banco sem ninguém para ler. Mesma régua que deixou de fora uma coluna
  -- de ordenação: sem consumidor aqui, não pertence aqui.
  label       text not null,

  -- Lado e grupo são dimensões de pesquisa, não enfeite. `thermal-asymmetry.ts` compara
  -- cada articulação com a correspondente do outro lado, e "temperatura média das MCPs"
  -- é agregação natural. Sem estas colunas, as duas viram `where id like 'RIGHT%'` e
  -- `like '%_MCP_%'` — string matching no id, exatamente o que esta normalização remove.
  side        text not null check (side in ('right','left')),
  joint_group text not null check (
    joint_group in ('shoulder','elbow','wrist','mcp','pip','knee'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- As 28 linhas.
--
-- Transcritas de JOINT_CATALOG (frontend/src/app/features/analysis/body-map/
-- joint-catalog.data.ts), que as gera por função. Os rótulos são os mesmos, caractere a
-- caractere, para que a tela e um export do banco chamem a mesma articulação pelo mesmo
-- nome. A ordem das linhas segue JOINTS_28, por legibilidade deste arquivo; ordem de
-- exibição é assunto de quem exibe, e não há coluna para ela.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.joints (id, label, side, joint_group) values
  ('RIGHT_SHOULDER', 'Ombro direito',            'right', 'shoulder'),
  ('LEFT_SHOULDER',  'Ombro esquerdo',           'left',  'shoulder'),
  ('RIGHT_ELBOW',    'Cotovelo direito',         'right', 'elbow'),
  ('LEFT_ELBOW',     'Cotovelo esquerdo',        'left',  'elbow'),
  ('RIGHT_WRIST',    'Punho direito',            'right', 'wrist'),
  ('LEFT_WRIST',     'Punho esquerdo',           'left',  'wrist'),
  ('RIGHT_MCP_1',    'MCP 1 (mão direita)',      'right', 'mcp'),
  ('RIGHT_MCP_2',    'MCP 2 (mão direita)',      'right', 'mcp'),
  ('RIGHT_MCP_3',    'MCP 3 (mão direita)',      'right', 'mcp'),
  ('RIGHT_MCP_4',    'MCP 4 (mão direita)',      'right', 'mcp'),
  ('RIGHT_MCP_5',    'MCP 5 (mão direita)',      'right', 'mcp'),
  ('LEFT_MCP_1',     'MCP 1 (mão esquerda)',     'left',  'mcp'),
  ('LEFT_MCP_2',     'MCP 2 (mão esquerda)',     'left',  'mcp'),
  ('LEFT_MCP_3',     'MCP 3 (mão esquerda)',     'left',  'mcp'),
  ('LEFT_MCP_4',     'MCP 4 (mão esquerda)',     'left',  'mcp'),
  ('LEFT_MCP_5',     'MCP 5 (mão esquerda)',     'left',  'mcp'),
  ('RIGHT_PIP_1',    'IFP/PIP 1 (mão direita)',  'right', 'pip'),
  ('RIGHT_PIP_2',    'IFP/PIP 2 (mão direita)',  'right', 'pip'),
  ('RIGHT_PIP_3',    'IFP/PIP 3 (mão direita)',  'right', 'pip'),
  ('RIGHT_PIP_4',    'IFP/PIP 4 (mão direita)',  'right', 'pip'),
  ('RIGHT_PIP_5',    'IFP/PIP 5 (mão direita)',  'right', 'pip'),
  ('LEFT_PIP_1',     'IFP/PIP 1 (mão esquerda)', 'left',  'pip'),
  ('LEFT_PIP_2',     'IFP/PIP 2 (mão esquerda)', 'left',  'pip'),
  ('LEFT_PIP_3',     'IFP/PIP 3 (mão esquerda)', 'left',  'pip'),
  ('LEFT_PIP_4',     'IFP/PIP 4 (mão esquerda)', 'left',  'pip'),
  ('LEFT_PIP_5',     'IFP/PIP 5 (mão esquerda)', 'left',  'pip'),
  ('RIGHT_KNEE',     'Joelho direito',           'right', 'knee'),
  ('LEFT_KNEE',      'Joelho esquerdo',          'left',  'knee');

-- Trava a transcrição contra erro de digitação e contra recorte incompleto. As 28 são as
-- de JOINTS_28; as 22 de mão são as que a análise térmica mede, e são elas que precisam
-- existir aqui para o payload traduzido no frontend encontrar destino.
do $$
declare total int; de_mao int;
begin
  select count(*) into total from public.joints;
  select count(*) into de_mao from public.joints
   where joint_group in ('wrist','mcp','pip');

  assert total = 28, format('o catálogo deveria ter 28 articulações, tem %s', total);
  assert de_mao = 22, format('deveriam ser 22 articulações de mão, são %s', de_mao);

  -- Simetria: toda articulação existe dos dois lados. Um id transcrito errado quase
  -- sempre quebra o par antes de quebrar a contagem.
  assert (select count(*) from public.joints where side = 'right')
       = (select count(*) from public.joints where side = 'left'),
    'o catálogo deveria ser simétrico entre os lados';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privilégios e RLS
--
-- Leitura para todo autenticado; escrita para ninguém. Mudar o catálogo é migration, e
-- não clique — é o que garante que os ids referenciados por dado clínico não somem
-- debaixo dele.
--
-- O revoke abaixo NÃO é decorativo, e o teste de RLS pegou isso: a baseline do Supabase
-- traz `alter default privileges ... grant all on tables to authenticated`, então esta
-- tabela nasceu com DELETE, INSERT, UPDATE e TRUNCATE concedidos. `tenant_integrity`
-- fechou essa torneira para o `anon`, mas não para o `authenticated`. Um `grant select`
-- sozinho seria aditivo e não tiraria nada.
--
-- O grave é o TRUNCATE, pelo mesmo motivo que `users_grants` já registrou: **RLS não se
-- aplica a TRUNCATE**. É privilégio de tabela puro, sem WHERE onde a policy possa
-- entrar. Num catálogo que é alvo de chave estrangeira de dado clínico, esvaziá-lo não
-- apagaria só 28 linhas — derrubaria toda referência a elas.
--
-- DELETE, INSERT e UPDATE hoje já seriam barrados pela RLS por ausência de policy, mas
-- ausência protege por acidente: uma policy futura escrita sem cuidado transformaria o
-- grant herdado em escrita liberada. Revogar alinha o privilégio à intenção.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.joints from anon, authenticated;
grant select on public.joints to authenticated;

alter table public.joints enable row level security;

-- Sem INSERT, UPDATE ou DELETE de propósito: policy ausente já nega, e o revoke acima
-- fecha a porta antes disso. A policy de leitura existe para a proteção não depender de
-- ausência, que é o mesmo princípio do §6 de `clinical_model`.
create policy joints_read on public.joints
  for select
  to authenticated
  using (true);
