-- Tira de encounters as quatro colunas herdadas da fusão de `image_analyses`.
--
-- `subject_label` e `trial_label` guardavam de qual pasta de aquisição a sequência
-- veio ('V051', 'T1'); `capture_interval_seconds`, o intervalo do protocolo; e
-- `analysis_params` era um jsonb livre para parâmetros da análise.
--
-- Nenhuma das quatro é lida. E, ao contrário do que o nome sugere, a curva de
-- reaquecimento **não** depende do intervalo: cada captura já grava o próprio
-- `elapsed_seconds`, e é dele que a curva sai. O intervalo é usado só no momento da
-- importação, para calcular esse tempo — depois de calculado, virou dado da linha.
--
-- `analysis_params` nunca chegou a receber nada: nenhum caminho do frontend a
-- preenche, e todas as linhas têm o default '{}'.
--
-- O que se perde: a rastreabilidade da consulta até a pasta bruta em disco. Foi uma
-- decisão consciente — se a pesquisa precisar dela depois, o vínculo terá que ser
-- reconstruído por outro caminho (data da consulta e nomes dos arquivos).
alter table public.encounters
  drop column subject_label,
  drop column trial_label,
  drop column capture_interval_seconds,
  drop column analysis_params;
