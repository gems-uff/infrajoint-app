-- Impede dois pacientes iguais no acervo de pesquisa.
--
-- ─── O buraco
-- `patients_sem_duplicado` é por dono: (owner_id, nome normalizado, birth_date). Quando
-- foi criado, dono e tenant eram a mesma coisa, e o índice cobria tudo o que um
-- usuário enxergava. O acervo de pesquisa (`acervo_de_pesquisa`) desfez essa
-- igualdade: dois pesquisadores enxergam e editam o mesmo conjunto de pacientes, mas
-- cada linha continua com o owner_id de quem a criou. O resultado, reproduzido na
-- aplicação:
--
--   P1 cadastra "Maria Silva", 01/01/1980.
--   P2 tenta o mesmo, recebe o aviso de homônimo com o cadastro de P1 na lista,
--   clica "É outra pessoa, cadastrar assim mesmo" e o paciente ENTRA.
--
-- Para o mesmo P2, repetir um paciente dele próprio seria recusado pelo índice. A tela
-- promete as duas coisas igualmente ("ela precisa ter data de nascimento diferente,
-- senão não haveria como distinguir as duas depois"), e no acervo a promessa não era
-- cumprida. Num acervo comum, dois cadastros da mesma pessoa partem o histórico dela
-- ao meio: metade das consultas num, metade no outro.
--
-- `find_by_name` já avisava sobre o homônimo do par. Esta migration faz o banco
-- recusar o que o aviso mostra, e desfaz a decisão registrada ali de que "dois
-- pesquisadores podem mesmo precisar de cadastros próprios do mesmo paciente": no
-- acervo, o cadastro de um já é do outro para editar.
--
-- ─── Por que trigger, e não índice
-- O recorte certo é "os pacientes que quem grava pode editar", `app.can_curate()`. Ele
-- depende do papel do DONO da linha, que mora em public.users, e índice não enxerga
-- outra tabela. A alternativa seria denormalizar o pool numa coluna de patients e
-- mantê-la em dia a cada mudança de papel, que é mais peça móvel do que o problema pede.
--
-- O trigger usa a MESMA função da policy de escrita e do aviso da API, então o que a
-- tela avisa, o que a policy deixa editar e o que o banco recusa são o mesmo recorte.
-- Para um médico, `can_curate` de outro dono é sempre falso, e o trigger nunca acha
-- nada: entre médicos a unicidade continua por dono, pelo motivo de sempre (global,
-- ela vazaria existência através da RLS). Dentro do pool não há o que vazar, porque o
-- par já enxerga o paciente que o recusou.
--
-- Roda com os direitos de quem chama, e não SECURITY DEFINER, de propósito: a busca
-- passa pela RLS de patients e só pode encontrar linha que o chamador já lê.
--
-- ─── O que ele deixa de fora
-- Linhas do mesmo dono: o índice por dono já cuida delas, com a mensagem dele.
--
-- UPDATE que não muda nome normalizado nem nascimento: a tela de edição manda o
-- formulário inteiro, e sem esta saída um par duplicado anterior a esta regra (ver
-- abaixo) bloquearia até a troca de telefone dos dois pacientes.
--
-- Promoção a pesquisador: papel só muda por SQL, e quem entra no pool pode trazer um
-- paciente igual a um que já está lá. O trigger não impede a promoção nem mexe nessas
-- linhas; ele só recusa a PRÓXIMA gravação que criar uma duplicata. Quem promove
-- alguém confere antes, com a consulta da guarda abaixo.
--
-- ─── Corrida
-- Duas inserções simultâneas não veem uma à outra antes do commit, e as duas
-- passariam pela checagem. O índice se protege disso sozinho; o trigger precisa do
-- lock. Ele é por (nome normalizado, nascimento), então só espera quem está gravando a
-- mesma pessoa, e é de transação, então se solta no commit. A checagem logo depois
-- enxerga a linha que a outra transação acabou de gravar porque, em READ COMMITTED
-- (o padrão, e o que a API usa), cada comando de uma função VOLATILE tira um snapshot
-- novo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Guarda: falhar alto se o pool já tiver duplicata gravada
--
-- O trigger não olha para trás, e deixar passar em silêncio a duplicata que motivou
-- esta migration seria entregar um banco que já viola a regra no dia em que ela nasce.
-- Mesma forma da guarda de `patients_sem_duplicado`: os nomes como foram digitados, e
-- de quem é cada um, porque é pela aplicação que um deles tem de ser apagado.
do $$
declare
  grupos text;
begin
  select string_agg(descricao, '; ') into grupos from (
    select format('%s (%s)',
                  string_agg(format('%s de %s', quote_literal(p.full_name),
                                    coalesce(u.full_name, u.id::text)), ' = '),
                  p.birth_date) as descricao
      from public.patients p
      join public.users u on u.id = p.owner_id
     where u.role = 'pesquisador'::public.user_role
     group by app.normalized_name(p.full_name), p.birth_date
    having count(distinct p.owner_id) > 1
  ) d;
  if grupos is not null then
    raise exception
      'abortado: pacientes duplicados no acervo de pesquisa: %. Apague um de cada '
      'grupo pela aplicação (o SQL direto deixa as imagens órfãs no R2), com a conta '
      'de quem o cadastrou, e rode esta migration de novo', grupos;
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O trigger
create or replace function app.reject_pool_duplicate()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and app.normalized_name(new.full_name) = app.normalized_name(old.full_name)
     and new.birth_date = old.birth_date then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('patients_sem_duplicado_no_acervo'),
    hashtext(app.normalized_name(new.full_name) || '|' || new.birth_date::text));

  if exists (
    select 1
      from public.patients p
     where p.owner_id <> new.owner_id
       and app.can_curate(p.owner_id)
       and app.normalized_name(p.full_name) = app.normalized_name(new.full_name)
       and p.birth_date = new.birth_date
  ) then
    -- 23505 com o nome da regra em CONSTRAINT: para a API, é a mesma violação de
    -- unicidade que o índice levantaria, e ela a traduz pelo nome, como faz com ele.
    raise exception 'já existe um paciente com este nome e esta data de nascimento no acervo'
      using errcode = 'unique_violation',
            constraint = 'patients_sem_duplicado_no_acervo';
  end if;

  return new;
end
$$;

-- `before`: o INSERT precisa do owner_id que `app.own_row()` define, e os triggers
-- BEFORE do mesmo evento rodam em ordem alfabética. "patients_own_row" <
-- "patients_sem_duplicado_no_acervo", então quando este roda o dono já está certo. No
-- UPDATE, `patients_freeze_owner` também vem antes, pelo mesmo motivo.
create trigger patients_sem_duplicado_no_acervo
  before insert or update of full_name, birth_date on public.patients
  for each row execute function app.reject_pool_duplicate();
