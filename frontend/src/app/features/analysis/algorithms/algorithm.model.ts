/**
 * Contratos dos algoritmos de pesquisa, como a API os expõe.
 *
 * O algoritmo em si não mora mais aqui: ele roda no servidor, onde estão os dados e as
 * bibliotecas de cálculo. O que sobrou deste lado é o formato do que chega, e é de
 * propósito que seja pouco — plugar um algoritmo novo não deve custar nada no frontend.
 *
 * Os nomes ficam em snake_case, iguais aos do backend, mesma convenção de
 * `patient.model.ts`: um mapper para camelCase seria uma camada de tradução sem nada
 * para traduzir.
 */

/**
 * Sobre que recorte o algoritmo trabalha.
 *
 * É o que diz à tela o que perguntar antes de executar: `encounter` pede uma consulta,
 * `cohort` não pede nada e alcança tudo que aquele usuário pode ver. Quem declara é o
 * algoritmo, no servidor; a tela só obedece.
 */
export type AlgorithmScope = 'encounter' | 'cohort';

/** Um algoritmo disponível, como `GET /algorithms` o lista. */
export interface Algorithm {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly scope: AlgorithmScope;
}

/** Uma linha do resultado: um número com nome, e a unidade quando houver. */
export interface AlgorithmValue {
  readonly label: string;
  readonly value: number;
  /** Ausente quando o número não tem unidade, uma contagem ou uma proporção. */
  readonly unit?: string | null;
}

/**
 * O resultado, igual para todo algoritmo.
 *
 * `status` não é redundante com `summary`: sem ele a tela teria que interpretar o texto
 * para saber se mostra um achado ou a justificativa de não haver achado.
 */
export interface AlgorithmResult {
  readonly status: 'ok' | 'insufficient-data';
  readonly summary: string;
  readonly values: readonly AlgorithmValue[];
}

/**
 * Corpo do `POST /algorithms/{slug}/run`.
 *
 * A consulta é opcional porque o recorte depende do escopo: um algoritmo de coorte não
 * recebe nenhuma, e mandar uma seria ignorado pelo servidor.
 */
export interface AlgorithmRun {
  readonly encounter_id?: string;
}
