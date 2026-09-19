-- O nome do médico dono de uma linha, legível só por admin.
--
-- ─── Por que isto precisa existir
-- A RLS de `public.users` tem uma única policy de leitura, `select_own_profile`
-- (`auth.uid() = id`). Ou seja: nem o admin consegue ler o nome de outro usuário, e um
-- `join public.users` na listagem de pacientes devolveria nulo para todo mundo que não
-- fosse o próprio chamador.
--
-- ─── Por que isto é necessário AGORA
-- O admin enxerga os pacientes de todos os médicos (a policy `patients_read` usa
-- `app.can_access`, que é verdadeiro para ele) e `PatientOut` omite `owner_id` de
-- propósito. Resultado: a tela `/pacientes` mostrava, numa lista única e sem nenhuma
-- marca, os pacientes dele e os dos outros — com o botão de excluir na mesma linha.
-- O admin pode mesmo apagar paciente alheio (é decisão do projeto: ele administra o
-- acervo, não assina no lugar de quem atendeu), mas apagar sem saber de quem é não é
-- decisão, é acidente.
--
-- ─── Por que uma função, e não uma policy nova em public.users
-- Uma policy do tipo "authenticated lê o nome de qualquer usuário" resolveria o
-- problema e abriria outro: o diretório de nomes da plataforma inteira, para todo mundo.
-- Esta função expõe UMA coluna, para UM papel, e não abre caminho para nada além disso.
--
-- SECURITY DEFINER é o que permite atravessar a policy de `public.users`, e a cláusula
-- `app.is_admin()` dentro do corpo é o que impede que atravessar vire ler à vontade:
-- para quem não é admin ela devolve NULL, seja qual for o uuid perguntado. Como o admin
-- já lê a linha inteira do paciente — dado bem mais sensível que o nome do médico —,
-- isto não amplia o que ele alcança; só torna visível o que ele já podia destruir.
--
-- search_path fixo e vazio, com tudo qualificado, pelo mesmo motivo das outras funções
-- SECURITY DEFINER do schema: sem ele, um search_path controlado pelo chamador poderia
-- resolver `users` para outra tabela e a função rodaria com os privilégios do dono.
create or replace function app.owner_display_name(owner uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select u.full_name
    from public.users u
   where u.id = owner
     and app.is_admin()
$$;

grant execute on function app.owner_display_name(uuid) to authenticated;
