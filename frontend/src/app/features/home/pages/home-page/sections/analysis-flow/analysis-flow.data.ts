import { ProtocolStep } from './analysis-flow.model';

export const PROTOCOL_STEPS: readonly ProtocolStep[] = [
  {
    id: 1,
    phase: 'prep',
    title: 'Preparação do ambiente',
    subtitle: 'Setup térmico e disposição do equipamento',
    details: [
      { label: 'Temperatura', value: '20-24°C' },
      { label: 'Umidade', value: '10-50%' },
      { label: 'Câmera', value: 'Hickmicro SP60H L25' },
      { label: 'Distância', value: '~100 cm, 90°' },
    ],
    keyPoints: ['Iluminação controlada', 'Sem correntes de ar', 'EVA 463×395×5 mm'],
    note: 'A câmera é posicionada verticalmente sobre a placa de EVA. Dois ventiladores USB (255 mm, 7,5 W) são posicionados à frente, usados apenas na fase dinâmica.',
  },
  {
    id: 2,
    phase: 'prep',
    title: 'Aclimatação e anamnese',
    subtitle: 'Questionário e classificação do voluntário',
    details: [
      { label: 'Duração', value: '~20 min' },
      { label: 'Responsável', value: 'Médico reumatologista' },
      { label: 'Mãos', value: 'Descobertas' },
      { label: 'Temperatura', value: 'Aferida ao final' },
    ],
    keyPoints: ['Sem café (2h)', 'Sem creme/loção', 'Sem unhas postiças'],
    note: 'Questionário coleta dados gerais e de saúde. Ao final, o voluntário é classificado em grupo A, B ou C.',
    groups: [
      { letter: 'A', description: 'Artropatia inflamatória' },
      { letter: 'B', description: 'Dor não articular inflamatória' },
      { letter: 'C', description: 'Grupo controle' },
    ],
  },
  {
    id: 3,
    phase: 'prep',
    title: 'Configuração da câmera',
    subtitle: 'Parâmetros e posicionamento inicial',
    details: [
      { label: 'Emissividade', value: '0,98 (pele)' },
      { label: 'Foco', value: 'Automático' },
      { label: 'Instrumento', value: 'Termo-higrômetro' },
      { label: 'Marcadores', value: '12×12×5 mm' },
    ],
    keyPoints: ['Temp. refletida', 'Temp. ambiente', 'Umidade relativa'],
    note: 'Marcadores fixados 40 mm acima da prega de flexão dorsal. Voluntário posiciona as mãos sobre o desenho esquemático da placa de EVA.',
    cameraParams: [
      { key: 'Temp. refletida', value: 'Temp. refletida' },
      { key: 'Temp. óptica externa', value: 'Temp. óptica externa' },
      { key: 'Emissividade', value: 'ε = 0,98' },
      { key: 'Foco', value: 'Automático' },
    ],
  },
  {
    id: 4,
    phase: 'cap',
    title: 'Captura estática',
    subtitle: 'Registro único em repouso',
    details: [
      { label: 'Imagens', value: '1 captura' },
      { label: 'Foco', value: 'Toque na tela (automático)' },
      { label: 'Posição', value: 'Mãos sobre EVA' },
      { label: 'Confirmação', value: 'Miniatura na tela' },
    ],
    keyPoints: ['Fase estática', 'Temperatura basal', 'Sem ventilação'],
    note: 'Operador toca a tela para acionar foco automático (moldura verde retangular), depois toca ícone de câmera. Miniatura confirma o registro.',
    progress: {
      label: 'Captura estática',
      phases: [{ label: 'Repouso → Captura única', value: 100 }],
    },
  },
  {
    id: 5,
    phase: 'cap',
    title: 'Captura dinâmica',
    subtitle: 'Resfriamento e reaquecimento',
    details: [
      { label: 'Resfriamento', value: '2 min (ventiladores)' },
      { label: 'Capturas', value: '20 imagens' },
      { label: 'Intervalo', value: '15 segundos' },
      { label: 'Total', value: '5 minutos' },
    ],
    keyPoints: ['Fase dinâmica', 'Velocidade máxima', 'Captura agendada'],
    note: 'Após 2 min de resfriamento, ventiladores desligados e inicia-se registro de reaquecimento. Contador (1/20) e cronômetro de 15s exibidos.',
    capturePhases: [
      {
        title: 'Resfriamento (2 min)',
        description: 'Ventiladores em velocidade máxima, mãos descobertas.',
      },
      {
        title: 'Reaquecimento (5 min)',
        description: '20 capturas a cada 15 s. Contador (1/20) exibido.',
      },
    ],
    progress: {
      label: 'Captura dinâmica',
      phases: [
        { label: 'Resfriamento (2 min)', value: 29 },
        { label: 'Reaquecimento, 20×15s (5 min)', value: 100 },
      ],
    },
  },
  {
    id: 6,
    phase: 'cli',
    title: 'Coleta clínica (Grupos A e B)',
    subtitle: 'Avaliação médica e registros clínicos',
    details: [
      { label: 'Diagnóstico', value: 'AR, LES, gota, esclerose…' },
      { label: 'Avaliação', value: 'Palpação articular' },
      { label: 'Escalas', value: 'PGA e PhGA' },
      { label: 'Registro', value: 'Diagrama de juntas' },
    ],
    keyPoints: ['Marcadores imunológicos', 'Exames laboratoriais', 'Ano do diagnóstico'],
    note: 'Médico palpa articulações e registra dor e edema em diagrama padronizado. Escalas numéricas PGA (paciente) e PhGA (médico) são aplicadas.',
  },
];
