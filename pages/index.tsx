import React, { useEffect, useRef, useState } from 'react';

type Label = string;
type ComboType =
  | 'single' | 'pair' | 'triple' | 'bomb' | 'rocket'
  | 'straight' | 'pair-straight' | 'plane'
  | 'triple-with-single' | 'triple-with-pair'
  | 'four-with-two-singles' | 'four-with-two-pairs';
type Four2Policy = 'both' | '2singles' | '2pairs';

type EventObj =
  | { type:'state'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'init'; landlord:number; hands: Label[][] }   // 兼容部分后端
  | { type:'event'; kind:'play'; seat:number; move:'play'|'pass'; cards?:Label[]; comboType?:ComboType; reason?:string }
  | { type:'event'; kind:'rob'; seat:number; rob:boolean }
  | { type:'event'; kind:'trick-reset' }
  | { type:'event'; kind:'win'; winner:number; multiplier:number; deltaScores:[number,number,number] }
  | { type:'log';  message:string };

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type LiveProps = {
  rounds: number;                 // 多局数（后端连打）
  startScore: number;
  seatDelayMs?: number[];         // 每家最小间隔（ms）
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: {
    openai?: string;
    gemini?: string;
    grok?: string;
    kimi?: string;
    qwen?: string;
    httpBase?: string;
    httpToken?: string;
  }[];
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
};

function SeatTitle({ i }: { i:number }) {
  return <span style={{ fontWeight:700 }}>{['甲','乙','丙'][i]}</span>;
}

/* ---------- 花色渲染（前端显示专用） ---------- */
type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];

// 只提取点数；处理 10→T、大小写
const rankOf = (l: string) => {
  if (!l) return '';
  const c0 = l[0];
  if ('♠♥♦♣'.includes(c0)) return l.slice(1).replace(/10/i, 'T').toUpperCase();
  if (c0 === '🃏') return (l.slice(2) || 'X').replace(/10/i, 'T').toUpperCase();
  return l.replace(/10/i, 'T').toUpperCase();
};

// 返回所有可能的装饰写法（用于从后端原始标签映射到前端装饰牌）
function candDecorations(l: string): string[] {
  if (!l) return [];
  if (l.startsWith('🃏')) return [l];
  if ('♠♥♦♣'.includes(l[0])) return [l];
  const r = rankOf(l);
  if (r === 'X' || r === 'x' || r === 'JOKER') return [`🃏${r === 'X' ? 'X' : 'x'}`];
  return SUITS.map(s => `${s}${r}`);
}

// 无花色 → 轮换花色；已有花色/🃏保持不变
function decorateHandCycle(raw: string[]): string[] {
  let idx = 0;
  return raw.map(l => {
    if (!l) return l;
    if (l.startsWith('🃏')) return l;
    if ('♠♥♦♣'.includes(l[0])) return l;
    if (l === 'x' || l === 'X') return `🃏${l}`;  // 保留大小写：x=小王, X=大王
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(l)}`;
  });
}

function Card({ label }: { label:string }) {
  const suit = label.startsWith('🃏') ? '🃏' : label.charAt(0);
  const baseColor = (suit === '♥' || suit === '♦') ? '#af1d22' : (suit === '🃏' ? '#6b5' : '#1a1a1a');
  const rank = label.startsWith('🃏') ? (label.slice(2) || '') : label.slice(1);
  const rankColor = suit === '🃏' ? (rank === 'X' ? '#d11' : '#16a34a') : undefined;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6,
      border:'1px solid #ddd', borderRadius:8, padding:'6px 10px',
      marginRight:6, marginBottom:6, fontWeight:800, color: baseColor
    }}>
      <span style={{ fontSize:16 }}>{suit}</span>
      <span style={{ fontSize:16, ...(rankColor ? { color: rankColor } : {}) }}>{rank === 'T' ? '10' : rank}</span>
    </span>
  );
}

function Hand({ cards }: { cards: string[] }) {
  if (!cards || !cards.length) return <span style={{ opacity:0.6 }}>（空）</span>;
  return <div style={{ display:'flex', flexWrap:'wrap' }}>
    {cards.map((c, idx) => <Card key={`${c}-${idx}`} label={c} />)}
  </div>;
}

function PlayRow(
  { seat, move, cards, reason }:
  { seat:number; move:'play'|'pass'; cards?:string[]; reason?:string }
) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0' }}>
      <div style={{ width:32, textAlign:'right', opacity:0.8 }}>{['甲','乙','丙'][seat]}</div>
      <div style={{ width:56, fontWeight:700 }}>{move === 'pass' ? '过' : '出牌'}</div>
      <div style={{ flex:1 }}>
        {move === 'pass'
          ? <span style={{ opacity:0.6 }}>过</span>
          : <Hand cards={cards || []} />}
      </div>
      {reason && <div style={{ width:220, fontSize:12, color:'#666' }}>{reason}</div>}
    </div>
  );
}

function LogLine({ text }: { text:string }) {
  return (
    <div
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize:12, color:'#555', padding:'2px 0'
      }}
    >
      {text}
    </div>
  );
}

function Section({ title, children }:{title:string; children:React.ReactNode}) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

/* ==================== LivePanel（对局） ==================== */
function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);

  // UI：装饰后的手牌
  const [hands, setHands] = useState<string[][]>([[],[],[]]);

  // 其他状态
  const [landlord, setLandlord] = useState<number|null>(null);
  const [plays, setPlays] = useState<{seat:number; move:'play'|'pass'; cards?:string[]; reason?:string}[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState<[number,number,number]>([
  const [finishedCount, setFinishedCount] = useState(0);
    props.startScore || 0, props.startScore || 0, props.startScore || 0,
  ]);


  // 首次启动时，将总分重置为初始分；后续多局不会清零
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      const base = props.startScore || 0;
      setTotals([base, base, base]);
    }
    prevRunningRef.current = running;
  }, [running, props.startScore]);

  useEffect(() => { props.onTotals?.(totals); }, [totals]);
  useEffect(() => { props.onLog?.(log); }, [log]);

  const controllerRef = useRef<AbortController|null>(null);

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
    setFinishedCount(0);

    controllerRef.current = new AbortController();

    try {
      const r = await fetch('/api/stream_ndjson', {
        method:'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({
          rounds: props.rounds,          // 后端连续多局
          startScore: props.startScore,
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
      let buf = '';

      const pump = async (): Promise<void> => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream:true });

          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;

            let msg: EventObj | null = null;
            try { msg = JSON.parse(line) } catch { msg = null; }
            if (!msg) continue;
            const m: any = msg as any;

            // 任何含 hands 的消息都视为“初始化/刷新手牌”
            const rawHands =
              m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
            const hasHands =
              Array.isArray(rawHands) &&
              rawHands.length === 3 &&
              Array.isArray(rawHands[0]);

            if (hasHands) {
              // 每局开始：重置当局显示
              setPlays([]);
              setWinner(null);
              setDelta(null);
              setMultiplier(1);

              const handsRaw: string[][] = rawHands as string[][];
              const decorated: string[][] = handsRaw.map(decorateHandCycle);
              setHands(decorated);
              const lord =
                m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
              setLandlord(lord);
              setLog([`发牌完成，${lord!=null?['甲','乙','丙'][lord]:'?'}为地主`]);
              continue;
            }

            if (m.type === 'event' && m.kind === 'rob') {
              setLog(l => [...l, `${['甲','乙','丙'][m.seat]} ${m.rob ? '抢地主' : '不抢'}`]);
              continue;
            }

            if (m.type === 'event' && m.kind === 'play') {
              if (m.move === 'pass') {
                setPlays(p => [...p, { seat:m.seat, move:'pass', reason:m.reason }]);
                setLog(l => [...l, `${['甲','乙','丙'][m.seat]} 过${m.reason ? `（${m.reason}）` : ''}`]);
              } else {
                const pretty: string[] = [];
                setHands(h => {
                  const nh = h.map(x => [...x]);
                  const seat = m.seat as number;
                  for (const raw of (m.cards || [])) {
                    const options = candDecorations(raw);
                    const chosen = options.find((d:string) => nh[seat].includes(d)) || options[0];
                    const k = nh[seat].indexOf(chosen);
                    if (k >= 0) nh[seat].splice(k, 1);
                    pretty.push(chosen);
                  }
                  return nh;
                });
                setPlays(p => [...p, { seat:m.seat, move:'play', cards: pretty }]);
                setLog(l => [...l, `${['甲','乙','丙'][m.seat]} 出牌：${pretty.join(' ')}`]);
              }
              continue;
            }

            if (m.type === 'event' && m.kind === 'trick-reset') {
              setLog(l => [...l, '一轮结束，重新起牌']);
              setPlays([]);
              continue;
            }

            if (m.type === 'event' && m.kind === 'win') {
              setWinner(m.winner);
              setMultiplier(m.multiplier);
              setDelta(m.deltaScores);
              setLog(l => [...l, `胜者：${['甲','乙','丙'][m.winner]}，倍数 x${m.multiplier}，当局积分变更 ${m.deltaScores.join(' / ')}`]);
              setTotals(t => [ t[0] + m.deltaScores[0], t[1] + m.deltaScores[1], t[2] + m.deltaScores[2] ]);
              // 不中断，继续读下一局
              setFinishedCount(c => c + 1);
              continue;
            }

            if (m.type === 'log' && typeof m.message === 'string') {
              setLog(l => [...l, m.message]);
              continue;
            }
          }
        }
      };

      await pump();
    } catch (e:any) {
      if (e?.name === 'AbortError') {
        setLog(l => [...l, '已手动停止。']);
      } else {
        setLog(l => [...l, `错误：${e?.message || e}`]);
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };
  // 剩余局数（含当前局）：总局数 - 已完成局数
  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);


  return (
    <div>
      {/* 剩余局数徽标（不影响原布局） */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, lineHeight:1.2, userSelect:'none', background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* 第一行：积分（总分） */}
      <Section title="积分（总分）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div><SeatTitle i={i}/></div>
              <div style={{ fontSize:24, fontWeight:800 }}>{totals[i]}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="手牌">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8 }}>
              <div style={{ marginBottom:6 }}>
                <SeatTitle i={i} /> {landlord === i && <span style={{ marginLeft:6, color:'#bf7f00' }}>（地主）</span>}
              </div>
              <Hand cards={hands[i]} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="出牌">
        <div style={{ border:'1px dashed #eee', borderRadius:8, padding:'6px 8px' }}>
          {plays.length === 0
            ? <div style={{ opacity:0.6 }}>（尚无出牌）</div>
            : plays.map((p, idx) =>
                <PlayRow key={idx} seat={p.seat} move={p.move} cards={p.cards} reason={p.reason} />
              )
          }
        </div>
      </Section>

      <Section title="结果">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>倍数</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{multiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>胜者</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{winner == null ? '—' : ['甲','乙','丙'][winner]}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>本局加减分</div>
            <div style={{ fontSize:20, fontWeight:700 }}>{delta ? delta.join(' / ') : '—'}</div>
          </div>
        </div>
      </Section>

      <div style={{ display:'flex', gap:8 }}>
        <button onClick={start} disabled={running}
          style={{ padding:'8px 12px', borderRadius:8, background:'#222', color:'#fff' }}>开始</button>
        <button onClick={stop} disabled={!running}
          style={{ padding:'8px 12px', borderRadius:8 }}>停止</button>
      </div>
    </div>
  );
}

/* ==================== 页面（布局：对局设置 → 对局 → 运行日志） ==================== */
export default function Home() {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [rounds, setRounds] = useState<number>(10);
  const [startScore, setStartScore] = useState<number>(100);
  const [rob, setRob] = useState<boolean>(true);
  const [four2, setFour2] = useState<'both'|'2singles'|'2pairs'>('both');

  const [seatDelayMs, setSeatDelayMs] = useState<number[]>([1000, 1000, 1000]);
  const setSeatDelay = (i:number, v:number|string) =>
    setSeatDelayMs(arr => { const n=[...arr]; n[i] = Math.max(0, Math.floor(Number(v) || 0)); return n; });

  const [seats, setSeats] = useState<BotChoice[]>([
    'built-in:greedy-max',
    'built-in:greedy-min',
    'built-in:random-legal',
  ]);
  const [seatModels, setSeatModels] = useState<string[]>(['gpt-4o-mini', 'gemini-1.5-flash', 'grok-2-latest']);
  const [seatKeys, setSeatKeys] = useState<
    { openai?:string; gemini?:string; grok?:string; kimi?:string; qwen?:string; httpBase?:string; httpToken?:string; }[]
  >([
    { openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }
  ]);

  const [liveLog, setLiveLog] = useState<string[]>([]);

  return (
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Bot Arena</h1>

      {/* 1) 对局设置 */}
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
          <label>
            启用对局
            <div><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /></div>
          </label>

          <label>
            局数
            <input
              type="number" min={1} step={1} value={rounds}
              onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||1)))}
              style={{ width:'100%' }}
            />
          </label>

          <label>
            初始分
            <input type="number" step={10} value={startScore}
                   onChange={e=>setStartScore(Number(e.target.value)||0)}
                   style={{ width:'100%' }} />
          </label>

          <label>
            可抢地主
            <div><input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} /></div>
          </label>

          <label>
            4带2 规则
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{ width:'100%' }}>
              <option value="both">都可</option>
              <option value="2singles">两张单牌</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
        </div>

        {/* 每家 AI 设置（独立） */}
        <div style={{ marginTop:10, borderTop:'1px dashed #eee', paddingTop:10 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>每家 AI 设置（独立）</div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <div key={i} style={{ border:'1px dashed #ccc', borderRadius:8, padding:10 }}>
                <div style={{ fontWeight:700, marginBottom:8 }}><SeatTitle i={i} /></div>

                <label style={{ display:'block', marginBottom:6 }}>
                  选择
                  <select
                    value={seats[i]}
                    onChange={e=>{
                      const v = e.target.value as BotChoice;
                      setSeats(arr => { const n=[...arr]; n[i] = v; return n; });
                    }}
                    style={{ width:'100%' }}
                  >
                    <optgroup label="内置">
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                    </optgroup>
                    <optgroup label="AI">
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="http">HTTP</option>
                    </optgroup>
                  </select>
                </label>

                {seats[i].startsWith('ai:') && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    模型（可选）
                    <input type="text" value={seatModels[i]||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatModels(arr => { const n=[...arr]; n[i] = v; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {/* 各家 key/端点 */}
                {seats[i] === 'ai:openai' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    OpenAI API Key
                    <input type="password" value={seatKeys[i]?.openai||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), openai:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:gemini' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Gemini API Key
                    <input type="password" value={seatKeys[i]?.gemini||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), gemini:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:grok' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    xAI (Grok) API Key
                    <input type="password" value={seatKeys[i]?.grok||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), grok:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:kimi' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Kimi API Key
                    <input type="password" value={seatKeys[i]?.kimi||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), kimi:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:qwen' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Qwen API Key
                    <input type="password" value={seatKeys[i]?.qwen||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), qwen:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'http' && (
                  <>
                    <label style={{ display:'block', marginBottom:6 }}>
                      HTTP Base / URL
                      <input type="text" value={seatKeys[i]?.httpBase||''}
                             onChange={e=>{
                               const v = e.target.value;
                               setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpBase:v }; return n; });
                             }}
                             style={{ width:'100%' }} />
                    </label>
                    <label style={{ display:'block', marginBottom:6 }}>
                      HTTP Token（可选）
                      <input type="password" value={seatKeys[i]?.httpToken||''}
                             onChange={e=>{
                               const v = e.target.value;
                               setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpToken:v }; return n; });
                             }}
                             style={{ width:'100%' }} />
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* 每家出牌最小间隔（独立） */}
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家出牌最小间隔 (ms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{['甲','乙','丙'][i]}</div>
                  <label style={{ display:'block' }}>
                    最小间隔 (ms)
                    <input
                      type="number" min={0} step={100}
                      value={seatDelayMs[i]}
                      onChange={e=>setSeatDelay(i, e.target.value)}
                      style={{ width:'100%' }}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2) 对局（设置下面、运行日志上面） */}
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局</div>
        <LivePanel
          rounds={rounds}
          startScore={startScore}
          seatDelayMs={seatDelayMs}
          enabled={enabled}
          rob={rob}
          four2={four2}
          seats={seats}
          seatModels={seatModels}
          seatKeys={seatKeys}
          onLog={setLiveLog}
        />
      </div>

      {/* 3) 运行日志（页面底部） */}
      <div style={{ marginTop:18 }}>
        <Section title="运行日志">
          <div style={{
            border:'1px solid #eee', borderRadius:8, padding:'8px 10px',
            maxHeight:420, overflow:'auto', background:'#fafafa'
          }}>
            {liveLog.length === 0
              ? <div style={{ opacity:0.6 }}>（暂无）</div>
              : liveLog.map((t, idx) => <LogLine key={idx} text={t} />)
            }
          </div>
        </Section>
      </div>
    </div>
  );
}
