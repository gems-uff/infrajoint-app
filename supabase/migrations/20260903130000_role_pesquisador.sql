-- Acrescenta o role `pesquisador` ao enum public.user_role.
--
-- Sozinha de propósito, pelo mesmo motivo de `role_medico`: `ALTER TYPE ... ADD VALUE`
-- não pode compartilhar transação com o uso do valor novo, e a migration seguinte
-- (`acervo_de_pesquisa`) já o referencia dentro das funções de autorização.

alter type public.user_role add value if not exists 'pesquisador';
