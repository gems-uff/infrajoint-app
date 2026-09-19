-- `patients.birth_date` passa a ser obrigatória.
--
-- Sem documento (a decisão de não guardar CPF/RG continua valendo) e sem número de
-- prontuário (que a migration `simplify_patients` tirou), a data de nascimento é o
-- ÚNICO campo que distingue dois pacientes homônimos. Deixá-la opcional era deixar
-- opcional a única coisa que torna o cadastro identificável.
--
-- ─── O que isto conserta no índice único
-- `patients_sem_duplicado` é (owner_id, normalized_name(full_name), birth_date) com
-- NULLS NOT DISTINCT. O NULLS NOT DISTINCT existia justamente para que dois "Maria
-- Silva" SEM data colidissem — o par que ninguém consegue distinguir. Com a coluna
-- obrigatória esse caso deixa de existir na origem, e o índice passa a comparar sempre
-- duas datas reais. Ele fica como está: `nulls not distinct` vira inócuo (nenhuma das
-- três expressões pode ser nula), e mexer nele custaria um REINDEX sem ganho nenhum.
--
-- ─── O que muda no aviso de homônimo
-- Melhora. O 409 da criação devolve os homônimos para a tela mostrar, e o médico decide
-- olhando as datas de nascimento — antes, uma lista de candidatos sem data não ajudava
-- a decidir nada. Homônimo com data diferente continua cadastrável na confirmação;
-- nome e data idênticos continuam recusados pelo índice.
--
-- ─── Consequência assumida
-- Paciente cujo nascimento o médico não sabe deixa de caber no cadastro. É o preço de
-- ter uma quase-chave: ou o registro identifica a pessoa, ou não serve de prontuário.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guarda: falhar alto, e nomeando quem falta
--
-- O `set not null` falharia sozinho, mas com uma mensagem que fala de constraint. Esta
-- diz QUAIS pacientes precisam de data antes da migration poder rodar — sem isso, achar
-- os culpados num banco de produção é uma query que ninguém escreveu ainda.
do $$
declare
  faltando text;
  n        bigint;
begin
  select count(*), string_agg(quote_literal(full_name), ', ' order by full_name)
    into n, faltando
    from public.patients
   where birth_date is null;

  if n > 0 then
    raise exception
      'abortado: % paciente(s) sem data de nascimento — %. Preencha a data pela '
      'aplicação (ou apague o cadastro, se for teste) e rode esta migration de novo',
      n, faltando;
  end if;
end
$$;

alter table public.patients
  alter column birth_date set not null;
