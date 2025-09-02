import { useState } from "react";

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  async function startGame() {
    setLogs(["开始新对局..."]);
    const res = await fetch("/api/game");
    const state = await res.json();
    setLogs((l) => [...l, JSON.stringify(state)]);
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">AI 斗地主 MVP</h1>
      <div className="mt-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="输入 OpenAI API Key"
          className="border p-2 w-80"
        />
      </div>
      <div className="mt-2">
        <button
          onClick={startGame}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          开始对局
        </button>
      </div>
      <div className="mt-4 bg-gray-100 p-2 h-64 overflow-y-scroll">
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  );
}
