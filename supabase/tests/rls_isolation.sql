-- Prova de isolamento da RLS do modelo clínico.
--
--   docker exec -i supabase_db_InfraJoint psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/rls_isolation.sql
--
-- Roda contra o banco LOCAL. Qualquer assert que falhe aborta o script com
-- código de saída não-zero.
--
-- O que ele prova:
--   1. Médico A não enxerga nada do médico B
--   2. inherit_owner ignora o owner_id enviado pelo cliente
--   3. Não dá para pendurar uma consulta no paciente de outro médico
--   4. Leitor ('user') não cria paciente
--   5. Admin enxerga os dois médicos
--   6. Não dá para reparentar uma linha para o tenant de outro médico
--   7. Médico rebaixado vira somente-leitura (não apaga)
--   8. As funções de autorização são totais — nunca devolvem NULL
--   9. Tabela nova não nasce acessível ao anon
--  10. anon não alcança as tabelas
--  11. Pesquisadores compartilham o acervo entre si
--  12. O par edita cadastro alheio sem tomar a posse, e a edição fica assinada
--  13. O par não apaga nada do outro
--  14. O pool não alcança médico nenhum, e nenhum médico o alcança
--  15. O catálogo de articulações é de todos, e de ninguém para escrever
--  16. A avaliação articular herda o isolamento da consulta
--  17. O catálogo recusa articulação inexistente
--  18. O escore cobra a forma do índice que declara ser
--  19. Medição e avaliação cruzam pela mesma articulação
--  20. Diagnóstico é relação com catálogo, e grupo de estudo é coluna à parte
--  21. O avatar de cada um está na pasta dele, e ninguém escreve na pasta alheia

\set ON_ERROR_STOP on
\set QUIET on

-- ─────────────────────────────────────────────────────────────────────────────
-- Cenário: 2 médicos, 1 leitor, 1 admin, 2 pesquisadores. Ids fixos para o script
-- ser relegível.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

delete from public.patients where full_name like 'RLS-TEST%';

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rlstest-a@local','{"full_name":"Medico A"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rlstest-b@local','{"full_name":"Medico B"}'),
  ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rlstest-l@local','{"full_name":"Leitor"}'),
  ('dddddddd-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rlstest-x@local','{"full_name":"Admin"}'),
  ('eeeeeeee-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rlstest-p1@local','{"full_name":"Pesquisadora P1"}'),
  ('ffffffff-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rlstest-p2@local','{"full_name":"Pesquisador P2"}')
on conflict (id) do nothing;

update public.users set role = 'medico' where id in
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002');
update public.users set role = 'user'  where id = 'cccccccc-0000-0000-0000-000000000003';
update public.users set role = 'admin' where id = 'dddddddd-0000-0000-0000-000000000004';
update public.users set role = 'pesquisador' where id in
  ('eeeeeeee-0000-0000-0000-000000000005','ffffffff-0000-0000-0000-000000000006');

-- O nome vai no UPDATE também: quem rodou o script antes desta mudança já tem a linha
-- criada pelo trigger, e o ON CONFLICT acima não a corrigiria. O cenário 18 assere
-- sobre esses nomes.
update public.users u set full_name = a.raw_user_meta_data->>'full_name'
  from auth.users a where a.id = u.id and u.id in
  ('eeeeeeee-0000-0000-0000-000000000005','ffffffff-0000-0000-0000-000000000006');

commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '1. Médico A cria paciente e consulta — e o owner_id enviado é ignorado'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- owner_id vai de propósito com o uuid do médico B: o trigger tem que descartar.
insert into public.patients (id, owner_id, full_name, birth_date)
values ('11111111-aaaa-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002', 'RLS-TEST paciente de A', '1970-01-01');

insert into public.encounters (id, patient_id, owner_id, reason)
values ('22222222-aaaa-0000-0000-000000000001',
        '11111111-aaaa-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002', 'RLS-TEST consulta');

-- `owner_id` carrega os dois fatos de uma vez: de quem é o prontuário e quem
-- registrou. Houve uma coluna `created_by` separada, e ela tinha um assert próprio
-- aqui; a migration `consulta_e_do_dono` passou a exigir owner_id = auth.uid() na
-- escrita, o que tornou as duas sempre iguais, e `drop_created_by` removeu a coluna.
do $$
declare dono uuid; dono_enc uuid;
begin
  select owner_id into dono     from public.patients   where full_name = 'RLS-TEST paciente de A';
  select owner_id into dono_enc from public.encounters
   where id = '22222222-aaaa-0000-0000-000000000001';

  assert dono = 'aaaaaaaa-0000-0000-0000-000000000001',
    format('own_row deveria ter forçado o dono para A, veio %s', dono);
  assert dono_enc = 'aaaaaaaa-0000-0000-0000-000000000001',
    format('inherit_owner deveria ter copiado o dono do paciente, veio %s', dono_enc);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '2. Médico B não enxerga nem alcança nada de A'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.patients where full_name like 'RLS-TEST%';
  assert n = 0, format('B deveria ver 0 pacientes de A, viu %s', n);

  select count(*) into n from public.encounters
   where patient_id in (select id from public.patients where full_name like 'RLS-TEST%');
  assert n = 0, format('B deveria ver 0 consultas, viu %s', n);

  -- Buscar pelo id exato também não revela nada: é isso que vira 404 na API.
  select count(*) into n from public.patients
   where id = '11111111-aaaa-0000-0000-000000000001';
  assert n = 0, 'B alcançou o paciente de A pelo id — a API responderia 200 em vez de 404';
end $$;

-- E não consegue pendurar uma consulta no paciente de A: o pai está invisível,
-- então o inherit_owner não acha a linha e aborta.
do $$
begin
  begin
    insert into public.encounters (patient_id, reason)
    values ('11111111-aaaa-0000-0000-000000000001', 'RLS-TEST invasao');
    raise exception 'FALHA: B criou consulta no paciente de A';
  exception when insufficient_privilege then
    null;  -- esperado
  end;
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '3. Leitor não cria paciente'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

do $$
begin
  begin
    insert into public.patients (full_name, birth_date)
    values ('RLS-TEST paciente do leitor', '1970-01-01');
    raise exception 'FALHA: leitor criou paciente';
  exception when insufficient_privilege then
    null;  -- WITH CHECK exige role medico/admin
  end;
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '4. Médico B cria o seu, e cada um continua vendo só o próprio'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
insert into public.patients (full_name, birth_date)
values ('RLS-TEST paciente de B', '1970-01-01');

do $$
declare n int;
begin
  select count(*) into n from public.patients where full_name like 'RLS-TEST%';
  assert n = 1, format('B deveria ver só o próprio paciente, viu %s', n);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '5. Admin enxerga os dois'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);

do $$
declare n int;
begin
  select count(*) into n from public.patients where full_name like 'RLS-TEST%';
  assert n = 2, format('admin deveria ver os 2 pacientes, viu %s', n);

  -- Recortado por RLS-TEST, como toda asserção deste script. Contando a tabela
  -- inteira, o teste passava só em banco recém-resetado: qualquer consulta criada
  -- pelo navegador (ou pela suíte de pytest) o fazia abortar aqui, com uma mensagem
  -- que parecia falha de isolamento. E abortando, a limpeza do fim não rodava.
  select count(*) into n from public.encounters
   where patient_id in (select id from public.patients where full_name like 'RLS-TEST%');
  assert n = 1, format('admin deveria ver a consulta de A, viu %s', n);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '5b. Admin lê a consulta de A, mas não escreve nela'
-- ─────────────────────────────────────────────────────────────────────────────
-- Consulta é do dono do paciente. O admin supervisiona (a policy _read continua com
-- can_access) e não assina no lugar de quem atendeu (a _write exige owner_id =
-- auth.uid()). Antes dessa separação a consulta nascia com o owner do médico e a
-- autoria do admin — um registro clínico assinado por quem não atendeu. Fechado o
-- caso, a coluna de autoria virou cópia de owner_id e saiu do schema.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.encounters
   where id = '22222222-aaaa-0000-0000-000000000001';
  assert n = 1, 'admin deveria continuar LENDO a consulta de A';

  begin
    insert into public.encounters (patient_id, reason)
    values ('11111111-aaaa-0000-0000-000000000001', 'RLS-TEST consulta do admin');
    raise exception 'FALHA: admin registrou consulta no paciente de A';
  exception when insufficient_privilege then
    null;  -- encounters_write exige owner_id = auth.uid()
  end;

  begin
    update public.encounters set reason = 'RLS-TEST editada pelo admin'
     where id = '22222222-aaaa-0000-0000-000000000001';
    assert not found, 'FALHA: admin editou a consulta de A';
  exception when insufficient_privilege then
    null;
  end;
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '5c. Admin lê e APAGA paciente alheio, mas não o EDITA'
-- ─────────────────────────────────────────────────────────────────────────────
-- A regra completa, depois de `paciente_e_do_dono`: o admin administra o acervo e
-- não assina no lugar de quem atendeu.
--
-- A assimetria entre apagar (pode) e editar (não pode) é deliberada, e o eixo não é
-- o tamanho do estrago: é falsificação contra remoção. Um paciente apagado não
-- engana ninguém, e o médico percebe que ele sumiu. Um cadastro editado passa a
-- afirmar algo que o dono nunca escreveu, e sobrevive assim, em silêncio.
--
-- Este bloco roda ANTES do 6 de propósito: ele apaga o paciente que cria, então não
-- deixa nada para os cenários seguintes.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
insert into public.patients (id, full_name, birth_date)
values ('11111111-cccc-0000-0000-000000000003', 'RLS-TEST alvo do admin', '1970-01-01');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients
   where id = '11111111-cccc-0000-0000-000000000003';
  assert n = 1, 'admin deveria LER o paciente de B';

  -- Editar: recusado. `patients_update` exige owner_id = auth.uid(), e um UPDATE que
  -- não casa a policy simplesmente não acha linha — não levanta erro.
  update public.patients set full_name = 'RLS-TEST renomeado pelo admin'
   where id = '11111111-cccc-0000-0000-000000000003';
  assert not found, 'FALHA: admin editou o cadastro do paciente de B';

  -- E o nome continua o que o dono escreveu.
  select count(*) into n from public.patients
   where id = '11111111-cccc-0000-0000-000000000003'
     and full_name = 'RLS-TEST alvo do admin';
  assert n = 1, 'FALHA: o nome do paciente de B mudou';

  -- Apagar: permitido. `patients_delete` mantém can_access.
  delete from public.patients where id = '11111111-cccc-0000-0000-000000000003';
  assert found, 'FALHA: admin não conseguiu apagar o paciente de B';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '6. A não consegue reparentar a própria consulta para o paciente de B'
-- ─────────────────────────────────────────────────────────────────────────────
-- Regressão: com o trigger só em BEFORE INSERT, este UPDATE passava. O owner_id
-- não mudava, então a policy continuava satisfeita — e a consulta de A ficava
-- pendurada no paciente de B. Quando B apagasse o paciente, o ON DELETE CASCADE
-- levaria a consulta de A junto.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
insert into public.patients (id, full_name, birth_date)
values ('11111111-bbbb-0000-0000-000000000002', 'RLS-TEST paciente de B2', '1970-01-01');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
begin
  begin
    update public.encounters
       set patient_id = '11111111-bbbb-0000-0000-000000000002'
     where id = '22222222-aaaa-0000-0000-000000000001';
    raise exception 'FALHA: A reparentou a consulta para o paciente de B';
  exception when insufficient_privilege then
    null;  -- inherit_owner não achou o pai sob a RLS de A
  end;
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '7. Médico rebaixado a leitor fica somente-leitura (não apaga)'
-- ─────────────────────────────────────────────────────────────────────────────
-- Regressão: com uma policy única `for all`, o DELETE consultava apenas o USING,
-- que não checava role. O rebaixado não podia editar e podia apagar.
begin;
update public.users set role = 'user' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients where full_name = 'RLS-TEST paciente de A';
  assert n = 1, 'rebaixado deveria continuar LENDO o próprio histórico';

  delete from public.patients where full_name = 'RLS-TEST paciente de A';
  select count(*) into n from public.patients where full_name = 'RLS-TEST paciente de A';
  assert n = 1, 'FALHA: leitor rebaixado APAGOU o próprio paciente';
end $$;
commit;

begin;
update public.users set role = 'medico' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '8. Funções de autorização são totais (nunca NULL)'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
do $$
begin
  assert app.is_admin()     is not null, 'is_admin() devolveu NULL para uid sem perfil';
  assert app.is_clinician() is not null, 'is_clinician() devolveu NULL para uid sem perfil';
  assert app.can_access('99999999-9999-9999-9999-999999999999') is not null,
    'can_access() devolveu NULL';
  assert app.is_researcher() is not null, 'is_researcher() devolveu NULL para uid sem perfil';
  assert app.can_curate('99999999-9999-9999-9999-999999999999') is not null,
    'can_curate() devolveu NULL';
  assert app.can_discard('99999999-9999-9999-9999-999999999999') is not null,
    'can_discard() devolveu NULL';
  assert app.same_research_pool('99999999-9999-9999-9999-999999999999') is not null,
    'same_research_pool() devolveu NULL';
  assert app.is_admin() = false and app.is_clinician() = false,
    'uid sem perfil não deveria ser admin nem clínico';
  assert app.is_researcher() = false, 'uid sem perfil não deveria ser pesquisador';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '9. Tabela nova não nasce acessível ao anon'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
create table public.rls_test_tabela_nova (id int);
do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_name = 'rls_test_tabela_nova';
  assert n = 0, format('tabela nova nasceu com %s grants para o anon', n);
end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '10. anon não alcança as tabelas'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.patients;
    raise exception 'FALHA: anon leu public.patients';
  exception when insufficient_privilege then
    null;  -- o revoke do §6 da migration
  end;
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '11. Pesquisadores compartilham o acervo: P2 enxerga o paciente de P1'
-- ─────────────────────────────────────────────────────────────────────────────
-- A partir daqui entra o pool. Estes cenários rodam DEPOIS do 10 de propósito: o
-- cenário 5 conta quantos pacientes RLS-TEST o admin enxerga, e um paciente de
-- pesquisador criado antes dele mudaria essa conta.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}', true);

insert into public.patients (id, full_name, birth_date)
values ('11111111-eeee-0000-0000-000000000005', 'RLS-TEST paciente de P1', '1970-01-01');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients
   where id = '11111111-eeee-0000-0000-000000000005';
  assert n = 1, 'P2 deveria enxergar o paciente de P1';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '12. P2 EDITA o paciente de P1, sem tomar a posse e assinando a edição'
-- ─────────────────────────────────────────────────────────────────────────────
-- As três asserções são a mudança inteira desta migration em uma tela:
-- editar pode, o dono não muda, e fica registrado quem editou.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$
declare dono uuid; editor uuid;
begin
  update public.patients set phone = '(21) 90000-0000'
   where id = '11111111-eeee-0000-0000-000000000005';
  assert found, 'FALHA: P2 não conseguiu editar o paciente do par';

  select owner_id, updated_by into dono, editor from public.patients
   where id = '11111111-eeee-0000-0000-000000000005';
  assert dono = 'eeeeeeee-0000-0000-0000-000000000005',
    format('a edição do par mudou o dono para %s', dono);
  assert editor = 'ffffffff-0000-0000-0000-000000000006',
    format('updated_by deveria ser P2, veio %s', editor);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '13. P2 não toma a posse do paciente de P1'
-- ─────────────────────────────────────────────────────────────────────────────
-- Sem `patients_freeze_owner`, este UPDATE passaria: `can_curate` deixa P2 escrever
-- na linha, e o WITH CHECK ficaria satisfeito com o novo dono sendo ele mesmo. E
-- como dono, P2 ganharia o direito de apagar que o cenário 14 lhe nega.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$
declare dono uuid;
begin
  update public.patients set owner_id = 'ffffffff-0000-0000-0000-000000000006'
   where id = '11111111-eeee-0000-0000-000000000005';

  select owner_id into dono from public.patients
   where id = '11111111-eeee-0000-0000-000000000005';
  assert dono = 'eeeeeeee-0000-0000-0000-000000000005',
    format('FALHA: P2 tomou a posse do paciente de P1, dono agora é %s', dono);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '14. P2 NÃO apaga o paciente de P1'
-- ─────────────────────────────────────────────────────────────────────────────
-- A metade "não apaga" da decisão de produto. O par edita coleta alheia porque o
-- acervo é comum; destruí-la continua sendo só do dono (e do admin).
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$
declare n int;
begin
  delete from public.patients where id = '11111111-eeee-0000-0000-000000000005';
  select count(*) into n from public.patients
   where id = '11111111-eeee-0000-0000-000000000005';
  assert n = 1, 'FALHA: P2 apagou o paciente do par';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '15. P2 registra consulta no paciente de P1, e a autoria fica com P2'
-- ─────────────────────────────────────────────────────────────────────────────
-- `owner_id` da consulta é de P1 (o trigger copia do paciente) e `created_by` é de
-- P2. É a divergência que devolveu a coluna de autoria ao schema: sem ela, este
-- registro pareceria escrito por P1.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
insert into public.encounters (id, patient_id, reason)
values ('22222222-ffff-0000-0000-000000000006',
        '11111111-eeee-0000-0000-000000000005', 'RLS-TEST consulta de P2');

do $$
declare dono uuid; autor uuid; n int;
begin
  select owner_id, created_by into dono, autor from public.encounters
   where id = '22222222-ffff-0000-0000-000000000006';
  assert dono = 'eeeeeeee-0000-0000-0000-000000000005',
    format('a consulta deveria pertencer ao dono do paciente, veio %s', dono);
  assert autor = 'ffffffff-0000-0000-0000-000000000006',
    format('created_by deveria ser P2, veio %s', autor);

  -- E apagar continua fora do alcance do par, aqui também.
  delete from public.encounters where id = '22222222-ffff-0000-0000-000000000006';
  select count(*) into n from public.encounters
   where id = '22222222-ffff-0000-0000-000000000006';
  assert n = 1, 'FALHA: P2 apagou a consulta do par';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '16. O pool não vaza para fora: médico e pesquisador seguem separados'
-- ─────────────────────────────────────────────────────────────────────────────
-- `same_research_pool` exige que os DOIS lados sejam pesquisadores. É o que garante
-- que promover alguém a pesquisador não mexe em quem já usava a plataforma.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients where full_name = 'RLS-TEST paciente de A';
  assert n = 0, 'FALHA: pesquisador enxergou o paciente de um médico';
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients where full_name = 'RLS-TEST paciente de P1';
  assert n = 0, 'FALHA: médico enxergou o paciente de um pesquisador';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '17. O admin continua sem editar, agora também no acervo de pesquisa'
-- ─────────────────────────────────────────────────────────────────────────────
-- `can_curate` não inclui o admin, e é por isso que ela existe separada de
-- `can_access`. Ele lê o acervo do pool e não assina dentro dele.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients
   where id = '11111111-eeee-0000-0000-000000000005';
  assert n = 1, 'admin deveria LER o paciente do pool';

  update public.patients set full_name = 'RLS-TEST renomeado pelo admin'
   where id = '11111111-eeee-0000-0000-000000000005';
  assert not found, 'FALHA: admin editou o cadastro de um paciente do pool';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '18. O nome do par aparece; o do próprio chamador, não'
-- ─────────────────────────────────────────────────────────────────────────────
-- É o que a tela usa para dizer "paciente de outra pessoa". Preenchido nas próprias
-- linhas, o rótulo repetiria o nome do chamador em toda a lista e não diria nada.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$
begin
  assert app.user_display_name('eeeeeeee-0000-0000-0000-000000000005') = 'Pesquisadora P1',
    'P2 deveria enxergar o nome de P1';
  assert app.user_display_name('ffffffff-0000-0000-0000-000000000006') is null,
    'o próprio nome não deveria vir preenchido';
  assert app.user_display_name('aaaaaaaa-0000-0000-0000-000000000001') is null,
    'FALHA: pesquisador leu o nome de um médico fora do pool';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '19. Leitor não entra no pool'
-- ─────────────────────────────────────────────────────────────────────────────
-- Uma conta rebaixada a 'user' perde o acervo compartilhado junto com a escrita: o
-- pool é do papel, não de um vínculo gravado em algum lugar.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patients where full_name like 'RLS-TEST paciente de P1';
  assert n = 0, 'FALHA: leitor enxergou o acervo do pool';
  assert app.is_researcher() = false, 'leitor não é pesquisador';
  assert app.can_curate('eeeeeeee-0000-0000-0000-000000000005') = false,
    'leitor não deveria poder escrever no acervo do pool';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '20. O catálogo de articulações é legível por qualquer autenticado'
-- ─────────────────────────────────────────────────────────────────────────────
-- `public.joints` é dado de referência, não prontuário: as 28 linhas são as mesmas para
-- todo mundo. É a primeira tabela do schema sem `owner_id`, então o que se prova aqui é
-- o oposto do resto deste arquivo — que ela NÃO é recortada por tenant.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.joints;
  assert n = 28, format('o leitor deveria ver as 28 articulações, viu %s', n);
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.joints;
  assert n = 28, format('o pesquisador deveria ver as 28 articulações, viu %s', n);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '21. Ninguém escreve no catálogo pela aplicação, e o anon não o alcança'
-- ─────────────────────────────────────────────────────────────────────────────
-- Mudar o catálogo é migration, não clique. Se um id pudesse sumir por uma requisição,
-- levaria junto a chave estrangeira do dado clínico que o referencia.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
begin
  begin
    insert into public.joints (id, label, side, joint_group)
    values ('RLS_TEST_JOINT', 'Inventada', 'right', 'elbow');
    raise exception 'FALHA: admin inseriu no catálogo de articulações';
  exception when insufficient_privilege then
    null;  -- o revoke, antes mesmo da policy
  end;

  begin
    delete from public.joints where id = 'RIGHT_MCP_3';
    raise exception 'FALHA: admin apagou uma articulação do catálogo';
  exception when insufficient_privilege then
    null;
  end;
end $$;
commit;

begin;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.joints;
    raise exception 'FALHA: anon leu o catálogo de articulações';
  exception when insufficient_privilege then
    null;
  end;
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '22. A avaliação articular herda o isolamento da consulta'
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabela nova, mesma prova de sempre: o dado clínico detalhado não pode vazar por ser
-- filho. A posse desce da consulta pelo trigger, e as policies leem `owner_id`.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.encounter_joint_evaluations (encounter_id, joint_id, pain, swelling)
values ('22222222-aaaa-0000-0000-000000000001', 'RIGHT_MCP_3', true, true),
       ('22222222-aaaa-0000-0000-000000000001', 'LEFT_KNEE',   false, false);

do $$
declare dono uuid;
begin
  select owner_id into dono from public.encounter_joint_evaluations
   where encounter_id = '22222222-aaaa-0000-0000-000000000001' and joint_id = 'RIGHT_MCP_3';
  assert dono = 'aaaaaaaa-0000-0000-0000-000000000001',
    format('a posse deveria ter descido da consulta, veio %s', dono);
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.encounter_joint_evaluations;
  assert n = 0, format('B deveria ver 0 avaliações de A, viu %s', n);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '23. O catálogo recusa articulação que não existe'
-- ─────────────────────────────────────────────────────────────────────────────
-- A razão de o catálogo existir. `RIGHT_MCP_9` tem a forma de um id válido e passaria
-- pelo regex da borda; o que ele não tem é linha em `public.joints`.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
begin
  begin
    insert into public.encounter_joint_evaluations (encounter_id, joint_id, pain, swelling)
    values ('22222222-aaaa-0000-0000-000000000001', 'RIGHT_MCP_9', true, true);
    raise exception 'FALHA: gravou articulação fora do catálogo';
  exception when foreign_key_violation then
    null;  -- esperado
  end;
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '24. O par de pesquisa escreve avaliação no acervo, e não a apaga'
-- ─────────────────────────────────────────────────────────────────────────────
-- As mesmas quatro regras da consulta valem no detalhe dela: escrever é do dono e do
-- par, apagar é do dono e do admin.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$
declare n int;
begin
  insert into public.encounter_joint_evaluations (encounter_id, joint_id, pain, swelling)
  values ('22222222-ffff-0000-0000-000000000006', 'RIGHT_WRIST', true, false);

  select count(*) into n from public.encounter_joint_evaluations
   where encounter_id = '22222222-ffff-0000-0000-000000000006';
  assert n = 1, 'o par deveria conseguir gravar avaliação no acervo';

  delete from public.encounter_joint_evaluations
   where encounter_id = '22222222-ffff-0000-0000-000000000006';
  select count(*) into n from public.encounter_joint_evaluations
   where encounter_id = '22222222-ffff-0000-0000-000000000006';
  assert n = 1, 'FALHA: o par apagou avaliação do acervo';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '25. O escore herda o isolamento, e a forma de cada índice é cobrada'
-- ─────────────────────────────────────────────────────────────────────────────
-- `escore_completo` é o que torna as colunas nulas intencionais: cada linha preenche
-- exatamente as do seu índice. Sem ela, ninguém saberia se um campo vazio significa
-- "não se aplica" ou "esqueceram".
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.encounter_scores
  (encounter_id, index_type, score, level, tender_count, swollen_count,
   patient_global, evaluator_global)
values ('22222222-aaaa-0000-0000-000000000001', 'cdai', 12.5, 'moderate', 2, 1, 5, 4.5);

do $$
declare dono uuid;
begin
  select owner_id into dono from public.encounter_scores
   where encounter_id = '22222222-aaaa-0000-0000-000000000001';
  assert dono = 'aaaaaaaa-0000-0000-0000-000000000001',
    format('a posse deveria ter descido da consulta, veio %s', dono);

  -- CDAI com campo de DAS28: recusado.
  begin
    insert into public.encounter_scores
      (encounter_id, index_type, score, level, tender_count, swollen_count,
       patient_global, evaluator_global, acute_phase)
    values ('22222222-aaaa-0000-0000-000000000001', 'das28', 4.2, 'moderate', 2, 1,
            5, 4.5, 'esr');
    raise exception 'FALHA: gravou escore misturando os dois índices';
  exception when check_violation then
    null;  -- escore_completo
  end;

  -- DAS28 sem o reagente de fase aguda: recusado.
  begin
    insert into public.encounter_scores
      (encounter_id, index_type, score, level, tender_count, swollen_count,
       patient_global_health)
    values ('22222222-aaaa-0000-0000-000000000001', 'das28', 4.2, 'moderate', 2, 1, 40);
    raise exception 'FALHA: gravou DAS28 sem reagente de fase aguda';
  exception when check_violation then
    null;
  end;

  -- DAS28 acima do teto do índice (10): recusado. O CDAI vai a 76, e é por isso que a
  -- faixa é por tipo, e não uma só para a coluna.
  begin
    insert into public.encounter_scores
      (encounter_id, index_type, score, level, tender_count, swollen_count,
       acute_phase, acute_value, patient_global_health)
    values ('22222222-aaaa-0000-0000-000000000001', 'das28', 40, 'high', 2, 1,
            'esr', 25, 40);
    raise exception 'FALHA: gravou DAS28 fora da faixa do índice';
  exception when check_violation then
    null;
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.encounter_scores;
  assert n = 0, format('B deveria ver 0 escores de A, viu %s', n);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '26. A medição da ROI herda o isolamento, e usa o mesmo catálogo da avaliação'
-- ─────────────────────────────────────────────────────────────────────────────
-- É a razão da normalização inteira: a temperatura e o achado clínico passam a apontar
-- para a MESMA linha de `public.joints`, e por isso podem ser cruzados.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.analysis_captures (id, encounter_id, capture_index)
values ('33333333-aaaa-0000-0000-000000000001',
        '22222222-aaaa-0000-0000-000000000001', 0);

insert into public.capture_measurements (capture_id, joint_id, t_mean, area, sample_count)
values ('33333333-aaaa-0000-0000-000000000001', 'RIGHT_MCP_3', 34.8, 1438, 1400);

do $$
declare dono uuid; n int;
begin
  select owner_id into dono from public.capture_measurements
   where capture_id = '33333333-aaaa-0000-0000-000000000001';
  assert dono = 'aaaaaaaa-0000-0000-0000-000000000001',
    format('a posse deveria ter descido da captura, veio %s', dono);

  -- O cruzamento: a mesma articulação medida e avaliada, numa consulta só.
  select count(*) into n
    from public.capture_measurements m
    join public.analysis_captures c on c.id = m.capture_id
    join public.encounter_joint_evaluations a
      on a.encounter_id = c.encounter_id and a.joint_id = m.joint_id
   where a.swelling;
  assert n = 1,
    format('a medição deveria cruzar com o achado da mesma articulação, cruzou %s', n);

  -- Articulação fora do catálogo: recusada aqui também.
  begin
    insert into public.capture_measurements (capture_id, joint_id, t_mean)
    values ('33333333-aaaa-0000-0000-000000000001', 'RIGHT_MCP_9', 34.8);
    raise exception 'FALHA: gravou medição de articulação fora do catálogo';
  exception when foreign_key_violation then
    null;
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.capture_measurements;
  assert n = 0, format('B deveria ver 0 medições de A, viu %s', n);
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo '27. Diagnóstico é relação com catálogo, e grupo de estudo não é diagnóstico'
-- ─────────────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.patient_diagnoses (patient_id, diagnosis_code, is_primary)
values ('11111111-aaaa-0000-0000-000000000001', 'M05', true),
       ('11111111-aaaa-0000-0000-000000000001', 'M79.7', false);

do $$
declare dono uuid;
begin
  select owner_id into dono from public.patient_diagnoses
   where patient_id = '11111111-aaaa-0000-0000-000000000001' and diagnosis_code = 'M05';
  assert dono = 'aaaaaaaa-0000-0000-0000-000000000001',
    format('a posse deveria ter descido do paciente, veio %s', dono);

  -- Código fora do catálogo: 'AR' é abreviação, não CID.
  begin
    insert into public.patient_diagnoses (patient_id, diagnosis_code)
    values ('11111111-aaaa-0000-0000-000000000001', 'AR');
    raise exception 'FALHA: gravou diagnóstico fora do catálogo';
  exception when foreign_key_violation then
    null;
  end;

  -- Dois principais: "principal" só significa algo se houver no máximo um.
  begin
    insert into public.patient_diagnoses (patient_id, diagnosis_code, is_primary)
    values ('11111111-aaaa-0000-0000-000000000001', 'M32', true);
    raise exception 'FALHA: gravou dois diagnósticos principais';
  exception when unique_violation then
    null;
  end;
end $$;

-- Grupo de estudo é coluna do paciente, e independe do diagnóstico: um controle com
-- achado incidental continua sendo controle.
update public.patients set study_group = 'controle'
 where id = '11111111-aaaa-0000-0000-000000000001';

do $$
declare grupo text; n int;
begin
  select study_group into grupo from public.patients
   where id = '11111111-aaaa-0000-0000-000000000001';
  assert grupo = 'controle', format('o grupo deveria ser controle, veio %s', grupo);

  select count(*) into n from public.patient_diagnoses
   where patient_id = '11111111-aaaa-0000-0000-000000000001';
  assert n = 2, format('o controle deveria manter os 2 diagnósticos, tem %s', n);

  -- E o catálogo não aceita valor inventado de grupo.
  begin
    update public.patients set study_group = 'talvez'
     where id = '11111111-aaaa-0000-0000-000000000001';
    raise exception 'FALHA: gravou grupo de estudo inválido';
  exception when check_violation then
    null;
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.patient_diagnoses;
  assert n = 0, format('B deveria ver 0 diagnósticos de A, viu %s', n);

  select count(*) into n from public.diagnoses;
  assert n >= 17, 'o catálogo de diagnósticos é de todos';
end $$;
commit;

-- ─────────────────────────────────────────────────────────────────────────────
\echo ''
\echo '28. O avatar é da pasta do dono, e a pasta alheia é intocável'
-- O único bucket do sistema, e a única regra de autorização que vivia fora do
-- repositório até `bucket_de_avatares`. O recorte é a primeira pasta do caminho:
-- sem ele, `bucket_id = 'avatars'` deixaria qualquer autenticado sobrescrever a
-- foto de qualquer outro, porque o bucket é um só.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Na própria pasta, passa.
insert into storage.objects (bucket_id, name, owner)
values ('avatars', 'aaaaaaaa-0000-0000-0000-000000000001/avatar', auth.uid());

do $$
declare n int;
begin
  -- Na pasta de outro, não.
  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', 'bbbbbbbb-0000-0000-0000-000000000002/avatar');
    raise exception 'FALHA: escreveu no avatar de outro usuário';
  exception when insufficient_privilege then
    null;
  end;

  -- E o UPDATE não alcança a pasta alheia, que é o outro meio de sobrescrever:
  -- o `upsert` do SDK cai nele quando o objeto já existe.
  update storage.objects set name = name
   where bucket_id = 'avatars'
     and (storage.foldername(name))[1] <> auth.uid()::text;
  get diagnostics n = row_count;
  assert n = 0, format('FALHA: UPDATE alcançou %s objeto(s) de outro dono', n);
end $$;
rollback;

-- ─────────────────────────────────────────────────────────────────────────────
begin;
delete from public.patients where full_name like 'RLS-TEST%';
commit;

\echo ''
\echo 'rls_isolation: todos os cenários passaram.'
