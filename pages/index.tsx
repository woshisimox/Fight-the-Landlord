// ==== pages/index.tsx ====
// 你原始的 React 页面整体保留；我只在所有 import 之后、组件外部，插入一个 IIFE

import React from 'react';
// ... 你原有的 import 全部保留 ...

/* ================= NDJSON 前端调试注入（只打日志，不改行为） ================= */
(function () {
  if (typeof window === 'undefined') return;
  if ((window as any).__NDJSON_FE_TRACER__) return;
  (window as any).__NDJSON_FE_TRACER__ = true;

  const on = () => sessionStorage.getItem('ndjson.debug') === '1';
  const log = (...a: any[]) => { if (on()) console.debug('[NDJSON/FE]', ...a); };

  // 1) fetch 打点
  const oldFetch = window.fetch.bind(window);
  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    const res = await oldFetch(...args);
    try { log('fetch', { url: args?.[0], ok: res.ok, status: res.status }); } catch {}
    return res;
  }) as typeof window.fetch;

  // 2) ReadableStream.getReader().read 打点
  const RS: any = (window as any).ReadableStream;
  if (RS?.prototype?.getReader) {
    const oldGetReader = RS.prototype.getReader;
    RS.prototype.getReader = function (...args: any[]) {
      const reader = oldGetReader.apply(this, args);
      if (reader && typeof reader.read === 'function') {
        const oldRead = reader.read.bind(reader);
        reader.read = async (...rargs: any[]) => {
          const ret = await oldRead(...rargs);
          try { log('read', { done: !!ret?.done, bytes: ret?.value?.length || 0 }); } catch {}
          return ret;
        };
      }
      return reader;
    };
  }

  // 3) TextDecoder.decode 打点
  const TD: any = (window as any).TextDecoder;
  if (TD?.prototype?.decode) {
    const oldDecode = TD.prototype.decode;
    TD.prototype.decode = function (...args: any[]) {
      const out = oldDecode.apply(this, args as any);
      try {
        const src = args[0]; const stream = args?.[1]?.stream;
        log('decode', { inBytes: src?.length || 0, stream: !!stream, outLen: typeof out === 'string' ? out.length : 0 });
      } catch {}
      return out;
    };
  }

  // 4) 便捷面包屑
  (window as any).ndjsonMark = (tag: string, meta?: any) => log('mark', { tag, ...meta });

  log('injected');
})();
/* ================= NDJSON 前端调试注入（完） ================= */

// === 从这里开始，保留你原本的 UI 组件与业务逻辑（完全不动） ===

// export default function Home() { ... 你的完整页面代码原样继续 ... }
