import { Patient } from '../../patients/data/patient.model';
import {
  ACOES_RAPIDAS,
  acoesPara,
  cadastradosNaJanela,
  ehClinico,
  maisRecentes,
} from './dashboard-summary';

function paciente(id: string, created_at: string, partial: Partial<Patient> = {}): Patient {
  return {
    id,
    full_name: `Paciente ${id}`,
    birth_date: '1970-01-01',
    sex: null,
    phone: null,
    diagnoses: [],
    study_group: null,
    created_at,
    updated_at: created_at,
    // O caso comum das fixtures: prontuário do próprio leitor, que pode tudo. Os
    // testes de linha alheia sobrescrevem por `partial`.
    can_edit: true,
    can_delete: true,
    ...partial,
  };
}

const AGORA = new Date('2026-08-22T12:00:00Z');

describe('cadastradosNaJanela', () => {
  it('conta só quem entrou dentro da janela', () => {
    const lista = [
      paciente('a', '2026-08-20T12:00:00Z'), // 2 dias
      paciente('b', '2026-08-01T12:00:00Z'), // 21 dias
      paciente('c', '2026-06-01T12:00:00Z'), // 82 dias
    ];

    expect(cadastradosNaJanela(lista, AGORA)).toBe(2);
  });

  it('inclui quem está exatamente no limite da janela', () => {
    expect(cadastradosNaJanela([paciente('a', '2026-07-23T12:00:00Z')], AGORA)).toBe(1);
  });

  it('não conta data ilegível, que inflaria um número não conferível', () => {
    expect(cadastradosNaJanela([paciente('a', 'não é data')], AGORA)).toBe(0);
  });

  it('devolve zero para conta vazia', () => {
    expect(cadastradosNaJanela([], AGORA)).toBe(0);
  });
});

describe('maisRecentes', () => {
  it('ordena do mais novo para o mais antigo', () => {
    const lista = [
      paciente('velho', '2026-01-01T00:00:00Z'),
      paciente('novo', '2026-08-20T00:00:00Z'),
      paciente('meio', '2026-05-01T00:00:00Z'),
    ];

    expect(maisRecentes(lista).map((p) => p.id)).toEqual(['novo', 'meio', 'velho']);
  });

  it('respeita o limite', () => {
    const lista = Array.from({ length: 9 }, (_, i) =>
      paciente(`p${i}`, `2026-0${i + 1}-01T00:00:00Z`),
    );

    expect(maisRecentes(lista)).toHaveLength(5);
  });

  it('não descarta quem tem data ilegível, só manda para o fim', () => {
    const lista = [paciente('quebrado', 'xx'), paciente('bom', '2026-08-20T00:00:00Z')];

    expect(maisRecentes(lista).map((p) => p.id)).toEqual(['bom', 'quebrado']);
  });

  it('não altera o array recebido', () => {
    const lista = [paciente('a', '2026-01-01T00:00:00Z'), paciente('b', '2026-08-01T00:00:00Z')];
    maisRecentes(lista);

    expect(lista.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('devolve vazio para conta vazia', () => {
    expect(maisRecentes([])).toEqual([]);
  });
});

describe('acoesPara', () => {
  it('mostra tudo para o médico', () => {
    expect(acoesPara('medico')).toHaveLength(ACOES_RAPIDAS.length);
  });

  it('mostra tudo para o admin', () => {
    expect(acoesPara('admin')).toHaveLength(ACOES_RAPIDAS.length);
  });

  it('esconde as ações de prontuário de quem não é clínico', () => {
    const rotas = acoesPara('user').map((a) => a.rota);

    expect(rotas).not.toContain('/pacientes');
    expect(rotas).not.toContain('/analise/analise-termica');
    // As ferramentas abertas continuam: elas não gravam nada.
    expect(rotas).toContain('/analise/analisador-de-imagens');
    expect(rotas).toContain('/analise/mapa-corporal');
  });

  it('trata perfil ainda não carregado como não clínico', () => {
    expect(acoesPara(undefined).every((a) => a.papeis === undefined)).toBe(true);
  });
});

describe('ehClinico', () => {
  it('reconhece médico e admin', () => {
    expect(ehClinico('medico')).toBe(true);
    expect(ehClinico('admin')).toBe(true);
  });

  it('recusa o papel comum e o perfil ausente', () => {
    expect(ehClinico('user')).toBe(false);
    expect(ehClinico(undefined)).toBe(false);
  });
});
