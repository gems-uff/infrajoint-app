-- Contas de desenvolvimento LOCAL, com senha, uma por papel.
--
-- Carregado automaticamente pelo `supabase db reset`, depois das migrations. Nunca vai
-- para produção: o `supabase db push` só envia supabase/migrations/.
--
--   medico-a@local.test   SenhaLocal123!   medico
--   medico-b@local.test   SenhaLocal123!   medico   (para provar o isolamento entre médicos)
--   leitor@local.test     SenhaLocal123!   user     (vê a demo, não salva)
--   admin@local.test      SenhaLocal123!   admin
--   pesq-1@local.test     SenhaLocal123!   pesquisador
--   pesq-2@local.test     SenhaLocal123!   pesquisador  (para ver o acervo compartilhado)
--
-- Os dois médicos existem para provar o ISOLAMENTO; os dois pesquisadores, para provar o
-- contrário dele: cadastre um paciente com o pesq-1, entre com o pesq-2 e ele estará lá,
-- editável, sem o botão de excluir.
--
-- A senha é fraca de propósito e está versionada de propósito: estas contas só existem
-- no Postgres do seu Docker, que escuta em 127.0.0.1.

do $$
declare
  conta        record;
  senha_hash   text := crypt('SenhaLocal123!', gen_salt('bf'));
  contas       constant jsonb := '[
    {"id":"11111111-0000-4000-8000-000000000001","email":"medico-a@local.test","nome":"Dra. Alice Medeiros","papel":"medico"},
    {"id":"22222222-0000-4000-8000-000000000002","email":"medico-b@local.test","nome":"Dr. Bruno Tavares","papel":"medico"},
    {"id":"33333333-0000-4000-8000-000000000003","email":"leitor@local.test","nome":"Leitor Demo","papel":"user"},
    {"id":"44444444-0000-4000-8000-000000000004","email":"admin@local.test","nome":"Admin InfraJoint","papel":"admin"},
    {"id":"55555555-0000-4000-8000-000000000005","email":"pesq-1@local.test","nome":"Dra. Clara Pesquisa","papel":"pesquisador"},
    {"id":"66666666-0000-4000-8000-000000000006","email":"pesq-2@local.test","nome":"Dr. Davi Pesquisa","papel":"pesquisador"}
  ]';
begin
  for conta in select * from jsonb_to_recordset(contas)
                 as x(id uuid, email text, nome text, papel text)
  loop
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    )
    values (
      conta.id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', conta.email, senha_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', conta.nome),
      now(), now()
    )
    on conflict (id) do nothing;

    -- As colunas de token são NULL por padrão, mas o GoTrue as lê como string não
    -- anulável em Go. Deixá-las nulas faz o login morrer com um erro que não ajuda:
    -- "Database error querying schema" (o detalhe real só aparece no log do container).
    update auth.users
       set confirmation_token = '', recovery_token = '',
           email_change_token_new = '', email_change = '',
           email_change_token_current = '', reauthentication_token = '',
           phone_change = '', phone_change_token = ''
     where id = conta.id;

    -- Sem a identity o GoTrue não encontra o provedor 'email' e o login falha.
    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    values (
      gen_random_uuid(), conta.id::text, conta.id,
      jsonb_build_object('sub', conta.id::text, 'email', conta.email,
                         'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    )
    on conflict do nothing;

    -- public.users é criado pelo trigger on_auth_user_created; aqui só o papel.
    update public.users set role = conta.papel::public.user_role where id = conta.id;
  end loop;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Dado clínico de desenvolvimento: o acervo de pesquisa montado.
--
-- As contas acima sozinhas não mostram nada: o pool só aparece quando existe
-- prontuário de mais de uma pessoa. Cada linha daqui existe para tornar visível um
-- comportamento da migration `acervo_de_pesquisa`, e não para encher a tela.
--
--   Helena (da Clara), editada pelo Davi  → "Última edição por Dr. Davi Pesquisa"
--   Otávio (da Clara), consulta do Davi   → "Registrada por Dr. Davi Pesquisa", e o
--                                            PDF sai com ele como responsável
--   Marina e Rui (do Davi)                → o que a Clara vê do lado dele
--   Zuleica (da Dra. Alice, médica)       → o que NENHUM pesquisador pode ver
--
-- Tudo entra pela porta da frente: `set local role authenticated` com as claims de
-- cada um, então os triggers de posse e as policies decidem o resultado, exatamente
-- como decidiriam para a aplicação. Se alguma regra estiver errada, o seed falha.
--
-- Re-executável: cada inserção é guardada por `not exists`, porque o índice único de
-- homônimos abortaria a segunda rodada num banco que não foi resetado.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Dra. Clara Pesquisa (pesq-1) cadastra os dois dela
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"55555555-0000-4000-8000-000000000005","role":"authenticated"}', true);

insert into public.patients (full_name, birth_date, sex, phone, study_group)
select novo.* from (values
  ('Helena Duarte Ramos',  '1968-03-12'::date, 'F', '(21) 98811-2200', 'caso'),
  ('Otávio Bertoldo Lima', '1975-11-02'::date, 'M', '(21) 99640-1187', 'caso')
) as novo(full_name, birth_date, sex, phone, study_group)
where not exists (
  select 1 from public.patients p where p.full_name = novo.full_name
);

-- Diagnóstico agora é relação, pelo código da CID-10. Ver `diagnostico_e_grupo`.
insert into public.patient_diagnoses (patient_id, diagnosis_code, is_primary)
select p.id, d.code, true
  from public.patients p
  join (values
    ('Helena Duarte Ramos',  'M06.9'),
    ('Otávio Bertoldo Lima', 'M07')
  ) as d(nome, code) on d.nome = p.full_name
 where not exists (
   select 1 from public.patient_diagnoses pd where pd.patient_id = p.id);

-- A consulta que ela mesma registra: body map e CDAI em atividade moderada
-- (3 dolorosas + 2 edemaciadas + 4 PGA + 3 EGA = 12, faixa 10 a 22).
insert into public.encounters (patient_id, occurred_at, reason)
select p.id, now() - interval '9 days', 'Avaliação inicial da coorte'
  from public.patients p
 where p.full_name = 'Helena Duarte Ramos'
   and not exists (select 1 from public.encounters e where e.patient_id = p.id);

-- CDAI em atividade moderada: 3 dolorosas + 2 edemaciadas + 4 PGA + 3 EGA = 12, faixa
-- de 10 a 22. Escore agora é linha, não documento. Ver `escores_clinicos`.
insert into public.encounter_scores
  (encounter_id, index_type, score, level, tender_count, swollen_count,
   patient_global, evaluator_global)
select e.id, 'cdai', 12, 'moderate', 3, 2, 4, 3
  from public.encounters e
  join public.patients p on p.id = e.patient_id
 where p.full_name = 'Helena Duarte Ramos'
   and not exists (select 1 from public.encounter_scores s where s.encounter_id = e.id);

-- O body map agora é tabela: uma linha por articulação avaliada, e os ids conferidos
-- contra o catálogo. Ver a migration `avaliacao_articular`.
insert into public.encounter_joint_evaluations (encounter_id, joint_id, pain, swelling)
select e.id, achado.joint_id, achado.pain, achado.swelling
  from public.encounters e
  join public.patients p on p.id = e.patient_id,
  (values
    ('RIGHT_WRIST', true,  true),
    ('LEFT_WRIST',  true,  false),
    ('RIGHT_MCP_3', true,  true),
    ('LEFT_KNEE',   false, false)
  ) as achado(joint_id, pain, swelling)
 where p.full_name = 'Helena Duarte Ramos'
   and not exists (
     select 1 from public.encounter_joint_evaluations a where a.encounter_id = e.id);
commit;

-- ── Dr. Davi Pesquisa (pesq-2) cadastra os dele
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"66666666-0000-4000-8000-000000000006","role":"authenticated"}', true);

-- O Rui entra como CONTROLE, e mesmo assim tem um diagnóstico. É o caso que motivou o
-- grupo de estudo a ficar em coluna própria em vez de virar uma linha no catálogo: um
-- controle com achado incidental continua sendo controle.
insert into public.patients (full_name, birth_date, sex, phone, study_group)
select novo.* from (values
  ('Marina Sales Cavalcanti', '1982-07-25'::date, 'F', '(21) 98120-7744', 'caso'),
  ('Rui Andrade Prado',       '1959-01-30'::date, 'M', null,              'controle')
) as novo(full_name, birth_date, sex, phone, study_group)
where not exists (
  select 1 from public.patients p where p.full_name = novo.full_name
);

insert into public.patient_diagnoses (patient_id, diagnosis_code, is_primary)
select p.id, d.code, true
  from public.patients p
  join (values
    ('Marina Sales Cavalcanti', 'M06.9'),
    ('Rui Andrade Prado',       'M18')
  ) as d(nome, code) on d.nome = p.full_name
 where not exists (
   select 1 from public.patient_diagnoses pd where pd.patient_id = p.id);

insert into public.encounters (patient_id, occurred_at, reason)
select p.id, now() - interval '5 days', 'Retorno de 3 meses'
  from public.patients p
 where p.full_name = 'Marina Sales Cavalcanti'
   and not exists (select 1 from public.encounters e where e.patient_id = p.id);

insert into public.encounter_scores
  (encounter_id, index_type, score, level, tender_count, swollen_count,
   acute_phase, acute_value, patient_global_health)
select e.id, 'das28', 3.1, 'low', 2, 1, 'esr', 22, 35
  from public.encounters e
  join public.patients p on p.id = e.patient_id
 where p.full_name = 'Marina Sales Cavalcanti'
   and not exists (select 1 from public.encounter_scores s where s.encounter_id = e.id);

insert into public.encounter_joint_evaluations (encounter_id, joint_id, pain, swelling)
select e.id, achado.joint_id, achado.pain, achado.swelling
  from public.encounters e
  join public.patients p on p.id = e.patient_id,
  (values
    ('LEFT_MCP_2',  true, false),
    ('RIGHT_PIP_3', true, true)
  ) as achado(joint_id, pain, swelling)
 where p.full_name = 'Marina Sales Cavalcanti'
   and not exists (
     select 1 from public.encounter_joint_evaluations a where a.encounter_id = e.id);

-- ── E aqui o caso que só o acervo permite: ele escreve no paciente DELA.
--
-- A consulta nasce com `owner_id` da Clara (o trigger copia do paciente) e
-- `created_by` do Davi. É a divergência que devolveu a coluna de autoria ao schema.
insert into public.encounters (patient_id, occurred_at, reason)
select p.id, now() - interval '2 days', 'Coleta conduzida pelo colega de projeto'
  from public.patients p
 where p.full_name = 'Otávio Bertoldo Lima'
   and not exists (select 1 from public.encounters e where e.patient_id = p.id);

-- ── E edita o cadastro dela, que é o outro lado da mesma regra.
update public.patients
   set phone = '(21) 98811-3399'
 where full_name = 'Helena Duarte Ramos'
   and updated_by is null;
commit;

-- ── Dra. Alice (medico-a), a testemunha: nenhum pesquisador alcança esta linha
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.patients (full_name, birth_date, sex, study_group)
select novo.* from (values
  ('Zuleica Portela Nunes', '1970-05-20'::date, 'F', 'caso')
) as novo(full_name, birth_date, sex, study_group)
where not exists (
  select 1 from public.patients p where p.full_name = novo.full_name
);

insert into public.patient_diagnoses (patient_id, diagnosis_code, is_primary)
select p.id, 'M06.9', true
  from public.patients p
 where p.full_name = 'Zuleica Portela Nunes'
   and not exists (
     select 1 from public.patient_diagnoses pd where pd.patient_id = p.id);
commit;

-- ── O grupo de estudo, para quem já existia
--
-- Os `insert` acima são guardados por `not exists`, então num banco que já tem estes
-- pacientes eles não rodam e a coluna nova ficaria nula. Sem este update, rodar o seed
-- do zero e re-rodá-lo dariam estados diferentes, que é o tipo de divergência que faz
-- alguém depurar a aplicação por causa do ambiente.
begin;
update public.patients p set study_group = g.grupo
  from (values
    ('Helena Duarte Ramos',     'caso'),
    ('Otávio Bertoldo Lima',    'caso'),
    ('Marina Sales Cavalcanti', 'caso'),
    ('Rui Andrade Prado',       'controle'),
    ('Zuleica Portela Nunes',   'caso')
  ) as g(nome, grupo)
 where p.full_name = g.nome and p.study_group is null;
commit;
