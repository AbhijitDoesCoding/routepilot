import { useState, useCallback, useRef, useEffect } from "react";
import {
  cancelLocalSpeech,
  generateLocalSpeech,
  getLocalVoiceInfo,
  prepareLocalVoice,
} from "../lib/localVoice";
import type { LocalVoiceStatus } from "../lib/localVoice";

export interface SpeechState {
  isListening: boolean;
  isSupported: boolean;
  transcript: string;
  error: string | null;
}

export const useSpeechInput = (onTranscript: (text: string) => void) => {
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(() => {
    return typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  });
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("Voice input is not supported in this browser.");
      return;
    }
    setError(null);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      onTranscript(text);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed") {
        setError("Microphone access denied. Please allow microphone in browser settings.");
      } else if (event.error === "no-speech") {
        setError("No speech detected. Please try again.");
      } else {
        setError(`Voice recognition error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
    setIsListening(true);
  }, [isSupported, onTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { isListening, isSupported, error, startListening, stopListening };
};

const getPreferredVoice = () => {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.name === "Google US English")
    ?? voices.find((v) => v.lang.startsWith("en") && /Samantha|Ava|Allison|Aria|Jenny|Natural/i.test(v.name))
    ?? voices.find((v) => v.lang === "en-US")
    ?? voices[0];
};

/** Browser speechSynthesis fallback. This path never touches the network. */
const speakWithBrowser = (text: string, isStale: () => boolean, onEnd: () => void) => {
  if (!("speechSynthesis" in window)) {
    onEnd();
    return false;
  }
  window.speechSynthesis.cancel();

  const run = () => {
    if (isStale()) return;
    const voice = getPreferredVoice();
    // Chrome drops very long utterances; queue sentence-sized chunks instead.
    const chunks = text.split(/(?<=[.!?])\s+/);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk.trim());
      utterance.lang = "en-US";
      utterance.rate = 1.05;
      if (voice) utterance.voice = voice;
      if (index === chunks.length - 1) {
        utterance.onend = utterance.onerror = () => {
          if (!isStale()) onEnd();
        };
      }
      window.speechSynthesis.speak(utterance);
    });
  };

  // Voices load asynchronously in Chrome; wait briefly for them so we don't
  // fall back to the robotic default voice, but never block speech entirely.
  if (window.speechSynthesis.getVoices().length) {
    run();
  } else {
    const timer = setTimeout(run, 300);
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      clearTimeout(timer);
      run();
    }, { once: true });
  }
  return true;
};

export type VoiceMode = "groq" | "local" | "browser";

/**
 * - idle/ready: nothing is being synthesized
 * - preparing: local model is downloading/initializing
 * - generating: TTS model is synthesizing audio
 * - speaking: audio is playing (groq, local or browser)
 * - stopped: the user muted or superseded speech
 * - unavailable: neither cloud, local nor browser speech can play
 */
export type VoicePhase =
  | "idle"
  | "ready"
  | "preparing"
  | "generating"
  | "speaking"
  | "stopped"
  | "unavailable";

export type ActiveVoiceEngine = "groq" | "local" | "browser" | null;

const VOICE_MODE_KEY = "routepilot.voice-mode";
const KOKORO_VOICE_KEY = "routepilot.kokoro-voice";
export const DEFAULT_KOKORO_VOICE = "af_bella";

const readKokoroVoice = (): string => {
  try {
    return window.localStorage.getItem(KOKORO_VOICE_KEY) || DEFAULT_KOKORO_VOICE;
  } catch {
    return DEFAULT_KOKORO_VOICE;
  }
};

const readVoiceMode = (): VoiceMode => {
  try {
    const val = window.localStorage.getItem(VOICE_MODE_KEY);
    if (val === "browser") return "browser";
    if (val === "local") return "local";
    if (val === "groq") return "groq";
    return "groq";
  } catch {
    return "groq";
  }
};

const supportsBrowserSpeech = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

const sanitizeMessage = (value: unknown): string => {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return raw.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 180);
};

export const useSpeechOutput = () => {
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>(readVoiceMode);
  const [kokoroVoice, setKokoroVoiceState] = useState<string>(readKokoroVoice);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeEngine, setActiveEngine] = useState<ActiveVoiceEngine>(null);
  const [localStatus, setLocalStatus] = useState<LocalVoiceStatus>(
    () => getLocalVoiceInfo().status
  );
  const [prepareProgress, setPrepareProgress] = useState<{
    progress?: number;
    file?: string;
  } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped on stop()/new speech so slow model or TTS work can't play after mute.
  const generation = useRef(0);

  const isSupported = supportsBrowserSpeech() || typeof Worker !== "undefined";

  // Release media and pending work without touching React state. This runs on
  // unmount, including React StrictMode's dev-only mount/unmount probe, where
  // setting "stopped" would leak into the remounted UI.
  const releaseSpeech = useCallback(() => {
    generation.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    cancelLocalSpeech();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
    if (supportsBrowserSpeech()) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stop = useCallback(() => {
    releaseSpeech();
    setIsSpeaking(false);
    setActiveEngine(null);
    setPhase("stopped");
  }, [releaseSpeech]);

  const setKokoroVoice = useCallback((voice: string) => {
    setKokoroVoiceState(voice);
    try {
      window.localStorage.setItem(KOKORO_VOICE_KEY, voice);
    } catch {
      // Storage safety
    }
  }, []);

  const setVoiceMode = useCallback(
    (mode: VoiceMode) => {
      stop();
      setVoiceModeState(mode);
      setSpeechError(null);
      setPhase(mode === "local" && localStatus === "ready" ? "ready" : "idle");
      try {
        window.localStorage.setItem(VOICE_MODE_KEY, mode);
      } catch {
        // Storage can be unavailable in private/embedded contexts.
      }
    },
    [localStatus, stop]
  );

  const speakBrowserFallback = useCallback(
    (text: string, isStale: () => boolean) => {
      if (!supportsBrowserSpeech()) {
        setSpeechError("Speech playback is unavailable in this browser.");
        setPhase("unavailable");
        setIsSpeaking(false);
        setActiveEngine(null);
        return;
      }
      setActiveEngine("browser");
      setPhase("speaking");
      setIsSpeaking(true);
      const started = speakWithBrowser(text, isStale, () => {
        if (isStale()) return;
        setIsSpeaking(false);
        setActiveEngine(null);
        setPhase("ready");
      });
      if (!started) {
        setSpeechError("Speech playback is unavailable in this browser.");
        setPhase("unavailable");
        setIsSpeaking(false);
        setActiveEngine(null);
      }
    },
    []
  );

  const playLocalBlob = useCallback(
    async (blob: Blob, text: string, isStale: () => boolean, engine: "local" | "groq" = "local") => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        if (isStale()) return;
        setIsSpeaking(false);
        setActiveEngine(null);
        setPhase("ready");
      };

      setActiveEngine(engine);
      setPhase("speaking");
      setIsSpeaking(true);
      try {
        await audio.play();
      } catch (error) {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        if (isStale()) return;
        setIsSpeaking(false);
        const message = sanitizeMessage(error) || "Browser blocked audio playback.";
        setSpeechError(message);
        speakBrowserFallback(text, isStale);
      }
    },
    [speakBrowserFallback]
  );

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      stop();
      const gen = generation.current;
      const isStale = () => gen !== generation.current;
      setSpeechError(null);

      if (voiceMode === "browser") {
        speakBrowserFallback(text, isStale);
        return;
      }

      if (voiceMode === "groq") {
        setPhase("generating");
        setActiveEngine("groq");
        try {
          const controller = new AbortController();
          abortRef.current = controller;
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
            signal: controller.signal,
          });
          if (isStale()) return;
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Groq TTS request failed");
          }
          const blob = await res.blob();
          if (isStale()) return;
          abortRef.current = null;
          await playLocalBlob(blob, text, isStale, "groq");
          return;
        } catch (error) {
          if (isStale()) return;
          const aborted =
            error instanceof DOMException && error.name === "AbortError";
          if (aborted) return;
          const message = sanitizeMessage(error) || "Groq TTS unavailable.";
          setSpeechError(message);
          speakBrowserFallback(text, isStale);
          return;
        }
      }

      // A previously failed local load falls back visibly rather than retrying
      // on every reply.
      if (localStatus === "unavailable") {
        setLocalError((current) => current || "On-device voice is unavailable.");
        speakBrowserFallback(text, isStale);
        return;
      }

      if (!("Worker" in window)) {
        setLocalError("This browser cannot run the on-device voice worker.");
        speakBrowserFallback(text, isStale);
        return;
      }

      try {
        const current = getLocalVoiceInfo();
        if (current.status !== "ready" && current.status !== "generating") {
          setPhase("preparing");
          setActiveEngine(null);
          setPrepareProgress(null);
          const info = await prepareLocalVoice((progress) => {
            if (isStale()) return;
            setLocalStatus(progress.status);
            setPrepareProgress({ progress: progress.progress, file: progress.file });
          });
          setLocalStatus(info.status);
          setPrepareProgress(null);
          if (isStale()) return;
          if (info.status !== "ready" && info.status !== "generating") {
            setLocalError(info.error || "On-device voice could not be initialized.");
            speakBrowserFallback(text, isStale);
            return;
          }
        }

        setPhase("generating");
        const controller = new AbortController();
        abortRef.current = controller;
        const blob = await generateLocalSpeech(text, {
          signal: controller.signal,
          voice: kokoroVoice,
          speed: 0.95,
          onProgress: () => {
            if (!isStale()) setPhase("generating");
          },
        });
        if (isStale()) return;
        abortRef.current = null;
        setLocalStatus("ready");
        await playLocalBlob(blob, text, isStale, "local");
      } catch (error) {
        if (isStale()) return;
        const aborted =
          error instanceof DOMException && error.name === "AbortError";
        if (aborted) return;
        const message = sanitizeMessage(error) || "On-device voice generation failed.";
        setLocalError(message);
        setLocalStatus(getLocalVoiceInfo().status);
        speakBrowserFallback(text, isStale);
      }
    },
    [kokoroVoice, localStatus, playLocalBlob, speakBrowserFallback, stop, voiceMode]
  );

  // Stop audio and model work when the app unmounts or the page is hidden.
  useEffect(() => {
    const handlePageHide = () => stop();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      releaseSpeech();
    };
  }, [releaseSpeech, stop]);

  return {
    isSupported,
    isSpeaking,
    speak,
    stop,
    voiceMode,
    setVoiceMode,
    phase,
    activeEngine,
    localStatus,
    localError,
    speechError,
    prepareProgress,
    kokoroVoice,
    setKokoroVoice,
  };
};
