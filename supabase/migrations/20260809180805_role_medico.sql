-- Acrescenta o role `medico` ao enum public.user_role.
--
-- Esta migration existe SOZINHA de propósito: `ALTER TYPE ... ADD VALUE` não pode
-- compartilhar transação com o uso do valor novo, e a migration seguinte já o referencia.
-- Cada arquivo de migration roda na sua própria transação, então separá-los resolve.

alter type public.user_role add value if not exists 'medico';
