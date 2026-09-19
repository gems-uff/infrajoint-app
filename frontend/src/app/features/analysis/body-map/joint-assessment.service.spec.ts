import { JointAssessmentService } from './joint-assessment.service';
import { JOINTS_28 } from './assessment-configs.data';
import { DEFAULT_SCORE_PARAMETERS } from './body-map.model';

describe('JointAssessmentService', () => {
  let store: JointAssessmentService;

  beforeEach(() => {
    store = new JointAssessmentService();
    store.setActiveJoints(JOINTS_28);
  });

  it('starts with every joint not evaluated', () => {
    expect(store.statusOf('RIGHT_KNEE')).toBe('not-evaluated');
    expect(store.tenderCount()).toBe(0);
    expect(store.swollenCount()).toBe(0);
    expect(store.evaluatedCount()).toBe(0);
    expect(store.totalCount()).toBe(28);
  });

  it('derives the visual status from the findings', () => {
    store.setPain('RIGHT_MCP_3', true);
    expect(store.statusOf('RIGHT_MCP_3')).toBe('pain');

    store.setSwelling('RIGHT_MCP_3', true);
    expect(store.statusOf('RIGHT_MCP_3')).toBe('both');

    store.setPain('RIGHT_MCP_3', false);
    expect(store.statusOf('RIGHT_MCP_3')).toBe('swelling');

    store.setSwelling('RIGHT_MCP_3', false);
    expect(store.statusOf('RIGHT_MCP_3')).toBe('normal');
  });

  it('counts tender and swollen joints', () => {
    store.setEvaluation('RIGHT_KNEE', { pain: true, swelling: false });
    store.setEvaluation('LEFT_WRIST', { pain: true, swelling: true });

    expect(store.tenderCount()).toBe(2);
    expect(store.swollenCount()).toBe(1);
    expect(store.evaluatedCount()).toBe(2);
  });

  it('clears a single evaluation and resets all', () => {
    store.setPain('RIGHT_KNEE', true);
    store.clearEvaluation('RIGHT_KNEE');
    expect(store.statusOf('RIGHT_KNEE')).toBe('not-evaluated');

    store.setPain('LEFT_KNEE', true);
    store.reset();
    expect(store.evaluatedCount()).toBe(0);
  });

  it('only counts joints in the active assessment', () => {
    store.setActiveJoints(['RIGHT_KNEE']);
    store.setEvaluation('RIGHT_KNEE', { pain: true, swelling: false });
    store.setEvaluation('LEFT_KNEE', { pain: true, swelling: false }); // outside the active set

    expect(store.tenderCount()).toBe(1);
    expect(store.evaluatedCount()).toBe(1);
  });

  it('serializes to a result ready for the calculation algorithms', () => {
    store.setEvaluation('RIGHT_MCP_3', { pain: true, swelling: true });

    expect(store.toResult('CDAI', 'a3f1c2d4-0000-4000-8000-000000000001')).toEqual({
      patientId: 'a3f1c2d4-0000-4000-8000-000000000001',
      assessmentType: 'CDAI',
      joints: { RIGHT_MCP_3: { pain: true, swelling: true } },
      parameters: DEFAULT_SCORE_PARAMETERS,
    });
  });

  it('carries the typed-in parameters into the serialized result', () => {
    // Estes parâmetros vinham de dentro do componente de escore e não saíam de
    // lá — sem eles no resultado, o fluxo de Análise Térmica não teria o que
    // persistir. É este teste que impede a regressão de voltarem para lá.
    store.setParameter('patientGlobal', 4.5);
    store.setParameter('acuteValue', 25);

    const { parameters } = store.toResult('DAS28');
    expect(parameters.patientGlobal).toBe(4.5);
    expect(parameters.acuteValue).toBe(25);
  });

  it('computes CDAI from the joint counts and the globals', () => {
    store.setActiveJoints(['RIGHT_KNEE', 'LEFT_KNEE']);
    store.setEvaluation('RIGHT_KNEE', { pain: true, swelling: true });
    store.setParameter('patientGlobal', 3);
    store.setParameter('evaluatorGlobal', 2);

    // TJC 1 + SJC 1 + PGA 3 + EGA 2
    expect(store.scoreFor('CDAI').score).toBe(7);
    expect(store.scoreFor('CDAI').level).toBe('low');
  });

  it('leaves DAS28 open while the acute-phase reactant is missing', () => {
    store.setActiveJoints(['RIGHT_KNEE']);
    store.setEvaluation('RIGHT_KNEE', { pain: true, swelling: false });

    expect(store.scoreFor('DAS28')).toEqual({ score: null, level: null });

    store.setParameter('acuteValue', 25);
    expect(store.scoreFor('DAS28').score).not.toBeNull();
  });

  it('reset clears the parameters too, not just the joints', () => {
    store.setEvaluation('RIGHT_KNEE', { pain: true, swelling: false });
    store.setParameter('patientGlobal', 7);

    store.reset();

    expect(store.evaluatedIds().size).toBe(0);
    expect(store.parameters()).toEqual(DEFAULT_SCORE_PARAMETERS);
  });
});
