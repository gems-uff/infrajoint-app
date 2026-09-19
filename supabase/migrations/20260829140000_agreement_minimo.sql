-- Reduz o jsonb `agreement` a três campos: `normalized`, `opticalArea`, `thermalArea`.
--
-- ─── A redução é sem perda, e esta é a conta que prova
-- Os três que saem são rearranjos dos que ficam:
--
--     ceiling      = 2·min(A,B) / (A+B)
--     dice         = normalized × ceiling
--     intersection = normalized × min(A,B)
--
-- Não é aproximação. `alignment-quality.spec.ts` refaz as duas primeiras a partir
-- dos campos guardados e afirma sobre o resultado, então se alguma fórmula estiver
-- errada é o teste que quebra, não uma análise seis meses depois.
--
-- ─── Por que estes três, e não só `normalized`
-- `normalized` é o indicador, o único que a tela mostra. As duas áreas ficam porque
-- são a única coisa aqui que **nenhuma fórmula traz de volta**, e sem elas o
-- indicador é ambíguo: ele significa "fração da silhueta óptica sobre células
-- quentes" quando A ≤ B, e "fração da máscara quente coberta" quando B < A. Nas sete
-- capturas de referência a térmica era a menor em quatro — ou seja, o mesmo 0,95
-- quer dizer coisas diferentes em capturas diferentes da mesma base. Qual lado
-- limitou o teto é irrecuperável depois que as áreas somem, e é por ele que uma
-- análise agrupada tem que estratificar.
--
-- ─── `version` sai, com uma condição anotada
-- Ele carimbava qual definição da métrica produziu o número, para que capturas de
-- definições diferentes nunca fossem juntadas por acidente (a v1 mandava a máscara
-- óptica crua; a v2 a trata contra ruído, o que vale até ~1,2 ponto onde a óptica é
-- a menor das duas).
--
-- Sai porque o sistema é pré-lançamento e toda linha é dado de teste: um carimbo
-- uniforme não informa nada, e `created_at` mais o histórico do git reconstroem o
-- mesmo corte enquanto for assim.
--
-- **A condição, que é o que esta migration existe para deixar escrito:** no dia em
-- que `alignment-quality.ts` mudar JÁ HAVENDO captura de paciente real gravada,
-- decida como marcar a fronteira antes de subir — reintroduzindo o carimbo, ou
-- registrando a data de corte. Depois do deploy não há como olhar um `0,87` e saber
-- de qual definição ele veio.
--
-- ─── Custo de processamento: nenhum
-- As três grandezas continuam sendo calculadas, porque não se chega ao indicador sem
-- elas. O que muda é só o que é devolvido e gravado. Medir o alinhamento custa ~247 ms
-- por captura (matriz 640x480 sobre foto 1280x960), e é por isso que este jsonb é
-- persistido em vez de recalculado na leitura: numa sequência de 21 seriam ~5 s de
-- tela travada a cada reabertura, além de o número passar a mudar sozinho quando a
-- segmentação melhorasse.

-- `jsonb_exists_any` em vez do operador `?|`: é a mesma coisa, sem o caractere `?`,
-- que parte dos drivers trata como placeholder de parâmetro. O WHERE existe só para
-- não reescrever linha que já está no formato novo.
update public.analysis_captures
   set agreement = agreement - array['dice', 'ceiling', 'intersection', 'version']
 where agreement is not null
   and jsonb_exists_any(agreement, array['dice', 'ceiling', 'intersection', 'version']);

comment on column public.analysis_captures.agreement is
  'Concordância das silhuetas sob a afim gravada: {normalized, opticalArea, thermalArea}. '
  'normalized = I/min(A,B), "quanto da sobreposição possível foi atingida" — é o que a tela '
  'mostra. As áreas dizem qual máscara limitou o teto, do que depende o significado do '
  'indicador. ceiling, dice e intersection não são guardados por serem deriváveis destes três.';
