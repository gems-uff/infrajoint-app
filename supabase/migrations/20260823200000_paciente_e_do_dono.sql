-- O cadastro do paciente só pode ser EDITADO pelo médico dono.
--
-- Fecha a última peça da regra que `consulta_e_do_dono` estabeleceu para consultas e
-- capturas, e que aquela migration deixou explicitamente em aberto aqui:
--
--     "patients_write continua com can_access, então o admin ainda pode editar e
--      apagar paciente de outro médico"
--
-- ─── O princípio, agora válido no schema inteiro
-- O admin **administra o acervo**; ele não assina no lugar de quem atendeu.
--
--   SELECT  — sim. É a supervisão; sem ela não há o que administrar.
--   DELETE  — sim. Remover não falsifica: nada de falso sobra no prontuário, e o
--             médico percebe que o paciente sumiu.
--   INSERT  — indiferente. O trigger app.own_row() já força owner_id = auth.uid(),
--             então o admin nunca cria um cadastro em nome de outro. A cláusula
--             abaixo é redundante ali de propósito, para a policy dizer a regra
--             inteira sem depender de o leitor conhecer o trigger.
--   UPDATE  — NÃO. Aqui está a diferença que motiva esta migration: editar o
--             cadastro alheio grava conteúdo do admin sob o nome de outro médico,
--             e nada na tela denuncia. É o mesmo mal que `consulta_e_do_dono`
--             impediu ao proibir o admin de registrar consulta no paciente de
--             outro — "um registro clínico assinado por quem não atendeu".
--
-- ─── Por que apagar continua liberado, se apagar é "pior"
-- O eixo não é o tamanho do estrago, é falsificação contra remoção. Um registro
-- apagado não engana ninguém. Um registro editado passa a afirmar algo que o dono
-- nunca escreveu, e sobrevive assim.
--
-- ─── Consequência assumida
-- Um admin não conserta mais o cadastro de um paciente de outro médico — nem um erro
-- de digitação. Se o médico responsável não estiver mais disponível, o caminho é SQL
-- direto, que é auditável e deliberado, e não um clique numa tela.
--
-- ─── O que muda na API
-- `UpdatePatient` ganhou a guarda equivalente, pelo mesmo motivo de `CreateEncounter`:
-- para o médico errado o paciente já é invisível e vira 404, mas o admin ENXERGA o
-- paciente alheio. Sem a guarda ele receberia 404 por um paciente que a listagem dele
-- acabou de mostrar. A API responde 403, que é a verdade: a identidade não é segredo
-- para ele, o que falta é ser o responsável.

drop policy patients_write on public.patients;

-- Criar: sempre para si mesmo.
create policy patients_insert on public.patients
  for insert
  with check (owner_id = auth.uid() and app.is_clinician());

-- Editar: só o dono. É esta a linha que a migration existe para escrever.
create policy patients_update on public.patients
  for update
  using      (owner_id = auth.uid() and app.is_clinician())
  with check (owner_id = auth.uid() and app.is_clinician());

-- Apagar: o admin administra o acervo. `can_access` mantém isso.
create policy patients_delete on public.patients
  for delete
  using (app.can_access(owner_id) and app.is_clinician());
