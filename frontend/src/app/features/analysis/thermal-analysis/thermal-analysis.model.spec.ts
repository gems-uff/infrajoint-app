import { AssessedIndex, toEncounterCreate } from './thermal-analysis.model';
import { AssessmentResult, DEFAULT_SCORE_PARAMETERS } from '../body-map/body-map.model';

function resultado(joints: AssessmentResult['joints'] = {}): AssessmentResult {
  return {
    patientId: 'p1',
    assessmentType: 'CDAI',
    joints,
    parameters: DEFAULT_SCORE_PARAMETERS,
  } as AssessmentResult;
}

describe('toEncounterCreate', () => {
  it('não grava índice quando nenhum foi fechado', () => {
    // Regressão: com o body map intocado o CDAI vale 0 + 0 + 0 + 0 = 0, que não é
    // nulo — e a consulta era gravada com "CDAI 0,0, remissão", avaliação que
    // ninguém fez. Quem filtra é `closedIndexes`, e o payload precisa refletir isso.
    const payload = toEncounterCreate(resultado(), [], { tender: 0, swollen: 0 });

    expect(payload.scores).toBeNull();
    expect(payload.joint_evaluations).toBeNull();
  });

  it('grava o índice quando há avaliação por trás dele', () => {
    const indices: AssessedIndex[] = [
      { assessmentType: 'CDAI', outcome: { score: 4, level: 'low' } },
    ];

    const payload = toEncounterCreate(
      resultado({ RIGHT_MCP_3: { pain: true, swelling: false } }),
      indices,
      { tender: 1, swollen: 0 },
    );

    expect(payload.scores?.['CDAI']).toMatchObject({ score: 4, tender_count: 1 });
    expect(payload.joint_evaluations).toMatchObject({ RIGHT_MCP_3: { pain: true } });
  });
});
