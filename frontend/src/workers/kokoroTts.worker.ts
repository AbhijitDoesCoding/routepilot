// Dedicated module worker for the Kokoro-82M ONNX engine.
// kokoro-js is imported lazily so the main bundle (and even this worker's
// initial parse) does not pull the engine in until prepareLocalVoice() runs.

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";
const DTYPE = "q8";

type LocalDevice = "webgpu" | "wasm";

type MainToWorker =
  | { type: "prepare"; requestId: number }
  | { type: "generate"; requestId: number; text: string; voice?: string; speed?: number }
  | { type: "cancel"; requestId: number }
  | { type: "dispose" };

type WorkerToMain =
  | { type: "progress"; requestId: number; status: "preparing"; progress?: number; file?: string }
  | { type: "prepared"; requestId: number; device: LocalDevice; elapsedMs: number }
  | { type: "audio"; requestId: number; blob: Blob }
  | { type: "error"; requestId: number; stage: "prepare" | "generate"; message: string };

// The worker is compiled with the DOM lib; postMessage here is the worker
// global, not Window.postMessage, so keep the call narrow and explicit.
const post = (message: WorkerToMain) => {
  (self as unknown as { postMessage(message: WorkerToMain): void }).postMessage(message);
};

let engine: import("kokoro-js").KokoroTTS | null = null;
let engineDevice: LocalDevice | null = null;
let preparing = false;
const activeRequests = new Set<number>();
const cancelledRequests = new Set<number>();

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown local voice error";
};

async function prepare(requestId: number): Promise<void> {
  if (engine && engineDevice) {
    post({ type: "prepared", requestId, device: engineDevice, elapsedMs: 0 });
    return;
  }
  if (preparing) {
    post({
      type: "error",
      requestId,
      stage: "prepare",
      message: "Local voice is already being prepared.",
    });
    return;
  }

  preparing = true;
  try {
    const { KokoroTTS } = await import("kokoro-js");
    const started = performance.now();
    let lastProgressKey = "";

    const progressCallback = (event: unknown) => {
      const progress = event as { status?: string; progress?: number; file?: string };
      const file = progress.file;
      const percent = typeof progress.progress === "number" ? progress.progress : undefined;
      // Transformers emits many duplicate file events; forward meaningful ones only.
      const key = `${file ?? ""}:${percent === undefined ? "" : Math.round(percent)}`;
      if (key === lastProgressKey) return;
      lastProgressKey = key;
      post({ type: "progress", requestId, status: "preparing", progress: percent, file });
    };

    const load = (device: LocalDevice) =>
      KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: DTYPE,
        device,
        progress_callback: progressCallback,
      });

    let device: LocalDevice = "wasm";
    const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    if (hasWebGpu) {
      try {
        engine = await load("webgpu");
        device = "webgpu";
      } catch (error) {
        // One attempt only; fall through to the wasm path below.
        console.warn(`[kokoro] WebGPU init failed, falling back to WASM: ${describeError(error)}`);
        engine = null;
      }
    }

    if (!engine) {
      engine = await load("wasm");
      device = "wasm";
    }

    engineDevice = device;
    const elapsedMs = Math.round(performance.now() - started);
    console.info(`[kokoro] ${device} engine ready in ${elapsedMs}ms (${DTYPE})`);
    post({ type: "prepared", requestId, device, elapsedMs });
  } catch (error) {
    engine = null;
    engineDevice = null;
    const message = describeError(error);
    console.error(`[kokoro] prepare failed: ${message}`);
    post({ type: "error", requestId, stage: "prepare", message });
  } finally {
    preparing = false;
  }
}

async function generate(
  requestId: number,
  text: string,
  voice: string = VOICE,
  speed: number = 0.95
): Promise<void> {
  if (!engine) {
    post({ type: "error", requestId, stage: "generate", message: "Local voice engine is not ready." });
    return;
  }

  activeRequests.add(requestId);
  try {
    const selectedVoice = voice || VOICE;
    const selectedSpeed =
      typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? speed : 0.95;
    const audio = await engine.generate(text, { voice: selectedVoice as any, speed: selectedSpeed });
    if (cancelledRequests.has(requestId)) return;
    // RawAudio.toBlob() returns a WAV Blob (audio/wav) in transformers v3.
    post({ type: "audio", requestId, blob: audio.toBlob() });
  } catch (error) {
    if (!cancelledRequests.has(requestId)) {
      post({ type: "error", requestId, stage: "generate", message: describeError(error) });
    }
  } finally {
    activeRequests.delete(requestId);
    cancelledRequests.delete(requestId);
  }
}

self.addEventListener("message", (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case "prepare":
      void prepare(message.requestId);
      break;
    case "generate":
      void generate(message.requestId, message.text, message.voice, message.speed);
      break;
    case "cancel":
      // Inference itself cannot be interrupted; ignore its eventual result.
      if (activeRequests.has(message.requestId)) cancelledRequests.add(message.requestId);
      break;
    case "dispose":
      engine = null;
      engineDevice = null;
      activeRequests.clear();
      cancelledRequests.clear();
      break;
  }
});
