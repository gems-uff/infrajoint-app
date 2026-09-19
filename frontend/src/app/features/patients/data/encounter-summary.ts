/**
 * Leitura do que o fluxo de Análise Térmica gravou numa consulta.
 *
 * Funções puras, fora do componente: o prontuário só as renderiza. Elas também
 * são o contraponto de leitura da escrita feita em
 * `features/analysis/thermal-analysis/thermal-analysis.model.ts`.
 */

import { DISEASE_ACTIVITY_META } from '../../analysis/body-map/disease-activity';
import { Encounter } from './patient.model';

/** Um índice pronto para exibição: rótulo, valor formatado, faixa e cor. */
export interface ScoreChip {
  readonly label: string;
  readonly value: string;
  readonly levelLabel: string;
  readonly hex: string;
}

/** Contagens derivadas do body map da consulta. */
export interface JointSummary {
  readonly evaluated: number;
  readonly tender: number;
  readonly swollen: number;
}

/**
 * Índices gravados, em ordem estável.
 *
 * O CDAI sai com uma casa decimal e o DAS28 com duas, como na tela de avaliação —
 * a precisão faz parte de como cada índice é lido clinicamente.
 */
export function scoresOf(encounter: Encounter): readonly ScoreChip[] {
  const chips: ScoreChip[] = [];
  const { cdai, das28 } = encounter.scores ?? {};

  if (cdai) {
    chips.push({
      label: 'CDAI',
      value: cdai.score.toFixed(1),
      levelLabel: DISEASE_ACTIVITY_META[cdai.level].label,
      hex: DISEASE_ACTIVITY_META[cdai.level].hex,
    });
  }
  if (das28) {
    chips.push({
      label: 'DAS28',
      value: das28.score.toFixed(2),
      levelLabel: DISEASE_ACTIVITY_META[das28.level].label,
      hex: DISEASE_ACTIVITY_META[das28.level].hex,
    });
  }
  return chips;
}

/** Como a análise de imagem da consulta aparece na lista. */
export interface AnalysisBadge {
  readonly label: string;
  readonly pending: boolean;
}

/**
 * Estado da análise de imagem, ou `null` quando a consulta não tem uma.
 *
 * `'uploading'` merece destaque próprio: as capturas estão gravadas mas os arquivos
 * não foram confirmados no bucket. É estado recuperável, não erro — mas quem lê o
 * prontuário precisa saber que aquelas imagens ainda não estão garantidas.
 */
export function analysisBadgeOf(encounter: Encounter): AnalysisBadge | null {
  if (!encounter.analysis_status) {
    return null;
  }
  const capturas = encounter.capture_count;
  const quantidade = capturas === 1 ? '1 captura' : `${capturas} capturas`;
  return encounter.analysis_status === 'ready'
    ? { label: `Análise de imagem · ${quantidade}`, pending: false }
    : { label: `Análise de imagem · ${quantidade} · envio incompleto`, pending: true };
}

/**
 * Resumo do body map, ou `null` quando a consulta não tem um.
 *
 * Devolver `null` em vez de zeros é o que distingue "consulta sem body map" de
 * "body map em que nada foi encontrado" — clinicamente são coisas diferentes.
 */
export function jointSummaryOf(encounter: Encounter): JointSummary | null {
  const evaluations = encounter.joint_evaluations;
  if (!evaluations) {
    return null;
  }
  const findings = Object.values(evaluations);
  if (findings.length === 0) {
    return null;
  }
  return {
    evaluated: findings.length,
    tender: findings.filter((finding) => finding.pain).length,
    swollen: findings.filter((finding) => finding.swelling).length,
  };
}
