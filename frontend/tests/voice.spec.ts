import { test, expect, type Page, type Route } from '@playwright/test';

// Deterministic voice-engine tests. A fake Worker simulates the Kokoro module
// worker (prepare/generate/cancel) so nothing downloads model weights, and a
// stub speechSynthesis keeps browser fallback deterministic. No test touches
// /api/tts; any such request is counted and asserted to be zero.

const basePlan = {
  id: 'plan-voice',
  origin: { name: 'Home', lat: 18.5, lon: 73.8 },
  destination: { name: 'Pune Airport', lat: 18.57, lon: 73.9 },
  departureTime: '2026-10-07T05:58:00Z',
  actualEta: '2026-10-07T06:50:00Z',
  arrivalDeadline: '2026-10-07T07:00:00Z',
  durationMinutes: 52,
  drivingDurationMinutes: 52,
  stopDurationMinutes: 0,
  distanceKm: 21.4,
  bufferMinutes: 10,
  routeGeometry: {
    type: 'LineString',
    coordinates: [[73.8, 18.5], [73.9, 18.57]],
  },
  constraintEvaluations: [
    { type: 'avoid_tolls', severity: 'hard', status: 'satisfied' },
  ],
};

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface HarnessConfig {
  prepareError?: string | null;
  prepareHold?: boolean;
  prepareDelay?: number;
  generateHold?: boolean;
  generateDelay?: number;
  /** null keeps local audio "playing" so the speaking state stays visible. */
  audioEndDelay?: number | null;
  noSpeech?: boolean;
  noWorker?: boolean;
  speechAutoEnd?: boolean;
}

/**
 * Installs, before app code runs:
 * - a fake Worker that answers prepare/generate like the Kokoro worker;
 * - a fake speechSynthesis (unless noSpeech) that records utterances;
 * - an HTMLMediaElement.play stub so audio never needs real output.
 * Control state is exposed on window.__voiceFake for assertions.
 */
async function installVoiceHarness(page: Page, config: HarnessConfig = {}) {
  await page.addInitScript((seed: HarnessConfig) => {
    const w = window as any;
    const control: any = {
      config: {
        prepareError: null,
        prepareHold: false,
        prepareDelay: 0,
        generateHold: false,
        generateDelay: 0,
        audioEndDelay: null,
        noSpeech: false,
        noWorker: false,
        speechAutoEnd: false,
        ...seed,
      },
      workers: 0,
      kokoroWorkers: 0,
      workerUrls: [],
      messages: [],
      prepareRequests: [],
      generateRequests: [],
      cancelled: [],
      audioInfo: [],
      utterances: [],
      speechCancelCount: 0,
      audioPlays: 0,
      audioPauses: 0,
      terminated: 0,
      _worker: null,
    };
    w.__voiceFake = control;

    // 44-byte WAV header + a few silent 16-bit samples.
    const makeWav = () => {
      const sampleRate = 8000;
      const samples = 8;
      const dataSize = samples * 2;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const write = (offset: number, text: string) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
      };
      write(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      write(8, 'WAVE');
      write(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, 'data');
      view.setUint32(40, dataSize, true);
      return new Blob([buffer], { type: 'audio/wav' });
    };

    const emitAudio = (worker: any, requestId: number) => {
      const blob = makeWav();
      const entry = { type: blob.type, size: blob.size, riff: '' };
      control.audioInfo.push(entry);
      blob.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        entry.riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      });
      worker.dispatch({ type: 'audio', requestId, blob });
    };
    control.emitAudio = (requestId: number) => {
      if (control._worker) emitAudio(control._worker, requestId);
    };
    control.resolveGenerate = (requestId: number) => {
      if (control._worker) emitAudio(control._worker, requestId);
    };
    control.resolvePrepare = (requestId: number) => {
      control._worker?.dispatch({
        type: 'prepared',
        requestId,
        device: 'wasm',
        elapsedMs: 1,
      });
    };

    if (seed.noSpeech) {
      // "speechSynthesis" in window must be false, so remove it from the
      // instance and the Window prototype (where Chrome defines it).
      try { delete w.speechSynthesis; } catch { /* ignore */ }
      try { delete Object.getPrototypeOf(w).speechSynthesis; } catch { /* ignore */ }
      try { delete w.SpeechSynthesisUtterance; } catch { /* ignore */ }
    } else {
      class FakeUtterance {
        text: string;
        lang = '';
        rate = 1;
        voice: unknown = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      Object.defineProperty(w, 'SpeechSynthesisUtterance', {
        configurable: true,
        value: FakeUtterance,
      });
      Object.defineProperty(w, 'speechSynthesis', {
        configurable: true,
        value: {
          getVoices: () => [{ name: 'Fake English', lang: 'en-US' }],
          speak: (utterance: any) => {
            control.utterances.push(utterance.text);
            if (control.config.speechAutoEnd) {
              setTimeout(() => utterance.onend?.(), 10);
            }
          },
          cancel: () => {
            control.speechCancelCount += 1;
          },
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      });
    }

    if (seed.noWorker) {
      try { delete w.Worker; } catch { /* ignore */ }
      try { delete Object.getPrototypeOf(w).Worker; } catch { /* ignore */ }
      if (typeof w.Worker !== 'undefined') {
        try {
          Object.defineProperty(w, 'Worker', { configurable: true, value: undefined });
        } catch { /* ignore */ }
      }
    } else {
      class FakeWorker {
        listeners: Record<string, Array<(event: any) => void>> = {
          message: [],
          error: [],
          messageerror: [],
        };
        terminated = false;
        isKokoro: boolean;

        constructor(public url: string | URL, public options?: WorkerOptions) {
          control.workers += 1;
          const urlText = String(url);
          control.workerUrls.push(urlText);
          this.isKokoro = /kokoroTts\.worker/i.test(urlText);
          if (this.isKokoro) {
            control.kokoroWorkers += 1;
            control._worker = this;
          }
        }

        addEventListener(type: string, listener: (event: any) => void) {
          (this.listeners[type] ||= []).push(listener);
        }

        removeEventListener(type: string, listener: (event: any) => void) {
          const list = this.listeners[type];
          if (!list) return;
          const index = list.indexOf(listener);
          if (index >= 0) list.splice(index, 1);
        }

        terminate() {
          this.terminated = true;
          control.terminated += 1;
        }

        dispatch(data: any) {
          if (this.terminated) return;
          for (const listener of this.listeners.message || []) {
            listener.call(this, { data });
          }
        }

        postMessage(message: any) {
          control.messages.push(message);
          if (!this.isKokoro) return;
          if (message.type === 'prepare') {
            control.prepareRequests.push(message.requestId);
            if (control.config.prepareHold) return;
            setTimeout(() => {
              if (control.config.prepareError) {
                this.dispatch({
                  type: 'error',
                  requestId: message.requestId,
                  stage: 'prepare',
                  message: control.config.prepareError,
                });
                return;
              }
              this.dispatch({
                type: 'progress',
                requestId: message.requestId,
                status: 'preparing',
                progress: 42,
                file: 'model.onnx',
              });
              this.dispatch({
                type: 'prepared',
                requestId: message.requestId,
                device: 'wasm',
                elapsedMs: 1,
              });
            }, control.config.prepareDelay ?? 0);
            return;
          }
          if (message.type === 'generate') {
            control.generateRequests.push({
              requestId: message.requestId,
              text: message.text,
            });
            if (control.config.generateHold) return;
            setTimeout(
              () => emitAudio(this, message.requestId),
              control.config.generateDelay ?? 0,
            );
            return;
          }
          if (message.type === 'cancel') {
            control.cancelled.push(message.requestId);
          }
        }
      }

      Object.defineProperty(w, 'Worker', {
        configurable: true,
        writable: true,
        value: FakeWorker,
      });
    }

    // Never load real audio; optionally fire "ended" to model playback ending.
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      control.audioPlays += 1;
      const delay = control.config.audioEndDelay;
      if (delay !== null && delay !== undefined) {
        setTimeout(() => this.dispatchEvent(new Event('ended')), delay);
      }
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      control.audioPauses += 1;
    };
  }, config);
}

async function mockApis(page: Page, message = 'Route ready.') {
  const counter = { tts: 0, chat: 0 };
  await page.route('**/api/chat', (route) => {
    counter.chat += 1;
    return fulfillJson(route, { message, travelPlan: basePlan });
  });
  await page.route('**/api/plan*', (route) => fulfillJson(route, { travelPlan: basePlan }));
  await page.route('**/api/tts', (route) => {
    counter.tts += 1;
    return fulfillJson(route, { error: 'unexpected TTS request' }, 500);
  });
  return counter;
}

async function send(page: Page, text: string) {
  await page.getByLabel('Message input').fill(text);
  const button = page.getByRole('button', { name: 'Send message' });
  await expect(button).toBeEnabled();
  await button.click();
}

const fake = (page: Page) =>
  page.evaluate(() => (window as any).__voiceFake as Record<string, any>);

const speaking = (page: Page) => page.getByText(/Speaking on-device/);
const generating = (page: Page) =>
  page.getByText('Generating on-device speech…', { exact: true });
const preparing = (page: Page) => page.getByText(/Preparing on-device voice/);

test.describe('Voice engine: deterministic local + browser behavior', () => {
  test('1. default voice mode is On-device and initializes no model', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await installVoiceHarness(page);

    await page.goto('/');

    await expect(page.getByLabel('Voice engine')).toHaveValue('local');
    await expect(
      page.getByText('On-device voice (loads on first reply)', { exact: true }),
    ).toBeVisible();

    expect((await fake(page)).kokoroWorkers).toBe(0);
    expect(
      requests.some((url) => /huggingface\.co|hf\.co|cdn\.jsdelivr\.net/.test(url)),
    ).toBe(false);
    expect(requests.some((url) => url.includes('/api/tts'))).toBe(false);
  });

  test('2. choosing Browser persists to localStorage and survives a reload', async ({ page }) => {
    await installVoiceHarness(page);
    await page.goto('/');

    const engine = page.getByLabel('Voice engine');
    await engine.selectOption('browser');
    await expect(engine).toHaveValue('browser');
    expect(
      await page.evaluate(() => localStorage.getItem('routepilot.voice-mode')),
    ).toBe('browser');

    await page.reload();

    await expect(page.getByLabel('Voice engine')).toHaveValue('browser');
    await expect(page.getByText('Browser voice selected', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('routepilot.voice-mode')),
    ).toBe('browser');
  });

  test('3. default local mode never calls /api/tts after an assistant reply', async ({ page }) => {
    const counter = await mockApis(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await installVoiceHarness(page);

    await page.goto('/');
    await send(page, 'Plan my trip.');

    await expect(speaking(page).first()).toBeVisible();
    await page.waitForTimeout(150);

    expect(counter.tts).toBe(0);
    expect(requests.some((url) => url.includes('/api/tts'))).toBe(false);
    expect(
      requests.some((url) => /huggingface\.co|hf\.co|cdn\.jsdelivr\.net/.test(url)),
    ).toBe(false);
  });

  test('4. browser mode announces "Speaking with browser voice"', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page);
    await page.goto('/');

    await page.getByLabel('Voice engine').selectOption('browser');
    await send(page, 'Plan my trip.');

    await expect(page.getByText(/Speaking with browser voice/).first()).toBeVisible();
    const state = await fake(page);
    expect(state.utterances).toContain('Route ready.');
  });

  test('5. local preparation state is visible', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page, { prepareHold: true });
    await page.goto('/');

    await send(page, 'Plan my trip.');

    await expect(preparing(page).first()).toBeVisible();
    expect((await fake(page)).prepareRequests).toHaveLength(1);
  });

  test('6. local ready state is visible after prepare and playback finish', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page, { audioEndDelay: 60 });
    await page.goto('/');

    await send(page, 'Plan my trip.');

    await expect(page.getByText('On-device voice ready', { exact: true })).toBeVisible();
    expect((await fake(page)).prepareRequests).toHaveLength(1);
  });

  test('7. local generating state is visible while the worker synthesizes', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page, { generateHold: true });
    await page.goto('/');

    await send(page, 'Plan my trip.');

    await expect(generating(page)).toBeVisible();
    expect((await fake(page)).generateRequests).toHaveLength(1);
  });

  test('8. local speaking state is visible with a valid tiny WAV blob', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page);
    await page.goto('/');

    await send(page, 'Plan my trip.');

    await expect(speaking(page).first()).toBeVisible();
    await expect(page.getByLabel('Stop reading aloud')).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => (window as any).__voiceFake.audioInfo[0]?.riff))
      .toBe('RIFF');
    const audio = await page.evaluate(() =>
      (window as any).__voiceFake.audioInfo[0],
    );
    expect(audio.type).toBe('audio/wav');
    expect(audio.size).toBeGreaterThan(44);
    expect((await fake(page)).audioPlays).toBeGreaterThan(0);
  });

  test('9. local init failure falls back visibly to browser voice', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page, {
      prepareError: 'Failed to download model',
      speechAutoEnd: true,
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await send(page, 'Plan my trip.');

    await expect(
      page.getByText('On-device voice unavailable · browser fallback', { exact: true }),
    ).toBeVisible();
    const state = await fake(page);
    expect(state.prepareRequests).toHaveLength(1);
    expect(state.utterances.length).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('10. missing browser speech yields a recoverable "Speech unavailable" state', async ({
    page,
  }) => {
    await mockApis(page);
    await installVoiceHarness(page, { noSpeech: true, noWorker: true });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');

    await expect(page.getByText('Voice unavailable', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Speech unavailable in this browser', { exact: true }),
    ).toBeVisible();

    await send(page, 'Plan my trip.');
    await expect(page.getByText('Route ready.')).toBeVisible();
    await expect(
      page.getByText('Speech unavailable in this browser', { exact: true }),
    ).toBeVisible();

    // Recoverable: the composer still accepts another turn.
    await send(page, 'Try again.');
    await expect(page.getByText('Route ready.')).toHaveCount(2);

    // Removing global Worker is a fixture artifact: MapLibre needs one too.
    // Only that expected error is tolerated; anything else fails the test.
    expect(pageErrors.filter((message) => !/Worker is not defined/.test(message))).toEqual([]);
  });

  test('11. mute stops local playback and cancels pending generation', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page);
    await page.goto('/');

    await send(page, 'Plan my trip.');
    await expect(speaking(page).first()).toBeVisible();

    await page.getByLabel('Mute voice replies').click();
    await expect(speaking(page)).toHaveCount(0);
    await expect(page.getByText('Voice replies muted', { exact: true })).toBeVisible();

    // Enable again, then start a held generation and mute while it is pending.
    await page.evaluate(() => {
      (window as any).__voiceFake.config.generateHold = true;
    });
    await page.getByLabel('Enable voice replies').click();
    await page.getByLabel('Read response aloud').first().click();
    await expect(generating(page)).toBeVisible();

    const before = await fake(page);
    const pendingId = before.generateRequests[before.generateRequests.length - 1].requestId;

    await page.getByLabel('Mute voice replies').click();
    await expect(generating(page)).toHaveCount(0);

    const after = await fake(page);
    expect(after.cancelled).toContain(pendingId);
    await expect(speaking(page)).toHaveCount(0);

    // A cancelled request that resolves late must not start speaking.
    await page.evaluate((id) => (window as any).__voiceFake.emitAudio(id), pendingId);
    await page.waitForTimeout(100);
    await expect(speaking(page)).toHaveCount(0);
  });

  test('12. "Stop voice" removes speaking and stale audio cannot resume', async ({ page }) => {
    await mockApis(page);
    await installVoiceHarness(page);
    await page.goto('/');

    await send(page, 'Plan my trip.');
    await expect(speaking(page).first()).toBeVisible();

    const state = await fake(page);
    const requestId = state.generateRequests[state.generateRequests.length - 1].requestId;

    await page.getByLabel('Stop reading aloud').click();

    await expect(page.getByText('Speech stopped', { exact: true })).toBeVisible();
    await expect(speaking(page)).toHaveCount(0);
    await expect(page.getByLabel('Stop reading aloud')).toHaveCount(0);
    expect((await fake(page)).audioPauses).toBeGreaterThan(0);

    // Simulate a worker audio message arriving after the user stopped.
    await page.evaluate((id) => (window as any).__voiceFake.emitAudio(id), requestId);
    await page.waitForTimeout(150);

    await expect(speaking(page)).toHaveCount(0);
    await expect(page.getByText('Speech stopped', { exact: true })).toBeVisible();
  });

  test('13. a new assistant reply supersedes earlier speech', async ({ page }) => {
    let turn = 0;
    await page.route('**/api/chat', (route) => {
      turn += 1;
      return fulfillJson(route, {
        message: turn === 1 ? 'First reply.' : 'Second reply.',
        travelPlan: basePlan,
      });
    });
    await page.route('**/api/plan*', (route) => fulfillJson(route, { travelPlan: basePlan }));
    await page.route('**/api/tts', (route) =>
      fulfillJson(route, { error: 'unexpected TTS request' }, 500),
    );
    await installVoiceHarness(page, { generateHold: true });
    await page.goto('/');

    await send(page, 'Turn one.');
    await expect(page.getByText('First reply.')).toBeVisible();
    await expect(generating(page)).toBeVisible();

    await send(page, 'Turn two.');
    await expect(page.getByText('Second reply.')).toBeVisible();
    await expect
      .poll(async () => (await fake(page)).generateRequests.length)
      .toBe(2);

    const state = await fake(page);
    const [first, second] = state.generateRequests;
    expect(first.text).toContain('First reply.');
    expect(second.text).toContain('Second reply.');
    await expect
      .poll(async () => (await fake(page)).cancelled)
      .toContain(first.requestId);

    // The superseded request resolving late is ignored.
    await page.evaluate((id) => (window as any).__voiceFake.resolveGenerate(id), first.requestId);
    await page.waitForTimeout(100);
    await expect(speaking(page)).toHaveCount(0);
    await expect(generating(page)).toBeVisible();

    // Only the latest request produces audible speech.
    await page.evaluate((id) => (window as any).__voiceFake.resolveGenerate(id), second.requestId);
    await expect(speaking(page).first()).toBeVisible();
  });

  test('14. repeated replies share one model initialization', async ({ page }) => {
    let turn = 0;
    await page.route('**/api/chat', (route) => {
      turn += 1;
      return fulfillJson(route, {
        message: `Reply ${turn}.`,
        travelPlan: basePlan,
      });
    });
    await page.route('**/api/plan*', (route) => fulfillJson(route, { travelPlan: basePlan }));
    await page.route('**/api/tts', (route) =>
      fulfillJson(route, { error: 'unexpected TTS request' }, 500),
    );
    await installVoiceHarness(page, { audioEndDelay: 20 });
    await page.goto('/');

    await send(page, 'Turn one.');
    await expect(page.getByText('Reply 1.')).toBeVisible();
    await expect(page.getByText('On-device voice ready', { exact: true })).toBeVisible();

    await send(page, 'Turn two.');
    await expect(page.getByText('Reply 2.')).toBeVisible();
    await expect(page.getByText('On-device voice ready', { exact: true })).toBeVisible();

    const state = await fake(page);
    expect(state.prepareRequests).toHaveLength(1);
    expect(state.generateRequests).toHaveLength(2);
  });

  test('15. multiple local turns never call /api/tts and cleanup is safe', async ({ page }) => {
    const counter = await mockApis(page);
    const requests: string[] = [];
    const pageErrors: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installVoiceHarness(page, { audioEndDelay: 20 });
    await page.goto('/');

    await send(page, 'Turn one.');
    await expect(page.getByText('Route ready.')).toHaveCount(1);
    await expect(page.getByText('On-device voice ready', { exact: true })).toBeVisible();

    await send(page, 'Turn two.');
    await expect(page.getByText('Route ready.')).toHaveCount(2);
    await expect(page.getByText('On-device voice ready', { exact: true })).toBeVisible();

    // Cleanup path: pagehide calls stop(), unmount/navigation releases audio.
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(100);
    await page.goto('about:blank');
    await page.waitForTimeout(100);

    expect(counter.tts).toBe(0);
    expect(requests.some((url) => url.includes('/api/tts'))).toBe(false);
    expect(
      requests.some((url) => /huggingface\.co|hf\.co|cdn\.jsdelivr\.net/.test(url)),
    ).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});
