-- A posição da captura passa a ser UMA coluna: `capture_index`, nulável.
--
--     NULL → análise avulsa (não há sequência, não há eixo de tempo)
--     0    → captura basal
--     N    → captura dinâmica N
--
-- ─── O motivo, e não é economia de coluna
-- `phase` e `capture_index` diziam o mesmo fato por dois caminhos, e nada no banco
-- os obrigava a concordar: `phase = 'baseline'` com `capture_index = 5` era aceito
-- sem reclamação, e nada no código diria qual dos dois estava certo. É exatamente o
-- que custou a coluna `alignment_mode` em `slim_analysis_captures` — dois registros
-- de um fato é um que pode divergir do outro.
--
-- Colapsar não reduz o modelo, elimina uma classe inteira de inconsistência: sob uma
-- coluna só, "basal com índice 5" deixa de ser representável.
--
-- ─── `label` sai junto, e é a que menos deixa saudade
-- Ela guardava o pedaço `Est`/`Din07` do nome do arquivo. Três fatos sobre ela:
-- nenhum leitor a consumia (a tela chama `captureDisplayLabel(kind, index)`, que
-- recalcula "Base"/"Din 7" e nunca abre a coluna); a leitura a devolvia só para a
-- escrita seguinte regravá-la; e a justificativa que a manteve viva em
-- `slim_analysis_captures` — "único vestígio de qual arquivo originou a captura" —
-- perdeu o chão quando `drop_session_labels` levou `subject_label` e `trial_label`,
-- que eram os tokens que de fato identificavam a pasta. O que sobrava em `label` não
-- apontava para arquivo nenhum: repetia fase e índice, em texto.
--
-- **A leitura das pastas não muda em nada.** O regex e o tratamento de sessão legada
-- (token de superfície, descarte do `Din00`) moram em `sequence-files.ts` e seguem
-- intactos. O que sai é a cópia do token depois da importação, não a capacidade de
-- importar.
--
-- ─── A unicidade da basal não se perde, muda de dono
-- O índice parcial `where phase = 'baseline'` sai porque virou redundante, não porque
-- a regra foi abandonada: `unique (encounter_id, capture_index)`, que já existia,
-- passa a garantir sozinho no máximo uma linha de índice 0 por consulta.
--
-- O que de fato se abre mão: duas avulsas na mesma consulta, porque NULL nunca
-- conflita em índice único. Na prática `CreateCaptures` já recusa uma segunda análise
-- por consulta, e uma avulsa é por definição uma captura só. Se um dia incomodar,
-- `NULLS NOT DISTINCT` fecha sem coluna nova.
--
-- ─── Consequência assumida
-- `capture_index = 0` não se explica sozinho para quem abre a tabela no SQL, enquanto
-- `phase = 'baseline'` se explicava. A convenção fica gravada no `COMMENT ON COLUMN`
-- abaixo, para ser lida onde a dúvida aparece — no próprio banco — e não só aqui.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Guarda
--
-- Diferente de `merge_image_analyses`, esta migration NÃO pressupõe tabela vazia:
-- `capture_index` já existe e já está correto em toda linha, então a conversão é
-- sem perda. O que ela não tolera é encontrar a divergência que veio eliminar — uma
-- basal fora do índice 0 não tem para onde ser convertida, e escolher um dos dois
-- valores em silêncio seria inventar dado clínico.
do $$
declare
  n_divergentes bigint;
begin
  select count(*) into n_divergentes
    from public.analysis_captures
   where phase = 'baseline' and capture_index <> 0;
  if n_divergentes > 0 then
    raise exception
      'abortado: % captura(s) com phase = baseline e capture_index <> 0; '
      'a convenção NULL/0/N não as representa, e escolher um dos dois valores '
      'seria inventar dado. Corrija-as antes de aplicar.',
      n_divergentes;
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backfill: a avulsa passa a se declarar pelo índice nulo
--
-- Antes ela era "capture_index = 0 e phase nulo", indistinguível de uma basal pelo
-- índice sozinho. É esta linha que dá ao índice o poder de responder a pergunta que
-- `phase` respondia.
alter table public.analysis_captures alter column capture_index drop not null;

update public.analysis_captures set capture_index = null where phase is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. As duas colunas saem
--
-- O índice parcial cai junto com a coluna que ele consultava; `unique (encounter_id,
-- capture_index)` continua de pé e assume a garantia da basal única.
drop index if exists public.analysis_captures_one_baseline;

alter table public.analysis_captures
  drop column phase,
  drop column label;

comment on column public.analysis_captures.capture_index is
  'Posição da captura. NULL = análise avulsa (sem sequência e sem eixo de tempo); '
  '0 = captura basal; N = captura dinâmica N. Único por consulta, o que garante no '
  'máximo uma basal. Substituiu a dupla capture_index + phase, que podia divergir.';
