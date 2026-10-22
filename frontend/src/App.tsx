import { useState, useRef, useEffect } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useRoutePilot } from "./hooks/useRoutePilot";
import { useSpeechInput, useSpeechOutput } from "./hooks/useSpeech";
import type { VoiceMode } from "./hooks/useSpeech";
import { RouteMap } from "./components/RouteMap";
import { TravelPlanCard } from "./components/TravelPlanCard";
import { PlanUpdateSummary } from "./components/PlanUpdateSummary";
import { MarkdownRenderer } from "./components/MarkdownRenderer";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  CircleDollarSign,
  Clock,
  Coffee,
  Compass,
  Loader2,
  Map as MapIcon,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Milestone,
  Route as RouteIcon,
  Send,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";

const toSpeech = (text: string) =>
  text
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[→]/g, " to ")
    .replace(/[*_`>#~]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

const EXAMPLE_PROMPTS = [
  "Get me to Pune Airport by 7 AM and avoid tolls.",
  "Find a coffee shop on the way to Pune Airport.",
  "Also avoid highways.",
  "Leave at 6 AM and tell me when I'll arrive.",
];

interface QuickAction {
  label: string;
  icon: LucideIcon;
  message?: string;
  onClick?: () => void;
}

function App() {
  const {
    messages,
    currentPlan,
    isLoading,
    error,
    planUpdate,
    sendMessage,
    retryLastMessage,
    dismissPlanUpdate,
  } = useRoutePilot();
  const [input, setInput] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "map">("chat");
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [summaryExpanded, setSummaryExpanded] = useState(
    () => !window.matchMedia("(max-width: 1023px)").matches
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSpokenId = useRef<string | null>(null);

  const sendText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    sendMessage(trimmed);
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    sendText(input);
  };

  const handleExamplePrompt = (prompt: string) => {
    sendText(prompt);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      sendText(input);
    }
  };

  const showFullRoute = () => {
    setFitSignal((signal) => signal + 1);
    setActiveTab("map");
  };

  // Auto-grow the composer up to a sensible ceiling.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [input]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading, planUpdate]);

  const speechInput = useSpeechInput((transcript) => {
    setInput(transcript);
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  const {
    isSupported: speechOutputSupported,
    isSpeaking,
    speak,
    stop: stopSpeaking,
    voiceMode,
    setVoiceMode,
    phase: voicePhase,
    activeEngine,
    localStatus,
    localError,
    speechError,
    prepareProgress,
  } = useSpeechOutput();

  // Alexa-style: read each new assistant reply aloud. Mark messages as seen even
  // while muted so unmuting doesn't replay the previous reply.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.id === lastSpokenId.current) return;
    lastSpokenId.current = last.id;
    if (voiceEnabled) speak(toSpeech(last.text));
  }, [messages, voiceEnabled, speak]);

  const toggleVoice = () => {
    if (voiceEnabled) {
      stopSpeaking();
      setVoiceEnabled(false);
    } else {
      setVoiceEnabled(true);
      // Clear the "stopped" phase left by the previous mute.
      setVoiceMode(voiceMode);
    }
  };

  // A stop selection only survives while that stop is still in the canonical plan.
  const activeStopIndex =
    selectedStopIndex !== null && currentPlan?.stops?.[selectedStopIndex]
      ? selectedStopIndex
      : null;

  const constraintTypes = new Set<string>([
    ...(currentPlan?.constraints ?? []).map((constraint) => constraint.type),
    ...(currentPlan?.constraintEvaluations ?? []).map((evaluation) => evaluation.type),
  ]);
  const hasStops = !!currentPlan?.stops?.length;

  const quickActions: QuickAction[] = currentPlan
    ? [
        {
          label: constraintTypes.has("avoid_tolls") ? "Allow tolls" : "Avoid tolls",
          icon: CircleDollarSign,
          message: constraintTypes.has("avoid_tolls") ? "Stop avoiding tolls." : "Avoid tolls.",
        },
        {
          label: constraintTypes.has("avoid_highways") ? "Allow highways" : "Avoid highways",
          icon: Milestone,
          message: constraintTypes.has("avoid_highways")
            ? "Stop avoiding highways."
            : "Avoid highways.",
        },
        hasStops
          ? {
              label: "Remove stop",
              icon: Trash2,
              message: "Remove the current stop.",
            }
          : {
              label: "Add a coffee stop",
              icon: Coffee,
              message: "Add a coffee stop on the way.",
            },
        {
          label: "Leave later",
          icon: Clock,
          message: "Leave 15 minutes later.",
        },
        {
          label: "Show full route",
          icon: Maximize2,
          onClick: showFullRoute,
        },
      ]
    : [];

  const runQuickAction = (action: QuickAction) => {
    if (action.onClick) {
      action.onClick();
      return;
    }
    if (action.message) sendText(action.message);
  };

  const hasError = !!error || !!speechInput.error;
  const voiceStatusText = !speechOutputSupported
    ? "Speech unavailable in this browser"
    : !voiceEnabled
      ? "Voice replies muted"
      : speechError
        ? speechError
        : voicePhase === "preparing"
          ? typeof prepareProgress?.progress === "number"
            ? `Preparing on-device voice… ${Math.round(prepareProgress.progress)}%`
            : "Preparing on-device voice…"
          : voicePhase === "generating"
            ? "Generating on-device speech…"
            : voicePhase === "speaking"
              ? activeEngine === "local"
                ? "Speaking on-device…"
                : "Speaking with browser voice…"
              : voicePhase === "stopped"
                ? "Speech stopped"
                : voiceMode === "browser"
                  ? "Browser voice selected"
                  : localStatus === "unavailable"
                    ? "On-device voice unavailable · browser fallback"
                    : localStatus === "ready"
                      ? localError
                        ? "On-device voice error · browser fallback"
                        : "On-device voice ready"
                      : "On-device voice (loads on first reply)";

  const statusLabel = hasError
    ? "Needs attention"
    : speechInput.isListening
      ? "Listening…"
      : isLoading
        ? "Planning…"
        : voicePhase === "preparing"
          ? "Preparing voice…"
          : voicePhase === "generating"
            ? "Generating speech…"
            : isSpeaking
              ? activeEngine === "local"
                ? "Speaking on-device…"
                : "Speaking with browser voice…"
              : !speechInput.isSupported
                ? "Voice input unavailable"
                : voiceEnabled
                  ? "Voice ready"
                  : "Voice muted";

  const statusTone = clsx(
    "h-1.5 w-1.5 rounded-full",
    (hasError || speechInput.isListening) && "bg-signal-rose text-signal-rose",
    !hasError &&
      !speechInput.isListening &&
      (isLoading ||
        isSpeaking ||
        voicePhase === "preparing" ||
        voicePhase === "generating") &&
      "bg-route-400 text-route-400",
    !hasError &&
      !speechInput.isListening &&
      !isLoading &&
      !isSpeaking &&
      voicePhase !== "preparing" &&
      voicePhase !== "generating" &&
      (voiceEnabled ? "bg-signal-green text-signal-green" : "bg-ink-500 text-ink-500"),
    speechInput.isListening && "status-ping relative"
  );

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-ink-950 text-paper-50">
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-ink-700/80 bg-ink-950 px-3 md:h-16 md:gap-3 md:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-route-500 text-ink-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
            <RouteIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-white">
              RoutePilot
            </h1>
            <p className="truncate text-[9px] font-medium uppercase tracking-[0.16em] text-ink-300">
              Alexa+ Travel Assistant
            </p>
          </div>
        </div>

        <nav className="ml-auto flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-850 p-0.5 md:hidden" aria-label="Workspace view">
          <button
            type="button"
            aria-label="Chat view"
            aria-pressed={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
            className={clsx(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400",
              activeTab === "chat"
                ? "bg-ink-700 text-white shadow-sm"
                : "text-ink-300 hover:text-white"
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Chat
          </button>
          <button
            type="button"
            aria-label="Map view"
            aria-pressed={activeTab === "map"}
            onClick={() => setActiveTab("map")}
            className={clsx(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400",
              activeTab === "map"
                ? "bg-ink-700 text-white shadow-sm"
                : "text-ink-300 hover:text-white"
            )}
          >
            <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Map
          </button>
        </nav>

        <div className="flex items-center gap-2 md:ml-auto">
          {speechOutputSupported ? (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={voiceEnabled ? "Mute voice replies" : "Enable voice replies"}
              aria-pressed={voiceEnabled}
              title={voiceEnabled ? "Voice replies on — click to mute" : "Voice replies off — click to enable"}
              aria-description={voiceStatusText}
              className={clsx(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400",
                voiceEnabled
                  ? "border-route-500/40 bg-route-500/10 text-route-300 hover:bg-route-500/15"
                  : "border-ink-600 bg-ink-850 text-ink-300 hover:text-white"
              )}
            >
              {voiceEnabled ? (
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{voiceEnabled ? "Voice on" : "Muted"}</span>
            </button>
          ) : (
            <span
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2.5 text-[11px] font-medium text-ink-400"
              title="Voice replies unavailable in this browser"
            >
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Voice unavailable</span>
            </span>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          id="conversation"
          className={clsx(
            "relative z-20 min-h-0 w-full shrink-0 flex-col border-r border-ink-700/70 bg-ink-900 transition-[width] duration-300 ease-out",
            activeTab === "chat" ? "flex" : "hidden",
            "md:flex",
            chatCollapsed ? "md:w-16" : "md:w-[300px] lg:w-[320px] xl:w-[392px]"
          )}
        >
          {chatCollapsed ? (
            <div className="hidden h-full flex-col items-center gap-2 py-3 md:flex">
              <button
                type="button"
                onClick={() => setChatCollapsed(false)}
                aria-label="Expand conversation"
                title="Expand conversation"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-ink-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
              >
                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="mt-1 flex flex-col items-center gap-2 text-ink-500">
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
                <span className="rotate-180 text-[9px] font-semibold uppercase tracking-[0.2em] [writing-mode:vertical-rl]">
                  Conversation
                </span>
              </div>
              <span className="mt-auto text-[10px] font-medium text-ink-500 tnum">
                {messages.length}
              </span>
            </div>
          ) : (
            <>
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-700/70 px-3">
                <span className={statusTone} aria-hidden="true" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-300">
                  Conversation
                </span>
                <span
                  aria-live="polite"
                  className="ml-auto truncate text-[10px] font-medium text-ink-400"
                >
                  {statusLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setChatCollapsed(true)}
                  aria-label="Collapse conversation"
                  title="Collapse conversation"
                  className="hidden h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-ink-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400 md:grid"
                >
                  <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-5">
                {messages.length === 0 ? (
                  <div className="flex min-h-full flex-col justify-center gap-5 py-4">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="grid h-11 w-11 place-items-center rounded-xl border border-ink-600 bg-ink-800 text-route-300">
                        <Compass className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-white">
                          Ready to plan your route
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-ink-300">
                          Try one of these or ask in your own words:
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {EXAMPLE_PROMPTS.map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => handleExamplePrompt(prompt)}
                          disabled={isLoading}
                          aria-label={`Try example: ${prompt}`}
                          className="group flex w-full items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-left text-[13px] leading-snug text-ink-200 transition-colors hover:border-ink-500 hover:bg-ink-800 hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
                        >
                          <span className="min-w-0 flex-1">"{prompt}"</span>
                          <ArrowUpRight
                            className="h-3.5 w-3.5 shrink-0 text-ink-500 transition-colors group-hover:text-route-300"
                            aria-hidden="true"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={clsx(
                          "flex flex-col",
                          message.role === "user" ? "items-end" : "items-start"
                        )}
                      >
                        <span className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                          {message.role === "user" ? "You" : "RoutePilot"}
                        </span>
                        <div
                          className={clsx(
                            "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
                            message.role === "user"
                              ? "rounded-br-md bg-route-700 text-white"
                              : "rounded-bl-md border border-ink-600/70 bg-ink-800 text-paper-100"
                          )}
                        >
                          {message.role === "assistant" ? (
                            <MarkdownRenderer content={message.text} />
                          ) : (
                            <span className="whitespace-pre-wrap">{message.text}</span>
                          )}
                        </div>
                        {message.role === "assistant" && speechOutputSupported && (
                          <button
                            type="button"
                            onClick={() => speak(toSpeech(message.text))}
                            aria-label="Read response aloud"
                            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-ink-500 transition-colors hover:text-route-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
                          >
                            <Volume2 className="h-3 w-3" aria-hidden="true" />
                            Read aloud
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {planUpdate && (
                  <PlanUpdateSummary
                    notice={planUpdate}
                    onDismiss={dismissPlanUpdate}
                  />
                )}

                {isLoading && (
                  <div
                    aria-live="polite"
                    className="mt-4 flex items-center gap-2 text-[12px] font-medium text-ink-300"
                  >
                    <span className="inline-flex items-end gap-0.5" aria-hidden="true">
                      <span className="typing-dot h-1 w-1 rounded-full bg-route-400" />
                      <span className="typing-dot h-1 w-1 rounded-full bg-route-400" />
                      <span className="typing-dot h-1 w-1 rounded-full bg-route-400" />
                    </span>
                    Planning your route...
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {quickActions.length > 0 && (
                <div className="shrink-0 border-t border-ink-700/60 px-3 pt-2.5">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                    Refine trip
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {quickActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => runQuickAction(action)}
                          disabled={isLoading}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-850 px-2.5 py-1.5 text-[11px] font-medium text-ink-200 transition-colors hover:border-ink-500 hover:bg-ink-800 hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
                        >
                          <Icon className="h-3.5 w-3.5 text-route-300" aria-hidden="true" />
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="shrink-0 border-t border-ink-700/70 px-3 pb-3 pt-2">
                {hasError && (
                  <div
                    role="alert"
                    className="mb-2 flex items-start justify-between gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-snug text-rose-200"
                  >
                    <span>{error || speechInput.error}</span>
                    {error && (
                      <button
                        type="button"
                        onClick={retryLastMessage}
                        aria-label="Retry last message"
                        className="shrink-0 font-semibold text-rose-100 underline underline-offset-2 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}

                <form
                  onSubmit={handleSend}
                  className={clsx(
                    "flex items-end gap-1.5 rounded-xl border bg-ink-850 px-1.5 py-1 transition-colors",
                    speechInput.isListening
                      ? "border-rose-400/70 ring-2 ring-rose-400/15"
                      : "border-ink-600 focus-within:border-route-500/70 focus-within:ring-2 focus-within:ring-route-500/15"
                  )}
                >
                  {speechInput.isSupported && (
                    <button
                      type="button"
                      onClick={
                        speechInput.isListening
                          ? speechInput.stopListening
                          : speechInput.startListening
                      }
                      disabled={isLoading}
                      aria-label={speechInput.isListening ? "Stop listening" : "Start voice input"}
                      title={
                        speechInput.isListening
                          ? "Stop listening"
                          : "Start voice input"
                      }
                      className={clsx(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400 disabled:opacity-50",
                        speechInput.isListening
                          ? "bg-rose-500 text-white hover:bg-rose-400"
                          : "text-ink-300 hover:bg-ink-700 hover:text-white"
                      )}
                    >
                      {speechInput.isListening ? (
                        <MicOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Mic className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  )}

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading || speechInput.isListening}
                    rows={1}
                    aria-label="Message input"
                    title="Enter to send · Shift+Enter for a new line"
                    placeholder={
                      speechInput.isListening
                        ? "Listening…"
                        : isLoading
                          ? "Planning your route…"
                          : "Ask RoutePilot…"
                    }
                    className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-2 text-[14px] leading-snug text-paper-50 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
                  />

                  <button
                    type="submit"
                    aria-label="Send message"
                    title="Send message"
                    disabled={isLoading || !input.trim() || speechInput.isListening}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-route-600 text-white transition-colors hover:bg-route-500 disabled:cursor-not-allowed disabled:opacity-35 focus:outline-none focus-visible:ring-2 focus-visible:ring-route-300"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </form>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-ink-500">
                  <span
                    className="min-w-0 truncate"
                    title={voiceStatusText}
                    aria-live="polite"
                  >
                    {voiceStatusText}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {voiceEnabled && speechOutputSupported && (
                      <select
                        aria-label="Voice engine"
                        title="Local Kokoro runs fully on this device. Browser voice uses the browser speech engine."
                        value={voiceMode}
                        onChange={(event) =>
                          setVoiceMode(event.target.value as VoiceMode)
                        }
                        className="rounded-md border border-ink-600 bg-ink-850 px-1.5 py-1 text-[10px] font-medium text-ink-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
                      >
                        <option value="local">On-device</option>
                        <option value="browser">Browser</option>
                      </select>
                    )}
                    {isSpeaking && (
                      <button
                        type="button"
                        onClick={stopSpeaking}
                        aria-label="Stop reading aloud"
                        className="shrink-0 font-medium text-route-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-route-400"
                      >
                        Stop voice
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

        <section
          id="map-workspace"
          className={clsx(
            "relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#e9eef2]",
            activeTab === "map" ? "block" : "hidden",
            "md:block"
          )}
        >
          <RouteMap
            plan={currentPlan}
            selectedStopIndex={activeStopIndex}
            onSelectStop={setSelectedStopIndex}
            fitSignal={fitSignal}
          />

          {!currentPlan && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="max-w-[280px] rounded-2xl border border-paper-200 bg-paper-50/95 px-5 py-4 text-center shadow-panel">
                <MapIcon className="mx-auto h-5 w-5 text-ink-400" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-ink-900">
                  Your route will appear here
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">
                  Describe a trip in the conversation and RoutePilot will draw the plan on the
                  map.
                </p>
              </div>
            </div>
          )}

          {currentPlan && (
            <button
              type="button"
              onClick={showFullRoute}
              aria-label="Fit full route"
              title="Fit full route"
              className="absolute left-3 top-3 z-20 grid h-10 w-10 place-items-center rounded-xl border border-paper-200 bg-paper-50 text-ink-700 shadow-panel transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-route-500 lg:left-auto lg:right-4 lg:top-auto lg:bottom-14"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {currentPlan && (
            <div className="pointer-events-none absolute inset-x-3 bottom-6 z-20 flex max-h-[58vh] flex-col gap-1.5 lg:inset-x-auto lg:bottom-auto lg:left-4 lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:w-[300px] xl:w-[360px]">
              <div
                id="trip-summary"
                className={clsx(
                  "pointer-events-auto min-h-0 overflow-y-auto rounded-2xl scroll-light",
                  !summaryExpanded && "hidden lg:block"
                )}
              >
                <TravelPlanCard
                  plan={currentPlan}
                  selectedStopIndex={activeStopIndex}
                  onSelectStop={setSelectedStopIndex}
                />
              </div>
              <button
                type="button"
                onClick={() => setSummaryExpanded((expanded) => !expanded)}
                aria-expanded={summaryExpanded}
                aria-controls="trip-summary"
                className="pointer-events-auto inline-flex items-center gap-1.5 self-end rounded-lg border border-paper-200 bg-paper-50 px-2.5 py-1.5 text-[11px] font-semibold text-ink-700 shadow-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-route-500 lg:hidden"
              >
                {summaryExpanded ? "Hide details" : "Trip details"}
                {summaryExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
