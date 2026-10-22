import { test, expect } from '@playwright/test';

/**
 * Focused engine-boundary tests. These do not call a backend TTS endpoint and
 * do not download model weights; the live test is opt-in via KOKORO_LIVE=1.
 */
test.describe('local Kokoro voice engine', () => {
  test('import is lazy and never touches /api/tts or model assets', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/');

    await page.evaluate(() => {
      const OriginalWorker = window.Worker;
      (window as unknown as { __kokoroWorkers: number }).__kokoroWorkers = 0;
      window.Worker = class extends OriginalWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          (window as unknown as { __kokoroWorkers: number }).__kokoroWorkers += 1;
          super(url, options);
        }
      };
    });

    const afterLoad = requests.length;
    const result = await page.evaluate(async () => {
      const mod = await import('/src/lib/localVoice.ts');
      const info = mod.getLocalVoiceInfo();
      let error = '';
      try {
        await mod.generateLocalSpeech('hello');
      } catch (caught) {
        error = (caught as Error).message;
      }
      return {
        status: info.status,
        workers: (window as unknown as { __kokoroWorkers: number }).__kokoroWorkers,
        error,
      };
    });

    expect(result.status).toBe('not_loaded');
    expect(result.workers).toBe(0);
    expect(result.error).toContain('not prepared');

    const lazyRequests = requests.slice(afterLoad);
    expect(lazyRequests.some((url) => url.includes('/api/tts'))).toBe(false);
    expect(lazyRequests.some((url) => /huggingface\.co|cdn\.jsdelivr\.net/.test(url))).toBe(false);
  });

  test('worker startup failure becomes a clean unavailable status', async ({ page }) => {
    await page.goto('/');

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const result = await page.evaluate(async () => {
      window.Worker = class {
        constructor() {
          throw new Error('worker blocked by test');
        }
      } as unknown as typeof Worker;

      const mod = await import('/src/lib/localVoice.ts');
      const progress: string[] = [];
      const prepared = await mod.prepareLocalVoice((event: { status: string }) => {
        progress.push(event.status);
      });
      // A dispose during/after unavailable must remain harmless.
      mod.disposeLocalVoice();
      return {
        status: prepared.status,
        error: prepared.error,
        progress,
        current: mod.getLocalVoiceInfo().status,
      };
    });

    await page.waitForTimeout(100);
    expect(result.status).toBe('unavailable');
    expect(result.error).toContain('worker blocked by test');
    expect(result.progress).toContain('preparing');
    expect(result.current).toBe('not_loaded');
    expect(pageErrors).toEqual([]);
  });

  test('abort rejects cleanly and a stale worker result cannot settle a newer request', async ({
    page,
  }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      type Handler = (event: MessageEvent) => void;
      const listeners = new Map<string, Set<Handler>>();
      const sent: Array<{ type: string; requestId?: number }> = [];

      const emit = (data: unknown) => {
        for (const handler of listeners.get('message') ?? []) {
          handler({ data } as MessageEvent);
        }
      };

      class FakeWorker {
        addEventListener(type: string, handler: Handler) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(handler);
        }
        removeEventListener(type: string, handler: Handler) {
          listeners.get(type)?.delete(handler);
        }
        terminate() {}
        postMessage(message: { type: string; requestId?: number }) {
          sent.push(message);
          if (message.type === 'prepare') {
            setTimeout(
              () =>
                emit({
                  type: 'prepared',
                  requestId: message.requestId,
                  device: 'wasm',
                  elapsedMs: 1,
                }),
              0,
            );
          }
          if (message.type === 'generate') {
            // The canceled request returns late with deliberately different
            // bytes; the live request returns later still.
            const stale = message.requestId === 2;
            setTimeout(
              () =>
                emit({
                  type: 'audio',
                  requestId: message.requestId,
                  blob: new Blob([stale ? 'stale' : 'fresh'], { type: 'audio/wav' }),
                }),
              stale ? 30 : 120,
            );
          }
        }
      }

      window.Worker = FakeWorker as unknown as typeof Worker;

      const mod = await import('/src/lib/localVoice.ts');
      const [prepared] = await Promise.all([mod.prepareLocalVoice(), mod.prepareLocalVoice()]);

      const controller = new AbortController();
      const cancelled = mod.generateLocalSpeech('first', { signal: controller.signal });
      controller.abort();

      let abortName = '';
      let abortMessage = '';
      try {
        await cancelled;
      } catch (error) {
        abortName = (error as DOMException).name;
        abortMessage = (error as Error).message;
      }

      const second = await mod.generateLocalSpeech('second');
      const text = await second.text();
      return {
        status: prepared.status,
        abortName,
        abortMessage,
        text,
        type: second.type,
        cancelled: sent.some((message) => message.type === 'cancel'),
        prepareRequests: sent.filter((message) => message.type === 'prepare').length,
      };
    });

    expect(result.status).toBe('ready');
    expect(result.abortName).toBe('AbortError');
    expect(result.abortMessage).toContain('cancelled');
    expect(result.type).toBe('audio/wav');
    expect(result.text).toBe('fresh');
    expect(result.cancelled).toBe(true);
    expect(result.prepareRequests).toBe(1);
  });

  test('real model initialization and generation', async ({ page }) => {
    test.skip(!process.env.KOKORO_LIVE, 'Set KOKORO_LIVE=1 to download and run Kokoro-82M.');
    test.setTimeout(10 * 60_000);

    page.on('console', (message) => {
      if (message.text().startsWith('[kokoro]')) console.log(message.text());
    });
    page.on('pageerror', (error) => console.log(`[kokoro-live] pageerror: ${error.message}`));

    const seenRequests = new Set<string>();
    page.on('request', (request) => {
      const url = request.url();
      if (!/huggingface\.co|jsdelivr\.net|\.onnx|\.wasm|\/api\/tts/.test(url)) return;
      if (seenRequests.has(url)) return;
      seenRequests.add(url);
      console.log(`[kokoro-live] request ${url}`);
    });

    await page.goto('/');

    const run = () =>
      page.evaluate(async () => {
        const mod = await import('/src/lib/localVoice.ts');
        const prepareStarted = performance.now();
        const prepared = await mod.prepareLocalVoice();
        const prepareMs = performance.now() - prepareStarted;

        if (prepared.status !== 'ready') {
          return { prepared, prepareMs, generateMs: 0, size: 0, type: '' };
        }

        const generateStarted = performance.now();
        const blob = await mod.generateLocalSpeech('RoutePilot local voice is ready.');
        const generateMs = performance.now() - generateStarted;
        return { prepared, prepareMs, generateMs, size: blob.size, type: blob.type };
      });

    // Vite's dev optimizer may discover kokoro-js on the first worker import and
    // force one full reload. Retry after that navigation; production builds do
    // not do this.
    let result: Awaited<ReturnType<typeof run>> | undefined;
    for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
      try {
        result = await run();
      } catch (error) {
        if (!/Execution context was destroyed|navigation/i.test(String(error))) throw error;
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1_000);
      }
    }
    if (!result) throw new Error('Local voice page kept navigating during prepare.');

    console.log(
      `[kokoro-live] device=${result.prepared.device} prepare=${Math.round(result.prepareMs)}ms ` +
        `generate=${Math.round(result.generateMs)}ms bytes=${result.size} type=${result.type}`,
    );

    expect(result.prepared.status).toBe('ready');
    expect(result.prepared.modelId).toBe('onnx-community/Kokoro-82M-v1.0-ONNX');
    expect(result.prepared.voice).toBe('af_heart');
    expect(result.type).toBe('audio/wav');
    expect(result.size).toBeGreaterThan(1000);
  });
});
