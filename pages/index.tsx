import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Bot Arena - Dou Dizhu
 * - 逐张渲染手牌（不再聚合同点数），花色/点数严格按牌面标签展示
 * - 首屏显示积分；对局设置 → 对局 → 运行日志 布局
 * - 兼容 /api/stream_ndjson.ts NDJSON 流事件
 */

// ----------- 小工具：牌面解析 / 排序 / 操作 -----------
const seatName = (i: number) => '甲乙丙'.charAt(i) || `Seat${i+1}`;
const SUIT_ORDER = '♣♦♥♠';
const RANK_ORDER = '3456789TJQKA2xX';

const suitOf = (c: string) => (/[♠♥♦♣]/.test(c?.[0] ?? '') ? c[0] : '');
const rankOf = (c: string) => (/[♠♥♦♣]/.test(c?.[0] ?? '') ? c.slice(1) : c);
const rankIdx = (r: string) => RANK_ORDER.indexOf(r);
const suitIdx = (s: string) => SUIT_ORDER.indexOf(s);

const sortByRankSuit = (a: string, b: string) => {
  const ra = rankIdx(rankOf(a)), rb = rankIdx(rankOf(b));
  if (ra !== rb) return ra - rb;
  const sa = suitIdx(suitOf(a)), sb = suitIdx(suitOf(b));
  return sa - sb;
};

const removeOnce = (arr: string[], card: string) => {
  const i = arr.indexOf(card);
  if (i >= 0) arr.splice(i, 1);
};

const removeLabels = (hand: string[], pick: string[]) => {
  for (const c of pick) removeOnce(hand, c);
};

// ----------- 牌面组件（逐张渲染） -----------
const CardPill: React.FC<{ card: string }> = ({ card }) => {
  const s = suitOf(card);
  const r = rankOf(card);
  const isRed = s === '♥' || s === '♦';
  const show10 = r === 'T' ? '10' : r;
  const suitText = s || (r === 'x' || r === 'X' ? '🃏' : '');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-xl px-2 py-1 border text-sm ${isRed ? 'text-red-600' : 'text-gray-800'}`}
      style={{ borderColor: isRed ? '#fecaca' : '#d1d5db' }}
      title={card}
    >
      <span>{suitText}</span>
      <span>{show10}</span>
    </span>
  );
};

const HandView: React.FC<{ hand: string[] }> = ({ hand }) => (
  <div className="flex flex-wrap gap-2">
    {[...hand].sort(sortByRankSuit).map((c, i) => <CardPill key={`${c}-${i}`} card={c} />)}
  </div>
);

// ----------- 页面 -----------
type Four2 = 'both'|'2singles'|'2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

const BOT_OPTIONS: { value: BotChoice, label: string }[] = [
  { value: 'built-in:greedy-max', label: 'Greedy Max' },
  { value: 'built-in:greedy-min', label: 'Greedy Min' },
  { value: 'built-in:random-legal', label: 'Random Legal' },
  { value: 'ai:openai', label: 'AI: OpenAI' },
  { value: 'ai:gemini', label: 'AI: Gemini' },
  { value: 'ai:grok',   label: 'AI: Grok' },
  { value: 'ai:kimi',   label: 'AI: Kimi' },
  { value: 'ai:qwen',   label: 'AI: Qwen' },
  { value: 'http',      label: 'HTTP Bot' },
];

const IndexPage: React.FC = () => {
  // 对局设置
  const [enabled, setEnabled] = useState(true);
  const [delayMs, setDelayMs] = useState(1000);
  const [startScore, setStartScore] = useState(100);
  const [rob, setRob] = useState(true);
  const [four2, setFour2] = useState<Four2>('both');

  // 每家 AI & 延时
  const [seats, setSeats] = useState<BotChoice[]>([
    'built-in:greedy-max', 'built-in:greedy-min', 'built-in:random-legal'
  ]);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>([1000,1000,1000]);
  const setSeatDelay = (i: number, v: number | string) =>
    setSeatDelayMs(arr => { const n = [...arr]; n[i] = Math.max(0, Math.floor(Number(v) || 0)); return n; });

  // 对局状态
  const [scores, setScores] = useState<number[]>([100,100,100]);
  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [roundDelta, setRoundDelta] = useState<[number,number,number]|null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const controllerRef = useRef<AbortController|null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 首屏显示初始分
    setScores([startScore, startScore, startScore]);
  }, [startScore]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const prettyCards = useCallback((arr?: string[]) => {
    if (!arr || !arr.length) return '—';
    return arr.map(c => {
      const s = suitOf(c), r = rankOf(c);
      const show10 = r === 'T' ? '10' : r;
      return `${s || (r==='x'||r==='X' ? '🃏' : '')}${show10}`;
    }).join(' ');
  }, []);

  const startGame = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setLog([]);
    setRoundDelta(null);
    setMultiplier(1);
    setLandlord(null);
    setHands([[],[],[]]);
    setScores([startScore, startScore, startScore]);

    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    try {
      const res = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          delayMs,
          seatDelayMs,
          startScore,
          rob,
          four2,
          seats,
          seatModels: ['', '', ''],
          seatKeys: [{}, {}, {}],
        }),
        signal: ctrl.signal
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
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
          try {
            const msg = JSON.parse(line);

            // 任何包含 hands 的事件，立即初始化/刷新
            if (msg?.hands && Array.isArray(msg.hands)) {
              setLandlord(msg.landlord ?? null);
              setHands(msg.hands.map((h: string[]) => [...h]));
            }

            if (msg.type === 'event' && msg.kind === 'rob') {
              setLog(l => [...l, `${seatName(msg.seat)} ${msg.rob ? '抢地主' : '不抢'}`]);
            } else if (msg.type === 'event' && msg.kind === 'reveal') {
              setLog(l => [...l, `亮底：${prettyCards(msg.bottom)}`]);
              // 底牌会由后端合进地主手牌并再次下发 hands，这里无需手动合并
            } else if (msg.type === 'event' && msg.kind === 'play') {
              if (msg.move === 'pass') {
                setLog(l => [...l, `${seatName(msg.seat)} 过`]);
              } else {
                setLog(l => [...l, `${seatName(msg.seat)} 出牌：${prettyCards(msg.cards)}${msg.comboType ? `（${msg.comboType}）` : ''}`]);
                // 扣牌（保险起见本地也扣一遍）
                setHands(hs => {
                  const n = hs.map(x => [...x]);
                  if (Array.isArray(msg.cards)) removeLabels(n[msg.seat], msg.cards);
                  return n;
                });
              }
            } else if (msg.type === 'event' && msg.kind === 'trick-reset') {
              setLog(l => [...l, `— 本轮结束，重开 —`]);
            } else if (msg.type === 'event' && msg.kind === 'win') {
              setMultiplier(msg.multiplier ?? 1);
              const delta: [number,number,number] = msg.deltaScores || [0,0,0];
              setRoundDelta(delta);
              setScores(s => s.map((v, i) => v + (delta[i] || 0)));
              setLog(l => [...l, `胜者：${seatName(msg.winner)}，倍数 ×${msg.multiplier}，加减分：${delta.join(' / ')}`]);
              setRunning(false);
            }
          } catch (e) {
            console.warn('Bad line:', line, e);
          }
        }
      }
    } catch (e: any) {
      setLog(l => [...l, `后端错误：${e?.message || String(e)}`]);
    } finally {
      setRunning(false);
    }
  }, [running, enabled, delayMs, seatDelayMs, startScore, rob, four2, seats, prettyCards]);

  const stopGame = useCallback(() => {
    try { controllerRef.current?.abort(); } catch {}
    setRunning(false);
  }, []);

  // ----------- UI -----------
  const ScoreBox: React.FC<{ i: number }> = ({ i }) => (
    <div className="border rounded-lg p-4 min-w-[160px]">
      <div className="text-gray-500 mb-1">{seatName(i)}</div>
      <div className="text-3xl font-semibold">{scores[i]}</div>
    </div>
  );

  const SeatHeader: React.FC<{ i: number }> = ({ i }) => (
    <div className="flex items-center gap-2 font-bold text-lg">
      <span>{seatName(i)}</span>
      {landlord === i && <span className="text-amber-600 text-sm">(地主)</span>}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">斗地主 · Bot Arena</h1>

      {/* 对局设置 */}
      <section className="border rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-3">对局设置</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            启用对局
          </label>

        <label className="flex flex-col gap-1">
            <span>出牌最小间隔 (ms)</span>
            <input type="number" value={delayMs} min={0} step={100}
                   onChange={e => setDelayMs(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                   className="border rounded px-2 py-1" />
          </label>

          <label className="flex flex-col gap-1">
            <span>初始分</span>
            <input type="number" value={startScore} step={10}
                   onChange={e => setStartScore(Math.floor(Number(e.target.value) || 0))}
                   className="border rounded px-2 py-1" />
          </label>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rob} onChange={e => setRob(e.target.checked)} />
            可抢地主
          </label>

          <label className="flex flex-col gap-1">
            <span>4带2 规则</span>
            <select value={four2} onChange={e => setFour2(e.target.value as Four2)} className="border rounded px-2 py-1">
              <option value="both">都可</option>
              <option value="2singles">两张单</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0,1,2].map(i => (
            <div key={i} className="border rounded-lg p-3">
              <div className="font-semibold mb-2">{seatName(i)}</div>
              <label className="flex flex-col gap-1 mb-2">
                <span>选择</span>
                <select
                  value={seats[i]}
                  onChange={e => setSeats(ss => { const n=[...ss] as BotChoice[]; n[i] = e.target.value as BotChoice; return n; })}
                  className="border rounded px-2 py-1"
                >
                  {BOT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span>最小间隔 (ms)</span>
                <input type="number" min={0} step={100}
                       value={seatDelayMs[i]}
                       onChange={e => setSeatDelay(i, e.target.value)}
                       className="border rounded px-2 py-1" />
              </label>
            </div>
          ))}
        </div>
      </section>

      {/* 对局 */}
      <section className="border rounded-lg p-4 mb-6">
        {/* 积分 */}
        <div className="mb-4">
          <h3 className="font-semibold mb-2">积分（总分）</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0,1,2].map(i => <ScoreBox key={i} i={i} />)}
          </div>
        </div>

        {/* 手牌 */}
        <div className="mb-4">
          <h3 className="font-semibold mb-2">手牌</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0,1,2].map(i => (
              <div key={i} className="border rounded-lg p-3">
                <SeatHeader i={i} />
                <div className="mt-2">
                  <HandView hand={hands[i]} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 出牌 */}
        <div className="mb-4">
          <h3 className="font-semibold mb-2">出牌</h3>
          <div className="border rounded-lg p-3 min-h-[120px]">
            <div className="whitespace-pre-wrap leading-7">
              {log.filter(l => /出牌：| 过$/.test(l)).slice(-24).join('\n') || '—'}
            </div>
          </div>
        </div>

        {/* 结果与控制 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="border rounded-lg p-3">
            <div className="text-sm text-gray-500">倍数</div>
            <div className="text-3xl font-semibold">{multiplier}</div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-sm text-gray-500">本局加减分</div>
            <div className="text-xl">
              {roundDelta ? roundDelta.join(' / ') : '—'}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={startGame}
              disabled={running}
              className={`px-4 py-2 rounded ${running ? 'bg-gray-300' : 'bg-black text-white'}`}
            >开始</button>
            <button
              onClick={stopGame}
              disabled={!running}
              className={`px-4 py-2 rounded ${running ? 'bg-gray-200' : 'bg-gray-300'}`}
            >停止</button>
          </div>
        </div>
      </section>

      {/* 运行日志 */}
      <section className="border rounded-lg p-4 mb-6">
        <h3 className="font-semibold mb-2">运行日志</h3>
        <div ref={logRef} className="border rounded p-3 h-[360px] overflow-auto text-sm whitespace-pre-wrap">
          {log.join('\n') || '—'}
        </div>
      </section>
    </div>
  );
};

export default IndexPage;
