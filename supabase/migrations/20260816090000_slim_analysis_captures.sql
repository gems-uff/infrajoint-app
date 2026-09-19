-- Tira de analysis_captures três colunas que ninguém lê.
--
-- Levantamento do consumo real (banco → backend → tela), coluna a coluna:
--
--   matrix_width / matrix_height
--     O plano previa reconstruir a sobreposição com `csvScale = jpeg.width /
--     matrix_width`. Não foi o que a implementação fez: a consulta reaberta baixa o
--     CSV — que fica guardado de qualquer forma — e o reparseia, então a largura vem
--     do próprio arquivo (`jpeg.width / matrix.width`). Guardá-las é desnormalizar um
--     arquivo que sempre temos, com o risco que toda desnormalização tem: divergir.
--     Somado a isso, no protocolo a matriz é sempre 640x480 — hoje as duas colunas
--     não carregam informação nenhuma.
--
--   alignment_mode
--     É o mesmo fato de alignment_method, cujo check já inclui 'manual'. Os dois
--     escritores derivavam um do outro ('manual' → manual, senão auto) e a reabertura
--     lê só alignment_method. Duas colunas para um fato é uma que pode discordar da
--     outra — e nada no código diria qual está certa.
--
-- Ficam de fora desta limpeza, de propósito:
--   agreement_normalized  — sem leitor hoje, mas é projeção numérica de agreement,
--                           feita para a pesquisa poder consultar e ordenar sem
--                           abrir o jsonb; recriá-la depois exigiria backfill.
--   manual_rois           — era gravada e não restaurada. O buraco estava na leitura,
--                           e foi ela que se corrigiu.
--   label                 — não chega à tela (ela mostra fase + índice), mas é o
--                           único vestígio de qual arquivo originou a captura.
alter table public.analysis_captures
  drop column matrix_width,
  drop column matrix_height,
  drop column alignment_mode;
