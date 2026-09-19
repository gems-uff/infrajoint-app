-- O acervo de pesquisa: pesquisadores compartilham pacientes entre si.
--
-- ─── O que muda
-- Até aqui a plataforma tinha um tenant por médico, e a única exceção era o admin,
-- que lê tudo. `pesquisador` é a primeira forma de posse COMPARTILHADA: dois
-- pesquisadores enxergam e editam o mesmo acervo, como se fossem um só tenant.
--
-- A `app.can_access()` sempre disse que era este o ponto de mudança da estratégia de
-- tenancy ("migrar de dono é o médico para dono é a organização mexe nesta função e
-- em nada mais"). Isso valia para a LEITURA. Escrita e exclusão divergiram desde
-- `consulta_e_do_dono`, então esta migration separa as três perguntas em três
-- funções, cada uma com uma resposta diferente:
--
--   app.can_access(owner)   ler      = minha  ou admin  ou par de pool
--   app.can_curate(owner)   escrever = minha              ou par de pool
--   app.can_discard(owner)  apagar   = minha  ou admin
--
-- Lidas em coluna, elas são a regra inteira do sistema. As duas ausências são as
-- decisões que esta migration toma:
--
--   · admin NÃO está em can_curate. É a regra que `paciente_e_do_dono` e
--     `consulta_e_do_dono` estabeleceram: ele administra o acervo e não assina no
--     lugar de quem atendeu. Nada aqui a afrouxa.
--   · par de pool NÃO está em can_discard. Foi decisão de produto, e ela inverte a
--     assimetria do admin: o pesquisador edita e não apaga; o admin apaga e não
--     edita. Não é incoerência, são eixos diferentes. Para o admin o risco é
--     falsificar registro alheio, e apagar não falsifica. Para o par o risco é
--     destruir coleta alheia, e editar em acervo compartilhado é justamente o que
--     ele foi convidado a fazer.
--
-- ─── O que NÃO muda
-- O médico. `same_research_pool` exige que os DOIS lados sejam pesquisadores, então
-- paciente cadastrado por um médico continua invisível para o pesquisador, e
-- vice-versa. Quem já tem conta não perde nem ganha nada com esta migration.
--
-- ─── Consequência a assumir
-- Promover alguém a `pesquisador` deixa de ser ajuste de tela e passa a ser decisão
-- de privacidade: no instante do UPDATE, essa pessoa alcança o acervo inteiro do
-- pool, com nome, telefone e diagnóstico dos pacientes de todos os outros. Não há
-- passo intermediário e não há convite por estudo. A política de privacidade foi
-- atualizada junto com esta migration porque ela prometia o contrário.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quem é pesquisador, e quem é par de quem
-- ─────────────────────────────────────────────────────────────────────────────

-- Total por construção, como as demais: NULL dentro de policy nega, mas `not
-- is_researcher()` também daria NULL, e nunca true.
create or replace function app.is_researcher()
  returns boolean
  language sql
  stable
as $$
  select coalesce(app.current_app_role() = 'pesquisador'::public.user_role, false)
$$;

-- O pool: quem consulta é pesquisador E o dono da linha também é.
--
-- SECURITY DEFINER é obrigatório aqui, e pelo mesmo motivo de
-- `app.owner_display_name()`: a RLS de public.users tem uma única policy de leitura
-- (`auth.uid() = id`), então ninguém enxerga o role de outra pessoa. Sem atravessar
-- essa policy, a pergunta "o dono desta linha é pesquisador?" seria sempre NULL.
--
-- O que ela expõe é UM booleano derivado do role alheio, e só para quem já é
-- pesquisador — não abre o role de terceiros para leitura.
--
-- search_path fixo e vazio com tudo qualificado, pelo motivo de sempre: sem isso um
-- search_path do chamador poderia resolver `users` para outra tabela, e a função
-- rodaria com os privilégios do dono.
create or replace function app.same_research_pool(owner uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(
    app.is_researcher()
    and (select u.role from public.users u where u.id = owner)
        = 'pesquisador'::public.user_role,
    false)
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. As três perguntas
-- ─────────────────────────────────────────────────────────────────────────────

-- Ler. Mantém o nome porque é o que todas as policies `_read` já chamam.
create or replace function app.can_access(owner uuid)
  returns boolean
  language sql
  stable
as $$
  select coalesce(
    owner = auth.uid() or app.is_admin() or app.same_research_pool(owner),
    false)
$$;

-- Escrever no que já existe, e criar sob linha alheia do pool.
create or replace function app.can_curate(owner uuid)
  returns boolean
  language sql
  stable
as $$
  select coalesce(owner = auth.uid() or app.same_research_pool(owner), false)
$$;

-- Apagar. Deliberadamente sem o par de pool.
create or replace function app.can_discard(owner uuid)
  returns boolean
  language sql
  stable
as $$
  select coalesce(owner = auth.uid() or app.is_admin(), false)
$$;

-- `is_clinician` é o portão de "pode escrever dado clínico", e o pesquisador pode.
-- O nome fica: renomear obrigaria a reescrever oito policies e o espelho na API para
-- ganhar só um sinônimo melhor.
create or replace function app.is_clinician()
  returns boolean
  language sql
  stable
as $$
  select coalesce(
    app.current_app_role() in (
      'medico'::public.user_role,
      'pesquisador'::public.user_role,
      'admin'::public.user_role),
    false)
$$;

grant execute on function app.is_researcher() to authenticated;
grant execute on function app.same_research_pool(uuid) to authenticated;
grant execute on function app.can_curate(uuid) to authenticated;
grant execute on function app.can_discard(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Policies
--
-- As `_read` não aparecem aqui: continuam chamando `app.can_access()`, que acabou de
-- passar a incluir o pool. Era esse o desenho.
--
-- `encounters` e `analysis_captures` chegaram nesta migration com uma policy única
-- `for all`, que fazia DELETE consultar só o USING. Com apagar e editar deixando de
-- ter a mesma resposta, elas se separam em três, como `patients` já estava.
-- ─────────────────────────────────────────────────────────────────────────────

-- Paciente ────────────────────────────────────────────────────────────────────
drop policy patients_update on public.patients;
create policy patients_update on public.patients
  for update
  using      (app.can_curate(owner_id) and app.is_clinician())
  with check (app.can_curate(owner_id) and app.is_clinician());

drop policy patients_delete on public.patients;
create policy patients_delete on public.patients
  for delete
  using (app.can_discard(owner_id) and app.is_clinician());

-- Consulta ────────────────────────────────────────────────────────────────────
drop policy encounters_write on public.encounters;

-- O INSERT não cita auth.uid(): `app.inherit_owner()` copia o owner do paciente, de
-- modo que a consulta que um pesquisador registra no paciente de um par nasce com o
-- owner do par. É o que queremos, e é por isso que a autoria passa a ser gravada em
-- `created_by` na seção 5: com o pool, owner_id deixou de responder quem atendeu.
create policy encounters_insert on public.encounters
  for insert
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy encounters_update on public.encounters
  for update
  using      (app.can_curate(owner_id) and app.is_clinician())
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy encounters_delete on public.encounters
  for delete
  using (app.can_discard(owner_id) and app.is_clinician());

-- Captura ─────────────────────────────────────────────────────────────────────
drop policy analysis_captures_write on public.analysis_captures;

create policy analysis_captures_insert on public.analysis_captures
  for insert
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy analysis_captures_update on public.analysis_captures
  for update
  using      (app.can_curate(owner_id) and app.is_clinician())
  with check (app.can_curate(owner_id) and app.is_clinician());

create policy analysis_captures_delete on public.analysis_captures
  for delete
  using (app.can_discard(owner_id) and app.is_clinician());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. O dono do paciente congela no UPDATE
--
-- Buraco aberto por esta própria migration, e fechado antes de existir: até aqui
-- `patients_update` exigia `owner_id = auth.uid()` nos dois lados, então ninguém
-- conseguia mexer na coluna. Com `can_curate` no WITH CHECK, um par passaria a poder
-- gravar `owner_id = auth.uid()` numa linha alheia: tomaria o paciente para si e,
-- como dono, ganharia o direito de apagar que esta migration acabou de lhe negar.
--
-- `app.own_row()` não resolve: ele força `owner_id = auth.uid()` e só roda no INSERT.
-- Estendê-lo ao UPDATE transferiria a posse a cada edição de par, que é o mesmo mal
-- pelo caminho oposto. O que se quer é que a coluna não mude, e é o que este trigger
-- faz.
--
-- Consultas e capturas não precisam do equivalente: `app.inherit_owner()` já roda em
-- UPDATE desde `tenant_integrity` e re-deriva o owner do paciente a cada gravação.
create or replace function app.freeze_owner()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.owner_id := old.owner_id;
  return new;
end
$$;

create trigger patients_freeze_owner
  before update on public.patients
  for each row execute function app.freeze_owner();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Autoria
--
-- `drop_created_by` removeu `encounters.created_by` porque, depois de
-- `consulta_e_do_dono`, ela era sempre igual a `owner_id` — coluna que repete outra
-- não é informação. O pool desfaz exatamente essa igualdade: a consulta que o
-- pesquisador B registra no paciente de A nasce com `owner_id` de A. Sem uma coluna
-- de autoria, ninguém saberia que foi B, e `updated_at` mudaria sozinho.
--
-- Duas colunas, cada uma respondendo o que a outra não responde:
--
--   encounters.created_by  quem registrou a consulta (≠ owner_id só no pool)
--   *.updated_by           quem gravou por último
--
-- `patients.created_by` não existe de propósito: paciente nasce por `app.own_row()`,
-- que força `owner_id = auth.uid()`, então quem criou é sempre o dono. Seria a mesma
-- coluna redundante que já foi removida uma vez.
--
-- O que estas colunas NÃO são: trilha de auditoria. Elas guardam o último estado, não
-- o histórico. Reconstruir "quem mudou o quê e quando" exigiria tabela de eventos, e
-- isso está fora do escopo desta mudança.
alter table public.patients
  add column if not exists updated_by uuid references public.users(id);

alter table public.encounters
  add column if not exists created_by uuid references public.users(id),
  add column if not exists updated_by uuid references public.users(id);

-- As consultas que já existem recebem a autoria que sempre tiveram.
--
-- Não é chute: desde `consulta_e_do_dono`, a policy de escrita exige
-- `owner_id = auth.uid()`, então em toda consulta anterior a esta migration o dono É
-- quem a registrou. Foi exatamente por isso que a coluna de autoria pôde ser removida
-- em `drop_created_by`, e é o que torna o backfill uma reconstrução, e não invenção.
--
-- Deixá-las nulas teria consequência visível: o relatório em PDF nomeia o responsável
-- a partir daqui, e sem o backfill ele cairia no nome de quem exportou o arquivo.
-- Numa consulta antiga aberta por um par, isso imprimiria a pessoa errada no
-- cabeçalho de um documento clínico.
--
-- Os triggers saem de cena durante o UPDATE. `encounters_touch_updated_at` marcaria
-- todas as consultas do banco como alteradas agora, e a data de alteração é dado que
-- a tela mostra: preencher uma coluna administrativa não é edição clínica. Como tudo
-- roda numa transação só, e nada mais escreve na tabela enquanto a migration corre,
-- desligá-los aqui não abre janela para gravação sem trigger.
alter table public.encounters disable trigger user;
update public.encounters set created_by = owner_id where created_by is null;
alter table public.encounters enable trigger user;

-- Os dois seguem o padrão de `app.own_row()`: sobrescrevem o que o cliente enviar.
-- O grant de UPDATE em public.encounters é de tabela inteira, então sem o trigger
-- qualquer requisição poderia declarar-se autora de qualquer coisa.
create or replace function app.stamp_created_by()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  return new;
end
$$;

create or replace function app.stamp_updated_by()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end
$$;

create trigger encounters_stamp_created_by
  before insert on public.encounters
  for each row execute function app.stamp_created_by();

create trigger encounters_stamp_updated_by
  before update on public.encounters
  for each row execute function app.stamp_updated_by();

create trigger patients_stamp_updated_by
  before update on public.patients
  for each row execute function app.stamp_updated_by();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Nomes visíveis
--
-- `owner_display_name` existia para o admin saber de quem era cada linha antes de
-- apagá-la. O pesquisador tem a mesma necessidade, com uma diferença: para ele o
-- rótulo não marca o que é proibido, marca o que é compartilhado.
--
-- A regra continua estreita: UMA coluna (o nome), de UMA linha por vez, e só para
-- quem já enxerga o prontuário inteiro daquela pessoa. Não vira diretório de nomes
-- da plataforma — quem não é admin nem par de pool continua recebendo NULL para
-- qualquer uuid que perguntar.
--
-- A cláusula `subject <> auth.uid()` é o que dá ao campo um significado único e
-- acionável, como `owner_display_name_so_alheio` estabeleceu: preenchido = esta
-- linha é de outra pessoa. Preenchê-lo nas próprias linhas repetiria o nome do
-- chamador em toda a lista e apagaria a única informação que o rótulo carrega.
create or replace function app.user_display_name(subject uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select u.full_name
    from public.users u
   where u.id = subject
     and subject <> auth.uid()
     and (app.is_admin() or app.same_research_pool(subject))
$$;

-- Fica como o nome que as leituras de paciente já usam. Delegar mantém uma só
-- implementação da regra, e o nome específico diz, no SQL da consulta, qual coluna
-- está sendo traduzida.
create or replace function app.owner_display_name(owner uuid)
  returns text
  language sql
  stable
as $$
  select app.user_display_name(owner)
$$;

grant execute on function app.user_display_name(uuid) to authenticated;
