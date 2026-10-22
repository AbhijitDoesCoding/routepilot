# Local voice (Kokoro TTS)

RoutePilot's default reply voice is **Kokoro-82M running on the user's device**. The previous
Groq/Orpheus `/api/tts` endpoint still exists for compatibility, but the frontend no longer calls
it. Theme context: see `docs/` and `frontend/src/index.css`.

## Runtime architecture

```
App (React)
  └─ useSpeechOutput (frontend/src/hooks/useSpeech.ts)
       ├─ default: localVoice.ts
       │    └─ dedicated module Web Worker (kokoroTts.worker.ts)
       │         └─ dynamic import("kokoro-js") → Transformers.js → ONNX Runtime Web
       │              ├─ WebGPU when an adapter initializes
       │              └─ WASM fallback (one attempt)
       └─ fallback: browser speechSynthesis (never a network TTS request)
```

- `kokoro-js` is imported **inside the worker** with `await import(...)`. Model weights and voice
  tensors are fetched by Transformers.js at runtime, never bundled into application JavaScript.
- The worker is created lazily on the first spoken reply, not on page load.
- Model: `onnx-community/Kokoro-82M-v1.0-ONNX`, dtype `q8` (ONNX `model_quantized.onnx`), voice
  `af_heart`.
- Concurrent prepares share one attempt. Switching voices or pressing mute cancels playback and
  generation; a late worker result cannot play.
- If local initialization or generation fails, the reply is spoken with the browser's
  `speechSynthesis` engine and the UI says so. There is no silent network fallback and no automatic
  retry loop.

## Download and privacy

- First local reply downloads the quantized model (~92 MB), the `af_heart` voice tensor (~0.5 MB),
  tokenizer/config, and the Kokoro runtime from `huggingface.co`. WebGPU may select a different
  quantized asset if runtime support differs.
- The assets are cached by the browser (Transformers.js browser cache and HTTP cache), so later
  visits and later replies normally do not re-download them. There is no app-managed copy.
- After the model is cached, RoutePilot sends the reply text only to the local Web Worker. Inference
  is local; text is not sent to Hugging Face, Groq, Orpheus, or `/api/tts`.
- The initial model download is a normal HTTPS request to Hugging Face, which necessarily exposes
  the user's IP address and requested files to that host. No API key or `.env` value is involved.
- Browser voice (`speechSynthesis`) availability and voice quality depend on the browser/OS and may
  use OS speech services; the UI labels the active path.

## Versions and licenses (installed)

| Component | Version | License |
| --- | --- | --- |
| `kokoro-js` | 1.2.1 | Apache-2.0 |
| `@huggingface/transformers` | 3.8.1 | Apache-2.0 |
| `phonemizer` | 1.2.1 | Apache-2.0 |
| `onnxruntime-web` | 1.22.0-dev.20250409-89f8206ba4 | MIT |
| Kokoro-82M ONNX model | v1.0 | Apache-2.0 (model card) |
| `af_heart` voicepack | v1.0 | Distributed in the Apache-2.0 model repository; no separate voicepack license is stated on the model card |

Model training data notes (per the Kokoro-82M model card) include permissive/public-domain audio and
some CC BY recordings. Review the upstream model cards before redistribution. RoutePilot code
remains under the repository's existing license.

## UI states

The chat composer footer exposes the actual path and phase:

- On-device voice (loads on first reply)
- Preparing on-device voice… N%
- Generating on-device speech…
- Speaking on-device…
- On-device voice ready
- Browser voice selected / browser fallback
- Speech stopped
- Speech unavailable in this browser

The voice-mode select (On-device / Browser) is persisted in `localStorage` under
`routepilot.voice-mode`. Mute (`Mute voice replies`) and `Stop reading aloud` cancel both paths.
