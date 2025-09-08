import React, { useEffect, useRef, useState } from 'react';

/* ==================== 轻量工具：牌面装饰 ==================== */
const SUITS = ['♠','♥','♦','♣'] as const;  // 展示花色循环
function rankOf(label: string){
  const L = label.trim();
  if (L==='X') return 'JOKER'; if (L==='x') return 'joker';
  const r = L.replace(/^[SHDC♠♥♦♣]/, '');
  return r.toUpperCase();
}
function decorateHandCycle(hand: string[]): string[] {
  let idx = 0;
  return hand.map(l => {
    if (l==='x' || l==='X') return `${l}`;  // 保留大小写：x=小王, X=大王
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(l)}`;
  });
}
function candDecorations(label: string): string[] {
  if (label==='x' || label==='X') return [label];
  const r = rankOf(label);
  return SUITS.map(s => `${s}${r}`);
}

/* ==================== 类型声明（最小必要） ==================== */
export type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen';

type Seats = [BotChoice, BotChoice, BotChoice];

/* ==================== 主组件：LivePanel ==================== */
interface LivePanelProps {
  rounds: number;       // 连打局数
  seatDelayMs: number;  // 出牌间隔（ms）
  enabled: boolean;     // 开关
  rob: 'classic' | 'all-rob' | 'none';
  four2: 'ban' | 'allow' | 'both';
  seats: Seats;
  seatModels?: Partial<Record<'E'|'S'|'W', string>>;
  seatKeys?: Partial<Record<'E'|'S'|'W', string>>;
  startScore?: number;
  onTotals?: (t:[number,number,number])=>void;
  onLog?: (lines:string[])=>void;
}

export function LivePanel(props: LivePanelProps) {
  const [running, setRunning] = useState(false);
  const [hands, setHands] = useState<string[][]>([[],[],[]]);  // 3 家手牌显示
  const [plays, setPlays] = useState<string[]>([]);            // 当前台面
  const [totals, setTotals] = useState<[number,number,number]>([0,0,0]);
  const [finishedCount, setFinishedCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number]|null>(null);
  const [multiplier, setMultiplier] = useState<number>(1);

  // 运行状态变化时初始积分
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (!prevRunningRef.current && running) {
      const base = props.startScore || 0;
      setTotals([base, base, base]);
    }
    prevRunningRef.current = running;
  }, [running, props.startScore]);

  useEffect(() => { props.onTotals?.(totals); }, [totals]);
  useEffect(() => { props.onLog?.(log); }, [log]);

  const controllerRef = useRef<AbortController|null>(null);
  // --- Batch ingest state mirrors (for robust chunk processing) ---
  const handsRef = useRef(hands); useEffect(() => { handsRef.current = hands; }, [hands]);
  const playsRef = useRef(plays); useEffect(() => { playsRef.current = plays; }, [plays]);
  const totalsRef = useRef(totals); useEffect(() => { totalsRef.current = totals; }, [totals]);
  const finishedRef = useRef(finishedCount); useEffect(() => { finishedRef.current = finishedCount; }, [finishedCount]);
  const logRef = useRef(log); useEffect(() => { logRef.current = log; }, [log]);
  const landlordRef = useRef(landlord); useEffect(() => { landlordRef.current = landlord; }, [landlord]);
  const winnerRef = useRef(winner); useEffect(() => { winnerRef.current = winner; }, [winner]);
  const deltaRef = useRef(delta); useEffect(() => { deltaRef.current = delta; }, [delta]);
  const multiplierRef = useRef(multiplier); useEffect(() => { multiplierRef.current = multiplier; }, [multiplier]);

  const start = async () => {
    if (running) return;
    setRunning(true);
    setLandlord(null);
    setHands([[],[],[]]);
    setPlays([]);
    setWinner(null);
    setDelta(null);
    setMultiplier(1);
    setLog([]);
    setFinishedCount(0);

    controllerRef.current = new AbortController();

    try {
      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rounds: props.rounds,
          seatDelayMs: props.seatDelayMs,
          enabled: props.enabled,
          rob: props.rob,
          four2: props.four2,
          seats: props.seats,
          seatModels: props.seatModels,
          seatKeys: props.seatKeys,
        }),
        signal: controllerRef.current.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let watchdogLastTs = Date.now();
      let watchdogCount = 0;
      let buf = '';

      const pump = async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (!value) { if (Date.now()-watchdogLastTs>8000) { setLog((prev)=>[...prev, '（watchdog）已 8s 未收到事件…']); watchdogLastTs = Date.now(); } }
          if (done) break;
          buf += decoder.decode(value, { stream:true });

          let idx: number;
          const batch: any[] = [];
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            try { batch.push(JSON.parse(line)); } catch {}
          }

          if (batch.length) {
            // Take snapshots
            let nextHands = handsRef.current.map(x => [...x]);
            let nextPlays = [...playsRef.current];
            let nextTotals = [...totalsRef.current] as [number,number,number];
            let nextFinished = finishedRef.current;
            let nextLog = [...logRef.current];
            let nextLandlord = landlordRef.current;
            let nextWinner = winnerRef.current as number|null;
            let nextDelta = deltaRef.current as [number,number,number]|null;
            let nextMultiplier = multiplierRef.current;

            for (const raw of batch) {
              if ((raw as any)?.type === 'ka') continue; // ① 旁路心跳，避免与同秒关键信号互相覆盖
              const m: any = raw;
              try {
                const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);

                if (hasHands) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  nextMultiplier = 1;
                  const handsRaw: string[][] = rh as string[][];
                  const decorated: string[][] = handsRaw.map(decorateHandCycle);
                  nextHands = decorated;
                  const lord = m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
                  nextLandlord = lord;
                  nextLog = [...nextLog, `发牌完成，${lord!=null?['甲','乙','丙'][lord]:'?'}为地主`];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'rob') {
                  nextLog = [...nextLog, `${['甲','乙','丙'][m.seat]} ${m.rob ? '抢地主' : '不抢'}`];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'trick-reset') {
                  nextLog = [...nextLog, '一轮结束，重新起牌'];
                  nextPlays = [];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'play') {
                  if (m.move === 'pass') {
                    nextPlays = [...nextPlays, `${['甲','乙','丙'][m.seat]}: PASS`];
                    nextLog = [...nextLog, `${['甲','乙','丙'][m.seat]} 过${m.reason ? `（${m.reason}）` : ''}`];
                  } else {
                    const pretty: string[] = [];
                    const seat = m.seat as number;
                    const cards: string[] = m.cards || [];
                    const nh = (nextHands && (nextHands as any[]).length===3 ? nextHands : [[],[],[]]).map((x:any)=>[...x]);
                    for (const rawCard of cards) {
                      const options = candDecorations(rawCard);
                      const chosen = options.find((d:string) => nh[seat].includes(d)) || options[0];
                      const k = nh[seat].indexOf(chosen);
                      if (k >= 0) nh[seat].splice(k, 1);
                      pretty.push(chosen);
                    }
                    nextHands = nh;
                    nextPlays = [...nextPlays, `${['甲','乙','丙'][seat]}: ${pretty.join(' ')}`];
                    nextLog = [...nextLog, `${['甲','乙','丙'][m.seat]} 出牌：${pretty.join(' ')}`];
                  }
                  continue;
                }

                if (m.type === 'event' && m.kind === 'win') {
                  nextWinner = m.winner;
                  nextMultiplier = m.multiplier;
                  nextDelta = m.deltaScores;
                  nextLog = [...nextLog, `胜者：${['甲','乙','丙'][m.winner]}，倍数 x${m.multiplier}，当局积分变更 ${m.deltaScores.join(' / ')}`];
                  nextTotals = [ nextTotals[0] + m.deltaScores[0], nextTotals[1] + m.deltaScores[1], nextTotals[2] + m.deltaScores[2] ] as any;
                  nextFinished = nextFinished + 1; // ② 仅用本批统计，避免与 ref 竞态
                  continue;
                }

                if (m.type === 'log' && typeof m.message === 'string') {
                  nextLog = [...nextLog, m.message];
                  continue;
                }

              } catch (e) {
                console.error('[ingest:batch]', e, raw);
              }
            }

            // Commit once per chunk
            setHands(nextHands);
            setPlays(nextPlays);
            setTotals(nextTotals);
            setFinishedCount(nextFinished); // ③ 以本批结果为准
            setLog(nextLog);
            setLandlord(nextLandlord);
            setWinner(nextWinner);
            setMultiplier(nextMultiplier);
            setDelta(nextDelta);
            watchdogLastTs = Date.now(); watchdogCount = 0; // watchdog 刷新
          }

        }
      };

      await pump();
    } catch (e:any) {
      if (e?.name === 'AbortError') {
        // 正常停止
      } else {
        console.error(e);
        setLog(prev => [...prev, `异常：${String(e?.message||e)}`]);
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };
  // 剩余局数（包含当前局）：总局数 - 已完成局数
  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);


  return (
    <div>
      {/* 剩余局数徽标（最小改动） */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', borderRadius:999, border:'1px solid #999', fontSize:12, lineHeight:1.2, userSelect:'none', background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* 第一行：积分 */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:8 }}>
        {(['甲','乙','丙'] as const).map((name, i) => (
          <div key={i} style={{ padding:10, border:'1px solid #ddd', borderRadius:8, background:'#fafafa' }}>
            <div style={{ fontSize:14, marginBottom:4 }}>{name}</div>
            <div style={{ fontSize:22, fontWeight:700 }}>{totals[i]}</div>
            {winner===i && delta && (
              <div style={{ marginTop:4, fontSize:12 }}>+{delta[i]}（x{multiplier}）</div>
            )}
          </div>
        ))}
      </div>

      {/* 第二行：地主与手牌（只展示数量或简单牌面） */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:8 }}>
        {hands.map((h, i) => (
          <div key={i} style={{ padding:10, border:'1px solid #ddd', borderRadius:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:14 }}>{['甲','乙','丙'][i]}{landlord===i ? '（地主）' : ''}</span>
              <span style={{ fontSize:12, color:'#666' }}>{h.length} 张</span>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {h.map((c, k) => (
                <span key={k} style={{ border:'1px solid #ccc', borderRadius:6, padding:'2px 6px', fontSize:12, background:'#fff' }}>{c}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 第三行：当前台面 */}
      <div style={{ padding:10, border:'1px dashed #ccc', borderRadius:8, minHeight:46, marginBottom:8 }}>
        {plays.length===0 ? <span style={{ color:'#888' }}>（无出牌）</span> : (
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {plays.map((line, i) => (
              <span key={i} style={{ fontFamily:'monospace' }}>{line}</span>
            ))}
          </div>
        )}
      </div>

      {/* 运行与日志 */}
      <div style={{ display:'flex', gap:8 }}>
        {!running ? (
          <button onClick={start} style={{ padding:'8px 12px' }}>开始</button>
        ) : (
          <button onClick={stop} style={{ padding:'8px 12px' }}>停止</button>
        )}
      </div>

      <div style={{ marginTop:12, padding:10, border:'1px solid #eee', borderRadius:8, background:'#fff', maxHeight:240, overflow:'auto' }}>
        {log.map((line, i) => (
          <div key={i} style={{ fontSize:12, lineHeight:1.5, whiteSpace:'pre-wrap' }}>{line}</div>
        ))}
      </div>
    </div>
  );
}

/* ==================== 页面（布局：对局设置 → 对局 → 运行日志） ==================== */
export default function Home() {
  const [rounds, setRounds] = useState(10);
  const [seatDelayMs, setSeatDelayMs] = useState(1000);
  const [enabled, setEnabled] = useState(true);
  const [rob, setRob] = useState<'classic'|'all-rob'|'none'>('classic');
  const [four2, setFour2] = useState<'ban'|'allow'|'both'>('both');
  const [seats, setSeats] = useState<Seats>(['built-in:greedy-max','built-in:greedy-min','built-in:random-legal']);

  const [seatModels] = useState<{[k in 'E'|'S'|'W']?: string}>({});
  const [seatKeys] = useState<{[k in 'E'|'S'|'W']?: string}>({});

  const [totals, setTotals] = useState<[number,number,number]>([0,0,0]);
  const [lines, setLines] = useState<string[]>([]);

  return (
    <div style={{ padding:16 }}>
      {/* 对局设置 */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(220px, 1fr))', gap:12 }}>
        <div>
          <label style={{ display:'block', fontSize:12, color:'#666' }}>连打局数</label>
          <input type="number" value={rounds} onChange={e=>setRounds(Number(e.target.value)||1)} />
        </div>
        <div>
          <label style={{ display:'block', fontSize:12, color:'#666' }}>出牌间隔 (ms)</label>
          <input type="number" value={seatDelayMs} onChange={e=>setSeatDelayMs(Number(e.target.value)||0)} />
        </div>
        <div>
          <label style={{ display:'block', fontSize:12, color:'#666' }}>功能开关</label>
          <select value={enabled? 'on':'off'} onChange={e=>setEnabled(e.target.value==='on')}>
            <option value="on">开启</option>
            <option value="off">关闭</option>
          </select>
        </div>
        <div>
          <label style={{ display:'block', fontSize:12, color:'#666' }}>抢地主规则</label>
          <select value={rob} onChange={e=>setRob(e.target.value as any)}>
            <option value="classic">经典</option>
            <option value="all-rob">全员可抢</option>
            <option value="none">不抢</option>
          </select>
        </div>
        <div>
          <label style={{ display:'block', fontSize:12, color:'#666' }}>四个“2”</label>
          <select value={four2} onChange={e=>setFour2(e.target.value as any)}>
            <option value="ban">禁用</option>
            <option value="allow">允许</option>
            <option value="both">二者兼测</option>
          </select>
        </div>
        <div>
          <label style={{ display:'block', fontSize:12, color:'#666' }}>对手选择</label>
          <div style={{ display:'flex', gap:6 }}>
            <select value={seats[0]} onChange={e=>setSeats([e.target.value as any, seats[1], seats[2]])}>
              <option value="built-in:greedy-max">GreedyMax</option>
              <option value="built-in:greedy-min">GreedyMin</option>
              <option value="built-in:random-legal">Random</option>
              <option value="ai:openai">AI: OpenAI</option>
              <option value="ai:gemini">AI: Gemini</option>
              <option value="ai:grok">AI: Grok</option>
              <option value="ai:kimi">AI: Kimi</option>
              <option value="ai:qwen">AI: Qwen</option>
            </select>
            <select value={seats[1]} onChange={e=>setSeats([seats[0], e.target.value as any, seats[2]])}>
              <option value="built-in:greedy-max">GreedyMax</option>
              <option value="built-in:greedy-min">GreedyMin</option>
              <option value="built-in:random-legal">Random</option>
              <option value="ai:openai">AI: OpenAI</option>
              <option value="ai:gemini">AI: Gemini</option>
              <option value="ai:grok">AI: Grok</option>
              <option value="ai:kimi">AI: Kimi</option>
              <option value="ai:qwen">AI: Qwen</option>
            </select>
            <select value={seats[2]} onChange={e=>setSeats([seats[0], seats[1], e.target.value as any])}>
              <option value="built-in:greedy-max">GreedyMax</option>
              <option value="built-in:greedy-min">GreedyMin</option>
              <option value="built-in:random-legal">Random</option>
              <option value="ai:openai">AI: OpenAI</option>
              <option value="ai:gemini">AI: Gemini</option>
              <option value="ai:grok">AI: Grok</option>
              <option value="ai:kimi">AI: Kimi</option>
              <option value="ai:qwen">AI: Qwen</option>
            </select>
          </div>
        </div>
      </div>

      {/* 对局 */}
      <div style={{ marginTop:16 }}>
        <LivePanel
          rounds={rounds}
          seatDelayMs={seatDelayMs}
          enabled={enabled}
          rob={rob}
          four2={four2}
          seats={seats}
          seatModels={{}}
          seatKeys={{}}
          startScore={0}
          onTotals={(t)=>setTotals(t)}
          onLog={(l)=>setLines(l)}
        />
      </div>

      {/* 运行日志（透传） */}
      <div style={{ marginTop:16 }}>
        <h3 style={{ margin:'8px 0' }}>运行日志</h3>
        <div style={{ padding:10, border:'1px solid #eee', borderRadius:8, background:'#fff', maxHeight:260, overflow:'auto' }}>
          {lines.map((line, i) => <div key={i} style={{ fontSize:12 }}>{line}</div>)}
        </div>
      </div>
    </div>
  );
}
