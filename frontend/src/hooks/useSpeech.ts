import { useState, useCallback, useRef, useEffect } from "react";

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

/** Browser speechSynthesis fallback when the neural TTS endpoint is unavailable. */
const speakWithBrowser = (text: string, isStale: () => boolean) => {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  const run = () => {
    if (isStale()) return;
    const voice = getPreferredVoice();
    // Chrome drops very long utterances; queue sentence-sized chunks instead.
    // Split only after punctuation followed by whitespace so decimals stay intact.
    const chunks = text.split(/(?<=[.!?])\s+/);
    for (const chunk of chunks) {
      const utterance = new SpeechSynthesisUtterance(chunk.trim());
      utterance.lang = "en-US";
      utterance.rate = 1.05;
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    }
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
};

export const useSpeechOutput = () => {
  const [isSupported] = useState(() => typeof window !== "undefined");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped on stop()/new speech so a slow TTS response can't play after mute.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current++;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    stop();
    const gen = generation.current;
    const isStale = () => gen !== generation.current;

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const blob = await res.blob();
      if (isStale()) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      await audio.play();
    } catch {
      if (!isStale()) speakWithBrowser(text, isStale);
    }
  }, [stop]);

  return { isSupported, speak, stop };
};

