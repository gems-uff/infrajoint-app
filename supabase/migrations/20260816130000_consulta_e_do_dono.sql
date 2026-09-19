-- A consulta e a análise só podem ser escritas pelo dono do paciente.
--
-- Até aqui as policies de escrita usavam `app.can_access(owner_id)`, que é verdadeiro
-- também para admin. Efeito: um admin podia registrar consulta no paciente de outro
-- médico. A consulta nascia com `owner_id` do médico (o trigger copia do paciente) e
-- `created_by` do admin — clinicamente, um registro assinado por quem não atendeu.
--
-- A regra passa a ser explícita: escrever consulta é do dono do paciente, e de mais
-- ninguém. `is_clinician()` continua ali porque um médico rebaixado a leitor deve
-- perder a escrita do próprio histórico também.
--
-- **A leitura não muda**: `encounters_read` e `analysis_captures_read` seguem com
-- `can_access`, então o admin continua enxergando tudo. Ele perde a autoria, não a
-- supervisão.
--
-- Um efeito colateral desta migration: `created_by` passa a ser sempre igual a
-- `owner_id`. Sem o caso de divergência, a coluna perdeu a razão de existir e sai na
-- migration seguinte (`drop_created_by`).
--
-- O que NÃO é fechado aqui, e é decisão em aberto: `patients_write` continua com
-- `can_access`, então o admin ainda pode editar e apagar paciente de outro médico — e
-- apagar leva as consultas por cascata, que roda como dona da tabela e não passa por
-- estas policies. Ou seja, a via indireta de destruição continua existindo.
drop policy encounters_write on public.encounters;
create policy encounters_write on public.encounters
  for all
  using      (owner_id = auth.uid() and app.is_clinician())
  with check (owner_id = auth.uid() and app.is_clinician());

drop policy analysis_captures_write on public.analysis_captures;
create policy analysis_captures_write on public.analysis_captures
  for all
  using      (owner_id = auth.uid() and app.is_clinician())
  with check (owner_id = auth.uid() and app.is_clinician());
