
import React, { useEffect, useRef, useState } from 'react';

/** ---------- 花色渲染 ---------- **/
const SUIT_CHAR: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', RJ: '🃏', BJ: '🃏' };
const SUIT_COLOR: Record<string, string> = { S: '#222', C: '#222', H: '#c00', D: '#c00', RJ: '#c00', BJ: '#222' };
const labelText = (l: string) => (l === 'T' ? '10' : l);

function CardLine({ cards }: { cards: any[] }): JSX.Element {
  if (!cards || !cards.length) return <span style={{ opacity: 0.6 }}>过</span>;
  return (
    <span>
      {cards.map((c: any, idx: number) => (
        <span key={c.code || `${c.label}-${idx}`} style={{ marginRight: 6, color: SUIT_COLOR[c.suit] || '#222' }}>
          <span>{SUIT_CHAR[c.suit] || ''}</span>
          <span style={{ marginLeft: 2 }}>{labelText(c.label || '')}</span>
        </span>
      ))}
    </span>
  );
}

/** ---------- 类型 ---------- **/
type Board = {
  hands: string[][];
  last: string[];
  landlord: number | null;
  bottom: string[];
  handsRich: any[][];
  lastRich: any[][];
  bottomRich: any[];
  trick: Array<{ seat: number; pass?: boolean; cardsRich?: any[] }>;
};

type LiveProps = {
  rounds: number;
  seed: number;
  rob: boolean;
  four2: 'both' | '2singles' | '2pairs';
  delayMs: number;
  startScore: number;
  players: string;
  apiKeys?: {
    openai?: string;
    gemini?: string;
    kimi?: string;
    grok?: string;
    httpBase?: string;
    httpToken?: string;
  };
};
type Mode = 'auto' | 'post' | 'sse';

/** ---------- 实时面板 ---------- **/
function LivePanel(props: LiveProps): JSX.Element {
  const [lines, setLines] = useState<string[]>([]);
  const push = (t: string) => setLines((l) => [...l, t]);

  const [board, setBoard] = useState<Board>({
    hands: [[], [], []],
    last: ['', '', ''],
    landlord: null,
    bottom: [],
    handsRich: [[], [], []],
    lastRich: [[], [], []],
    bottomRich: [],
    trick: [],
  });

  const [totals, setTotals] = useState<[number, number, number]>([props.startScore||0, props.startScore||0, props.startScore||0]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'streaming' | 'terminated'>('idle');

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotFirstChunkRef = useRef(false);

  const [endpointOverride, setEndpointOverride] = useState<string>('');
  const [mode, setMode] = useState<Mode>('auto');

  function clearWatchdog() { if (watchdogRef.current) { clearTimeout(watchdogRef.current as any); watchdogRef.current = null; } }
  function armWatchdog() {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => { if (!gotFirstChunkRef.current) push('⚠️ 长时间未收到数据，请检查后端是否返回 NDJSON 或 SSE。'); }, 5000);
  }

  function handle(obj: any) {
    if (obj?.type === 'event') {
      if (obj.kind === 'turn') {
        const seat = ['甲', '乙', '丙'][obj.seat];
        const req = obj.require ? `需跟:${obj.require.type}>${obj.require.mainRank}` : '';
        push(`【回合】${seat} ${obj.lead ? '(领出)' : ''} ${req}`);
      } else if (obj.kind === 'deal') {
        const SUITS = ['S', 'H', 'D', 'C'];
        const nextIdx: Record<string, number> = {};
        const take = (label: string) => {
          if (label === 'X') return { label, suit: 'RJ', code: 'J-R' };
          if (label === 'x') return { label, suit: 'BJ', code: 'J-B' };
          const i = nextIdx[label] || 0;
          const suit = SUITS[i % 4];
          nextIdx[label] = i + 1;
          return { label, suit, code: `${label}-${suit}-${i + 1}` };
        };
        const handsRich = (obj.hands || []).map((arr: string[]) => arr.map(take));
        const bottomRich = (obj.bottom || []).map(take);
        setBoard((b) => ({
          ...b,
          hands: obj.hands,
          bottom: obj.bottom,
          handsRich,
          bottomRich,
          lastRich: [[], [], []],
          trick: [],
        }));
        push(`发牌：底牌 ${obj.bottom?.join('') ?? ''}`);
      } else if (obj.kind === 'landlord') {
        setBoard((b) => ({ ...b, landlord: obj.landlord }));
        push(`确定地主：${['甲', '乙', '丙'][obj.landlord]}，底牌 ${obj.bottom?.join('') ?? ''} 基础分 ${obj.baseScore ?? ''}`);
      } else if (obj.kind === 'trick-reset') {
        setBoard((b) => ({ ...b, trick: [] }));
        push('新一轮开始。');
      } else if (obj.kind === 'play') {
        const seatName = ['甲', '乙', '丙'][obj.seat];
        if (obj.move === 'pass') {
          push(`${seatName}：过${obj.reason ? ' — 理由：' + obj.reason : ''}`);
          setBoard((b) => {
            const last = b.last.slice(); last[obj.seat] = '过';
            const lastRich = b.lastRich.map((x) => x.slice()); lastRich[obj.seat] = [];
            const trick = b.trick.slice(); trick.push({ seat: obj.seat, pass: true, cardsRich: [] });
            return { ...b, last, lastRich, trick };
          });
        } else {
          const labels: string[] = obj.cards || [];
          const text = labels.join('');
          push(`${seatName}：${obj.comboType || obj.type || '出牌'} ${text}${obj.reason ? ' — 理由：' + obj.reason : ''}`);
          setBoard((b) => {
            const last = b.last.slice(); last[obj.seat] = text;
            const hands = b.hands.map((a) => a.slice());
            for (const lab of labels) {
              const k = hands[obj.seat].indexOf(lab);
              if (k >= 0) hands[obj.seat].splice(k, 1);
            }
            const handsRich = b.handsRich.map((arr) => arr.slice());
            const taken: any[] = [];
            for (const lab of labels) {
              const k = handsRich[obj.seat].findIndex((c: any) => c.label === lab);
              if (k >= 0) taken.push(handsRich[obj.seat].splice(k, 1)[0]);
            }
            const lastRich = b.lastRich.map((x) => x.slice()); lastRich[obj.seat] = taken;
            const trick = b.trick.slice(); trick.push({ seat: obj.seat, cardsRich: taken });
            return { ...b, last, hands, handsRich, lastRich, trick };
          });
        }
      }
    } else if (obj?.type === 'score') {
      setTotals([obj.totals?.[0], obj.totals?.[1], obj.totals?.[2]]);
      const spring = obj.spring ? (obj.spring==='spring'?' · 春天×2':' · 反春天×2') : '';
      push(`积分：甲 ${obj.totals?.[0]} / 乙 ${obj.totals?.[1]} / 丙 ${obj.totals?.[2]}  · 底分=${obj.base} 倍数=${obj.multiplier}${spring}`);
    } else if (obj?.type === 'terminated') {
      setStatus('terminated');
      push('对局已终止。');
    }
  }

  async function runPOST(url: string) {
    const body: any = {
      rounds: props.rounds,
      seed: props.seed,
      rob: props.rob,
      four2: props.four2,
      delayMs: props.delayMs,
      startScore: props.startScore,
      start_score: props.startScore,
      players: props.players,
      playersList: (props.players || '').split(',').map((s) => s.trim()),
      apiKeys: props.apiKeys || {},
    };
    const ac = new AbortController();
    abortRef.current = ac;
    push(`连接(POST NDJSON)：${url}`);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    push(`HTTP ${r.status}  · content-type=${r.headers.get('content-type')}`);
    if (!r.ok || !r.body) throw new Error('响应不可读');
    setStatus('streaming');
    gotFirstChunkRef.current = false;
    armWatchdog();
    const reader = r.body.getReader();
    readerRef.current = reader;
    const dec = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (!gotFirstChunkRef.current) { gotFirstChunkRef.current = true; push('✅ 已收到数据流(POST)。'); clearWatchdog(); }
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
          const obj = JSON.parse(payload);
          handle(obj);
        } catch {}
      }
    }
  }

  function runSSE(url: string) {
    return new Promise<void>((resolve, reject) => {
      const qs = new URLSearchParams({
        rounds: String(props.rounds),
        seed: String(props.seed),
        rob: String(props.rob),
        four2: String(props.four2),
        delayMs: String(props.delayMs),
        startScore: String(props.startScore),
        players: props.players,
      });
      const full = url.includes('?') ? url + '&' + qs.toString() : url + '?' + qs.toString();
      push(`连接(GET SSE)：${full}`);
      const es = new EventSource(full);
      esRef.current = es;
      let opened = false;
      setStatus('streaming');
      armWatchdog();
      es.onopen = () => { opened = true; push('SSE 打开'); };
      es.onerror = () => { if (!opened) reject(new Error('SSE 打开失败')); else push('SSE 错误'); };
      es.onmessage = (ev) => {
        if (!gotFirstChunkRef.current) { gotFirstChunkRef.current = true; push('✅ 已收到数据流(SSE)。'); clearWatchdog(); }
        try { const obj = JSON.parse(ev.data); handle(obj); } catch {}
      };
    });
  }

  async function start() {
    try {
      setLines([]);
      setStatus('connecting');
      setRunning(true);
      gotFirstChunkRef.current = false;
      const candidates = endpointOverride ? [endpointOverride] : ['/api/stream_ndjson', '/api/stream', '/api/live_ndjson', '/api/live'];
      const tryModes: Mode[] = mode === 'auto' ? ['post', 'sse'] : [mode];
      let connected = false;
      for (const u of candidates) {
        for (const m of tryModes) {
          try {
            if (m === 'post') await runPOST(u);
            else await runSSE(u);
            connected = true;
            break;
          } catch (e: any) {
            push(`连接失败(${m}): ${u} · ${String(e?.message || e)}`);
          }
        }
        if (connected) break;
      }
      if (!connected) {
        push('❌ 所有尝试均失败，请确认后端端点与返回格式（NDJSON 或 SSE）。');
        setStatus('idle');
        setRunning(false);
      }
    } catch (err: any) {
      push('启动异常：' + String(err?.message || err));
      setStatus('idle');
      setRunning(false);
    }
  }

  function stop() {
    try { abortRef.current?.abort(); } catch {}
    try { esRef.current?.close(); } catch {}
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
    setStatus('idle');
    setRunning(false);
    push('已停止。');
  }

  useEffect(() => { return () => { stop(); }; }, []);

  return (
    <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={running ? stop : start}>{running ? '停止' : '开始'}</button>
        <span style={{ opacity: 0.7 }}>状态：{status}</span>
        <details>
          <summary>连接设置</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 8, marginTop: 8 }}>
            <label>自定义端点（留空自动尝试）<br />
              <input value={endpointOverride} onChange={e => setEndpointOverride(e.target.value)} placeholder="/api/stream_ndjson" />
            </label>
            <label>方式<br />
              <select value={mode} onChange={e => setMode(e.target.value as Mode)}>
                <option value="auto">自动（POST→SSE）</option>
                <option value="post">POST（NDJSON）</option>
                <option value="sse">GET（SSE）</option>
              </select>
            </label>
          </div>
        </details>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ border: '1px solid #eee', borderRadius: 6, padding: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {['甲', '乙', '丙'][i]} {board.landlord === i ? '（地主）' : ''}
            </div>
            <div>手牌数：{board.hands[i]?.length ?? 0}</div>
            <div style={{ marginTop: 6, lineHeight: 1.6 }}>
              手牌：<code><CardLine cards={board.handsRich ? board.handsRich[i] : []} /></code>
            </div>
            <div style={{ marginTop: 6 }}>
              最近出牌：<code><CardLine cards={board.lastRich ? board.lastRich[i] : []} /></code>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700 }}>本轮出牌顺序</div>
        <div style={{ whiteSpace: 'pre-wrap', background: '#fcfcfc', padding: '6px 8px', border: '1px solid #eee', borderRadius: 4 }}>
          {board.trick && board.trick.length ? (
            board.trick.map((t: any, idx: number) => (
              <div key={idx} style={{ marginBottom: 4 }}>
                <span style={{ marginRight: 6 }}>{['甲', '乙', '丙'][t.seat]}：</span>
                {t.pass ? <span style={{ opacity: 0.7 }}>过</span> : <CardLine cards={t.cardsRich || []} />}
              </div>
            ))
          ) : (
            <span style={{ opacity: 0.6 }}>（暂无）</span>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 700 }}>事件日志（诊断信息）</div>
        <div style={{ whiteSpace: 'pre-wrap', background: '#fcfcfc', padding: '6px 8px', border: '1px solid #eee', borderRadius: 4, maxHeight: 260, overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
          {lines.map((l, i) => (<div key={i}>• {l}</div>))}
        </div>
      </div>
    </div>
  );
}

/** ---------- 页面 ---------- **/
export default function Home(): JSX.Element {
  const [rounds, setRounds] = useState<number>(1);
  const [seed, setSeed] = useState<number>(0);
  const [rob, setRob] = useState<boolean>(true);
  const [four2, setFour2] = useState<'both' | '2singles' | '2pairs'>('both');
  const [delayMs, setDelayMs] = useState<number>(200);
  const [startScore, setStartScore] = useState<number>(0);

  const [players, setPlayers] = useState<string>('builtin,builtin,builtin');
  const [seatProviders, setSeatProviders] = useState<('builtin' | 'openai' | 'gemini' | 'kimi' | 'grok' | 'http')[]>(['builtin', 'builtin', 'builtin']);
  const [apiKeys, setApiKeys] = useState({ openai: '', gemini: '', kimi: '', grok: '', httpBase: '', httpToken: '' });

  function syncFromPlayersString(s: string) {
    const arr = (s || '').split(',').map((x) => x.trim());
    const pad: any[] = ['builtin', 'builtin', 'builtin'];
    for (let i = 0; i < Math.min(3, arr.length); i++) { if (arr[i]) pad[i] = arr[i]; }
    setSeatProviders(pad as any);
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto', padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <h1>斗地主 AI 比赛 · 甲 / 乙 / 丙</h1>
      <p>为每位选手选择内建或外部 AI，并可设置每步出牌延迟（ms）。</p>

      <fieldset style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
        <legend>对局参数</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, alignItems: 'end' }}>
          <label>局数<br /><input type="number" value={rounds} min={1} onChange={(e) => setRounds(Number(e.target.value))} /></label>
          <label>随机种子<br /><input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
          <label>抢地主制<br /><input type="checkbox" checked={rob} onChange={(e) => setRob(e.target.checked)} /></label>
          <label>四带二<br />
            <select value={four2} onChange={(e) => setFour2(e.target.value as any)}>
              <option value="both">两种都允许</option>
              <option value="2singles">只允许两单</option>
              <option value="2pairs">只允许两对</option>
            </select>
          </label>
          <label>延迟（ms）<br /><input type="number" value={delayMs} min={0} onChange={(e) => setDelayMs(Number(e.target.value))} /></label>
          <label>起始分<br /><input type="number" value={startScore} onChange={(e) => setStartScore(Number(e.target.value))} /></label>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>每家算法选择</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {['甲', '乙', '丙'].map((label, i) => (
              <label key={i}>
                {label}：
                <select
                  value={seatProviders[i]}
                  onChange={(e) => {
                    const v = e.target.value as any;
                    const arr = seatProviders.slice() as any[];
                    arr[i] = v;
                    setSeatProviders(arr as any);
                    setPlayers((arr as any).join(','));
                  }}
                >
                  <option value="builtin">内建</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Gemini</option>
                  <option value="kimi">Kimi</option>
                  <option value="grok">Grok</option>
                  <option value="http">HTTP</option>
                </select>
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>API Keys / HTTP</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <label>OpenAI Key<br /><input type="password" value={apiKeys.openai} onChange={(e) => setApiKeys({ ...apiKeys, openai: e.target.value })} placeholder="sk-..." /></label>
            <label>Gemini Key<br /><input type="password" value={apiKeys.gemini} onChange={(e) => setApiKeys({ ...apiKeys, gemini: e.target.value })} /></label>
            <label>Kimi Key<br /><input type="password" value={apiKeys.kimi} onChange={(e) => setApiKeys({ ...apiKeys, kimi: e.target.value })} /></label>
            <label>Grok Key<br /><input type="password" value={apiKeys.grok} onChange={(e) => setApiKeys({ ...apiKeys, grok: e.target.value })} /></label>
            <label>HTTP Base URL<br /><input value={apiKeys.httpBase} onChange={(e) => setApiKeys({ ...apiKeys, httpBase: e.target.value })} placeholder="https://example.com/api" /></label>
            <label>HTTP Token<br /><input type="password" value={apiKeys.httpToken} onChange={(e) => setApiKeys({ ...apiKeys, httpToken: e.target.value })} /></label>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label>选手（逗号分隔）<br />
            <input style={{ width: '100%' }} value={players} onChange={(e) => { const v = e.target.value; setPlayers(v); syncFromPlayersString(v); }} placeholder="builtin,builtin,builtin" />
          </label>
        </div>
      </fieldset>

      <details style={{ marginTop: 16 }}>
        <summary>实时运行（流式）</summary>
        {React.createElement(LivePanel as any, { rounds, seed, rob, four2, delayMs, startScore, players, apiKeys })}
      </details>
    </div>
  );
}
