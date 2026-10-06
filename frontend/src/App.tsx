import { useState } from "react";
import { useRoutePilot } from "./hooks/useRoutePilot";
import { RouteMap } from "./components/RouteMap";
import { TravelPlanCard } from "./components/TravelPlanCard";
import { Send, Loader2 } from "lucide-react";
import clsx from "clsx";

function App() {
  const { messages, currentPlan, isLoading, error, sendMessage, retryLastMessage } = useRoutePilot();
  const [input, setInput] = useState("");

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input);
    setInput("");
  };

  return (
    <div className="h-screen w-full flex flex-col md:flex-row bg-gray-50 text-gray-900 font-sans">
      {/* Left Panel: Chat */}
      <div className="flex flex-col w-full md:w-[400px] lg:w-[500px] border-r border-gray-200 bg-white shadow-sm z-10 h-[50vh] md:h-screen shrink-0">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
            R
          </div>
          <h1 className="font-bold text-xl tracking-tight text-gray-900">RoutePilot</h1>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6 flex flex-col">
          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-center px-4">
              <p className="mb-2">Welcome to RoutePilot.</p>
              <p className="text-sm">Try asking: "I need to get to Pune Airport by 7 AM and avoid tolls."</p>
            </div>
          )}
          
          {messages.map((m) => (
            <div key={m.id} className={clsx("flex flex-col max-w-[85%]", m.role === "user" ? "self-end items-end" : "self-start items-start")}>
              <span className="text-xs text-gray-400 mb-1 ml-1">{m.role === "user" ? "You" : "RoutePilot"}</span>
              <div className={clsx("px-4 py-2.5 rounded-2xl whitespace-pre-wrap", 
                m.role === "user" ? "bg-blue-600 text-white rounded-br-sm" : "bg-gray-100 text-gray-800 rounded-bl-sm"
              )}>
                {m.text}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="self-start flex items-center gap-2 text-gray-400 text-sm py-2 px-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Planning your route...
            </div>
          )}

        </div>

        <div className="p-4 bg-white border-t border-gray-100 shadow-sm">
          <form onSubmit={handleSend} className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              placeholder="Where do you want to go?"
              aria-label="Message input"
              className="w-full pl-4 pr-12 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent disabled:opacity-50 transition-colors shadow-inner"
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={isLoading || !input.trim()}
              className="absolute right-2 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          {error && (
            <div className="mt-3 flex items-center justify-between text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg border border-red-100">
              <span>{error}</span>
              <button type="button" onClick={retryLastMessage} className="text-red-700 underline font-medium hover:text-red-800 focus:outline-none">Retry</button>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Map & Plan */}
      <div className="flex-1 flex flex-col relative h-[50vh] md:h-screen bg-gray-100 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <RouteMap plan={currentPlan} />
        </div>
        
        <div className="relative z-10 p-4 w-full md:max-w-md lg:max-w-lg mx-auto md:mr-auto md:ml-4 mt-4 pointer-events-none">
          <div className="pointer-events-auto">
            <TravelPlanCard plan={currentPlan} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
