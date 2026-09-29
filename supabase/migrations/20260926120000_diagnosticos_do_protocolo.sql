-- Completa o catálogo de diagnósticos com as patologias do protocolo que faltavam.
--
-- ─── O que faltava, e de onde vem a lista
-- O protocolo do InfraJoint (etapa de coleta de dados dos grupos A e B) manda registrar
-- a patologia de base predominante e cita: artrite reumatoide, artrite psoriática,
-- lúpus, esclerose, miopatia, gota, osteoartrite, tendinite e/ou tenossinovite,
-- síndrome do túnel do carpo e fibromialgia. O catálogo de `diagnostico_e_grupo` cobria
-- todas menos duas, justamente duas causas de dor não inflamatória em mãos e punhos,
-- que é o grupo B do protocolo. Sem elas, um voluntário do grupo B com uma dessas
-- condições não tinha como ter o diagnóstico registrado.
--
-- ─── Os códigos escolhidos
-- Mesmo critério do catálogo existente: a categoria da CID-10 quando a patologia do
-- protocolo é genérica, a subcategoria quando o nome aponta para uma só.
--
--   M65   Sinovite e tenossinovite. O protocolo diz "tendinite e/ou tenossinovite",
--         sem especificar a forma, então entra a categoria inteira, como M05 e M07.
--   G56.0 Síndrome do túnel do carpo. Fica no capítulo VI da CID-10 (sistema nervoso),
--         e não no XIII, porque é uma mononeuropatia. Continua sendo CID-10, a única
--         classificação do catálogo.
--
-- A escolha dos códigos é do desenvolvimento, a partir dos nomes do protocolo. Quem
-- valida se são os códigos que a equipe clínica usa são os médicos do projeto.
--
-- ─── O que NÃO muda
-- Nada além de duas linhas de dado de referência: sem coluna nova, sem policy nova. O
-- catálogo continua com leitura para todo autenticado e escrita para ninguém, e o
-- seletor de diagnósticos da tela lê o catálogo pela API (`GET /diagnoses`), então as
-- duas opções aparecem sem mudança no frontend.
--
-- `on conflict do nothing` porque o catálogo cresce por `insert` e um ambiente pode já
-- ter recebido um destes códigos à mão: reaplicar não deve falhar nem duplicar.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.diagnoses (code, label) values
  ('M65',   'Sinovite e tenossinovite'),
  ('G56.0', 'Síndrome do túnel do carpo')
on conflict (code) do nothing;
