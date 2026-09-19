/**
 * Contratos da API clínica.
 *
 * Os nomes ficam em snake_case, iguais aos do backend — mesma convenção já usada por
 * `UserProfile`, que espelha as colunas do Supabase. Um mapper para camelCase seria
 * uma camada de tradução sem nada para traduzir.
 */

import { MeasurementDto } from '../../analysis/joint-identity';

/** Caso ou controle. Nulo significa que ninguém classificou ainda. */
export type StudyGroup = 'caso' | 'controle';

/** Uma linha do catálogo de diagnósticos: código da CID-10 e nome. */
export interface DiagnosisCatalog {
  readonly code: string;
  readonly label: string;
}

/** Um diagnóstico do paciente, com o rótulo já resolvido pela API. */
export interface PatientDiagnosis extends DiagnosisCatalog {
  readonly is_primary: boolean;
}

/** O que o formulário envia: o código, e qual é o principal. */
export interface DiagnosisRef {
  readonly code: string;
  readonly is_primary?: boolean;
}

/** O que a API pode devolver. Inclui `'N'`, que registros antigos podem carregar. */
export type Sex = 'F' | 'M' | 'O' | 'N';

/**
 * O que o usuário pode escolher — subconjunto do que o tipo aceita.
 *
 * `'N'` ficou de fora: com a opção vazia do seletor já significando "não informado",
 * tê-lo seria uma segunda forma de dizer a mesma coisa, gravando valores diferentes no
 * banco para o mesmo fato. Um registro que já tenha `'N'` cai no mesmo `—` do nulo.
 */
export const SEX_OPTIONS: readonly { readonly value: Sex; readonly label: string }[] = [
  { value: 'F', label: 'Feminino' },
  { value: 'M', label: 'Masculino' },
  { value: 'O', label: 'Outro' },
];

/**
 * Os grupos que o formulário oferece. A opção vazia do seletor é "não classificado",
 * que é o nulo da coluna, e por isso não está aqui.
 *
 * A lista existe porque quatro lugares precisam do mesmo par código/rótulo: os dois
 * seletores e as duas telas que exibem o grupo. Repetir 'Controle' em cada um deles
 * era como o rótulo saía errado num lugar só.
 */
export const STUDY_GROUP_OPTIONS: readonly {
  readonly value: StudyGroup;
  readonly label: string;
}[] = [
  { value: 'caso', label: 'Caso' },
  { value: 'controle', label: 'Controle' },
];

/** O rótulo do grupo, ou `null` quando ninguém classificou o paciente ainda. */
export function studyGroupLabel(group: StudyGroup | null): string | null {
  return STUDY_GROUP_OPTIONS.find((option) => option.value === group)?.label ?? null;
}

export interface Patient {
  readonly id: string;
  readonly full_name: string;
  /**
   * Obrigatória. Sem documento e sem número de prontuário, é o único campo que
   * distingue dois homônimos — por isso o banco a exige (`birth_date_obrigatoria`).
   */
  readonly birth_date: string;
  readonly sex: Sex | null;
  readonly phone: string | null;
  /** Uma linha do catálogo, como a API a devolve em `GET /diagnoses`. */
  readonly diagnoses: readonly PatientDiagnosis[];
  /**
   * O papel no estudo: `'caso'`, `'controle'` ou `null` para não classificado.
   *
   * Fica separado do diagnóstico de propósito: ser controle é papel no estudo, não
   * achado clínico, e um controle pode ter um diagnóstico incidental sem deixar de ser
   * controle.
   */
  readonly study_group: StudyGroup | null;
  readonly created_at: string;
  readonly updated_at: string;
  /**
   * Nome de quem cadastrou o paciente, e `null` quando é o próprio leitor.
   *
   * Quem decide se ele vem preenchido é o banco, não a tela: só admin e par do
   * acervo de pesquisa enxergam prontuário alheio, e nas linhas do próprio leitor o
   * campo cala para não repetir o nome dele na lista inteira. Renderizar quando
   * existir é, portanto, suficiente — não há checagem de papel a fazer aqui.
   *
   * O que ele **não** diz mais é o que o leitor pode fazer com a linha. Antes do
   * acervo de pesquisa, preenchido significava "de outra pessoa, logo somente
   * leitura"; para o pesquisador significa o contrário, "compartilhado comigo".
   * Quem responde isso agora são `can_edit` e `can_delete`.
   */
  readonly owner_name?: string | null;
  /** Quem gravou a última edição, quando não foi o próprio leitor. */
  readonly editor_name?: string | null;
  /**
   * O que este leitor pode fazer com esta linha, calculado pelo banco com as mesmas
   * funções que as policies de RLS chamam (`app.can_curate` e `app.can_discard`).
   *
   * Esconder o botão continua sendo cosmético: quem recusa de verdade é a policy. O
   * que estes campos evitam é oferecer uma ação que vai voltar 403 depois do
   * formulário preenchido.
   *
   * As duas respostas não andam juntas. O admin lê e apaga o acervo sem poder
   * editá-lo; o pesquisador edita o acervo do par sem poder apagá-lo.
   */
  readonly can_edit: boolean;
  readonly can_delete: boolean;
}

/** Um achado articular, como o backend grava em `encounters.joint_evaluations`. */
export interface JointEvaluationDto {
  readonly pain: boolean;
  readonly swelling: boolean;
}

/** Faixa de atividade. Mesmos valores do `ActivityLevel` do backend. */
export type ActivityLevelDto = 'remission' | 'low' | 'moderate' | 'high';

export interface CdaiScoreDto {
  readonly score: number;
  readonly level: ActivityLevelDto;
  readonly tender_count: number;
  readonly swollen_count: number;
  readonly patient_global: number;
  readonly evaluator_global: number;
}

export interface Das28ScoreDto {
  readonly score: number;
  readonly level: ActivityLevelDto;
  readonly tender_count: number;
  readonly swollen_count: number;
  readonly acute_phase: 'esr' | 'crp';
  readonly acute_value: number;
  readonly patient_global_health: number;
}

/**
 * Escores da consulta, indexados pelo tipo de avaliação em minúsculo.
 *
 * O backend normaliza o casing na fronteira: o frontend envia `CDAI`/`DAS28` e
 * recebe de volta `cdai`/`das28`. A chave dá unicidade por tipo sem constraint.
 */
export interface EncounterScores {
  readonly cdai?: CdaiScoreDto;
  readonly das28?: Das28ScoreDto;
}

export interface Encounter {
  readonly id: string;
  readonly patient_id: string;
  readonly occurred_at: string;
  readonly reason: string | null;
  readonly joint_evaluations: Readonly<Record<string, JointEvaluationDto>> | null;
  readonly scores: EncounterScores;
  /**
   * `null` = consulta sem análise de imagem, `'uploading'` = capturas gravadas e o
   * envio ainda não confirmado, `'ready'` = o cliente confirmou que os arquivos
   * subiram. Quem confere é este lado, que viu a resposta de cada PUT: o backend
   * não olha o bucket.
   */
  readonly analysis_status: 'uploading' | 'ready' | null;
  /**
   * Capturas gravadas na consulta; conta só o que a RLS deixa ver.
   *
   * Conta as **linhas**, não os objetos no bucket: em `uploading` ela é maior que
   * `captures`, que vem vazia de propósito. É o que deixa a tela dizer quanta
   * imagem ficou por confirmar.
   */
  readonly capture_count: number;
  readonly created_at: string;
  /**
   * Quem registrou a consulta, quando não foi o próprio leitor.
   *
   * No acervo de pesquisa a consulta pertence ao dono do PACIENTE, e não a quem a
   * registrou: um pesquisador que atende o paciente de um par grava uma consulta que
   * é do par. Sem este campo, o registro apareceria como escrito por quem não
   * atendeu.
   */
  readonly author_name?: string | null;
  /** Mesma semântica de `Patient.can_edit` / `can_delete`. */
  readonly can_edit: boolean;
  readonly can_delete: boolean;
}

/** Resposta de `GET /patients/{id}`: já traz as consultas, evitando um 2º request. */
export interface PatientDetail extends Patient {
  readonly encounters: readonly Encounter[];
}

/** Os três arquivos de uma captura. Enum fechado: vira parte da chave no R2. */
export type CaptureFileKind = 'optical' | 'thermal' | 'matrix';

/** Declaração do arquivo — tamanho e tipo. Não prova que o upload aconteceu. */
export interface CaptureFileDeclaration {
  size: number;
  content_type: string;
}

/**
 * Corpo do `POST /encounters/{id}/captures`.
 *
 * Uma consulta tem UMA análise. Avulsa é `captures` com um elemento; sequência tem N.
 * Não há discriminador — a cardinalidade é a diferença, no frontend como no banco.
 */
export interface AnalysisCreate {
  captures: readonly Record<string, unknown>[];
}

/** Uma URL assinada, casada com a captura e o arquivo a que pertence. */
export interface SignedUpload {
  readonly capture_id: string;
  /** `null` na avulsa, como o backend a gravou. É por ele que a URL reencontra o arquivo. */
  readonly capture_index: number | null;
  readonly kind: CaptureFileKind;
  readonly url: string;
}

/**
 * Resposta do POST. As URLs valem 1 h e o POST **não** pode ser repetido — a segunda
 * chamada recebe 409, porque criaria um segundo jogo de capturas na mesma consulta.
 */
export interface AnalysisCreated {
  readonly encounter_id: string;
  readonly uploads: readonly SignedUpload[];
}

/**
 * Arquivo da captura, com URL de leitura assinada (15 min).
 *
 * Só a URL: `size` e `content_type` vinham junto e nenhuma tela os lia — a reabertura
 * baixa o arquivo pela URL e mais nada.
 */
export interface CaptureFileDetail {
  /** Nula quando o R2 não está configurado: a consulta abre, só sem imagens. */
  readonly url: string | null;
}

/** Uma captura como foi gravada — é isto que reconstrói a tela do analisador. */
export interface CaptureDetail {
  readonly id: string;
  /** `null` = avulsa, `0` = basal, `N` = dinâmica N. A tela deriva o `kind` daqui. */
  readonly capture_index: number | null;
  readonly elapsed_seconds: number | null;

  readonly align_a: number | null;
  readonly align_b: number | null;
  readonly align_tx: number | null;
  readonly align_c: number | null;
  readonly align_d: number | null;
  readonly align_ty: number | null;
  /**
   * Como o alinhamento foi obtido — 'manual' inclusive.
   *
   * As dimensões da matriz não vêm daqui: elas saem do próprio CSV, que a reabertura
   * baixa e reparseia. Guardá-las no banco era desnormalizar um arquivo que sempre
   * temos — e, no protocolo, repetir 640x480 em toda linha.
   */
  readonly alignment_method: 'silhouette' | 'fiducial' | 'manual' | null;

  readonly agreement: Record<string, unknown> | null;
  readonly fiducial_correction: Record<string, unknown> | null;
  /**
   * As medições das ROIs, uma por articulação, com a identidade do body map.
   *
   * Deixou de ser `JointRoi[]` gravado cru quando `measurements` virou tabela: a API
   * devolve colunas, e `toJointRois` remonta a ROI a partir do catálogo. Ver
   * `analysis/joint-identity.ts`.
   */
  readonly measurements: readonly MeasurementDto[];
  readonly issue: string | null;
  readonly files: Readonly<Record<string, CaptureFileDetail>>;
}

/**
 * Resposta de `GET /encounters/{id}`: a consulta reaberta, inteira.
 *
 * `captures` vem vazia enquanto `analysis_status` não for `ready` — em `uploading`
 * os objetos podem não estar no bucket, e URLs para eles dariam 404 na tela.
 */
export interface EncounterDetail extends Encounter {
  readonly patient: Patient;
  readonly captures: readonly CaptureDetail[];
}

export interface PatientCreate {
  full_name: string;
  /** Obrigatória: o backend recusa com 422 sem ela. */
  birth_date: string;
  sex?: Sex | null;
  phone?: string | null;
  diagnoses?: readonly DiagnosisRef[];
  study_group?: StudyGroup | null;
}

/** PATCH parcial: o backend grava só as chaves presentes. */
export type PatientUpdate = Partial<PatientCreate>;

/**
 * Corpo do `POST /patients/{id}/encounters`.
 *
 * O fluxo de Análise Térmica grava tudo numa chamada só ao finalizar: a consulta
 * nasce já com o body map e os escores. Os dois campos clínicos são opcionais
 * porque as duas etapas do fluxo também são.
 */
export interface EncounterCreate {
  occurred_at?: string | null;
  reason?: string | null;
  joint_evaluations?: Record<string, JointEvaluationDto> | null;
  /** Chaves em maiúsculo (`CDAI`, `DAS28`); o backend normaliza ao gravar. */
  scores?: Record<string, CdaiScoreDto | Das28ScoreDto> | null;
}
