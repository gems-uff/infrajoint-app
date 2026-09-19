-- Tira `manual_rois` de analysis_captures.
--
-- A ROI manual é a região que o médico desenha à mão sobre a foto para ler a
-- temperatura de um ponto qualquer — diferente das 22 ROIs articulares, que a
-- detecção de mãos posiciona sozinha e que continuam em `measurements`.
--
-- Ela era gravada (no caminho avulso, com as estatísticas já em número) e nunca lida:
-- a consulta reaberta mostrava as articulares e perdia as manuais. Houve a opção de
-- fechar o buraco pela leitura; a decisão foi a inversa — enquanto nada no prontuário
-- consome esse dado, ROI manual é instrumento de inspeção da tela, não parte do
-- registro clínico. O caminho de sequência sequer a preenchia.
--
-- O que se perde ao aplicar: as ROIs desenhadas nas análises já gravadas. Voltar atrás
-- é `add column` mais o código de leitura, mas o que já foi apagado não retorna.
alter table public.analysis_captures
  drop column manual_rois;
