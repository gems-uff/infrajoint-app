/**
 * Envio dos arquivos de captura direto para o R2, com as URLs que o backend assinou.
 *
 * Os bytes nunca passam pelo backend: uma sequência de 21 capturas são ~48 MB, e
 * atravessar a instância seria lento e comeria memória. O backend assina e sai da
 * frente.
 *
 * Usa `fetch` e não `HttpClient` de propósito. O interceptor anexa o JWT do Supabase
 * a tudo que começa com `apiBaseUrl` — o R2 não começa, então hoje estaria a salvo;
 * mas mandar `Authorization` para um PUT assinado quebraria a assinatura, e depender
 * do escopo do interceptor para isso não valer é frágil demais para dezenas de MB.
 */

/** Um arquivo pronto para subir, casado com a URL que o backend assinou para ele. */
export interface PendingUpload {
  readonly url: string;
  readonly body: Blob;
  /**
   * Precisa ser **exatamente** o Content-Type que entrou na assinatura. O backend
   * assina `put_object` com ele; divergir aqui faz o R2 responder 403 — que parece
   * permissão e é, na verdade, cabeçalho errado.
   */
  readonly contentType: string;
  /** Aparece no progresso e na lista de falhas: "captura 3: matrix". */
  readonly describe: string;
}

/** Quanto já subiu. Bytes, e não só contagem: os arquivos variam 50× de tamanho. */
export interface UploadProgress {
  readonly done: number;
  readonly total: number;
  readonly bytesDone: number;
  readonly bytesTotal: number;
  /** O que acabou de subir, para a tela poder listar o que já foi. */
  readonly lastDescribe: string;
}

export interface UploadOptions {
  readonly concurrency?: number;
  /** Tentativas por arquivo, incluindo a primeira. */
  readonly attempts?: number;
  /**
   * Chamado no máximo a cada `progressIntervalMs` — com 63 arquivos, avisar a
   * cada um dispara 63 ciclos de detecção de mudanças competindo com o envio.
   */
  readonly onProgress?: (progress: UploadProgress) => void;
  readonly progressIntervalMs?: number;
  readonly fetchFn?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<void>;
  /** Injetável para o teste não depender do relógio. */
  readonly nowFn?: () => number;
}

export class UploadFailedError extends Error {
  constructor(
    readonly describe: string,
    readonly status: number | null,
    cause?: unknown,
  ) {
    super(
      status === null
        ? `Falha de rede ao enviar ${describe}.`
        : `Falha ao enviar ${describe} (HTTP ${status}).`,
    );
    this.name = 'UploadFailedError';
    this.cause = cause;
  }
}

/** Quanto cada arquivo custou. Serve para achar gargalo com número, não palpite. */
export interface UploadTiming {
  readonly describe: string;
  readonly bytes: number;
  /** Tempo só do PUT que deu certo (ou da última tentativa). */
  readonly millis: number;
  /** Tentativas gastas. Maior que 1 significa que houve falha transitória. */
  readonly attempts: number;
  /** Espera antes do PUT começar, por causa do teto de simultaneidade. */
  readonly queuedMillis: number;
}

/** O que sobrou sem subir. Vazio significa que tudo chegou ao bucket. */
export interface UploadOutcome {
  readonly failed: readonly UploadFailedError[];
  readonly timings: readonly UploadTiming[];
  /** Do início da fila ao último arquivo. */
  readonly totalMillis: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repetir só faz sentido para falha transitória.
 *
 * 403 do R2 significa assinatura inválida ou expirada, e 404 significa bucket errado
 * — insistir nos dois só atrasa o erro. 408, 429 e 5xx são passageiros.
 */
function vaiAdiantarRepetir(status: number | null): boolean {
  if (status === null) {
    return true; // erro de rede
  }
  return status === 408 || status === 429 || status >= 500;
}

async function enviarUm(
  item: PendingUpload,
  attempts: number,
  fetchFn: typeof fetch,
  sleepFn: (ms: number) => Promise<void>,
  agora: () => number,
): Promise<{ falha: UploadFailedError | null; millis: number; attempts: number }> {
  let ultimo: UploadFailedError | null = null;
  let gastas = 0;
  let millis = 0;

  for (let tentativa = 1; tentativa <= attempts; tentativa++) {
    gastas = tentativa;
    const inicio = agora();
    let status: number | null = null;
    try {
      const resposta = await fetchFn(item.url, {
        method: 'PUT',
        body: item.body,
        headers: { 'Content-Type': item.contentType },
      });
      millis = agora() - inicio;
      if (resposta.ok) {
        return { falha: null, millis, attempts: gastas };
      }
      status = resposta.status;
      ultimo = new UploadFailedError(item.describe, status);
    } catch (cause) {
      millis = agora() - inicio;
      ultimo = new UploadFailedError(item.describe, null, cause);
    }

    if (tentativa === attempts || !vaiAdiantarRepetir(status)) {
      break;
    }
    // Espera crescente: 300ms, 600ms, 1200ms…
    await sleepFn(300 * 2 ** (tentativa - 1));
  }

  return {
    falha: ultimo ?? new UploadFailedError(item.describe, null),
    millis,
    attempts: gastas,
  };
}

/**
 * Sobe todos os arquivos, no máximo `concurrency` de cada vez.
 *
 * **Não aborta na primeira falha.** Numa sequência de 63 arquivos, parar no
 * décimo deixaria 53 sem subir por causa de um problema que pode ser de um só —
 * e o médico teria que refazer tudo. Sobe o que der e devolve o que faltou, para
 * a tela dizer exatamente quais arquivos precisam de nova tentativa.
 *
 * O retry é **por arquivo**: uma captura que falhe é reenviada sozinha, sem
 * refazer as outras. É por isso que cada captura é uma linha no banco e não um
 * item de array — reenviar dentro de um array exigiria reescrever o array inteiro.
 */
export async function uploadAll(
  items: readonly PendingUpload[],
  options: UploadOptions = {},
): Promise<UploadOutcome> {
  const {
    concurrency = 6,
    attempts = 3,
    onProgress,
    fetchFn = fetch,
    sleepFn = sleep,
    nowFn = () => performance.now(),
    progressIntervalMs = 250,
  } = options;
  const failed: UploadFailedError[] = [];
  const timings: UploadTiming[] = [];
  if (items.length === 0) {
    return { failed, timings, totalMillis: 0 };
  }

  const bytesTotal = items.reduce((soma, item) => soma + item.body.size, 0);
  const inicioFila = nowFn();
  let proximo = 0;
  let done = 0;
  let bytesDone = 0;
  let ultimoAviso = 0;

  const trabalhador = async (): Promise<void> => {
    while (proximo < items.length) {
      const item = items[proximo++];
      const enfileirado = nowFn();
      const r = await enviarUm(item, attempts, fetchFn, sleepFn, nowFn);
      timings.push({
        describe: item.describe,
        bytes: item.body.size,
        millis: r.millis,
        attempts: r.attempts,
        queuedMillis: enfileirado - inicioFila,
      });
      if (r.falha) {
        failed.push(r.falha);
      } else {
        bytesDone += item.body.size;
      }
      done++;
      const agora = nowFn();
      if (done === items.length || agora - ultimoAviso >= progressIntervalMs) {
        ultimoAviso = agora;
        onProgress?.({
          done,
          total: items.length,
          bytesDone,
          bytesTotal,
          lastDescribe: item.describe,
        });
      }
    }
  };

  // Sem `Promise.all` que rejeita no meio: os trabalhadores nunca lançam, então
  // todos terminam a fila e nenhum fica órfão subindo em segundo plano depois de
  // o chamador já ter desistido.
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, trabalhador));
  return { failed, timings, totalMillis: nowFn() - inicioFila };
}

/**
 * Resumo legível dos tempos, para achar gargalo com número em vez de palpite.
 *
 * `tempo somado` muito abaixo do `total decorrido` significa que os PUTs não são o
 * gargalo — o tempo está fora deles, na thread principal.
 */
export function describeTimings(outcome: UploadOutcome): string {
  const { timings, totalMillis } = outcome;
  if (timings.length === 0) {
    return 'nenhum arquivo enviado';
  }
  const bytes = timings.reduce((s, t) => s + t.bytes, 0);
  const somaPut = timings.reduce((s, t) => s + t.millis, 0);
  const retentados = timings.filter((t) => t.attempts > 1);
  const maisLentos = [...timings].sort((a, b) => b.millis - a.millis).slice(0, 3);

  return [
    `${timings.length} arquivos, ${(bytes / 1e6).toFixed(1)} MB`,
    `total decorrido: ${(totalMillis / 1000).toFixed(1)}s`,
    `vazão efetiva: ${(bytes / 1e6 / (totalMillis / 1000)).toFixed(2)} MB/s`,
    `tempo somado dentro dos PUTs: ${(somaPut / 1000).toFixed(1)}s`,
    `arquivos com retry: ${retentados.length}`,
    `mais lentos: ${maisLentos.map((t) => `${t.describe} ${(t.millis / 1000).toFixed(1)}s`).join(', ')}`,
  ].join('\n  ');
}
