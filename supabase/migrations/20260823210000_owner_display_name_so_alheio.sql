-- `app.owner_display_name()` passa a calar sobre as linhas do próprio chamador.
--
-- Antes ela devolvia o nome do dono para qualquer linha, desde que quem perguntasse
-- fosse admin. Isso dizia menos do que parece: na lista do admin, TODA linha vinha
-- rotulada, inclusive as dele, e o rótulo deixava de carregar a única informação que
-- importa ali — se aquele prontuário é ou não de outra pessoa.
--
-- Com a cláusula `owner <> auth.uid()`, o campo passa a ter um significado único e
-- acionável: **preenchido = este paciente é de outro médico**. É o que permite à tela
-- esconder "Editar" exatamente onde `patients_update` vai recusar
-- (`paciente_e_do_dono`), em vez de deixar o admin descobrir a recusa depois de
-- preencher o formulário.
--
-- Para quem não é admin nada muda: continua NULL sempre, porque ele só enxerga os
-- próprios pacientes e o rótulo repetiria o nome dele em toda linha.
--
-- Substitui em vez de alterar: `create or replace` é idempotente, e a versão anterior
-- pode já ter sido aplicada no projeto hospedado.
create or replace function app.owner_display_name(owner uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select u.full_name
    from public.users u
   where u.id = owner
     and owner <> auth.uid()
     and app.is_admin()
$$;
