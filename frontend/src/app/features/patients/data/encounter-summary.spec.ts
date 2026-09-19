import { Encounter } from './patient.model';
import { analysisBadgeOf, jointSummaryOf, scoresOf } from './encounter-summary';

function encounter(partial: Partial<Encounter> = {}): Encounter {
  return {
    id: 'e1',
    patient_id: 'p1',
    occurred_at: '2026-08-15T12:00:00Z',
    reason: null,
    joint_evaluations: null,
    scores: {},
    analysis_status: null,
    capture_count: 0,
    created_at: '2026-08-15T12:00:00Z',
    can_edit: true,
    can_delete: true,
    ...partial,
  };
}

describe('scoresOf', () => {
  it('não devolve nada para consulta sem índice', () => {
    expect(scoresOf(encounter())).toEqual([]);
  });

  it('formata CDAI com uma casa e DAS28 com duas', () => {
    const chips = scoresOf(
      encounter({
        scores: {
          cdai: {
            score: 12.5,
            level: 'moderate',
            tender_count: 2,
            swollen_count: 1,
            patient_global: 5,
            evaluator_global: 4.5,
          },
          das28: {
            score: 4.213,
            level: 'moderate',
            tender_count: 2,
            swollen_count: 1,
            acute_phase: 'esr',
            acute_value: 25,
            patient_global_health: 40,
          },
        },
      }),
    );

    expect(chips.map((chip) => [chip.label, chip.value])).toEqual([
      ['CDAI', '12.5'],
      ['DAS28', '4.21'],
    ]);
    expect(chips[0].levelLabel).toBe('Atividade moderada');
  });

  it('mostra só o índice que foi fechado', () => {
    const chips = scoresOf(
      encounter({
        scores: {
          cdai: {
            score: 2,
            level: 'remission',
            tender_count: 0,
            swollen_count: 0,
            patient_global: 1,
            evaluator_global: 1,
          },
        },
      }),
    );
    expect(chips.map((chip) => chip.label)).toEqual(['CDAI']);
    expect(chips[0].levelLabel).toBe('Remissão');
  });
});

describe('jointSummaryOf', () => {
  it('distingue consulta sem body map de body map vazio', () => {
    expect(jointSummaryOf(encounter())).toBeNull();
    expect(jointSummaryOf(encounter({ joint_evaluations: {} }))).toBeNull();
  });

  it('conta avaliadas, dolorosas e edemaciadas', () => {
    const resumo = jointSummaryOf(
      encounter({
        joint_evaluations: {
          RIGHT_KNEE: { pain: true, swelling: true },
          LEFT_KNEE: { pain: false, swelling: false },
          RIGHT_MCP_3: { pain: true, swelling: false },
        },
      }),
    );

    // Uma articulação com dor E edema conta nas duas colunas — é como o NAD/NAE
    // são contados clinicamente, não são categorias exclusivas.
    expect(resumo).toEqual({ evaluated: 3, tender: 2, swollen: 1 });
  });
});

describe('analysisBadgeOf', () => {
  it('não mostra nada quando a consulta não tem análise de imagem', () => {
    expect(analysisBadgeOf(encounter())).toBeNull();
  });

  it('destaca o envio incompleto como pendência, não como erro', () => {
    // 'uploading' significa capturas gravadas e arquivos não confirmados no bucket.
    // É recuperável — mas quem lê o prontuário precisa saber que não está garantido.
    const badge = analysisBadgeOf(encounter({ analysis_status: 'uploading', capture_count: 21 }))!;
    expect(badge.pending).toBe(true);
    expect(badge.label).toContain('21 capturas');
    expect(badge.label).toContain('envio incompleto');
  });

  it('análise concluída não é pendência', () => {
    const badge = analysisBadgeOf(encounter({ analysis_status: 'ready', capture_count: 1 }))!;
    expect(badge.pending).toBe(false);
    expect(badge.label).toBe('Análise de imagem · 1 captura');
  });
});
