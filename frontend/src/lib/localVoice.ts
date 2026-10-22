// Lazy local Kokoro-82M TTS engine.
//
// Nothing here downloads or parses kokoro-js until prepareLocalVoice() is
// called. The engine itself lives in a dedicated module worker; model weights
// and voice tensors are fetched from Hugging Face by Transformers.js and cached
// by the browser, never bundled into the app chunks.

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";

export type LocalVoiceStatus = "not_loaded" | "preparing" | "ready" | "generating" | "unavailable";

export type LocalVoiceDevice = "webgpu" | "wasm";

export interface LocalVoiceInfo {
  status: LocalVoiceStatus;
  device?: LocalVoiceDevice;
  modelId: string;
  voice: string;
  error?: string;
}

export interface LocalVoiceProgress {
  status: LocalVoiceStatus;
  /** Download percentage (0-100) while preparing. */
  progress?: number;
  /** Asset currently being downloaded, when known. */
  file?: string;
}

export interface GenerateLocalSpeechOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LocalVoiceProgress) => void;
  voice?: string;
  speed?: number;
}

type MainToWorker =
  | { type: "prepare"; requestId: number }
  | { type: "generate"; requestId: number; text: string; voice?: string; speed?: number }
  | { type: "cancel"; requestId: number }
  | { type: "dispose" };

type WorkerToMain =
  | { type: "progress"; requestId: number; status: "preparing"; progress?: number; file?: string }
  | { type: "prepared"; requestId: number; device: LocalVoiceDevice; elapsedMs: number }
  | { type: "audio"; requestId: number; blob: Blob }
  | { type: "error"; requestId: number; stage: "prepare" | "generate"; message: string };

interface PendingPrepare {
  kind: "prepare";
  resolve: (info: LocalVoiceInfo) => void;
  onProgress?: (progress: LocalVoiceProgress) => void;
}

interface PendingGenerate {
  kind: "generate";
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: LocalVoiceProgress) => void;
  cleanup: () => void;
}

type Pending = PendingPrepare | PendingGenerate;

let worker: Worker | null = null;
let preparePromise: Promise<LocalVoiceInfo> | null = null;
let nextRequestId = 1;
const pending = new Map<number, Pending>();

let info: LocalVoiceInfo = {
  status: "not_loaded",
  modelId: MODEL_ID,
  voice: VOICE,
};

function updateInfo(
  status: LocalVoiceStatus,
  extra: { device?: LocalVoiceDevice; error?: string } = {},
): void {
  info = {
    status,
    modelId: MODEL_ID,
    voice: VOICE,
    device:
      status === "ready" || status === "generating" ? (extra.device ?? info.device) : undefined,
    error: extra.error,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown local voice error";
}

function createAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function hasPendingGenerations(): boolean {
  for (const entry of pending.values()) {
    if (entry.kind === "generate") return true;
  }
  return false;
}

function terminateWorker(): void {
  if (!worker) return;
  worker.removeEventListener("message", handleWorkerMessage);
  worker.removeEventListener("error", handleWorkerError);
  worker.removeEventListener("messageerror", handleWorkerMessageError);
  worker.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const next = new Worker(new URL("../workers/kokoroTts.worker.ts", import.meta.url), {
    type: "module",
  });
  next.addEventListener("message", handleWorkerMessage);
  next.addEventListener("error", handleWorkerError);
  next.addEventListener("messageerror", handleWorkerMessageError);
  worker = next;
  return next;
}

function failWorker(message: string): void {
  console.error(`[localVoice] ${message}`);
  terminateWorker();
  updateInfo("unavailable", { error: message });

  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    if (entry.kind === "generate") {
      entry.cleanup();
      entry.reject(new Error(message));
    } else {
      entry.resolve(getLocalVoiceInfo());
    }
  }
}

function handleWorkerMessage(event: MessageEvent<WorkerToMain>): void {
  const message = event.data;
  const requestId = message.requestId;
  const entry = pending.get(requestId);

  switch (message.type) {
    case "progress": {
      entry?.onProgress?.({
        status: "preparing",
        progress: message.progress,
        file: message.file,
      });
      return;
    }
    case "prepared": {
      if (!entry || entry.kind !== "prepare") return;
      pending.delete(requestId);
      updateInfo("ready", { device: message.device });
      entry.onProgress?.({ status: "ready" });
      entry.resolve(getLocalVoiceInfo());
      return;
    }
    case "audio": {
      // A stale worker result must never settle a newer request.
      if (!entry || entry.kind !== "generate") return;
      pending.delete(requestId);
      entry.cleanup();
      const blob = message.blob.type
        ? message.blob
        : new Blob([message.blob], { type: "audio/wav" });
      entry.resolve(blob);
      if (!hasPendingGenerations()) updateInfo("ready");
      return;
    }
    case "error": {
      if (message.stage === "prepare") {
        terminateWorker();
        updateInfo("unavailable", { error: message.message });
        if (entry && entry.kind === "prepare") {
          pending.delete(requestId);
          entry.onProgress?.({ status: "unavailable" });
          entry.resolve(getLocalVoiceInfo());
        }
        return;
      }

      if (!entry || entry.kind !== "generate") return;
      pending.delete(requestId);
      entry.cleanup();
      entry.reject(new Error(message.message));
      if (!hasPendingGenerations()) updateInfo("ready");
    }
  }
}

function handleWorkerError(event: ErrorEvent): void {
  failWorker(event.message || "Local voice worker crashed.");
}

function handleWorkerMessageError(): void {
  failWorker("Local voice worker sent an unreadable message.");
}

function startPrepare(
  onProgress?: (progress: LocalVoiceProgress) => void,
): Promise<LocalVoiceInfo> {
  updateInfo("preparing");
  onProgress?.({ status: "preparing" });

  const requestId = nextRequestId++;
  try {
    const activeWorker = ensureWorker();
    const prepared = new Promise<LocalVoiceInfo>((resolve) => {
      pending.set(requestId, { kind: "prepare", resolve, onProgress });
    });
    activeWorker.postMessage({ type: "prepare", requestId } satisfies MainToWorker);
    return prepared;
  } catch (error) {
    terminateWorker();
    pending.delete(requestId);
    updateInfo("unavailable", {
      error: `Could not start local voice: ${describeError(error)}`,
    });
    onProgress?.({ status: "unavailable" });
    return Promise.resolve(getLocalVoiceInfo());
  }
}

function cancelRequest(requestId: number, message: string): void {
  const entry = pending.get(requestId);
  if (!entry || entry.kind !== "generate") return;

  pending.delete(requestId);
  entry.cleanup();
  try {
    worker?.postMessage({ type: "cancel", requestId } satisfies MainToWorker);
  } catch {
    // The worker is already gone; the promise is still settled below.
  }
  entry.reject(createAbortError(message));
  if (!hasPendingGenerations()) updateInfo("ready");
}

/**
 * Download and initialize the local engine. Concurrent calls share one
 * initialization attempt; a failed attempt leaves status "unavailable" and a
 * later call may retry with a fresh worker.
 */
export function prepareLocalVoice(
  onProgress?: (progress: LocalVoiceProgress) => void,
): Promise<LocalVoiceInfo> {
  if (info.status === "ready" || info.status === "generating") {
    return Promise.resolve(getLocalVoiceInfo());
  }
  if (preparePromise) return preparePromise;

  const promise = startPrepare(onProgress);
  preparePromise = promise;
  const clear = () => {
    if (preparePromise === promise) preparePromise = null;
  };
  promise.then(clear, clear);
  return promise;
}

/**
 * Generate speech locally and return a WAV Blob. The engine must be prepared
 * first. Cancellation rejects with a DOMException named "AbortError" and does
 * not poison the engine for subsequent calls.
 */
export function generateLocalSpeech(
  text: string,
  options: GenerateLocalSpeechOptions = {},
): Promise<Blob> {
  const input = text.trim();
  if (!input) return Promise.reject(new Error("Local speech text is empty."));
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError("Local speech generation was cancelled."));
  }
  if (!worker || (info.status !== "ready" && info.status !== "generating")) {
    return Promise.reject(
      new Error("Local voice is not prepared. Call prepareLocalVoice() first."),
    );
  }

  const activeWorker = worker;
  const requestId = nextRequestId++;

  return new Promise<Blob>((resolve, reject) => {
    const onAbort = () => cancelRequest(requestId, "Local speech generation was cancelled.");
    const entry: PendingGenerate = {
      kind: "generate",
      resolve,
      reject,
      onProgress: options.onProgress,
      cleanup: () => options.signal?.removeEventListener("abort", onAbort),
    };

    pending.set(requestId, entry);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    updateInfo("generating");
    options.onProgress?.({ status: "generating" });

    try {
      activeWorker.postMessage({
        type: "generate",
        requestId,
        text: input,
        voice: options.voice,
        speed: options.speed,
      } satisfies MainToWorker);
    } catch (error) {
      pending.delete(requestId);
      entry.cleanup();
      reject(new Error(`Could not start local speech generation: ${describeError(error)}`));
      if (!hasPendingGenerations()) updateInfo("ready");
    }
  });
}

/** Cancel any in-flight generation. The engine stays initialized. */
export function cancelLocalSpeech(): void {
  const ids: number[] = [];
  for (const [requestId, entry] of pending) {
    if (entry.kind === "generate") ids.push(requestId);
  }
  for (const requestId of ids) {
    cancelRequest(requestId, "Local speech generation was cancelled.");
  }
}

/** Terminate the worker and release the initialized engine. */
export function disposeLocalVoice(): void {
  terminateWorker();

  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) {
    if (entry.kind === "generate") {
      entry.cleanup();
      entry.reject(createAbortError("Local voice was disposed."));
    } else {
      entry.resolve({
        status: "unavailable",
        modelId: MODEL_ID,
        voice: VOICE,
        error: "Local voice was disposed.",
      });
    }
  }

  preparePromise = null;
  updateInfo("not_loaded");
}

export function getLocalVoiceInfo(): LocalVoiceInfo {
  return { ...info };
}
