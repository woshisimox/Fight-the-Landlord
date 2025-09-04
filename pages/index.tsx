// pages/index.tsx
import React, { useRef, useState } from 'react';

/** ---------- 花色渲染辅助 ---------- **/
const SUIT_CHAR: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', RJ: '🃏', BJ: '🃏' };
const SUIT_COLOR: Record<string, string> = { S: '#222', C: '#222', H: '#c00', D: '#c00', RJ: '#c00', BJ: '#222' };

function labelDisplay(l: string) {
  return l === 'T' ? '10' : l;
}

function CardLine({ cards }: { cards: any[] }) {
  if (!cards || !cards.length) return <span style={{ opacity: 0.6 }}>过</span>;
  return (
    <span>
      {cards.map((c: any, idx: number) => {
        const icon = SUIT_CHAR[c.suit] || '';
        const color = SUIT_COLOR[c.suit] || '#222';
        const text = labelDisplay(c.label || '');
        return (
          <span key={c.code || `${c.label}-${idx}`} style={{ marginRight: 6, color }}>
            <span>{icon}</span>
            <span style={{ marginLeft: 2 }}>{text}</span>
          </span>
        );
      })}
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
};

type Provider = 'builtin' | 'openai' | 'gemini' | 'kimi' | 'grok' | 'http';

/** ---------- 实时面板 ---------- **/
const LivePanel: React.FC<LiveProps> = (props) => {
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

  const [totals, setTotals] = useState<[number, number, number]>([
    props.startScore || 0,
    props.startScore || 0,
    props.startScore || 0,
  ]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'streaming' | 'terminated'>('idle');

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function handle(obj: any) {
    if (obj?.type === 'event') {
      if (obj.kind === 'turn') {
        const seat = ['甲', '乙', '丙'][obj.seat];
        const req = obj.require ? `需跟:${obj.require.type}>${obj.require.mainRank}` : '';
        push(`【回合】${seat} ${obj.lead ? '(领出)' : ''} ${req}`);
      } else if (obj.kind === 'deal') {
        // 给每张牌分配花色，保证后续渲染一致
        const SUITS = ['S', 'H', 'D', 'C'];
        const nextIdx: Record<string, number> = {};
        function take(label: string) {
          if (label === 'X') return { label, suit: 'RJ', code: `J-R` };
          if (label === 'x') return { label, suit: 'BJ', code: `J-B` };
          const i = nextIdx[label] || 0;
          const suit = SUITS[i % 4];
          nextIdx[label] = i + 1;
          return { label, suit, code: `${label}-${suit}-${i + 1}` };
        }
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
        push(`发牌：底牌 ${obj.bottom.join('')}`);
      } else if (obj.kind === 'landlord') {
        setBoard((b) => ({ ...b, landlord: obj.landlord }));
        push(
          `确定地主：${['甲', '乙', '丙'][obj.landlord]}，底牌 ${obj.bottom?.join('') ?? ''} 基础分 ${obj.baseScore ?? ''}`
        );
      } else if (obj.kind === 'trick-reset') {
        setBoard((b) => ({ ...b, trick: [] }));
        push('新一轮开始。');
      } else if (obj.kind === 'play') {
        const seatName = ['甲', '乙', '丙'][obj.seat];
        if (obj.move === 'pass') {
          push(`${seatName}：过${obj.reason ? ' — 理由：' + obj.reason : ''}`);
          setBoard((b) => {
            const last = b.last.slice();
            last[obj.seat] = '过';
            const lastRich = b.lastRich.map((x) => x.slice());
            lastRich[obj.seat] = [];
            const trick = b.trick.slice();
            trick.push({ seat: obj.seat, pass: true, cardsRich: [] });
            return { ...b, last, lastRich, trick };
          });
        } else {
          const labels: string[] = obj.cards || [];
          const text = labels.join('');
          push(`${seatName}：${obj.comboType || obj.type || '出牌'} ${text}${obj.reason ? ' — 理由：' + obj.reason : ''}`);
          setBoard((b) => {
            const last = b.last.slice();
            last[obj.seat] = text;

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

            const lastRich = b.lastRich.map((x) => x.slice());
            lastRich[obj.seat] = taken;

            const trick = b.trick.slice();
            trick.push({ seat: obj.seat, cardsRich: taken });

            return { ...b, last, hands, handsRich, lastRich, trick };
          });
        }
      }
    } else if (obj?.type === 'score') {
      setTotals([obj.totals[0], obj.totals[1], obj.totals[2]]);
      push(`积分：甲 ${obj.totals[0]} / 乙 ${obj.totals[1]} / 丙 ${obj.totals[2]}`);
    } else if (obj?.type === 'terminated') {
      setStatus('terminated');
      push('对局已终止。');
    }
  }

  async function start() {
    try {
      setLines([]);
      setStatus('connecting');
      setRunning(true);

      // body 由父组件传入的 players + 可选 apiKeys（保持后端兼容）
      const body: any = (window as any).__ddz_req_body__ || {};
      const ac = new AbortController();
      abortRef.current = ac;

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.body) {
        push('后台无响应流。');
        setStatus('idle');
        setRunning(false);
        return;
      }
      setStatus('streaming');
      const reader = r.body.getReader();
      readerRef.current = reader;
      const dec = new TextDecoder('utf-8');
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const obj = JSON.parse(line);
            handle(obj);
          } catch {
            // 忽略非 JSON 行
          }
        }
      }
      setStatus('idle');
      setRunning(false);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        push('已停止。');
      } else {
        push('发生错误：' + String(err?.message || err));
      }
      setStatus('idle');
      setRunning(false);
    }
  }

  function stop() {
    try {
      abortRef.current?.abort();
    } catch {}
    setStatus('idle');
    setRunning(false);
  }

  return (
    <div style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, marginTop: 12 }}>
      <div>
        <button onClick={running ? stop : start}>{running ? '停止' : '开始'}</button>
        <span style={{ marginLeft: 12, opacity: 0.7 }}>状态：{status}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ border: '1px solid #eee', borderRadius: 6, padding: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {['甲', '乙', '丙'][i]} {board.landlord === i ? '（地主）' : ''}
            </div>
            <div>手牌数：{board.hands[i]?.length ?? 0}</div>
            {/* 新增：显示手牌 */}
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
        <div
          style={{
            whiteSpace: 'pre-wrap',
            background: '#fcfcfc',
            padding: '6px 8px',
            border: '1px solid #eee',
            borderRadius: 4,
          }}
        >
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
        <div style={{ fontWeight: 700 }}>事件日志</div>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            background: '#fcfcfc',
            padding: '6px 8px',
            border: '1px solid #eee',
            borderRadius: 4,
            maxHeight: 240,
            overflow: 'auto',
          }}
        >
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

/** ---------- 页面 ---------- **/
export default function Home() {
  const [rounds, setRounds] = useState<number>(1);
  const [seed, setSeed] = useState<number>(0);
  const [rob, setRob] = useState<boolean>(true);
  const [four2, setFour2] = useState<'both' | '2singles' | '2pairs'>('both');
  const [delayMs, setDelayMs] = useState<number>(200);
  const [startScore, setStartScore] = useState<number>(0);

  // 仍保留原有 players 字符串（兼容后端），新增可视化选择并双向同步
  const [players, setPlayers] = useState<string>('builtin,builtin,builtin');
  const [seatProviders, setSeatProviders] = useState<Provider[]>(['builtin', 'builtin', 'builtin']);

  // 可选：API Keys / HTTP 配置（随请求发送，后端不识别也不会影响）
  const [apiKeys, setApiKeys] = useState({
    openai: '',
    gemini: '',
    kimi: '',
    grok: '',
    httpBase: '',
    httpToken: '',
  });

  // 当手动编辑 players 字符串时，同步回三个下拉
  function syncFromPlayersString(s: string) {
    const arr = (s || '').split(',').map((x) => x.trim()) as Provider[];
    const pad: Provider[] = ['builtin', 'builtin', 'builtin'];
    for (let i = 0; i < Math.min(3, arr.length); i++) {
      if (arr[i]) pad[i] = arr[i] as Provider;
    }
    setSeatProviders(pad);
  }

  // 组合请求体（避免改 LivePanel 内 start() 逻辑：通过 window 临时挂载）
  function mountRequestBody() {
    (window as any).__ddz_req_body__ = {
      rounds,
      seed,
      rob,
      four2,
      delayMs,
      startScore,
      players,
      apiKeys, // 新增：可选密钥/HTTP配置
    };
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto', padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <h1>斗地主 AI 比赛 · 甲 / 乙 / 丙</h1>
      <p>为每位选手选择内建或外部 AI，并可设置每步出牌延迟（ms）。</p>

      <fieldset style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
        <legend>对局参数</legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, alignItems: 'end' }}>
          <label>
            局数<br />
            <input type="number" value={rounds} min={1} onChange={(e) => setRounds(Number(e.target.value))} />
          </label>
          <label>
            随机种子<br />
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
          </label>
          <label>
            抢地主制<br />
            <input type="checkbox" checked={rob} onChange={(e) => setRob(e.target.checked)} />
          </label>
          <label>
            四带二<br />
            <select value={four2} onChange={(e) => setFour2(e.target.value as any)}>
              <option value="both">两种都允许</option>
              <option value="2singles">只允许两单</option>
              <option value="2pairs">只允许两对</option>
            </select>
          </label>
          <label>
            延迟（ms）<br />
            <input type="number" value={delayMs} min={0} onChange={(e) => setDelayMs(Number(e.target.value))} />
          </label>
          <label>
            起始分<br />
            <input type="number" value={startScore} onChange={(e) => setStartScore(Number(e.target.value))} />
          </label>
        </div>

        {/* 新增：每家算法选择 */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>每家算法选择</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {['甲', '乙', '丙'].map((label, i) => (
              <label key={i}>
                {label}：
                <select
                  value={seatProviders[i]}
                  onChange={(e) => {
                    const v = e.target.value as Provider;
                    const arr = seatProviders.slice();
                    arr[i] = v;
                    setSeatProviders(arr);
                    setPlayers(arr.join(','));
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

        {/* 新增：API Keys / HTTP 配置（可选） */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>API Keys / HTTP</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <label>
              OpenAI Key<br />
              <input
                type="password"
                value={apiKeys.openai}
                onChange={(e) => setApiKeys({ ...apiKeys, openai: e.target.value })}
                placeholder="sk-..."
              />
            </label>
            <label>
              Gemini Key<br />
              <input type="password" value={apiKeys.gemini} onChange={(e) => setApiKeys({ ...apiKeys, gemini: e.target.value })} />
            </label>
            <label>
              Kimi Key<br />
              <input type="password" value={apiKeys.kimi} onChange={(e) => setApiKeys({ ...apiKeys, kimi: e.target.value })} />
            </label>
            <label>
              Grok Key<br />
              <input type="password" value={apiKeys.grok} onChange={(e) => setApiKeys({ ...apiKeys, grok: e.target.value })} />
            </label>
            <label>
              HTTP Base URL<br />
              <input
                value={apiKeys.httpBase}
                onChange={(e) => setApiKeys({ ...apiKeys, httpBase: e.target.value })}
                placeholder="https://example.com/api"
              />
            </label>
            <label>
              HTTP Token<br />
              <input
                type="password"
                value={apiKeys.httpToken}
                onChange={(e) => setApiKeys({ ...apiKeys, httpToken: e.target.value })}
              />
            </label>
          </div>
        </div>

        {/* 原有 players 文本框保留：可手动覆盖并同步回下拉 */}
        <div style={{ marginTop: 12 }}>
          <label>
            选手（逗号分隔）<br />
            <input
              style={{ width: '100%' }}
              value={players}
              onChange={(e) => {
                const v = e.target.value;
                setPlayers(v);
                syncFromPlayersString(v);
              }}
              placeholder="builtin,builtin,builtin"
            />
          </label>
        </div>
      </fieldset>

      <details style={{ marginTop: 16 }} onToggle={mountRequestBody}>
        <summary>实时运行（流式）</summary>
        {React.createElement(LivePanel as any, { rounds, seed, rob, four2, delayMs, startScore, players })}
      </details>
    </div>
  );
}
