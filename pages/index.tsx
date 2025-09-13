// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react';

type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type LiveProps = {
  rounds: number;
  startScore: number;
  seatDelayMs?: number[];
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seatChoice: BotChoice[];
  seatModels: string[];
  seatKeys: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string;
    httpBase?: string; httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
};

function SeatTitle({ i }: { i:number }) {
  return <span style={{ fontWeight:700 }}>{['甲','乙','丙'][i]}</span>;
}

type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];
const seatName = (i:number)=>['甲','乙','丙'][i]

/* ====== 卡牌渲染（黑白） ====== */
function rankOf(card:string) {
  const r = card.slice(1);
  return r === 'T' ? '10' : r;
}
function suitOf(card:string): SuitSym {
  const s = card[0];
  if (s === '♠' || s === '♥' || s === '♦' || s === '♣') return s as SuitSym;
  return '🃏';
}
function Card({ card, bold=false, rankColor }: { card:string; bold?:boolean; rankColor?:string }) {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const baseColor = suit === '♥' || suit === '♦' ? '#b11' : '#111';
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6, padding:'4px 6px',
      border:'1px solid #888', borderRadius:6, background:'#fff',
      fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontWeight: bold ? 800 : 600, color: baseColor
    }}>
      <span style={{ fontSize:16 }}>{suit}</span>
      <span style={{ fontSize:16, ...(rankColor ? { color: rankColor } : {}) }}>{rank === 'T' ? '10' : rank}</span>
    </span>
  );
}
function Hand({ cards }: { cards:string[] }) {
  return <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
    {cards.map((c, i)=><Card key={i} card={c} />)}
  </div>;
}

/* ====== 工具 ====== */
function fmtDelta(d:[number,number,number]) {
  const s = (x:number)=> (x>0?`+${x}`:`${x}`);
  return `${s(d[0])} / ${s(d[1])} / ${s(d[2])}`;
}
function clamp(n:number, lo:number, hi:number) { return Math.max(lo, Math.min(hi, n)); }

/* ====== 运行日志样式封装 ====== */
function Section({ title, children }:{ title:string; children:React.ReactNode }) {
  return (
    <div style={{ border:'1px solid #444', borderRadius:12, padding:12 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

/* ====== 雷达图（累计画像） ====== */
type Score5 = { coop:number; agg:number; cons:number; eff:number; rob:number };
function mergeScore(prev: Score5, curr: Score5, mode: 'mean'|'ewma', count:number, alpha:number): Score5 {
  if (mode === 'mean') {
    const c = Math.max(0, count);
    const w = 1 / Math.max(1, c + 1);
    return {
      coop: prev.coop*(1-w) + curr.coop*w,
      agg:  prev.agg *(1-w) + curr.agg *w,
      cons: prev.cons*(1-w) + curr.cons*w,
      eff:  prev.eff *(1-w) + curr.eff *w,
      rob:  prev.rob *(1-w) + curr.rob *w,
    };
  } else {
    const a = clamp(alpha, 0, 1);
    return {
      coop: prev.coop*(1-a) + curr.coop*a,
      agg:  prev.agg *(1-a) + curr.agg *a,
      cons: prev.cons*(1-a) + curr.cons*a,
      eff:  prev.eff *(1-a) + curr.eff *a,
      rob:  prev.rob *(1-a) + curr.rob *a,
    };
  }
}
function RadarPanel({ aggStats, aggCount, aggMode, alpha, onChangeMode, onChangeAlpha }:{
  aggStats: Score5 | null; aggCount:number; aggMode:'mean'|'ewma'; alpha:number;
  onChangeMode:(m:'mean'|'ewma')=>void; onChangeAlpha:(a:number)=>void;
}) {
  const s = aggStats || { coop:0, agg:0, cons:0, eff:0, rob:0 };
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:8 }}>
        <div>配合：{s.coop.toFixed(2)}</div>
        <div>进攻：{s.agg.toFixed(2)}</div>
        <div>稳健：{s.cons.toFixed(2)}</div>
        <div>效率：{s.eff.toFixed(2)}</div>
        <div>抢地主：{s.rob.toFixed(2)}</div>
      </div>
      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        <label>累计模式：</label>
        <select value={aggMode} onChange={e=>onChangeMode((e.target.value as any))}>
          <option value="mean">均值</option>
          <option value="ewma">EWMA</option>
        </select>
        {aggMode==='ewma' && <>
          <label>α：</label>
          <input type="range" min={0} max={1} step={0.05} value={alpha}
                 onChange={e=>onChangeAlpha(Number(e.target.value))} />
          <span>{alpha.toFixed(2)}</span>
        </>}
      </div>
    </div>
  );
}

/* ==================== LivePanel（对局） ==================== */
function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);

  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [plays, setPlays] = useState<any[]>([]);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState<[number,number,number]>([
    props.startScore || 0, props.startScore || 0, props.startScore || 0,
  ]);
  const [finishedCount, setFinishedCount] = useState(0);

  // 累计画像
  const [aggMode, setAggMode] =
    useState<'mean'|'ewma'>('mean');
  const [alpha, setAlpha] = useState(0.5);
  const [aggStats, setAggStats] = useState<Score5|null>(null);
  const [aggCount, setAggCount] = useState(0);

  // 最近原因兜底
  const lastReasonRef = useRef<[string|null,string|null,string|null]>([null, null, null]);

  // 取消控制
  const controllerRef = useRef<AbortController|null>(null);

  useEffect(() => {
    props.onTotals?.(totals);
  }, [totals]);

  const normalizeModelForProvider = (choice:BotChoice, model:string) => {
    if (choice==='ai:openai')  return model || 'gpt-4o-mini';
    if (choice==='ai:gemini')  return model || '1.5-flash';
    if (choice==='ai:grok')    return model || 'grok-2-mini';
    if (choice==='ai:kimi')    return model || 'moonshot-v1-8k';
    if (choice==='ai:qwen')    return model || 'qwen2.5-7b-instruct';
    return model;
  };
  const defaultModelFor = (choice:BotChoice) => normalizeModelForProvider(choice, '');

  const normalizeLog = (msg:any, n:number) => {
    if (typeof msg !== 'string') return msg;
    let out = msg;
    out = out.replace(/开始连打\s*\d+\s*局（/g, `开始第 ${n} 局（`);
    out = out.replace(/开始连打\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
    out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局（/g, `单局模式：开始第 ${n} 局（`);
    out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局\(/g,  `单局模式：开始第 ${n} 局(`);
    out = out.replace(/第\s*\d+\s*局开始/g, `第 ${n} 局开始`);
    out = out.replace(/开始第\s*\d+\s*局（/g, `开始第 ${n} 局（`);
    out = out.replace(/开始第\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
    return out;
  };

  const start = async () => {
    if (running) return;
    if (!props.enabled) { setLog(l => [...l, '【前端】未启用对局：请在设置中勾选“启用对局”。']); return; }

    setRunning(true);
    setLandlord(null); setHands([[], [], []]); setPlays([]);
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    // 同步“初始分”到总分（修复：修改初始分后仍显示为 100 的问题）
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null); setAggCount(0);

    controllerRef.current = new AbortController();

    const buildSeatSpecs = (): any[] => {
      return props.seatChoice.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai': return { kind:'openai', model, keys };
          case 'ai:gemini': return { kind:'gemini', model, keys };
          case 'ai:grok':   return { kind:'grok', model, keys };
          case 'ai:kimi':   return { kind:'kimi', model, keys };
          case 'ai:qwen':   return { kind:'qwen', model, keys };
          case 'http':      return { kind:'http', model, keys };
          default:          return { kind:'builtin', name: choice.replace('built-in:','') };
        }
      });
    };

    const traceId = Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36);

    const rounds = Math.max(1, Math.floor(props.rounds || 1));
    for (let r = 1; r <= rounds; r++) {
      const body = {
        rounds: 1,
        rob: !!props.rob,
        four2: props.four2,
        farmerCoop: !!props.farmerCoop,
        seats: buildSeatSpecs(),
        seatDelayMs: (props.seatDelayMs || [0,0,0]).slice(0,3),
        traceId,
      };
      try {
        const r = await fetch('/api/stream_ndjson', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controllerRef.current?.signal,
          body: JSON.stringify(body),
        });
        if (!r.ok || !r.body) {
          setLog(l=>[...l, `【前端】请求失败：${r.status} ${r.statusText}`]);
          break;
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();

        let buf = '';
        let n = 0;
        const parseLines = (raw:string): string[] => raw.split(/\r?\n/).filter(Boolean);

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream:true });
          const lines = parseLines(buf);
          if (!buf.endsWith('\n')) {
            buf = lines.pop() || '';
          } else {
            buf = '';
          }
          if (lines.length) {
            const batch = lines.map(x=> {
              try { return JSON.parse(x); } catch { return { type:'log', message:x }; }
            });

            // 处理批量事件
            // 1) 初始化
            const initEv = batch.find(e=>e.type==='init');
            if (initEv) {
              setLandlord(initEv.landlord ?? null);
              setHands([initEv.hands[0]||[], initEv.hands[1]||[], initEv.hands[2]||[]]);
            }

            // 2) 出牌与日志
            const playEvs = batch.filter(e=>e.type==='play');
            if (playEvs.length) {
              setPlays(prev=>[...prev, ...playEvs.map((e:any)=>({ seat:e.seat, move:e.move, cards:e.cards || [], reason:e.reason || lastReasonRef.current[e.seat] || '' }))]);
              // 兜底记住最近 reason
              playEvs.forEach((e:any)=> { if (e.reason) { lastReasonRef.current[e.seat] = e.reason; } });
            }

            // 3) 倍数
            const multEv = batch.find(e=>e.type==='mult');
            if (multEv) setMultiplier(multEv.value || 1);

            // 4) 结束
            const endEv = batch.find(e=>e.type==='end');
            if (endEv) {
              setWinner(endEv.winner);
              const d:[number,number,number] = endEv.delta || [0,0,0];
              setDelta(d);
              setTotals(t => [ t[0] + d[0], t[1] + d[1], t[2] + d[2] ]);
              setFinishedCount(c=>c+1);

              // 累计画像（示例：从服务器带回或本地估算，本实现为兜底示例）
              if (endEv.stats && typeof endEv.stats==='object') {
                const s = endEv.stats as Score5;
                setAggStats(prev => prev ? mergeScore(prev, s, aggMode, aggCount, alpha) : s);
                setAggCount(c => c+1);
              }
            }

            // 5) 文本日志
            const logs = batch.filter(e=>e.type==='log').map((e:any)=>normalizeLog(e.message, finishedCount+1));
            if (logs.length) setLog(prev => [...prev, ...logs]);
          }
        }
      } catch (e:any) {
        setLog(l=>[...l, `【前端】网络/中断：${String(e?.message || e)}`]);
        break;
      }
    }

    setRunning(false);
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  const [multiplier, setMultiplier] = useState(1);

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:12 }}>
      <div>
        <Section title="对局">
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', rowGap:8, columnGap:12 }}>
            <div style={{ fontWeight:700 }}>地主：</div>
            <div>{landlord===null ? '—' : <SeatTitle i={landlord} />}</div>

            <div style={{ alignSelf:'start', fontWeight:700 }}>手牌：</div>
            <div style={{ display:'grid', gap:8 }}>
              {[0,1,2].map(i=><div key={i}><SeatTitle i={i}/>：<Hand cards={hands[i]||[]} /></div>)}
            </div>

            <div style={{ fontWeight:700 }}>当前倍数：</div>
            <div>{multiplier}×</div>

            <div style={{ alignSelf:'start', fontWeight:700 }}>出牌与理由：</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {plays.map((p, idx)=>(
                <div key={idx} style={{ display:'grid', gridTemplateColumns:'52px 1fr', gap:8 }}>
                  <div><SeatTitle i={p.seat} /></div>
                  <div>
                    <div>动作：{p.move === 'pass' ? '过' : '出牌'}</div>
                    {p.move !== 'pass' && <div style={{ margin:'4px 0' }}>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {(p.cards || []).map((c:string, i:number)=><Card key={i} card={c} />)}
                      </div>
                    </div>}
                    <div style={{ color:'#555' }}>理由：{p.reason || '—'}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ fontWeight:700 }}>本局结果：</div>
            <div>
              {winner===null ? '—' : <>
                <span style={{ marginRight:12 }}>胜者：<SeatTitle i={winner} /></span>
                <span>Δ：{delta ? fmtDelta(delta) : '—'}</span>
              </>}
            </div>

            <div style={{ fontWeight:700 }}>累计总分：</div>
            <div>
              <span>甲 {totals[0]}</span>
              <span style={{ margin:'0 10px' }}>|</span>
              <span>乙 {totals[1]}</span>
              <span style={{ margin:'0 10px' }}>|</span>
              <span>丙 {totals[2]}</span>
            </div>

            <div style={{ fontWeight:700 }}>已完成局数：</div>
            <div>{finishedCount}</div>
          </div>

          {/* 出牌流水 */}
          <div style={{ marginTop:14 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>出牌记录：</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:260, overflow:'auto', paddingRight:6 }}>
              {plays.map((p, idx)=>(
                <div key={idx} style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <SeatTitle i={p.seat} />
                  <span>→</span>
                  {p.move==='pass'
                    ? <span style={{ color:'#777' }}>过</span>
                    : <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {(p.cards || []).map((c:string, i:number)=><Card key={i} card={c} />)}
                      </div>}
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* 累计雷达图（仅显示累计） */}
        <Section title="战术画像（累计，0~5）">
          <RadarPanel aggStats={aggStats} aggCount={aggCount} aggMode={aggMode} alpha={alpha}
            onChangeMode={setAggMode} onChangeAlpha={setAlpha}/>
        </Section>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={start} style={{ padding:'8px 12px', borderRadius:8, background:'#222', color:'#fff' }}>开始</button>
          <button onClick={stop} style={{ padding:'8px 12px', borderRadius:8 }}>停止</button>
        </div>
      </div>

      <div>
        <Section title="运行日志">
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
            <div>（最近 200 条）</div>
            <button onClick={()=>setLog([])} style={{ padding:'2px 8px', borderRadius:6 }}>清空</button>
          </div>
          <div style={{ maxHeight:520, overflow:'auto', fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
            {log.slice(-200).map((l, i)=><div key={i} style={{ whiteSpace:'pre-wrap' }}>{l}</div>)}
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ==================== 页面（布局：对局设置 → 对局 → 运行日志） ==================== */
export default function Home() {
  const [rounds, setRounds] = useState(1);
  const [startScore, setStartScore] = useState(100);
  const [enabled, setEnabled] = useState(true);
  const [rob, setRob] = useState(true);
  const [four2, setFour2] = useState<Four2Policy>('both');
  const [farmerCoop, setFarmerCoop] = useState(true);

  const [seatChoice, setSeatChoice] = useState<BotChoice[]>(['built-in:greedy-max','built-in:greedy-min','built-in:random-legal']);
  const [seatModels, setSeatModels] = useState<string[]>(['','','']);
  const [seatKeys, setSeatKeys] = useState<any[]>([{},{},{}]);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>([0,0,0]);

  const [totals, setTotals] = useState<[number,number,number]>([startScore, startScore, startScore]);
  const [log, setLog] = useState<string[]>([]);

  // 汇总回调
  const handleTotals = (t:[number,number,number]) => setTotals(t);
  const handleLog = (lines:string[]) => setLog(lines);

  return (
    <div style={{ padding:16, display:'grid', gridTemplateColumns:'1fr 1.2fr', gap:16 }}>
      <div>
        <Section title="对局设置">
          <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', rowGap:10, columnGap:12 }}>
            <label>启用对局：</label>
            <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />

            <label>局数：</label>
            <input type="number" value={rounds} onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||1)))} />

            <label>初始分：</label>
            <input type="number" value={startScore} onChange={e=>setStartScore(Math.floor(Number(e.target.value)||0))} />

            <label>叫/抢地主：</label>
            <input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} />

            <label>两张 2：</label>
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)}>
              <option value="both">可作对子也可作两张单牌</option>
              <option value="2pairs">只作对子</option>
              <option value="2singles">只作两张单牌</option>
            </select>

            <label>农民配合（测试项）：</label>
            <input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} />

            <div style={{ gridColumn:'1/3', marginTop:8, fontWeight:700 }}>每位座位（甲/乙/丙）策略：</div>

            {[0,1,2].map(i=>(
              <React.Fragment key={i}>
                <label>玩家 {['甲','乙','丙'][i]}：</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8 }}>
                  <select value={seatChoice[i]} onChange={e => setSeatChoice(prev => {
                    const next = [...prev] as BotChoice[]; next[i] = e.target.value as BotChoice; return next;
                  })}>
                    <option value="built-in:greedy-max">内置：GreedyMax</option>
                    <option value="built-in:greedy-min">内置：GreedyMin</option>
                    <option value="built-in:random-legal">内置：RandomLegal</option>
                    <option value="ai:openai">OpenAI</option>
                    <option value="ai:gemini">Gemini</option>
                    <option value="ai:grok">Grok</option>
                    <option value="ai:kimi">Kimi</option>
                    <option value="ai:qwen">Qwen</option>
                    <option value="http">HTTP</option>
                  </select>

                  <input placeholder="模型（可留空）" value={seatModels[i]||''}
                         onChange={e=>setSeatModels(prev=>{ const n=[...prev]; n[i]=e.target.value; return n; })} />
                  <input placeholder="Key / HTTP Base" value={(seatKeys[i]?.openai || seatKeys[i]?.httpBase || '')}
                         onChange={e=>setSeatKeys(prev=>{ const n=[...prev]; n[i] = { ...(n[i]||{}), openai:e.target.value, httpBase:e.target.value }; return n; })} />
                  <input placeholder="HTTP Token（可空）" value={(seatKeys[i]?.httpToken || '')}
                         onChange={e=>setSeatKeys(prev=>{ const n=[...prev]; n[i] = { ...(n[i]||{}), httpToken:e.target.value }; return n; })} />
                </div>
              </React.Fragment>
            ))}

            <label>决策延时（ms）：</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
              {[0,1,2].map(i=><input key={i} type="number" value={seatDelayMs[i]}
                                     onChange={e=>setSeatDelayMs(prev=>{ const n=[...prev]; n[i]=Math.max(0, Math.floor(Number(e.target.value)||0)); return n; })} />)}
            </div>
          </div>
        </Section>
      </div>

      <div>
        <LivePanel
          rounds={rounds}
          startScore={startScore}
          enabled={enabled}
          rob={rob}
          four2={four2}
          farmerCoop={farmerCoop}
          seatChoice={seatChoice}
          seatModels={seatModels}
          seatKeys={seatKeys}
          seatDelayMs={seatDelayMs}
          onTotals={handleTotals}
          onLog={handleLog}
        />

        <div style={{ marginTop:18 }}>
          <Section title="运行日志（页面聚合）">
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
              <div>（最近 200 条）</div>
              <button onClick={()=>setLog([])} style={{ padding:'2px 8px', borderRadius:6 }}>清空</button>
            </div>
            <div style={{ maxHeight:280, overflow:'auto', fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
              {log.slice(-200).map((l, i)=><div key={i} style={{ whiteSpace:'pre-wrap' }}>{l}</div>)}
            </div>
          </Section>
        </div>

        <div style={{ marginTop:12 }}>
          <Section title="累积分（页面聚合）">
            <div>初始分：{startScore}</div>
            <div style={{ marginTop:6 }}>
              <span>甲 {totals[0]}</span>
              <span style={{ margin:'0 10px' }}>|</span>
              <span>乙 {totals[1]}</span>
              <span style={{ margin:'0 10px' }}>|</span>
              <span>丙 {totals[2]}</span>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
