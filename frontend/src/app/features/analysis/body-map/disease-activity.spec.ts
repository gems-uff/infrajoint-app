import {
  calculateCdai,
  calculateDas28,
  cdaiActivityLevel,
  das28ActivityLevel,
} from './disease-activity';

describe('CDAI', () => {
  it('sums tender, swollen and both global assessments', () => {
    expect(
      calculateCdai({ tenderCount: 5, swollenCount: 3, patientGlobal: 4, evaluatorGlobal: 2 }),
    ).toBe(14);
  });

  it('classifies activity by the standard thresholds', () => {
    expect(cdaiActivityLevel(2.8)).toBe('remission');
    expect(cdaiActivityLevel(2.9)).toBe('low');
    expect(cdaiActivityLevel(10)).toBe('low');
    expect(cdaiActivityLevel(10.1)).toBe('moderate');
    expect(cdaiActivityLevel(22)).toBe('moderate');
    expect(cdaiActivityLevel(22.1)).toBe('high');
  });
});

describe('DAS28', () => {
  it('computes the ESR variant', () => {
    // 0.56·√6 + 0.28·√4 + 0.70·ln(30) + 0.014·50
    const score = calculateDas28({
      tenderCount: 6,
      swollenCount: 4,
      acutePhase: 'esr',
      acuteValue: 30,
      patientGlobalHealth: 50,
    });
    expect(score).toBeCloseTo(5.01, 2);
  });

  it('computes the CRP variant with its constant offset', () => {
    // all-zero inputs collapse to the +0.96 constant
    const score = calculateDas28({
      tenderCount: 0,
      swollenCount: 0,
      acutePhase: 'crp',
      acuteValue: 0,
      patientGlobalHealth: 0,
    });
    expect(score).toBeCloseTo(0.96, 2);
  });

  it('guards against ln(0) for ESR', () => {
    const score = calculateDas28({
      tenderCount: 0,
      swollenCount: 0,
      acutePhase: 'esr',
      acuteValue: 0,
      patientGlobalHealth: 0,
    });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeCloseTo(0, 5); // 0.70·ln(1) = 0
  });

  it('classifies activity by the standard thresholds', () => {
    expect(das28ActivityLevel(2.59)).toBe('remission');
    expect(das28ActivityLevel(2.6)).toBe('low');
    expect(das28ActivityLevel(3.2)).toBe('low');
    expect(das28ActivityLevel(3.21)).toBe('moderate');
    expect(das28ActivityLevel(5.1)).toBe('moderate');
    expect(das28ActivityLevel(5.11)).toBe('high');
  });
});
