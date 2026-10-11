import { useState, useRef } from "react";
import { useRoutePilot } from "./hooks/useRoutePilot";
import { useSpeechInput, useSpeechOutput } from "./hooks/useSpeech";
import { RouteMap } from "./components/RouteMap";
import { TravelPlanCard } from "./components/TravelPlanCard";
import { MarkdownRenderer } from "./components/MarkdownRenderer";
import { Send, Loader2, Mic, MicOff, Volume2 } from "lucide-react";
import clsx from "clsx";

const EXAMPLE_PROMPTS = [
  "Get me to Pune Airport by 7 AM and avoid tolls.",
  "Find a coffee shop on the way to Pune Airport.",
  "Also avoid highways.",
  "Leave at 6 AM and tell me when I'll arrive.",
];

function App() {
  const { messages, currentPlan, isLoading, error, sendMessage, retryLastMessage } = useRoutePilot();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput("");
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const handleExamplePrompt = (prompt: string) => {
    setInput(prompt);
    sendMessage(prompt);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const { isListening, isSupported: speechInputSupported, error: speechError, startListening, stopListening } =
    useSpeechInput((transcript) => {
      setInput(transcript);
    });

  const { isSupported: speechOutputSupported, speak } = useSpeechOutput();

  const speakMessage = (text: string) => {
    speak(text);
  };

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-gray-50 text-gray-900 font-sans overflow-hidden">
      {/* Left Panel: Alexa-like Chat */}
      <div className="flex flex-col w-full md:w-[420px] lg:w-[480px] border-r border-gray-200 bg-white shadow-sm z-10 h-[50vh] md:h-screen shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm">
            R
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-gray-900 leading-none">RoutePilot</h1>
            <p className="text-xs text-gray-400 mt-0.5">Alexa+ Travel Assistant</p>
          </div>
          {isListening && (
            <div className="ml-auto flex items-center gap-1.5 text-red-500 text-xs font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              Listening...
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-6">
              <div>
                <div className="text-4xl mb-3">🗺️</div>
                <p className="text-gray-700 font-semibold text-base mb-1">Ready to plan your route</p>
                <p className="text-gray-400 text-sm">Try one of these or ask in your own words:</p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleExamplePrompt(prompt)}
                    disabled={isLoading}
                    aria-label={`Try example: ${prompt}`}
                    className="text-left px-3 py-2.5 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl text-sm text-gray-700 hover:text-blue-700 transition-colors disabled:opacity-50"
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={clsx(
                "flex flex-col max-w-[88%]",
                m.role === "user" ? "self-end items-end" : "self-start items-start"
              )}
            >
              <span className="text-xs text-gray-400 mb-1">
                {m.role === "user" ? "You" : "RoutePilot"}
              </span>
              <div className={clsx(
                "px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap"
                  : "bg-gray-100 text-gray-800 rounded-bl-sm"
              )}>
                {m.role === "assistant" ? (
                  <MarkdownRenderer content={m.text} />
                ) : (
                  m.text
                )}
              </div>
              {m.role === "assistant" && speechOutputSupported && (
                <button
                  onClick={() => speakMessage(m.text)}
                  aria-label="Read response aloud"
                  className="mt-1 text-gray-400 hover:text-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-full p-0.5"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="self-start flex items-center gap-2 text-gray-400 text-sm py-1 px-3 bg-gray-50 rounded-full border border-gray-200">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Planning your route...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="p-3 bg-white border-t border-gray-100">
          <form onSubmit={handleSend} className="flex items-center gap-2">
            {speechInputSupported && (
              <button
                type="button"
                onClick={isListening ? stopListening : startListening}
                disabled={isLoading}
                aria-label={isListening ? "Stop listening" : "Start voice input"}
                className={clsx(
                  "p-2.5 rounded-xl border transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-400",
                  isListening
                    ? "bg-red-500 text-white border-red-500 hover:bg-red-600"
                    : "bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200"
                )}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading || isListening}
                placeholder={isListening ? "Listening..." : "Ask RoutePilot..."}
                aria-label="Message input"
                className="w-full pl-4 pr-12 py-2.5 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent disabled:opacity-60 transition-colors text-sm"
              />
              <button
                type="submit"
                aria-label="Send message"
                disabled={isLoading || !input.trim() || isListening}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>

          {/* Error display */}
          {(error || speechError) && (
            <div className="mt-2 flex items-center justify-between text-red-600 text-xs bg-red-50 px-3 py-2 rounded-lg border border-red-100">
              <span>{error || speechError}</span>
              {error && (
                <button
                  type="button"
                  onClick={retryLastMessage}
                  aria-label="Retry last message"
                  className="text-red-700 underline font-medium hover:text-red-800 focus:outline-none ml-2"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Map & Plan */}
      <div className="flex-1 flex flex-col relative h-[50vh] md:h-screen bg-gray-100 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <RouteMap plan={currentPlan} />
        </div>

        {/* TravelPlan card overlay */}
        <div className="relative z-10 p-4 w-full md:max-w-sm lg:max-w-md mx-auto md:mr-auto md:ml-4 mt-4 pointer-events-none">
          <div className="pointer-events-auto">
            <TravelPlanCard plan={currentPlan} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
