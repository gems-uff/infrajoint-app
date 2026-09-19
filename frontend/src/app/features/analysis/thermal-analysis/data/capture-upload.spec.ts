import { PendingUpload, UploadFailedError, describeTimings, uploadAll } from './capture-upload';

function item(nome: string, bytes = 1): PendingUpload {
  return {
    url: `https://bucket.local/${nome}`,
    body: new Blob(['x'.repeat(bytes)]),
    contentType: 'image/jpeg',
    describe: nome,
  };
}

/** `fetch` de mentira com roteiro por URL, contando chamadas e simultaneidade. */
function fakeFetch(roteiro: Record<string, (n: number) => number | 'rede'>) {
  const chamadas: Record<string, number> = {};
  let emVoo = 0;
  let pico = 0;
  const enviados: string[] = [];

  const fn = (async (url: string, init: RequestInit) => {
    emVoo++;
    pico = Math.max(pico, emVoo);
    await Promise.resolve();
    const nome = url.split('/').pop()!;
    chamadas[nome] = (chamadas[nome] ?? 0) + 1;
    const resultado = roteiro[nome]?.(chamadas[nome]) ?? 200;
    emVoo--;
    if (resultado === 'rede') {
      throw new TypeError('Failed to fetch');
    }
    if (resultado === 200) {
      enviados.push(`${nome}:${(init.headers as Record<string, string>)['Content-Type']}`);
    }
    return { ok: resultado === 200, status: resultado } as Response;
  }) as unknown as typeof fetch;

  return { fn, chamadas, enviados, pico: () => pico };
}

/** Sem espera real: o teste prova a política de retry, não o relógio. */
const semEspera = (): Promise<void> => Promise.resolve();

describe('uploadAll', () => {
  it('envia tudo e informa o progresso', async () => {
    const { fn, enviados } = fakeFetch({});
    const progresso: number[] = [];

    const resultado = await uploadAll([item('a'), item('b'), item('c')], {
      fetchFn: fn,
      sleepFn: semEspera,
      progressIntervalMs: 0,
      onProgress: (p) => progresso.push(p.done),
    });

    expect(enviados).toHaveLength(3);
    expect(progresso).toEqual([1, 2, 3]);
    expect(resultado.failed).toEqual([]);
  });

  it('manda o Content-Type que foi assinado', async () => {
    const { fn, enviados } = fakeFetch({});
    await uploadAll([item('a')], { fetchFn: fn, sleepFn: semEspera });

    // Divergir do que entrou na assinatura faz o R2 responder 403 — que parece
    // problema de permissão e é, na verdade, cabeçalho errado.
    expect(enviados).toEqual(['a:image/jpeg']);
  });

  it('respeita o teto de simultaneidade', async () => {
    const { fn, pico } = fakeFetch({});
    await uploadAll(
      Array.from({ length: 63 }, (_, i) => item(`c${i}`)),
      { fetchFn: fn, sleepFn: semEspera, concurrency: 6 },
    );
    expect(pico()).toBeLessThanOrEqual(6);
  });

  it('informa bytes, não só contagem — os arquivos variam 50x de tamanho', async () => {
    const { fn } = fakeFetch({});
    const leituras: { done: number; bytesDone: number; bytesTotal: number }[] = [];

    await uploadAll([item('pequeno', 100), item('grande', 2_000_000)], {
      fetchFn: fn,
      sleepFn: semEspera,
      concurrency: 1,
      progressIntervalMs: 0,
      onProgress: (p) => leituras.push({ ...p }),
    });

    expect(leituras.at(-1)!.bytesDone).toBe(2_000_100);
    expect(leituras.at(-1)!.bytesTotal).toBe(2_000_100);
  });

  it('repete só o arquivo que falhou, não os outros', async () => {
    const { fn, chamadas } = fakeFetch({ b: (n) => (n < 3 ? 500 : 200) });

    await uploadAll([item('a'), item('b'), item('c')], {
      fetchFn: fn,
      sleepFn: semEspera,
      attempts: 3,
    });

    expect(chamadas).toEqual({ a: 1, b: 3, c: 1 });
  });

  it('repete em erro de rede', async () => {
    const { fn, chamadas } = fakeFetch({ a: (n) => (n === 1 ? 'rede' : 200) });
    await uploadAll([item('a')], { fetchFn: fn, sleepFn: semEspera });
    expect(chamadas['a']).toBe(2);
  });

  it('NÃO repete em 403 — assinatura inválida não melhora com insistência', async () => {
    const { fn, chamadas } = fakeFetch({ a: () => 403 });

    const resultado = await uploadAll([item('a')], {
      fetchFn: fn,
      sleepFn: semEspera,
      attempts: 5,
    });

    expect(resultado.failed[0]).toBeInstanceOf(UploadFailedError);
    expect(chamadas['a']).toBe(1);
  });

  it('uma falha NÃO impede os outros arquivos de subirem', async () => {
    // Parar no décimo de 63 deixaria 53 sem subir por causa de um problema que
    // pode ser de um só — e o médico teria que refazer tudo.
    const { fn, chamadas, enviados } = fakeFetch({ b: () => 500 });

    const resultado = await uploadAll([item('a'), item('b'), item('c'), item('d')], {
      fetchFn: fn,
      sleepFn: semEspera,
      attempts: 2,
    });

    expect(resultado.failed.map((f) => f.describe)).toEqual(['b']);
    expect(enviados.map((e) => e.split(':')[0]).sort()).toEqual(['a', 'c', 'd']);
    expect(chamadas['b']).toBe(2);
  });

  it('lista vazia não faz requisição nenhuma', async () => {
    const { fn, chamadas } = fakeFetch({});
    const resultado = await uploadAll([], { fetchFn: fn, sleepFn: semEspera });
    expect(chamadas).toEqual({});
    expect(resultado.failed).toEqual([]);
  });
});

describe('describeTimings', () => {
  it('separa tempo dentro dos PUTs do decorrido total', async () => {
    // É essa diferença que distingue "rede lenta" de "gargalo na thread principal".
    let relogio = 0;
    const { fn } = fakeFetch({});

    const resultado = await uploadAll([item('a', 1_000_000), item('b', 1_000_000)], {
      fetchFn: fn,
      sleepFn: semEspera,
      concurrency: 1,
      nowFn: () => (relogio += 100),
    });

    expect(resultado.timings).toHaveLength(2);
    expect(resultado.totalMillis).toBeGreaterThan(0);
    const resumo = describeTimings(resultado);
    expect(resumo).toContain('2 arquivos');
    expect(resumo).toContain('2.0 MB');
  });

  it('conta os arquivos que precisaram de nova tentativa', async () => {
    const { fn } = fakeFetch({ b: (n) => (n < 2 ? 500 : 200) });
    const resultado = await uploadAll([item('a'), item('b')], {
      fetchFn: fn,
      sleepFn: semEspera,
    });

    expect(resultado.timings.find((t) => t.describe === 'b')!.attempts).toBe(2);
    expect(describeTimings(resultado)).toContain('arquivos com retry: 1');
  });
});

describe('limite de avisos de progresso', () => {
  it('avisa no máximo a cada intervalo, mas nunca engole o último', async () => {
    // Com 63 arquivos, avisar a cada um dispara 63 ciclos de detecção de mudanças
    // competindo com o envio — que é exatamente o que se quer evitar.
    let relogio = 0;
    const { fn } = fakeFetch({});
    const avisos: number[] = [];

    await uploadAll(
      Array.from({ length: 10 }, (_, i) => item(`c${i}`)),
      {
        fetchFn: fn,
        sleepFn: semEspera,
        concurrency: 1,
        nowFn: () => (relogio += 10),
        progressIntervalMs: 1000,
        onProgress: (p) => avisos.push(p.done),
      },
    );

    expect(avisos.length).toBeLessThan(10);
    expect(avisos.at(-1)).toBe(10);
  });
});
