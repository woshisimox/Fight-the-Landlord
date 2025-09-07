import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const DebugDock = dynamic(() => import("../components/DebugDock"), { ssr: false });

type Line = { ts: string; text: string; kind: "log" | "tick" | "error" | "done" };

export default function Home() {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [delayMs, setDelayMs] = useState(300);
  const [total, setTotal] = useState(40);
  const [crashAt, setCrashAt] = useState<number | "">( "");
  const controllerRef = useRef<AbortController | null>(null);

  function append(kind: Line["kind"], text: string) {
    setLines((prev) => [...prev, { ts: new Date().toISOString(), text, kind }]);
  }

  async function start() {
    if (running) return;
    setLines([]);
    setRunning(true);

    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    const params = new URLSearchParams();
    params.set("delayMs", String(delayMs));
    params.set("total", String(total));
    if (crashAt !== "") params.set("crashAt", String(crashAt));

    try {
      const res = await fetch("/api/stream_ndjson?" + params.toString(), { signal: ctrl.signal });
      if (!res.body) throw new Error("No response body (ReadableStream missing).");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      append("log", "Stream connected.");

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const chunk = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!chunk) continue;
          try {
            const j = JSON.parse(chunk);
            if (j?.type === "tick") append("tick", `#${j.i}`);
            else if (j?.type === "log") append("log", j.message || JSON.stringify(j));
            else if (j?.type === "error") append("error", j.message || JSON.stringify(j));
            else if (j?.type === "done") append("done", "done");
            else append("log", chunk);
          } catch {
            append("log", chunk);
          }
        }
      }
      append("log", "Stream ended.");
    } catch (e:any) {
      append("error", "Reader failed: " + String(e?.message || e));
    } finally {
      setRunning(false);
      controllerRef.current = null;
    }
  }

  function stop() {
    controllerRef.current?.abort();
    setRunning(false);
  }

  return (
    <div style={{ padding: 20, fontFamily: "ui-sans-serif, system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Debug-Ready NDJSON Stream Demo</h1>
      <p style={{ opacity: .8 }}>用它来区分“前端卡死”还是“后端停止”：右下角 🐞Debug 可导出完整报告。</p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
        <label>delayMs <input type="number" value={delayMs} onChange={e=>setDelayMs(Number(e.target.value))} style={{width:90}}/></label>
        <label>total <input type="number" value={total} onChange={e=>setTotal(Number(e.target.value))} style={{width:90}}/></label>
        <label>crashAt <input type="number" value={crashAt as any} onChange={e=>setCrashAt(e.target.value===""? "": Number(e.target.value))} placeholder="空=不崩" style={{width:90}}/></label>
        {!running ? <button onClick={start} style={{ padding:"8px 12px" }}>开始</button> : <button onClick={stop} style={{ padding:"8px 12px" }}>停止</button>}
      </div>

      <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 12, padding: 12, maxHeight: 360, overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: 12 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.kind === "error" ? "#b91c1c" : l.kind === "done" ? "#065f46" : "#111" }}>
            [{l.ts}] {l.kind.toUpperCase()} {l.text}
          </div>
        ))}
      </div>

      <DebugDock />
    </div>
  );
}
