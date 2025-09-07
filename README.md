# Debug Add-on (Downloadable Logs + Backend Ring Buffer)

This drop-in package adds a floating **🐞 Debug** button to your Next.js (pages directory) app to help diagnose front-end "freeze" vs. backend stop. It includes:
- Client log capture (console, window errors, unhandled rejections)
- Backend heartbeat indicator (`/api/ping`)
- Server-side **in-memory ring buffer** logs
- One-click **Download debug report** (client + server logs bundled into a JSON file)

Tested with Next.js 13/14 in `pages` projects and TypeScript.

---

## 1) Files

```
components/DebugDock.tsx
lib/debug/clientLogger.ts
lib/debug/serverLog.ts
pages/api/ping.ts
pages/api/debug_dump.ts
pages/api/stream_ndjson.instrumented.diff   # example patch for your streaming route
```

> If you deploy on Vercel, server logs are kept in-memory across the lambda's lifetime. Optionally enable file appends in `/tmp` by setting env `WRITE_LOG_FILE=1`.

---

## 2) Add the Debug Dock to your UI

In your main page (e.g. `pages/index.tsx`), add at the bottom of your component tree:

```tsx
import dynamic from "next/dynamic";
const DebugDock = dynamic(() => import("../components/DebugDock"), { ssr: false });

export default function Home() { 
  // ... your existing code ...
  return (
    <div>
      {/* your app */}
      <DebugDock />
    </div>
  );
}
```

The dock will:
- Patch `console.*` to capture logs (still prints to console)
- Record `window.onerror` & `unhandledrejection`
- Ping `/api/ping` every 5s and show a green/gray dot
- Let you **Download debug report** (JSON file) merging client and server logs

---

## 3) Instrument your streaming API (server logs)

Apply the example diff to your `pages/api/stream_ndjson.ts` (or equivalent). **Minimal changes**:
- Import `sInfo/sDebug/sError` from `lib/debug/serverLog`
- Log at request start/end
- Log every line sent to the client

See: `pages/api/stream_ndjson.instrumented.diff`

If you prefer, you can directly add these lines:

```ts
import { sInfo, sError, sDebug } from "../../lib/debug/serverLog";

const reqId = Math.random().toString(36).slice(2, 8);
sInfo("stream", "request:start", { ua: req.headers["user-agent"], query: req.query }, reqId);

function writeLine(obj: any){
  try { sDebug("stream", "send", obj, reqId); } catch {}
  res.write(JSON.stringify(obj) + "\n");
}

try {
  // ... your existing logic
} catch (err:any) {
  writeLine({ type: "error", message: String(err?.message || err) });
  try { sError("stream", "exception", { error: String(err?.stack || err) }, reqId); } catch {}
} finally {
  try { sInfo("stream", "request:end", {}, reqId); } catch {}
  res.end();
}
```

---

## 4) Backend endpoints

- `GET /api/ping` → `{ ok: true, ts }` (used by dock heartbeat)
- `GET /api/debug_dump` → JSON with `serverLogs`. Add `?format=ndjson` to stream NDJSON.

---

## 5) Optional: Write logs to file

If your platform allows writing to `/tmp` (Vercel does for ephemeral runtime), set:

- `WRITE_LOG_FILE=1`
- `LOG_FILE_PATH=/tmp/app.log` (optional; default `/tmp/app.log`)

---

## 6) Redaction & Privacy

The dock redacts likely secrets (keys/tokens) from client logs. It also only records **presence** of `sessionStorage` keys (names only) in the report—not values. You can extend redaction in `components/DebugDock.tsx` if needed.

---

## 7) Verify

- Start your app
- Open the page, click **🐞 Debug**
- See **Backend:** indicator and recent logs
- Click **Download debug report** to save a JSON file containing both client & server logs

This should help you quickly tell **"frontend卡死 vs 后端停止"** by comparing the last client-side entry and the last server-side `send` / `request:end` entries with timestamps & a shared `reqId`.
