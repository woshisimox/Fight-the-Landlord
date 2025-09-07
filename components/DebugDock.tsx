"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

const dockStyle: React.CSSProperties = {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  zIndex: 99999,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  alignItems: "flex-end",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
};

const btnStyle: React.CSSProperties = {
  borderRadius: 9999,
  padding: "10px 14px",
  border: "1px solid rgba(0,0,0,.1)",
  background: "white",
  boxShadow: "0 2px 10px rgba(0,0,0,.08)",
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  width: 380,
  maxHeight: 500,
  overflow: "auto",
  borderRadius: 16,
  border: "1px solid rgba(0,0,0,.1)",
  background: "white",
  boxShadow: "0 6px 24px rgba(0,0,0,.12)",
  padding: 12,
};

type Level = "debug" | "info" | "warn" | "error";
type Src = "ui" | "net" | "ai" | "sys" | "engine";

type ClientLog = {
  ts: string;
  level: Level;
  src: Src | string;
  msg: string;
  data?: any;
};

class ClientLogger {
  private static _instance: ClientLogger | null = null;
  static get I(): ClientLogger {
    if (!ClientLogger._instance) ClientLogger._instance = new ClientLogger();
    return ClientLogger._instance;
  }

  private logs: ClientLog[] = [];
  private cap = 5000;
  private rxText = "";
  private rxObjs: any[] = [];
  private rxCap = 3000;

  private originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  private patched = false;

  private redact(value: any): any {
    try {
      if (typeof value === "string") {
        const lower = value.toLowerCase();
        if (/(api[_-]?key|token|secret|bearer)/.test(lower) || value.replace(/[^A-Za-z0-9]/g, "").length > 24) {
          if (value.length <= 8) return "***";
          return value.slice(0, 2) + "****" + value.slice(-2);
        }
        return value;
      }
      if (typeof value === "object" && value) {
        const out: any = Array.isArray(value) ? [] : {};
        for (const k of Object.keys(value)) {
          if (/(key|token|secret|authorization|password)/i.test(k)) {
            out[k] = "***";
          } else {
            out[k] = this.redact((value as any)[k]);
          }
        }
        return out;
      }
    } catch {}
    return value;
  }

  private push(entry: ClientLog) {
    this.logs.push(entry);
    if (this.logs.length > this.cap) this.logs.splice(0, this.logs.length - this.cap);
  }

  private pushRxText(txt: string) {
    this.rxText += txt;
    let idx;
    while ((idx = this.rxText.indexOf("\n")) >= 0) {
      const line = this.rxText.slice(0, idx).trim();
      this.rxText = this.rxText.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        this.rxObjs.push({ ts: new Date().toISOString(), obj });
        if (this.rxObjs.length > this.rxCap) this.rxObjs.splice(0, this.rxObjs.length - this.rxCap);
      } catch {
        // keep as raw text if not JSON
        this.rxObjs.push({ ts: new Date().toISOString(), text: line });
        if (this.rxObjs.length > this.rxCap) this.rxObjs.splice(0, this.rxObjs.length - this.rxCap);
      }
    }
  }

  startCapture() {
    if (this.patched) return;
    this.patched = true;

    // Console patch
    console.log = (...args: any[]) => {
      this.push({ ts: new Date().toISOString(), level: "info", src: "ui", msg: "console.log", data: args.map(a => this.redact(a)) });
      this.originalConsole.log(...args);
    };
    console.info = (...args: any[]) => {
      this.push({ ts: new Date().toISOString(), level: "info", src: "ui", msg: "console.info", data: args.map(a => this.redact(a)) });
      this.originalConsole.info(...args);
    };
    console.warn = (...args: any[]) => {
      this.push({ ts: new Date().toISOString(), level: "warn", src: "ui", msg: "console.warn", data: args.map(a => this.redact(a)) });
      this.originalConsole.warn(...args);
    };
    console.error = (...args: any[]) => {
      this.push({ ts: new Date().toISOString(), level: "error", src: "ui", msg: "console.error", data: args.map(a => this.redact(a)) });
      this.originalConsole.error(...args);
    };
    console.debug = (...args: any[]) => {
      this.push({ ts: new Date().toISOString(), level: "debug", src: "ui", msg: "console.debug", data: args.map(a => this.redact(a)) });
      this.originalConsole.debug(...args);
    };

    // Error hooks
    window.addEventListener("error", (e) => {
      this.push({ ts: new Date().toISOString(), level: "error", src: "ui", msg: "window.error", data: this.redact({ message: e.message, stack: (e.error && e.error.stack) || undefined }) });
    });
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      this.push({ ts: new Date().toISOString(), level: "error", src: "ui", msg: "unhandledrejection", data: this.redact({ reason: (e as any).reason }) });
    });

    // Patch stream reader to capture NDJSON RX
    try {
      const RS: any = (window as any).ReadableStream;
      if (RS && RS.prototype && typeof RS.prototype.getReader === "function") {
        const origGetReader = RS.prototype.getReader;
        RS.prototype.getReader = function (...args: any[]) {
          const reader = origGetReader.apply(this, args);
          if (reader && typeof reader.read === "function") {
            const origRead = reader.read.bind(reader);
            reader.read = async (...a: any[]) => {
              const r = await origRead(...a);
              try {
                if (r && r.value) {
                  // try decode as UTF-8 text
                  const txt = new TextDecoder().decode(r.value);
                  if (txt) {
                    ClientLogger.I.pushRxText(txt);
                    ClientLogger.I.push({ ts: new Date().toISOString(), level: "debug", src: "net", msg: "rx-chunk", data: { sample: txt.slice(0, 120) } });
                  }
                }
              } catch {}
              return r;
            };
          }
          return reader;
        };
      }
    } catch {}

    // Fetch heartbeat
    this.ping();
    setInterval(() => this.ping(), 5000);
  }

  info(src: Src | string, msg: string, data?: any) { this.push({ ts: new Date().toISOString(), level: "info", src, msg, data: this.redact(data) }); }
  warn(src: Src | string, msg: string, data?: any) { this.push({ ts: new Date().toISOString(), level: "warn", src, msg, data: this.redact(data) }); }
  error(src: Src | string, msg: string, data?: any) { this.push({ ts: new Date().toISOString(), level: "error", src, msg, data: this.redact(data) }); }
  debug(src: Src | string, msg: string, data?: any) { this.push({ ts: new Date().toISOString(), level: "debug", src, msg, data: this.redact(data) }); }

  getAll(): ClientLog[] { return [...this.logs]; }
  getRxObjs(): any[] { return [...this.rxObjs]; }
  clear() { this.logs = []; this.rxText = ""; this.rxObjs = []; }

  async ping(): Promise<boolean> {
    try {
      const r = await fetch("/api/ping");
      const j = await r.json();
      const ok = !!j?.ok;
      this.info("net", "ping", { ok, ts: j?.ts });
      (window as any).__backendAlive = ok;
      return ok;
    } catch (e) {
      this.warn("net", "ping-failed", { error: String(e) });
      (window as any).__backendAlive = false;
      return false;
    }
  }
}

export const DebugDock: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [alive, setAlive] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [clientCount, setClientCount] = useState(0);
  const [rxCount, setRxCount] = useState(0);

  useEffect(() => {
    ClientLogger.I.startCapture();
    const t = setInterval(() => {
      setClientCount(ClientLogger.I.getAll().length);
      setRxCount(ClientLogger.I.getRxObjs().length);
      setAlive((window as any).__backendAlive ?? null);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const badge = useMemo(() => {
    if (alive === null) return "…";
    return alive ? "●" : "○";
  }, [alive]);

  async function downloadReport() {
    setDownloading(true);
    try {
      const meta = {
        when: new Date().toISOString(),
        url: window.location.href,
        ua: navigator.userAgent,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: navigator.language,
        screen: { w: window.screen.width, h: window.screen.height, dpr: window.devicePixelRatio },
        visibility: document.visibilityState,
      };

      const sessKeys = typeof window !== "undefined" ? Object.keys(sessionStorage || {}).filter(k => !k.toLowerCase().includes("key") && !k.toLowerCase().includes("token")) : [];
      const sesPresence: Record<string, "present" | "absent"> = {};
      for (const k of sessKeys) sesPresence[k] = "present";

      const clientLogs = ClientLogger.I.getAll();
      const streamRx = ClientLogger.I.getRxObjs();

      const r = await fetch("/api/debug_dump");
      const server = await r.json();

      const report = { meta, sessionPresence: sesPresence, clientLogs, streamRx, server };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = URL.createObjectURL(blob);
      a.download = `debug-report-${ts}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      alert("Download failed: " + String(e));
    } finally {
      setDownloading(false);
    }
  }

  function downloadClientNdjson() {
    const arr = ClientLogger.I.getRxObjs().map(x => x.obj ?? x.text);
    const body = arr.map(x => JSON.stringify(x)).join("\n");
    const blob = new Blob([body], { type: "application/x-ndjson" });
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = URL.createObjectURL(blob);
    a.download = `client-rx-${ts}.ndjson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div style={dockStyle}>
      {open && (
        <div style={panelStyle}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <div style={{fontWeight:600}}>Debug Console</div>
            <button style={btnStyle} onClick={() => setOpen(false)}>Close ✕</button>
          </div>
          <div style={{marginTop:8, fontSize:12, opacity:.8}}>
            Backend: <span style={{color: alive ? "#059669" : "#ef4444", fontWeight:700}}>{badge}</span>{" "}
            {alive ? "alive" : "unknown/offline"} • Client logs: {clientCount} • 最近流入对象: {rxCount}
          </div>
          <div style={{display:"flex", gap:8, marginTop:8, flexWrap:"wrap"}}>
            <button style={btnStyle} onClick={() => { ClientLogger.I.clear(); setClientCount(0); setRxCount(0); }}>Clear client logs</button>
            <button style={btnStyle} onClick={downloadClientNdjson}>下载仅客户端RX（NDJSON）</button>
            <button style={btnStyle} onClick={downloadReport} disabled={downloading}>
              {downloading ? "Bundling…" : "下载合并报告（含服务端尝试）"}
            </button>
          </div>
          <div style={{marginTop:10, borderTop:"1px solid #eee", paddingTop:10}}>
            <div style={{fontWeight:600, marginBottom:6}}>Recent client logs</div>
            <div style={{fontFamily:"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize:12, lineHeight:"18px"}}>
              {ClientLogger.I.getAll().slice(-20).map((l, i) => (
                <div key={i} style={{whiteSpace:"pre-wrap"}}>
                  [{l.ts}] {l.level.toUpperCase()} {l.src}: {l.msg}{l.data!==undefined ? " " + JSON.stringify(l.data) : ""}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <button title="Debug" style={btnStyle} onClick={() => setOpen(v => !v)}>
        🐞 Debug {alive === null ? "" : alive ? "●" : "○"}
      </button>
    </div>
  );
};

export default DebugDock;
