import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  LucideArrowLeft,
  LucideArrowRight,
  LucideCamera,
  LucideChartNoAxesCombined,
  LucideCheck,
  LucideChevronDown,
  LucideChevronRight,
  LucideChevronLeft,
  LucideCircleCheck,
  LucideCircleDashed,
  LucideCircleHelp,
  LucideCloudUpload,
  LucideCrosshair,
  LucideEraser,
  LucideEye,
  LucideFileDown,
  LucideFileSpreadsheet,
  LucideFlame,
  LucideHand,
  LucideHouse,
  LucideImage,
  LucideImages,
  LucideInfo,
  LucideLayers,
  LucideLoaderCircle,
  LucideLogOut,
  LucideMenu,
  LucidePause,
  LucidePersonStanding,
  LucidePlay,
  LucideRefreshCw,
  LucideRotateCcw,
  LucideScanSearch,
  LucideSettings,
  LucideShieldCheck,
  LucideSparkles,
  LucideStethoscope,
  LucideTarget,
  LucideThermometer,
  LucideTimeline,
  LucideTrash2,
  LucideTriangleAlert,
  LucideUserRound,
  LucideWind,
  LucideWorkflow,
  LucideX,
  provideLucideIcons,
} from '@lucide/angular';

import { environment } from '../../../../../../environments/environment';
import { JointAssessmentService } from '../../../body-map/joint-assessment.service';
import { JointId } from '../../../body-map/body-map.model';
import { CollectedAnalysis } from '../../data/analyzer-collect';
import { ThermalAnalysisPage } from './thermal-analysis-page';

/**
 * O caminho de FALHA do Finalizar.
 *
 * O de sucesso é o fácil. O que quebrava era o outro: quando o upload falhava, o botão
 * voltava ao estado inicial e o segundo clique chamava `createEncounter` de novo —
 * nascia uma SEGUNDA consulta, com o mesmo body map e a mesma data, enquanto a primeira
 * ficava órfã em `uploading` com os arquivos pela metade. Duas consultas para um exame
 * só, e nada na tela dizia isso.
 *
 * Como esta é a falha mais provável do fluxo (dezenas de MB por uma rede que cai), é o
 * caminho que mais precisa de teste — e era o único sem nenhum.
 */

const API = environment.apiBaseUrl;

/**
 * Os mesmos ícones registrados em `app.config.ts`.
 *
 * O TestBed não herda os providers da aplicação, e o analisador — que fica montado nesta
 * página — usa vários. Um que falte derruba o template inteiro com "Unable to resolve
 * icon", que não tem nada a ver com o que está sob teste.
 */
const ICONES = [
  LucideArrowLeft,
  LucideArrowRight,
  LucideCamera,
  LucideChartNoAxesCombined,
  LucideCheck,
  LucideChevronDown,
  LucideChevronRight,
  LucideChevronLeft,
  LucideCircleCheck,
  LucideCircleDashed,
  LucideCircleHelp,
  LucideCloudUpload,
  LucideCrosshair,
  LucideEraser,
  LucideEye,
  LucideFileDown,
  LucideFileSpreadsheet,
  LucideFlame,
  LucideHand,
  LucideHouse,
  LucideImage,
  LucideImages,
  LucideInfo,
  LucideLayers,
  LucideLoaderCircle,
  LucideLogOut,
  LucideMenu,
  LucidePause,
  LucidePersonStanding,
  LucidePlay,
  LucideRefreshCw,
  LucideRotateCcw,
  LucideScanSearch,
  LucideSettings,
  LucideShieldCheck,
  LucideSparkles,
  LucideStethoscope,
  LucideTarget,
  LucideThermometer,
  LucideTimeline,
  LucideTrash2,
  LucideTriangleAlert,
  LucideUserRound,
  LucideWind,
  LucideWorkflow,
  LucideX,
];

const PACIENTE = {
  id: 'p1',
  full_name: 'Ana Souza',
  birth_date: '1978-04-02',
  sex: 'F',
  phone: null,
  primary_diagnosis: null,
  created_at: '2026-08-09T12:00:00Z',
  updated_at: '2026-08-09T12:00:00Z',
  encounters: [],
};

const CONSULTA_CRIADA = {
  id: 'e1',
  patient_id: 'p1',
  occurred_at: '2026-08-23T12:00:00Z',
  reason: null,
  joint_evaluations: null,
  scores: {},
  analysis_status: null,
  capture_count: 0,
  created_at: '2026-08-23T12:00:00Z',
};

function arquivo(nome: string): File {
  return new File([new Uint8Array(64)], nome, { type: 'image/jpeg' });
}

/** Uma coleta com os `kinds` pedidos, na forma que o analisador produziria. */
function coleta(...kinds: readonly string[]): CollectedAnalysis {
  return {
    payload: {
      captures: [
        {
          capture_index: 0,
          files: Object.fromEntries(
            kinds.map((k) => [k, { size: 64, content_type: 'image/jpeg' }]),
          ),
        },
      ],
    },
    files: new Map(kinds.map((k) => [`0:${k}`, arquivo(`${k}.jpeg`)])),
  };
}

/** Deixa as promessas pendentes (fetch, firstValueFrom) resolverem antes de assertar. */
async function assentar(fixture: ComponentFixture<ThermalAnalysisPage>): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  fixture.detectChanges();
}

/**
 * A etapa "Paciente" busca a lista no construtor, e ela fica montada o fluxo inteiro.
 * Nada aqui é sobre essa lista — drená-la evita que ela apareça como requisição
 * pendente no `verify()` final.
 */
function drenarListas(controller: HttpTestingController): void {
  controller.match(`${API}/patients`).forEach((r) => (r.cancelled ? undefined : r.flush([])));
}

function botao(fixture: ComponentFixture<ThermalAnalysisPage>, texto: string): HTMLButtonElement {
  const encontrado = (
    Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]
  ).find((b) => b.textContent?.trim().startsWith(texto));
  if (!encontrado) {
    throw new Error(`botão "${texto}" não está na tela`);
  }
  return encontrado;
}

interface Montado {
  fixture: ComponentFixture<ThermalAnalysisPage>;
  controller: HttpTestingController;
  fetchFalso: ReturnType<typeof vi.fn>;
}

async function montar(analise: CollectedAnalysis): Promise<Montado> {
  // A coleta do analisador é substituída de propósito: o que está sob teste aqui é a
  // orquestração do gravar/retomar, não a leitura do analisador — essa já é coberta por
  // analyzer-collect.spec.ts, e montá-la de verdade exigiria imagens e matriz reais.
  vi.spyOn(
    ThermalAnalysisPage.prototype as unknown as { coletarAnalise(): CollectedAnalysis | null },
    'coletarAnalise',
  ).mockReturnValue(analise);

  const fetchFalso = vi.fn();
  vi.stubGlobal('fetch', fetchFalso);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      // A rota precisa existir: o sucesso navega para o prontuário, e um router sem
      // rotas rejeita com NG04002 fora do fluxo do teste.
      provideRouter([{ path: 'pacientes/:id', children: [] }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideLucideIcons(...ICONES),
    ],
  });

  const fixture = TestBed.createComponent(ThermalAnalysisPage);
  const controller = TestBed.inject(HttpTestingController);
  fixture.componentRef.setInput('paciente', 'p1');
  fixture.detectChanges();

  // O paciente vem da query string; com ele o fluxo pula para a etapa do body map.
  controller.expectOne(`${API}/patients/p1`).flush(PACIENTE);
  await assentar(fixture);

  // Uma articulação avaliada é o que faz `hasFindings()` — e portanto o botão de
  // finalizar — existir.
  const store = fixture.debugElement.injector.get(JointAssessmentService);
  store.setActiveJoints(['LEFT_WRIST' as JointId]);
  store.setPain('LEFT_WRIST' as JointId, true);
  fixture.detectChanges();

  return { fixture, controller, fetchFalso };
}

/** Leva o fluxo até o estado "consulta gravada, upload falhou". */
async function gravarComFalhaNoUpload(
  m: Montado,
  uploads: readonly { kind: string; url: string }[],
): Promise<void> {
  botao(m.fixture, 'Finalizar e gravar').click();
  await assentar(m.fixture);

  m.controller.expectOne(`${API}/patients/p1/encounters`).flush(CONSULTA_CRIADA);
  await assentar(m.fixture);

  m.controller.expectOne(`${API}/encounters/e1/captures`).flush({
    encounter_id: 'e1',
    uploads: uploads.map((u) => ({
      capture_id: 'c1',
      capture_index: 0,
      kind: u.kind,
      url: u.url,
    })),
  });
  await assentar(m.fixture);
}

describe('ThermalAnalysisPage — retomada do envio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('não cria uma segunda consulta quando o envio falha e o médico tenta de novo', async () => {
    const m = await montar(coleta('optical'));

    // 403 é o que o R2 responde a uma assinatura inválida, e `uploadAll` não o repete —
    // insistir num 403 só atrasaria o erro. Serve ao teste por ser determinístico e
    // rápido, sem as esperas do backoff.
    m.fetchFalso.mockResolvedValue({ ok: false, status: 403 } as Response);
    await gravarComFalhaNoUpload(m, [{ kind: 'optical', url: 'https://bucket.local/optical' }]);

    expect(m.fetchFalso).toHaveBeenCalledTimes(1);

    // O botão mudou de papel: agora ele retoma, e diz isso.
    m.fetchFalso.mockResolvedValue({ ok: true, status: 200 } as Response);
    botao(m.fixture, 'Tentar enviar novamente').click();
    await assentar(m.fixture);

    // O ponto do teste: nenhuma consulta nova, e nenhum segundo POST de capturas — que
    // aliás receberia 409, porque criaria um segundo jogo de capturas na mesma consulta.
    m.controller.expectNone(`${API}/patients/p1/encounters`);
    m.controller.expectNone(`${API}/encounters/e1/captures`);

    // O que faltava subiu, e a análise fecha na MESMA consulta.
    expect(m.fetchFalso).toHaveBeenCalledTimes(2);
    m.controller.expectOne(`${API}/encounters/e1/analysis-status`).flush(null);

    drenarListas(m.controller);
    m.controller.verify();
  });

  it('não oferece recuperação enquanto o envio ainda está em curso', async () => {
    // O erro que este teste existe para impedir: `consultaSalva()` fica verdadeiro
    // assim que o createEncounter responde, ou seja ANTES de o upload começar. A tela
    // passava o envio inteiro — minutos, numa sequência — mostrando uma mensagem de
    // recuperação ("tentar de novo retoma de onde parou") enquanto nada tinha falhado.
    const m = await montar(coleta('optical'));

    // Segura o PUT no ar para inspecionar a tela no meio do envio.
    let liberar!: (r: Response) => void;
    m.fetchFalso.mockReturnValue(
      new Promise<Response>((resolve) => {
        liberar = resolve;
      }),
    );

    botao(m.fixture, 'Finalizar e gravar').click();
    await assentar(m.fixture);
    m.controller.expectOne(`${API}/patients/p1/encounters`).flush(CONSULTA_CRIADA);
    await assentar(m.fixture);
    m.controller.expectOne(`${API}/encounters/e1/captures`).flush({
      encounter_id: 'e1',
      uploads: [
        { capture_id: 'c1', capture_index: 0, kind: 'optical', url: 'https://bucket.local/o' },
      ],
    });
    await assentar(m.fixture);

    // Estamos no meio do upload: o PUT saiu e não voltou.
    expect(m.fetchFalso).toHaveBeenCalledTimes(1);
    const tela = m.fixture.nativeElement.textContent as string;

    expect(tela).toContain('Enviando');
    // Nada de recuperação: não falhou nada ainda. Vale para o texto E para os botões —
    // um botão desabilitado ainda ocupa a tela oferecendo saída de um problema que não
    // existe.
    expect(tela).not.toContain('Tentar enviar novamente');
    expect(tela).not.toContain('Ver a consulta salva');
    expect(tela).not.toContain('retoma');
    expect(tela).not.toContain('já estão salvos');
    // E nem as dicas de "o que gravar", que a consulta gravada já respondeu.
    expect(tela).not.toContain('Marque ao menos uma articulação');
    expect(tela).not.toContain('para poder finalizar');

    liberar({ ok: true, status: 200 } as Response);
    await assentar(m.fixture);
    m.controller.expectOne(`${API}/encounters/e1/analysis-status`).flush(null);
    drenarListas(m.controller);
    m.controller.verify();
  });

  it('reenvia só o arquivo que faltou, não os que já subiram', async () => {
    const m = await montar(coleta('optical', 'thermal'));

    // A óptica sobe; a térmica não.
    m.fetchFalso.mockImplementation((url: string) =>
      Promise.resolve({
        ok: url.endsWith('optical'),
        status: url.endsWith('optical') ? 200 : 403,
      } as Response),
    );
    await gravarComFalhaNoUpload(m, [
      { kind: 'optical', url: 'https://bucket.local/optical' },
      { kind: 'thermal', url: 'https://bucket.local/thermal' },
    ]);

    expect(m.fetchFalso).toHaveBeenCalledTimes(2);

    m.fetchFalso.mockClear();
    m.fetchFalso.mockResolvedValue({ ok: true, status: 200 } as Response);
    botao(m.fixture, 'Tentar enviar novamente').click();
    await assentar(m.fixture);

    // Só a térmica volta à fila: a óptica já está no bucket, e reenviá-la seria
    // refazer trabalho — o custo que `uploadAll` evita ao não abortar na 1ª falha.
    expect(m.fetchFalso).toHaveBeenCalledTimes(1);
    expect(m.fetchFalso.mock.calls[0][0]).toContain('thermal');

    m.controller.expectOne(`${API}/encounters/e1/analysis-status`).flush(null);
    drenarListas(m.controller);
    m.controller.verify();
  });
});
