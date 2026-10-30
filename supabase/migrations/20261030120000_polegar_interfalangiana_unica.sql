-- O polegar tem uma interfalangiana só: IF/IP 1, e não IFP/PIP 1.
--
-- O "P" de proximal só distingue alguma coisa nos dedos que também têm a interfalangiana
-- distal. No polegar não há distal, e o médico parceiro apontou o rótulo no teste de
-- usabilidade. O id continua `*_PIP_1`: é identidade, referenciada pelas medições e
-- pelas avaliações gravadas e pelo cálculo do CDAI e do DAS28, e o grupo continua `pip`,
-- porque é ele que os índices contam como a 1ª das dez interfalangianas.
--
-- Os rótulos seguem `JOINT_CATALOG` (frontend/src/app/features/analysis/body-map/
-- joint-catalog.data.ts) caractere a caractere, como na migration do catálogo. É deste
-- rótulo que o algoritmo de diferença de temperatura tira o nome da articulação.

update public.joints set label = 'IF/IP 1 (mão direita)'  where id = 'RIGHT_PIP_1';
update public.joints set label = 'IF/IP 1 (mão esquerda)' where id = 'LEFT_PIP_1';

do $$
begin
  if (select count(*) from public.joints where label like 'IF/IP 1 (mão %)') <> 2 then
    raise exception 'polegar_interfalangiana_unica: esperava 2 rótulos IF/IP 1';
  end if;
end $$;
