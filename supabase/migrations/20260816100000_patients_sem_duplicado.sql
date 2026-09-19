-- Impede dois pacientes iguais sob o mesmo médico.
--
-- "Iguais" aqui é nome normalizado + data de nascimento. Não existe chave natural
-- para pessoa sem documento — o `id` uuid continua sendo a PK —, e a decisão de não
-- guardar CPF/RG continua valendo. O que dá para cobrar é a quase-chave que a
-- migration `simplify_patients` já assumiu ao tirar o número de prontuário:
-- "dois pacientes homônimos se distinguem pela data de nascimento".
--
-- ─── Por que por owner_id, e não global
-- Um índice único global vazaria existência através da RLS: o médico A tentaria
-- cadastrar "Maria Silva", receberia violação causada por uma linha do médico B — que
-- ele não pode ver — e ficaria num beco sem saída que a aplicação não sabe explicar.
-- Sendo por dono, a violação só fala de linhas que o próprio usuário enxerga.
--
-- ─── Por que NULLS NOT DISTINCT
-- Por padrão o Postgres considera NULLs distintos entre si, então dois "Maria Silva"
-- SEM data de nascimento passariam pelo índice — justamente o par que ninguém
-- consegue distinguir. Com NULLS NOT DISTINCT, "sem data" colide com "sem data".
--
-- ─── Consequência assumida
-- Homônimos com a mesma data de nascimento existem no mundo real e passam a não caber
-- no cadastro. É o preço de cobrar no banco, e a aplicação avisa antes de esbarrar
-- aqui: ela detecta o homônimo na criação e pergunta, em vez de deixar o médico
-- descobrir por um erro de constraint.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Normalização do nome
--
-- Sem isto, "  maria  silva" e "María Silva" seriam pessoas diferentes para o índice,
-- e o cadastro duplicado que mais acontece — redigitar quem já existe — passaria.
create extension if not exists unaccent with schema extensions;

-- IMMUTABLE é exigência de índice de expressão, e `unaccent()` é STABLE porque o
-- dicionário pode ser alterado. Declarar imutável é a promessa de não alterá-lo; se um
-- dia for, este índice precisa de REINDEX. O dicionário vai explícito como argumento
-- para não depender do search_path de quem chama.
create or replace function app.normalized_name(nome text)
  returns text
  language sql
  immutable
  strict
  parallel safe
  set search_path = ''
as $$
  -- O regexp colapsa espaço interno: "maria  silva" e "maria silva" são a mesma
  -- pessoa digitada duas vezes, e só o btrim não pegaria isso.
  select regexp_replace(
           lower(btrim(extensions.unaccent('extensions.unaccent'::regdictionary, nome))),
           '\s+', ' ', 'g'
         )
$$;

grant execute on function app.normalized_name(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Guarda: falhar alto se já houver duplicata gravada
--
-- O `create unique index` abaixo falharia sozinho, mas com uma mensagem que fala de
-- índice. Esta diz o que fazer.
-- A mensagem lista os nomes COMO FORAM DIGITADOS, e não a forma normalizada: a
-- duplicata que sobra a esta altura costuma diferir por acento ou espaço — invisível
-- numa consulta ingênua com lower(btrim(...)) —, e ver as duas grafias lado a lado é
-- o que explica por que elas são a mesma pessoa para o índice.
do $$
declare
  grupos text;
begin
  select string_agg(descricao, '; ') into grupos from (
    select format('%s (%s)',
                  string_agg(quote_literal(full_name), ' = '),
                  coalesce(birth_date::text, 'sem data de nascimento')) as descricao
      from public.patients
     group by owner_id, app.normalized_name(full_name), birth_date
    having count(*) > 1
  ) d;
  if grupos is not null then
    raise exception
      'abortado: pacientes duplicados para o mesmo médico — %. Apague pela aplicação '
      '(o SQL direto deixa as imagens órfãs no R2) ou dê datas de nascimento '
      'diferentes, e rode esta migration de novo', grupos;
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O índice
create unique index patients_sem_duplicado
  on public.patients (owner_id, app.normalized_name(full_name), birth_date)
  nulls not distinct;
