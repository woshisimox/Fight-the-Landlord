// /pages/index.tsx
import * as React from 'react';

type TSSeat = { mu: number; sigma: number; rc: number };

function useInitialTS(): TSSeat[] {
  const mu0 = 1000, sig0 = 1000 / 3;
  return [
    { mu: mu0, sigma: sig0, rc: mu0 - 3 * sig0 },
    { mu: mu0, sigma: sig0, rc: mu0 - 3 * sig0 },
    { mu: mu0, sigma: sig0, rc: mu0 - 3 * sig0 },
  ];
}

export default function Home() {
  // ====== 你原有的状态保持不变；这里只加 TrueSkill 状态与简单控制 ======
  const [rounds, setRounds] = React.useState<number>(3);
  const [running, setRunning] = React.useState<boolean>(false);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [tsSeats, setTsSeats] = React.useState<TSSeat[]>(useInitialTS());

  const appendLog = React.useCallback((line: string) => {
    setLogs(prev => (prev.length > 400 ? prev.slice(prev.length - 400) : prev).concat(line));
  }, []);

  const startMatch = async () => {
    if (running) return;
    setRunning(true);
    setLogs([]);
    try {
      const body: any = {
        rounds,
        // 你的引擎原有参数都可以继续放在这里透传……
        tsSeats: tsSeats.map(s => ({ mu: s.mu, sigma: s.sigma })), // <<< TrueSkill 跨请求延续
      };

      const res = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const reader = res.body?.getReader();
      if (!reader) { appendLog('无法获取流 reader'); setRunning(false); return; }

      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }

          // === 你原有的事件处理逻辑保持；这里只关心 ts / log / warn / error ===
          if (ev.type === 'ts' && Array.isArray(ev.seats)) {
            setTsSeats(ev.seats as TSSeat[]);
          } else if (ev.type === 'log' || ev.type === 'warn' || ev.type === 'error') {
            appendLog(`[${ev.type}] ${ev.message ?? ''}`);
          }
        }
      }
    } catch (e: any) {
      appendLog(`fetch/stream 错误：${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}>
      <h2 style={{ margin: 0, marginBottom: 12 }}>斗地主 · TrueSkill 演示集成</h2>

      {/* ====== 控制条（保持最小） ====== */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>
          局数：
          <input
            type="number"
            value={rounds}
            min={1}
            max={1000}
            onChange={e => setRounds(Math.max(1, Number(e.target.value || 1)))}
            style={{ width: 80, marginLeft: 6 }}
          />
        </label>
        <button onClick={startMatch} disabled={running} style={{ padding: '6px 12px' }}>
          {running ? '运行中…' : '开始'}
        </button>
      </div>

      {/* ====== TrueSkill 只读小卡片（TS_START） ====== */}
      <div style={{ marginTop: 8, padding: 8, border: '1px solid #eee', borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>TrueSkill（μ / σ / 保守分 μ−3σ）</div>
        <div style={{ display: 'flex', gap: 12 }}>
          {tsSeats.map((s, i) => (
            <div key={i} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, minWidth: 180 }}>
              <div style={{ opacity: 0.8, marginBottom: 4 }}>
                座位 {i === 0 ? '甲' : i === 1 ? '乙' : '丙'}
              </div>
              <div>μ = {s.mu.toFixed(2)}</div>
              <div>σ = {s.sigma.toFixed(2)}</div>
              <div>Rc = {s.rc.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>
      {/* ====== TrueSkill 小卡片（TS_END） ====== */}

      {/* ====== 简易日志（你可替换为现有日志区） ====== */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>运行日志</div>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            border: '1px solid #eee',
            borderRadius: 8,
            padding: 8,
            minHeight: 120,
            maxHeight: 240,
            overflow: 'auto',
            background: '#fafafa',
          }}
        >
          {logs.join('\n')}
        </div>
      </div>
    </div>
  );
}
