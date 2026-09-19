import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LucideInfo, provideLucideIcons } from '@lucide/angular';

import { environment } from '../../../../../../environments/environment';
import { AlgorithmsPage } from './algorithms-page';

const ALGORITMOS = `${environment.apiBaseUrl}/algorithms`;
const PACIENTES = `${environment.apiBaseUrl}/patients`;

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

/** O botão pelo rótulo, e não pelo índice: a tela tem outros botões. */
function executar(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
  const botao = [...fixture.nativeElement.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Executar'),
  );
  if (!botao) {
    throw new Error('botão Executar não encontrado');
  }
  return botao as HTMLButtonElement;
}

async function montar(algoritmos: unknown[]) {
  await TestBed.configureTestingModule({
    imports: [AlgorithmsPage],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      // Só o que a tela usa: o resultado sem dados suficientes traz o ícone de
      // informação. Sem ele o componente falha ao resolver, e o teste quebraria
      // por ambiente em vez de por regressão.
      provideLucideIcons(LucideInfo),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AlgorithmsPage);
  const controller = TestBed.inject(HttpTestingController);
  fixture.detectChanges();

  controller.expectOne(ALGORITMOS).flush(algoritmos);
  controller.expectOne(PACIENTES).flush([{ id: 'p1', full_name: 'Ana' }]);
  fixture.detectChanges();
  return { fixture, controller };
}

const ANALISE = {
  slug: 'assimetria',
  title: 'Assimetria térmica',
  description: 'Compara os dois lados.',
  scope: 'encounter',
};

describe('AlgorithmsPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('mostra os algoritmos que o servidor registrou', async () => {
    // A lista é do servidor, sempre: é isso que faz acrescentar um algoritmo não
    // custar nada aqui.
    const { fixture, controller } = await montar([ANALISE]);

    expect(texto(fixture)).toContain('Assimetria térmica');
    expect(texto(fixture)).toContain('Compara os dois lados.');
    controller.verify();
  });

  it('avisa quando o servidor não tem algoritmo nenhum', async () => {
    const { fixture, controller } = await montar([]);

    expect(texto(fixture)).toContain('Nenhum algoritmo registrado');
    controller.verify();
  });

  it('não deixa executar antes de escolher a consulta', async () => {
    const { fixture, controller } = await montar([ANALISE]);

    expect(executar(fixture).disabled).toBe(true);
    expect(texto(fixture)).toContain('Escolha o paciente.');
    controller.verify();
  });

  it('só oferece consultas com análise de imagem gravada', async () => {
    // Uma consulta sem análise só teria como devolver "dados insuficientes", então
    // oferecê-la é oferecer uma execução inútil.
    const { fixture, controller } = await montar([ANALISE]);

    const paciente = fixture.nativeElement.querySelector('#paciente') as HTMLSelectElement;
    paciente.value = 'p1';
    paciente.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    controller.expectOne(`${PACIENTES}/p1`).flush({
      id: 'p1',
      full_name: 'Ana',
      encounters: [
        { id: 'e1', occurred_at: '2026-09-01T10:00:00Z', analysis_status: null, capture_count: 0 },
      ],
    });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('não tem consulta com análise de imagem gravada');
    expect(executar(fixture).disabled).toBe(true);
    controller.verify();
  });

  it('roda um algoritmo de coorte sem pedir paciente nem consulta', async () => {
    // O escopo vem do servidor, então um algoritmo de coorte registrado lá passa a
    // funcionar aqui sem deploy do frontend. Coorte não tem recorte a escolher.
    const { fixture, controller } = await montar([
      { ...ANALISE, slug: 'coorte', title: 'Casos x controles', scope: 'cohort' },
    ]);

    expect(fixture.nativeElement.querySelector('#paciente')).toBeNull();
    expect(texto(fixture)).toContain('todos os pacientes que você tem acesso');
    expect(executar(fixture).disabled).toBe(false);

    executar(fixture).click();
    fixture.detectChanges();

    const requisicao = controller.expectOne(`${ALGORITMOS}/coorte/run`);
    // Sem consulta no corpo: mandar uma sugeriria um recorte que não vai acontecer.
    expect(requisicao.request.body).toEqual({});
    requisicao.flush({ status: 'ok', summary: '12 pacientes comparados.', values: [] });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('12 pacientes comparados.');
    controller.verify();
  });
});

describe('AlgorithmsPage — execução', () => {
  beforeEach(() => TestBed.resetTestingModule());

  /** Leva a tela até o ponto de poder executar: paciente e consulta escolhidos. */
  async function pronta() {
    const { fixture, controller } = await montar([ANALISE]);

    const paciente = fixture.nativeElement.querySelector('#paciente') as HTMLSelectElement;
    paciente.value = 'p1';
    paciente.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    controller.expectOne(`${PACIENTES}/p1`).flush({
      id: 'p1',
      full_name: 'Ana',
      encounters: [
        {
          id: 'e1',
          occurred_at: '2026-09-01T10:00:00Z',
          analysis_status: 'ready',
          capture_count: 2,
        },
      ],
    });
    fixture.detectChanges();

    const consulta = fixture.nativeElement.querySelector('#consulta') as HTMLSelectElement;
    consulta.value = 'e1';
    consulta.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    return { fixture, controller };
  }

  it('executa e mostra os números do resultado', async () => {
    const { fixture, controller } = await pronta();

    expect(executar(fixture).disabled).toBe(false);
    executar(fixture).click();
    fixture.detectChanges();

    const requisicao = controller.expectOne(`${ALGORITMOS}/assimetria/run`);
    expect(requisicao.request.body).toEqual({ encounter_id: 'e1' });
    requisicao.flush({
      status: 'ok',
      summary: 'Maior diferença na MCP 3.',
      values: [
        { label: 'MCP 3 (esquerda mais quente)', value: 1.4, unit: '°C' },
        { label: 'Punho (direita mais quente)', value: 0.2, unit: '°C' },
      ],
    });
    fixture.detectChanges();

    const conteudo = texto(fixture);
    // O algoritmo que rodou se identifica, e os números aparecem formatados.
    expect(conteudo).toContain('Assimetria térmica');
    expect(conteudo).toContain('Maior diferença na MCP 3.');
    expect(conteudo).toContain('MCP 3 (esquerda mais quente)');
    expect(conteudo).toContain('1.4');
    controller.verify();
  });

  it('mostra a explicação quando faltam dados, sem tabela de números', async () => {
    // `status` existe justamente para a tela não ter que interpretar a frase para
    // saber se mostra um achado ou a razão de não haver achado.
    const { fixture, controller } = await pronta();

    executar(fixture).click();
    fixture.detectChanges();
    controller.expectOne(`${ALGORITMOS}/assimetria/run`).flush({
      status: 'insufficient-data',
      summary: 'Nenhum par pôde ser comparado.',
      values: [],
    });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Nenhum par pôde ser comparado.');
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    controller.verify();
  });

  it('descarta o resultado quando a escolha muda', async () => {
    // O achado descreve aquelas medições; mantê-lo na tela depois de trocar de
    // consulta seria mostrar o resultado de outra análise.
    const { fixture, controller } = await pronta();

    executar(fixture).click();
    fixture.detectChanges();
    controller.expectOne(`${ALGORITMOS}/assimetria/run`).flush({
      status: 'ok',
      summary: 'Maior diferença na MCP 3.',
      values: [{ label: 'MCP 3', value: 1.4, unit: '°C' }],
    });
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Maior diferença na MCP 3.');

    const consulta = fixture.nativeElement.querySelector('#consulta') as HTMLSelectElement;
    consulta.value = '';
    consulta.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(texto(fixture)).not.toContain('Maior diferença na MCP 3.');
    expect(texto(fixture)).toContain('O resultado aparece aqui depois de executar.');
    controller.verify();
  });

  it('mostra a falha da execução sem apagar a escolha', async () => {
    const { fixture, controller } = await pronta();

    executar(fixture).click();
    fixture.detectChanges();
    controller
      .expectOne(`${ALGORITMOS}/assimetria/run`)
      .flush({ detail: 'consulta não encontrada' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Registro não encontrado.');
    // O botão volta a ficar disponível: a escolha continua válida.
    expect(executar(fixture).disabled).toBe(false);
    controller.verify();
  });
});
