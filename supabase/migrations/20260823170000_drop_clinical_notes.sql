-- Tira `encounters.clinical_notes`.
--
-- A coluna era lida em três lugares — o detalhe da consulta, a lista do prontuário e a
-- seção "Notas clínicas" do PDF — e escrita em nenhum. Nenhum formulário do frontend a
-- preenche: `toEncounterCreate` monta só `reason`, `joint_evaluations` e `scores`. O
-- campo existia na API e no schema desde o modelo clínico original e nunca ganhou tela.
--
-- Havia duas saídas: acrescentar o campo ao fluxo, ou tirar o caminho de leitura. A
-- decisão foi a segunda — o registro textual da consulta já tem `reason`, e uma segunda
-- caixa de texto livre sem regra que a distinga da primeira seria dois lugares para a
-- mesma coisa, com o médico tendo que adivinhar em qual escrever.
--
-- O que se perde ao aplicar: nada hoje, porque nenhuma linha tem valor. Voltar atrás é
-- `add column` mais o formulário que nunca existiu.
--
-- A guarda abaixo repete a verificação em qualquer ambiente onde esta migration rode.
-- Se ela disparar, é porque ali alguém gravou nota por um caminho que este raciocínio
-- não previu — SQL direto, provavelmente — e há texto clínico real a preservar.
do $$
declare
  n bigint;
begin
  select count(*) into n from public.encounters where clinical_notes is not null;
  if n > 0 then
    raise exception
      'abortado: % consulta(s) com clinical_notes preenchido — há texto clínico a '
      'preservar aqui; revise antes de apagar a coluna', n;
  end if;
end
$$;

alter table public.encounters
  drop column clinical_notes;
