-- Tira `encounters.created_by`.
--
-- Ela guardava a autoria (quem digitou), separada de `owner_id`, que é o tenant (de
-- quem é o prontuário). A separação só fazia diferença num caso: o admin registrando
-- consulta no paciente de outro médico — e a migration anterior
-- (`consulta_e_do_dono`) passou a proibir exatamente isso. Sem o caso, a coluna virou
-- uma segunda cópia de `owner_id` em toda linha nova.
--
-- Verificado no banco hospedado: nenhuma linha existente tem os dois valores
-- diferentes. A guarda abaixo repete a checagem em qualquer ambiente onde esta
-- migration rode, para não apagar autoria real por engano — se ela disparar, é porque
-- ali existe divergência que este raciocínio não previu.
--
-- Nota: `patients` e `analysis_captures` nunca tiveram `created_by`. A coluna era uma
-- assimetria de `encounters`, não um padrão do schema.
do $$
declare
  n bigint;
begin
  select count(*) into n from public.encounters where created_by <> owner_id;
  if n > 0 then
    raise exception
      'abortado: % consulta(s) com created_by diferente de owner_id — há autoria real '
      'a preservar aqui; revise antes de apagar a coluna', n;
  end if;
end
$$;

alter table public.encounters
  drop column created_by;
