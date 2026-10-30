# Analisador de imagens

Ferramenta client-side para sobrepor uma imagem térmica a uma fotografia RGB,
desenhar uma região de interesse (ROI) e ler as temperaturas correspondentes da
matriz térmica da câmera. É a porta para a web dos scripts Python de um colega
de pesquisa (`scripts/manual_roi_verifier.py` + `scripts/core.py`).

- **Rota:** `/analise/analisador-de-imagens`
- **Página:** [`ImageAnalyzerPage`](../pages/image-analyzer-page/image-analyzer-page.ts)
- **Processamento:** 100% no navegador — nenhum dado (imagem, CSV ou temperatura)
  sai da máquina do usuário.

## O que já faz

1. **Carrega três entradas obrigatórias** via arrastar-e-soltar ou seletor de
   arquivo (todas necessárias para iniciar a análise):
   - Imagem **RGB** (fotografia visual).
   - **CSV térmico** exportado pela câmera, com a matriz de temperaturas.
   - **JPEG térmico** renderizado pela câmera.
2. **Sobrepõe** a térmica à RGB com opacidade ajustável (0–100%).
3. **Alinha** as duas imagens automaticamente ao iniciar a análise (nada é
   sobreposto ou medido antes de existir um alinhamento):
   - **Automático (silhuetas)** — roda ao iniciar a análise e pode ser
     re-disparado pelo botão "Alinhar automaticamente". Segmenta as mãos/braços
     nas duas modalidades (pele × fundo azul na RGB; corpo quente × fundo frio
     na térmica, via Otsu) e busca a escala+translação que maximiza a
     sobreposição das silhuetas — milhares de pontos de correspondência
     automáticos, sem depender de marcadores. Se as silhuetas não puderem ser
     segmentadas, o usuário recorre à calibração manual.
   - **Calibração manual** — o usuário clica em ≥3 pares de pontos
     correspondentes e a transformação de similaridade (rotação + escala
     uniforme + translação) é ajustada por mínimos quadrados.
4. **Detecta as 22 articulações do mapa corporal** (botão "Detectar
   articulações"): os landmarks de mão do MediaPipe posicionam Punho, MCP 1–5 e
   IFP 1–5 de cada mão; cada articulação ganha uma ROI em células da matriz
   (punho: elipse 27×17; demais: círculo r=10, como no `core.py`, com tamanho
   ajustável de 50–150%), desenhada sobre a imagem (ciano = esquerda, âmbar =
   direita) e tabulada com mínima, média e máxima por lado. **Células cujo pixel RGB
   correspondente não é pele são excluídas da estatística** — a amostragem é em
   resolução plena da foto (fronteira dedo/fundo nítida) com margem de 2 px
   contra o erro de alinhamento; ROIs maiores que o dedo não misturam fundo
   frio, e como o critério é a cor (não a temperatura), dedos genuinamente
   frios do protocolo de reaquecimento continuam contando. Cada ROI reporta sua
   **cobertura de pele**; abaixo de 35% (dedo fino, ROI quase toda fundo) o
   valor é marcado com ⚠ na tabela como pouco confiável, em vez de fingir
   precisão. As temperaturas recalculam automaticamente se o alinhamento, o
   tamanho ou o modo mudarem.
   As ROIs articulares são **editáveis individualmente** quando um landmark
   fica fora do lugar: clique numa ROI (na imagem ou na tabela) para
   selecioná-la e arraste para movê-la, use a alça do canto para
   redimensioná-la, ou as setas/+/−/Delete pelo teclado (Delete restaura). Um
   *override* por junta (chave `lado:landmarkId`) guarda a posição e/ou o
   tamanho: mover apenas mantém a ROI seguindo o slider global de tamanho,
   redimensionar a fixa. O slider global só afeta as ROIs não ajustadas; cada
   junta tem seu botão de restaurar e há um "Restaurar ROIs" geral. Re-detectar
   ou trocar os arquivos descarta os ajustes.
5. **Desenha várias ROIs manuais** (círculo ou elipse) arrastando a partir do
   centro em qualquer área vazia — quantas forem necessárias. Cada ROI é
   numerada e listada com suas temperaturas. Clicar seleciona uma ROI; ela pode
   ser **reposicionada** (arrastando por dentro ou pela alça central) ou
   **redimensionada** (pela alça de canto). As alças têm **tamanho fixo na
   tela**, então ROIs pequenas continuam fáceis de manipular; com uma ROI
   selecionada, as **setas** a movem (Shift = 10 px), **+/−** redimensionam e
   **Delete** remove.
6. **Calcula** média, mediana, máxima e mínima em °C dentro de cada ROI,
   mapeando-a para a matriz térmica pelo alinhamento ativo. Os pontos de
   calibração manual são armazenados em células CSV, então sobrevivem entre
   alinhamentos.

## Como funciona

A lógica de domínio fica em módulos puros e testados, isolada dos componentes de
UI. Os componentes cuidam apenas de canvas, ponteiro e apresentação.

### Espaços de coordenadas

| Espaço | Resolução típica | Papel |
| --- | --- | --- |
| **RGB** | 1280×960 px | fotografia visual; onde a ROI é desenhada |
| **CSV** | 640×480 células | matriz de temperaturas (°C); onde a ROI é medida |
| **Exibição térmica** | 960×720 (JPEG) | imagem sobreposta na tela |

O JPEG da câmera é um *upsampling* de 1,5× da matriz CSV.

### Módulos ([`image-analyzer/`](.))

- **[`thermal-csv.ts`](thermal-csv.ts)** — parsing do CSV da câmera: encoding
  latin1, 16 linhas de metadados no cabeçalho, células com vírgula decimal e
  aspas (`"23,5"`), corte em 480 linhas e descarte de colunas totalmente
  vazias.
- **[`alignment.ts`](alignment.ts)** — transformações afins RGB → CSV:
  - `estimateSimilarityTransform`: ajuste de similaridade (rotação + escala
    uniforme + translação) por mínimos quadrados — equivalente fechado do
    `estimateAffinePartial2D` do OpenCV, sem RANSAC, usado pela calibração
    manual.
  - Utilitários de inversão, composição e escala de matrizes.
- **[`roi-stats.ts`](roi-stats.ts)** — agregação das temperaturas dentro da ROI:
  recorta o *bounding box* na matriz, aplica máscara circular/elíptica e ignora
  células NaN.
- **[`silhouette-registration.ts`](silhouette-registration.ts)** — alinhamento
  automático por **registro de silhuetas**, o método primário do botão
  "Alinhar automaticamente". Segmenta a pele (não-azul, 2 maiores componentes)
  e o corpo quente (Otsu), decima as máscaras (RGB ÷4, CSV ÷2) e faz busca em
  grade grossa→fina da escala+translação que maximiza a sobreposição — ~150 ms
  para 1280×960. Por usar a silhueta inteira como correspondência, um marcador
  mal detectado não distorce o resultado. Validado no par real V047: recupera
  s=0,5025, e ambos os marcadores caem a ≤2 células das suas impressões térmicas
  sem participarem do ajuste. O `score` da busca tem forma de Dice mas **não é**
  um: seu denominador mistura o conjunto de pontos subamostrado com a máscara
  térmica completa, o que serve para ordenar candidatas dentro de uma captura e
  nunca deve ser exibido — quem avalia o resultado é `alignment-quality.ts`.
- **[`alignment-quality.ts`](alignment-quality.ts)** — **avaliação** do
  alinhamento, separada do ajuste. Sob a transformação **final** (pós-fiduciais e
  polish), monta as duas silhuetas em espaço CSV na resolução plena da matriz —
  a óptica warpada, a térmica por Otsu, ambas com a mesma limpeza de ruído — e
  reporta o Dice de área dividido pelo teto atingível `2·min(A,B)/(A+B)`, que se
  reduz a `I / min(A,B)`. A normalização absorve a diferença sistemática de forma
  entre as modalidades (halo térmico dilata; Otsu descarta dedos frios) e torna o
  valor comparável entre capturas. Ponto cego documentado: quase insensível a
  translação pura (32 px ≈ 5–20 pontos; escala −10% ≈ 20–35), por isso é
  *verificação de consistência das silhuetas*, não garantia de precisão
  geométrica. **Ressalva a manter em qualquer texto sobre o módulo:** o índice
  avalia concordância espacial **global** entre as silhuetas e não é, sozinho,
  medida do erro de localização de cada ponto anatômico nem validação da
  exatidão das temperaturas das ROIs — ele é calculado *por área*, e a
  interseção não registra qual ponto caiu sobre qual. Na interface aparece só
  como `Sobreposição das silhuetas: 95%` no painel, com ícone de informação; a
  normalização ("do máximo possível") é detalhe de modelagem e fica na
  documentação. Persiste três campos — `normalized`, `opticalArea`,
  `thermalArea` — e `ceiling`, `dice` e `intersection` saem deles por conta
  (fórmulas em `SilhouetteAgreement`). As áreas ficam porque são o que nenhuma
  fórmula recupera, e é por elas que se sabe qual máscara limitou o teto, do que
  depende o significado do indicador. O carimbo de versão da métrica saiu
  enquanto o sistema é pré-lançamento: **mudar este arquivo com captura real já
  gravada exige decidir antes como marcar a fronteira**. Fundamentação completa:
  seções 4.9–4.12 de `src/escrita/analisador/texto-inicial.MD`.
- **[`fiducial-markers.ts`](fiducial-markers.ts)** — refinamento pelos quadrados
  de fita azul dos antebraços: mancha azul cercada de pele na RGB + impressão
  fria cercada de corpo quente na CSV (Otsu local numa janela de ±18 células em
  torno da previsão, com cascata de dois limiares). Correspondências
  **interiores**, imunes ao viés de borda do halo térmico. Só aplica com
  exatamente dois pares confirmados e dentro de ±6% de escala / ≤3,4° do coarse.
  A `FiducialCorrection` guardada é a **correção** que os marcadores aplicaram
  (previsão × detecção), decomposta em translação/escala/rotação em torno do
  ponto médio — **não** é resíduo do ajuste: com 2 pares a similaridade é
  exatamente determinada e o resíduo é zero por construção. Ela retém
  `predicted`/`detected`/`offsets` por marcador, e não só o agregado, para que a
  magnitude exibida (`Σ‖dᵢ‖ / n`, a média dos comprimentos) possa ser refeita à
  mão na tooltip do painel. `scaleRatio` e `rotationDeg` são a escala e a rotação
  **da correção** — a similaridade `fitted ∘ coarse⁻¹` — e a magnitude não é a
  soma delas. A magnitude é
  censurada em `MAX_PREDICTION_DIST` = 15 células, logo um alinhamento ruim
  aparece como *ausência* de fiduciais, não como correção grande.
- **[`alignment-polish.ts`](alignment-polish.ts)** — compensação final de
  paralaxe: pareia transições pele↔fundo (RGB) com quente↔frio (CSV) ao longo de
  linhas de varredura e promedia entrada e saída, o que cancela o halo térmico e
  isola o deslocamento real. Altera só a translação, limitada a 6 px por eixo.
- **[`image-ops.ts`](image-ops.ts)** — operações compartilhadas: morfologia
  binária separável, componentes conexos 8-conectados e limiar de Otsu.
- **[`joint-rois.ts`](joint-rois.ts)** — as 22 ROIs articulares do mapa
  corporal (`ROI_IDS` do `core.py`): Punho (elipse 27×17 células), MCP 1–5 e
  IFP 1–5 (círculo r=10) por mão, mapeadas pelo alinhamento ativo e agregadas
  com `roi-stats`.
- **[`hand-landmarks.service.ts`](hand-landmarks.service.ts)** — wrapper do
  HandLandmarker do MediaPipe (`@mediapipe/tasks-vision`), o mesmo modelo do
  `core.py`. O runtime wasm e o modelo (~19 MB) são auto-hospedados em
  `public/mediapipe/` para funcionar offline, com carregamento lazy no primeiro
  uso.

### Sequência temporal (protocolo de reaquecimento)

Além da análise individual, o módulo importa uma **sessão completa do
protocolo** (pasta tipo `V051/`): 1 baseline (`Est`, t₀ = 0) + ~20 capturas
dinâmicas (`Din01…`) em intervalo fixo (padrão 15 s, editável na conferência).

- **[`sequence.model.ts`](sequence.model.ts)** — tipos da sequência
  (`ReviewCapture`, `SequenceReview`, `SequenceCapture`) e helpers de rótulo/
  tempo.
- **[`sequence-files.ts`](sequence-files.ts)** — agrupamento do lote pelo nome
  dos arquivos (`{Sujeito}_{Trial}_{Est|DinNN}[_DAR|_IR].{jpeg|csv}`);
  originais da câmera (sem sufixo) e planilhas clínicas são ignorados e apenas
  contados. Também reconhece a **nomenclatura antiga** (`V014/`), que insere
  entre o trial e a fase um token da superfície de apoio — `E` (EVA azul),
  `EP` (EVA + papel), `M` (madeira): `V014_T1_E_Din01_IR.jpeg`. Ela é
  **normalizada para o protocolo atual** na importação: mantém-se só a `E`,
  que é a superfície adotada no protocolo novo (as aquisições `EP`/`M` são
  ensaios de superfície, só com baseline), e descarta-se a `Din00`, que é o
  mesmo instante da `Est`. O que sobra é uma sessão idêntica à atual (`Est` +
  `Din01…`), então `V014` é conferido e processado como `V014_T1` e nenhum
  conceito legado vaza para o resto do pipeline. Os descartes vão para
  `ignoredLegacy` e aparecem na conferência.
- **[`sequence.service.ts`](sequence.service.ts)** — store (signals) + pipeline
  de pré-processamento por captura: alinhamento (silhueta → fiduciais →
  polish), landmarks, **máscara de pele em espaço CSV** e miniatura térmica.
  Só os artefatos leves ficam em memória (~2,7 MB/captura); as fotos são
  decodificadas sob demanda com cache LRU. Provido pela página (liberado ao
  sair). `reset()` permite nova importação sem recarregar a aplicação.
- **[`skin-mask.ts`](skin-mask.ts)** — teste de pele compartilhado (margem
  ±2 px) e o *bake* da máscara por célula CSV, para as estatísticas da curva
  concordarem exatamente com a tabela.
- **[`rewarming-curve.ts`](rewarming-curve.ts)** — séries da **Curva de
  Reaquecimento** (temperatura × tempo por articulação/lado, baseline em t₀,
  lacunas onde a captura falhou).
- **[`dom-images.ts`](dom-images.ts)** — helpers de decodificação
  (File → imagem → canvas/pixels/miniatura) compartilhados pela página e pelo
  serviço.

As ROIs articulares são **re-detectadas em cada captura** (as mãos sofrem
pequenas mexidas involuntárias); ajustes manuais por junta valem para a captura
ativa. O visor em modo sequência ganha abas **Imagem | Curva de Reaquecimento**
e uma **linha do tempo** (miniaturas + slider + play/pause + setas).

### Componentes ([`components/`](components/))

- **[`overlay-canvas`](components/overlay-canvas/overlay-canvas.ts)** — desenha a
  RGB, aplica a térmica warpada pelo alinhamento ativo e gerencia o desenho
  interativo da ROI (arrastar do centro para fora, soltar para confirmar).
- **[`marker-picker`](components/marker-picker/marker-picker.ts)** — painel de
  imagem que registra cliques numerados em coordenadas nativas, usado na
  calibração manual (com desfazer/limpar no componente-pai).
- **[`upload-card`](components/upload-card/upload-card.ts)** — área de upload
  arrastar-e-soltar de um arquivo, com estados de hover, drag-over, carregando,
  sucesso (nome/tamanho + trocar arquivo) e erro.
- **[`sequence-import`](components/sequence-import/sequence-import.ts)** —
  importação em lote da sessão: seletor/drop de pasta (com travessia de
  diretórios), tela de conferência (tripletos completos/faltando, arquivos
  ignorados, intervalo) e progresso do processamento com cancelamento.
- **[`timeline`](components/timeline/timeline.ts)** — navegação da sequência:
  filmstrip de miniaturas térmicas (baseline fixada), slider, play/pause com
  velocidade e navegação por teclado (←/→/espaço).
- **[`rewarming-chart`](components/rewarming-chart/rewarming-chart.ts)** —
  Curva de Reaquecimento em Chart.js: uma linha por (lado, articulação),
  referência tracejada no valor basal, playhead sincronizado com a linha do
  tempo e clique-para-navegar.

### Estado

A página usa **Angular Signals**. As entradas (imagem, matriz, canvas térmico) e
os controles (opacidade, formato, modo, ROI) são `signal`; os derivados
(transformação ativa, warp térmico→RGB, resultado da ROI) são `computed`. Trocar
qualquer arquivo-fonte reseta ROI, pontos de calibração e matriz manual, evitando
medir com dados de outra origem.

## Correspondência com os scripts Python

| Python | TypeScript |
| --- | --- |
| `load_thermal_csv` | `thermal-csv.ts` |
| `estimateAffinePartial2D` (marcadores manuais) | `estimateSimilarityTransform` |
| `_roi_stats`, `extract_thermal_roi_stats` | `roi-stats.ts` |
| `extract_hand_landmarks_from_rgb` (MediaPipe) | `hand-landmarks.service.ts` |
| `ROI_IDS`, `get_both_hands_rois_stats_from_rgb` | `joint-rois.ts` |
| `OverlayLabel`, `build_overlay` | `overlay-canvas` |
| `_ClickPointLabel`, diálogo de calibração | `marker-picker` + página |

## O que ainda pode melhorar

Não portado de propósito (fora do escopo do navegador):

- **Normalização axilar/ambiente e série temporal** (`process_participant`):
  depende de processamento em lote de pastas de pacientes, que não se encaixa no
  fluxo de arquivo único do navegador.

Melhorias incrementais possíveis:

- **Persistir a calibração** (ex.: `localStorage` ou Supabase) para reaproveitar
  os marcadores entre sessões, como o `manual_markers.json` dos scripts.
- **Exportar resultados** (CSV/JSON) da tabela de articulações e das ROIs.
- **Integrar com o mapa corporal** (preencher as avaliações a partir das
  temperaturas articulares).

## Validação

Cobertura de testes unitários nos módulos puros
([`*.spec.ts`](.)): parsing de CSV, transformações de alinhamento, agregação de
ROI, registro de silhuetas e ROIs articulares (com cenas sintéticas que
reproduzem o caso real — fundo frio dominante e pele quente).

Validado **contra um export real da câmera** (`V047_T1_Din01`):

- Registro de silhuetas: recupera s=0,5025 em ~150 ms; os marcadores físicos
  (usados só como referência de verificação, não no ajuste) caem a ≤2 células
  das suas impressões térmicas.
- Exclusão de fundo por pele em resolução plena (margem 2 px): numa ROI r=10 na
  borda da mão do V047, a mínima sobe de 22,7 °C (fundo) para ~28,5 °C (só
  pele). No V033 (dedos finos, frios e afastados — o caso difícil), as médias
  dos PIPs sobem 0,5–2,3 °C com a exclusão do fundo e as ROIs com cobertura de
  pele < 35% são sinalizadas como pouco confiáveis; punhos ficam com 100% de
  cobertura e valores inalterados.

Sobreposição das silhuetas (`alignment-quality.ts`) nas 7 capturas de referência,
rodando o próprio código fora do navegador: **91,7–98,8%** normalizado, todas
pelo caminho fiducial, correções dos marcadores de **1,5–4,9 células**. O ganho
da normalização é visível no V043 (84,7% bruto → 96,3% normalizado, teto 87,9%) e
no V031 (9% da pele óptica fora do quadro térmico, 95,2% com ou sem restrição de
FOV). Sem limiar de aceitação e sem código de cores: n=7 com falhas sintéticas
não é calibração, e um selo verde/vermelho seria um limiar implícito.

**Pendências:** validar com mais pacientes (enquadramentos e temperaturas
variados); **medir o impacto do erro de alinhamento em °C** — perturbar a
transformação em ±1/±2/±3 células e recalcular as ROIs articulares, já que uma
boa sobreposição das silhuetas *não* demonstra exatidão da temperatura extraída
(o Dice é quase cego a translação, e os marcadores validam o antebraço, não as
juntas); exportar as componentes da métrica (não há camada de persistência, os
valores morrem com a sessão); e testar a detecção de articulações no navegador
com fotos reais — o
MediaPipe roda apenas no cliente, então essa etapa não é coberta pelos testes
de nó. A rotulagem esquerda/direita vem do próprio MediaPipe (mesma convenção
do `core.py`) e vale conferir com mãos em dorso para cima.
