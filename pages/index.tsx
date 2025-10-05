// pages/index.tsx
import { useEffect, useRef, useState } from 'react';

type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:mininet'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

/* ========= TrueSkill（前端轻量实现，1v2：地主 vs 两农民） ========= */
type Rating = { mu:number; sigma:number };
const TS_DEFAULT: Rating = { mu:25, sigma:25/3 };
const TS_BETA = 25/6;
const TS_TAU  = 25/300;
const SQRT2 = Math.sqrt(2);
function erf(x:number){ const s=Math.sign(x); const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const t=1/(1+p*Math.abs(x)); const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x); return s*y; }
function phi(x:number){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function Phi(x:number){ return 0.5*(1+erf(x/SQRT2)); }
function V_exceeds(t:number){ const d=Math.max(1e-12,Phi(t)); return phi(t)/d; }
function W_exceeds(t:number){ const v=V_exceeds(t); return v*(v+t); }
function tsUpdateTwoTeams(r:Rating[], teamA:number[], teamB:number[]){
  const varA = teamA.reduce((s,i)=>s+r[i].sigma**2,0), varB = teamB.reduce((s,i)=>s+r[i].sigma**2,0);
  const muA  = teamA.reduce((s,i)=>s+r[i].mu,0),     muB  = teamB.reduce((s,i)=>s+r[i].mu,0);
  const c2   = varA + varB + 2*TS_BETA*TS_BETA;
  const c    = Math.sqrt(c2);
  const t    = (muA - muB) / c;
  const v = V_exceeds(t), w = W_exceeds(t);
  for (const i of teamA) {
    const sig2=r[i].sigma**2, mult=sig2/c, mult2=sig2/c2;
    r[i].mu += mult*v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU);
  }
  for (const i of teamB) {
    const sig2=r[i].sigma**2, mult=sig2/c, mult2=sig2/c2;
    r[i].mu -= mult*v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU);
  }
}

/* ===== TrueSkill 本地存档（新增） ===== */
type TsRole = 'landlord'|'farmer';
type TsStoreEntry = {
  id: string;                 // 身份（详见 seatIdentity）
  label?: string;
  overall?: Rating | null;    // 总体
  roles?: {                   // 角色分档
    landlord?: Rating | null;
    farmer?: Rating | null;
  };
  meta?: { choice?: string; model?: string; httpBase?: string };
};
type TsStore = {
  schema: 'ddz-trueskill@1';
  updatedAt: string;
  players: Record<string, TsStoreEntry>;
};
const TS_STORE_KEY = 'ddz_ts_store_v1';

const ensureRating = (x:any): Rating => {
  const mu = Number(x?.mu), sigma = Number(x?.sigma);
  if (Number.isFinite(mu) && Number.isFinite(sigma)) return { mu, sigma };
  return { ...TS_DEFAULT };
};
const emptyStore = (): TsStore => ({ schema:'ddz-trueskill@1', updatedAt:new Date().toISOString(), players:{} });
const readStore = (): TsStore => {
  try { const raw = localStorage.getItem(TS_STORE_KEY); if (!raw) return emptyStore();
    const j = JSON.parse(raw); if (j?.schema && j?.players) return j as TsStore;
  } catch {}
  return emptyStore();
};
const writeStore = (s: TsStore) => { try { s.updatedAt=new Date().toISOString(); localStorage.setItem(TS_STORE_KEY, JSON.stringify(s)); } catch {} };

/* ====== 其它 UI/逻辑 ====== */
type LiveProps = {
  rounds: number;
  startScore: number;
  
  seatDelayMs?: number[];
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string;
    httpBase?: string; httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
  turnTimeoutSecs?: number[];};

function SeatTitle({ i }: { i:number }) {
  return <span style={{ fontWeight:700 }}>{['甲','乙','丙'][i]}</span>;
}

type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];
const seatName = (i:number)=>['甲','乙','丙'][i] || String(i);

const rankOf = (l: string) => {
  if (!l) return '';
  const c0 = l[0];
  if ('♠♥♦♣'.includes(c0)) return l.slice(1).replace(/10/i, 'T').toUpperCase();
  if (c0 === '🃏') return (l.slice(2) || 'X').replace(/10/i, 'T').toUpperCase();
  return l.replace(/10/i, 'T').toUpperCase();
};
function candDecorations(l: string): string[] {
  if (!l) return [];
  if (l === 'x') return ['🃏X'];
  if (l === 'X') return ['🃏Y'];
  if (l.startsWith('🃏')) return [l];
  if ('♠♥♦♣'.includes(l[0])) return [l];
  const r = rankOf(l);
  if (r === 'JOKER') return ['🃏Y'];
  return SUITS.map(s => `${s}${r}`);
}
function decorateHandCycle(raw: string[]): string[] {
  let idx = 0;
  return raw.map(l => {
    if (!l) return l;
    if (l === 'x') return '🃏X';
    if (l === 'X') return '🃏Y';
    if (l.startsWith('🃏')) return l;
    if ('♠♥♦♣'.includes(l[0])) return l;
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(l)}`;
  });
}

function Card({ label }: { label:string }) {
  const suit = label.startsWith('🃏') ? '🃏' : label.charAt(0);
  const baseColor = (suit === '♥' || suit === '♦') ? '#af1d22' : '#1a1a1a';
  const rank = label.startsWith('🃏') ? (label.slice(2) || '') : label.slice(1);
  const rankColor = suit === '🃏' ? (rank === 'Y' ? '#d11' : '#16a34a') : undefined;
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
  if (!cards || cards.length === 0) return <span style={{ opacity: 0.6 }}>（空）</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {cards.map((c, idx) => <Card key={`${c}-${idx}`} label={c} />)}
    </div>
  );
}
function PlayRow({ seat, move, cards, reason }:{
  seat:number; move:'play'|'pass'; cards?:string[]; reason?:string
}) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0' }}>
      <div style={{ width:32, textAlign:'right', opacity:0.8 }}>{seatName(seat)}</div>
      <div style={{ width:56, fontWeight:700 }}>{move === 'pass' ? '过' : '出牌'}</div>
      <div style={{ flex:1 }}>
        {move === 'pass' ? <span style={{ opacity:0.6 }}>过</span> : <Hand cards={cards || []} />}
      </div>
      {reason && <div style={{ width:260, fontSize:12, color:'#666' }}>{reason}</div>}
    </div>
  );
}
function LogLine({ text }: { text:string }) {
  return (
    <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', fontSize:12, color:'#555', padding:'2px 0' }}>
      {text}
    </div>
  );
}

/* ===== 天梯图组件（x=ΔR_event，y=各 AI/内置；含未参赛=历史或0） ===== */
function LadderPanel() {
  const [tick, setTick] = useState(0);
  useEffect(()=>{
    const onAny = () => setTick(k=>k+1);
    if (typeof window !== 'undefined') {
      window.addEventListener('ddz-all-refresh', onAny as any);
    }
    const t = setInterval(onAny, 2000);
    return ()=> { if (typeof window!=='undefined') window.removeEventListener('ddz-all-refresh', onAny as any); clearInterval(t); };
  }, []);

  let store:any = { players:{} };
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('ddz_ladder_store_v1');
      if (raw) store = JSON.parse(raw) || { players:{} };
    }
  } catch {}

  const CATALOG = [
    'built-in:greedy-max','built-in:greedy-min','built-in:random-legal','built-in:mininet','built-in:ally-support','built-in:endgame-rush',
    'ai:openai','ai:gemini','ai:grok','ai:kimi','ai:qwen','ai:deepseek','http'
  ];
  const catalogIds = CATALOG.map((choice)=>{
    const model = defaultModelFor(choice as any) || '';
    const base  = (choice === 'http') ? '' : '';
    return `${choice}|${model}|${base}`;
  });
  const catalogLabels = (id:string)=>{
    const [choice, model] = id.split('|');
    const label = choiceLabel(choice as any);
    if (choice.startsWith('ai:')) return `${label}:${model||defaultModelFor(choice as any)}`;
    return label;
  };

  const players: Record<string, any> = (store?.players)||{};
  const keys = Array.from(new Set([...Object.keys(players), ...catalogIds]));
  const arr = keys.map((id)=>{
    const ent = players[id];
    const val = ent?.current?.deltaR ?? 0;
    const n   = ent?.current?.n ?? 0;
    const label = ent?.label || catalogLabels(id) || id;
    return { id, label, val, n };
  });

  const K = Math.max(1, ...arr.map(x=> (players[x.id]?.current?.K ?? 20)), 20);
  const items = arr.sort((a,b)=> b.val - a.val);

  const axisStyle:any = { position:'absolute', left:'50%', top:0, bottom:0, width:1, background:'#e5e7eb' };

  return (
    <div style={{ border:'1px dashed #e5e7eb', borderRadius:8, padding:10, marginTop:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
        <div style={{ fontWeight:700 }}>天梯图（活动积分 ΔR）</div>
        <div style={{ fontSize:12, color:'#6b7280' }}>范围 ±K（按局面权重加权，当前 K≈{K}；未参赛=历史或0）</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'240px 1fr 56px', gap:8 }}>
        {items.map((it:any)=>{
          const pct = Math.min(1, Math.abs(it.val)/K);
          const pos = it.val >= 0;
          return (
            <div key={it.id} style={{ display:'contents' }}>
              <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.label}</div>
              <div style={{ position:'relative', height:16, background:'#f9fafb', border:'1px solid #f3f4f6', borderRadius:8 }}>
                <div style={axisStyle} />
                <div style={{ position:'absolute', left: pos ? '50%' : `${50 - pct*50}%`, width: `${pct*50}%`, top:2, bottom:2, background: pos ? '#16a34a' : '#ef4444', borderRadius:6 }}/>
              </div>
              <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace', textAlign:'right' }}>{it.val.toFixed(2)}</div>
            </div>
          );
        })}
      </div>
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

/* ====== 模型预设/校验 ====== */
function defaultModelFor(choice: BotChoice): string {
  switch (choice) {
    case 'ai:openai': return 'gpt-4o-mini';
    case 'ai:gemini': return 'gemini-1.5-flash';
    case 'ai:grok':  return 'grok-2-latest';
    case 'ai:kimi':  return 'kimi-k2-0905-preview';
    case 'ai:qwen':  return 'qwen-plus';
    case 'ai:deepseek': return 'deepseek-chat';
    default: return '';
  }
}
function normalizeModelForProvider(choice: BotChoice, input: string): string {
  const m = (input || '').trim(); if (!m) return '';
  const low = m.toLowerCase();
  switch (choice) {
    case 'ai:kimi':   return /^kimi[-\w]*/.test(low) ? m : '';
    case 'ai:openai': return /^(gpt-|o[34]|text-|omni)/.test(low) ? m : '';
    case 'ai:gemini': return /^gemini[-\w.]*/.test(low) ? m : '';
    case 'ai:grok':   return /^grok[-\w.]*/.test(low) ? m : '';
    case 'ai:qwen':   return /^qwen[-\w.]*/.test(low) ? m : '';
    case 'ai:deepseek': return /^deepseek[-\w.]*/.test(low) ? m : '';
    default: return '';
  }
}
function choiceLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max':   return 'Greedy Max';
    case 'built-in:greedy-min':   return 'Greedy Min';
    case 'built-in:random-legal': return 'Random Legal';
    case 'built-in:mininet':      return 'MiniNet';
    case 'built-in:ally-support': return 'AllySupport';
    case 'built-in:endgame-rush': return 'EndgameRush';
    case 'ai:openai':             return 'OpenAI';
    case 'ai:gemini':             return 'Gemini';
    case 'ai:grok':               return 'Grok';
    case 'ai:kimi':               return 'Kimi';
    case 'ai:qwen':               return 'Qwen';
    case 'ai:deepseek':           return 'DeepSeek';
    case 'http':                  return 'HTTP';
    default: return String(choice);
  }
}


/* ====== 雷达图累计（0~5） ====== */
type Score5 = { coop:number; agg:number; cons:number; eff:number; rob:number };
function mergeScore(prev: Score5, curr: Score5, mode: 'mean'|'ewma', count:number, alpha:number): Score5 {
  if (mode === 'mean') {
    const c = Math.max(0, count);
    return {
      coop: (prev.coop*c + curr.coop)/(c+1),
      agg:  (prev.agg *c + curr.agg )/(c+1),
      cons: (prev.cons*c + curr.cons)/(c+1),
      eff:  (prev.eff *c + curr.eff )/(c+1),
      rob:  (prev.rob *c + curr.rob )/(c+1),
    };
  }
  const a = Math.min(0.95, Math.max(0.05, alpha || 0.35));
  return {
    coop: a*curr.coop + (1-a)*prev.coop,
    agg:  a*curr.agg  + (1-a)*prev.agg,
    cons: a*curr.cons + (1-a)*prev.cons,
    eff:  a*curr.eff  + (1-a)*prev.eff,
    rob:  a*curr.rob  + (1-a)*prev.rob,
  };
}




/* ---------- 文本改写：把"第 x 局"固定到本局 ---------- */
const makeRewriteRoundLabel = (n: number) => (msg: string) => {
  if (typeof msg !== 'string') return msg;
  let out = msg;
  out = out.replace(/第\s*\d+\s*局开始/g, `第 ${n} 局开始`);
  out = out.replace(/开始第\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始第\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/开始连打\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始连打\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局（/g, `单局模式：开始第 ${n} 局（`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局\(/g,  `单局模式：开始第 ${n} 局(`);
  return out;
};

/* ==================== LivePanel（对局） ==================== */
function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);

  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [plays, setPlays] = useState<{seat:number; move:'play'|'pass'; cards?:string[]; reason?:string}[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState<[number,number,number]>([
    props.startScore || 0, props.startScore || 0, props.startScore || 0,
  ]);
  const [finishedCount, setFinishedCount] = useState(0);
  // —— 每手牌得分（动态曲线）+ 分局切割与地主 ——
  const [scoreSeries, setScoreSeries] = useState<(number|null)[][]>([[],[],[]]);
  const scoreSeriesRef = useRef(scoreSeries); useEffect(()=>{ scoreSeriesRef.current = scoreSeries; }, [scoreSeries]);
  const [roundCuts, setRoundCuts] = useState<number[]>([0]);
  const roundCutsRef = useRef(roundCuts); useEffect(()=>{ roundCutsRef.current = roundCuts; }, [roundCuts]);

  const [roundLords, setRoundLords] = useState<number[]>([]);

  /* ====== 评分统计（每局） ====== */
  type SeatStat = { rounds:number; overallAvg:number; lastAvg:number; best:number; worst:number; mean:number; sigma:number };
  const [scoreStats, setScoreStats] = useState<SeatStat[]>([
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
  ]);
  const [scoreDists, setScoreDists] = useState<number[][]>([[],[],[]]);
  const statsFileRef = useRef<HTMLInputElement|null>(null);
  const roundLordsRef = useRef(roundLords); useEffect(()=>{ roundLordsRef.current = roundLords; }, [roundLords]);

  // 依据 scoreSeries（每手评分）与 roundCuts（每局切点）计算每局均值，并汇总到席位统计
  const recomputeScoreStats = () => {
    try {
      const series = scoreSeriesRef.current;   // number[][]
      const cuts = roundCutsRef.current;       // number[]
      const n = Math.max(series[0]?.length||0, series[1]?.length||0, series[2]?.length||0);
      const bands = (cuts && cuts.length ? [...cuts] : [0]).sort((a,b)=>a-b);
      if (bands[0] !== 0) bands.unshift(0);
      if (bands[bands.length-1] !== n) bands.push(n);
      const perSeatRounds:number[][] = [[],[],[]];
      for (let b=0;b<bands.length-1;b++){
        const st = bands[b], ed = bands[b+1];
        const len = Math.max(0, ed - st);
        if (len <= 0) continue;
        for (let s=0;s<3;s++){
          const arr = series[s]||[];
          let sum = 0, cnt = 0;
          for (let i=st;i<ed;i++){
            const v = arr[i];
            if (typeof v === 'number') { sum += v; cnt++; }
          }
          if (cnt>0) perSeatRounds[s].push(sum/cnt);
        }
      }
      const stats = [0,1,2].map(s=>{
        const rs = perSeatRounds[s];
        const rounds = rs.length;
        if (rounds===0) return { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 };
        const sum = rs.reduce((a,b)=>a+b,0);
        const overall = sum/rounds;
        const last = rs[rounds-1];
        const best = Math.max(...rs);
        const worst = Math.min(...rs);
        const mu = overall;
        const varv = rs.reduce((a,b)=>a + (b-mu)*(b-mu), 0) / rounds;
        const sigma = Math.sqrt(Math.max(0, varv));
        return { rounds, overallAvg: overall, lastAvg: last, best, worst, mean: mu, sigma };
      });
      setScoreStats(stats);
      setScoreDists(perSeatRounds);
    } catch (e) { console.error('[stats] recompute error', e); }
  }
  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);

  // —— TrueSkill（前端实时） —— //
  const [tsArr, setTsArr] = useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
  const tsRef = useRef(tsArr); useEffect(()=>{ tsRef.current=tsArr; }, [tsArr]);
  const tsCr = (r:Rating)=> (r.mu - 3*r.sigma);

  // ===== 新增：TS 存档（读/写/应用） =====
  const tsStoreRef = useRef<TsStore>(emptyStore());
  useEffect(()=>{ try { tsStoreRef.current = readStore(); } catch {} }, []);
  const fileRef = useRef<HTMLInputElement|null>(null);

  const seatIdentity = (i:number) => {
    const choice = props.seats[i];
    const model = normalizeModelForProvider(choice, props.seatModels[i] || '') || defaultModelFor(choice);
    const base = choice === 'http' ? (props.seatKeys[i]?.httpBase || '') : '';
    return `${choice}|${model}|${base}`; // 身份锚定
  };

  const resolveRatingForIdentity = (id: string, role?: TsRole): Rating | null => {
    const p = tsStoreRef.current.players[id]; if (!p) return null;
    if (role && p.roles?.[role]) return ensureRating(p.roles[role]);
    if (p.overall) return ensureRating(p.overall);
    const L = p.roles?.landlord, F = p.roles?.farmer;
    if (L && F) return { mu:(L.mu+F.mu)/2, sigma:(L.sigma+F.sigma)/2 };
    if (L) return ensureRating(L);
    if (F) return ensureRating(F);
    return null;
  };

  // 修改：移除立即应用，只在牌局开始时应用
  const applyTsFromStore = (why:string) => {
    const ids = [0,1,2].map(seatIdentity);
    const init = ids.map(id => resolveRatingForIdentity(id) || { ...TS_DEFAULT });
    setTsArr(init);
    setLog(l => [...l, `【TS】已从存档应用（${why}）：` + init.map((r,i)=>`${['甲','乙','丙'][i]} μ=${(Math.round(r.mu*100)/100).toFixed(2)} σ=${(Math.round(r.sigma*100)/100).toFixed(2)}`).join(' | ')]);
  };

  // NEW: 按角色应用（若知道地主，则地主用 landlord 档，其他用 farmer 档；未知则退回 overall）
  const applyTsFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0,1,2].map(seatIdentity);
    const init = [0,1,2].map(i => {
      const role: TsRole | undefined = (lord == null) ? undefined : (i === lord ? 'landlord' : 'farmer');
      return resolveRatingForIdentity(ids[i], role) || { ...TS_DEFAULT };
    });
    setTsArr(init);
    setLog(l => [...l,
      `【TS】按角色应用（${why}，地主=${lord ?? '未知'}）：` +
      init.map((r,i)=>`${['甲','乙','丙'][i]} μ=${(Math.round(r.mu*100)/100).toFixed(2)} σ=${(Math.round(r.sigma*100)/100).toFixed(2)}`).join(' | ')
    ]);
  };

  const updateStoreAfterRound = (updated: Rating[], landlordIndex:number) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles:{} };
      entry.overall = { ...updated[i] };
      const role: TsRole = (i===landlordIndex) ? 'landlord' : 'farmer';
      entry.roles = entry.roles || {};
      entry.roles[role] = { ...updated[i] };
      const choice = props.seats[i];
      const model  = (props.seatModels[i] || '').trim();
      const base   = choice==='http' ? (props.seatKeys[i]?.httpBase || '') : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      tsStoreRef.current.players[id] = entry;
    }
    writeStore(tsStoreRef.current);
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: TsStore = emptyStore();

      // 兼容多种模板：数组 / {players:{}} / 单人
      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity || p.key; if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall || p.rating || null,
            roles: { landlord: p.roles?.landlord ?? p.landlord ?? p.L ?? null,
                     farmer:   p.roles?.farmer   ?? p.farmer   ?? p.F ?? null },
            meta: p.meta || {}
          };
        }
      } else if (j?.players && typeof j.players === 'object') {
        store.players = j.players;
      } else if (Array.isArray(j)) {
        for (const p of j) { const id = p.id || p.identity; if (!id) continue; store.players[id] = p; }
      } else {
        if (j?.id) store.players[j.id] = j;
      }

      tsStoreRef.current = store; writeStore(store);
      setLog(l => [...l, `【TS】已上传存档（共 ${Object.keys(store.players).length} 名玩家）`]);
    } catch (err:any) {
      setLog(l => [...l, `【TS】上传解析失败：${err?.message || err}`]);
    } finally { e.target.value = ''; }
  };

  const handleSaveArchive = () => {
    const ids = [0,1,2].map(seatIdentity);
    ids.forEach((id,i)=>{
      const entry: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles:{} };
      entry.overall = { ...tsRef.current[i] };
      tsStoreRef.current.players[id] = entry;
    });
    writeStore(tsStoreRef.current);
    const blob = new Blob([JSON.stringify(tsStoreRef.current, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'trueskill_store.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
    setLog(l => [...l, '【TS】已导出当前存档。']);
  };

  // —— 用于"区分显示"的帮助函数 —— //
  const fmt2 = (x:number)=> (Math.round(x*100)/100).toFixed(2);
  const muSig = (r: Rating | null | undefined) => r ? `μ ${fmt2(r.mu)}｜σ ${fmt2(r.sigma)}` : '—';
  const getStoredForSeat = (i:number) => {
    const id = seatIdentity(i);
    const p = tsStoreRef.current.players[id];
    return {
      overall: p?.overall ? ensureRating(p.overall) : null,
      landlord: p?.roles?.landlord ? ensureRating(p.roles.landlord) : null,
      farmer: p?.roles?.farmer ? ensureRating(p.roles.farmer) : null,
    };
  };


  /* ===== Radar（战术画像）本地存档（新增） ===== */
  type RadarAgg = { scores: Score5; count: number };
  type RadarStoreEntry = {
    id: string; // 身份：choice|model|base（沿用 seatIdentity）
    overall?: RadarAgg | null;  // 不区分身份时累计
    roles?: { landlord?: RadarAgg | null; farmer?: RadarAgg | null }; // 按角色分档
    meta?: { choice?: string; model?: string; httpBase?: string };
  };
  type RadarStore = {
    schema: 'ddz-radar@1';
    updatedAt: string;
    players: Record<string, RadarStoreEntry>;
  };
  const RADAR_STORE_KEY = 'ddz_radar_store_v1';

  const ensureScore5 = (x:any): Score5 => ({
    coop: Number(x?.coop ?? 2.5),
    agg : Number(x?.agg  ?? 2.5),
    cons: Number(x?.cons ?? 2.5),
    eff : Number(x?.eff  ?? 2.5),
    rob : Number(x?.rob  ?? 2.5),
  });
  const ensureRadarAgg = (x:any): RadarAgg => ({
    scores: ensureScore5(x?.scores),
    count : Math.max(0, Number(x?.count)||0),
  });

  const emptyRadarStore = (): RadarStore =>
    ({ schema:'ddz-radar@1', updatedAt:new Date().toISOString(), players:{} });

  const readRadarStore = (): RadarStore => {
    try {
      const raw = localStorage.getItem(RADAR_STORE_KEY);
      if (!raw) return emptyRadarStore();
      const j = JSON.parse(raw);
      if (j?.schema && j?.players) return j as RadarStore;
    } catch {}
    return emptyRadarStore();
  };
  const writeRadarStore = (s: RadarStore) => {
    try { s.updatedAt=new Date().toISOString(); localStorage.setItem(RADAR_STORE_KEY, JSON.stringify(s)); } catch {}
  };
  const radarStoreRef = useRef<RadarStore>(emptyRadarStore());
  useEffect(()=>{ radarStoreRef.current = readRadarStore(); }, []);

  const updateRadarStoreAfterRound = (scores: Score5[], landlordIndex: number) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry: RadarStoreEntry = radarStoreRef.current.players[id] || { id, roles:{} };
      const role: TsRole = (i===landlordIndex) ? 'landlord' : 'farmer';
      entry.roles = entry.roles || {};
      const prev = entry.roles[role] || entry.overall || { scores: ensureScore5(null), count:0 };
      const merged = {
        scores: mergeScore(prev.scores, scores[i], 'mean', prev.count, 0),
        count: prev.count + 1,
      };
      entry.roles[role] = merged;
      radarStoreRef.current.players[id] = entry;
    }
    writeRadarStore(radarStoreRef.current);
  };

  const radarFileRef = useRef<HTMLInputElement|null>(null);
  const handleUploadRadarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: RadarStore = emptyRadarStore();
      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity; if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall || p.radar || null,
            roles: { landlord: p.roles?.landlord ?? p.landlord ?? p.L ?? null,
                     farmer:   p.roles?.farmer   ?? p.farmer   ?? p.F ?? null },
            meta: p.meta || {}
          };
        }
      } else if (j?.players && typeof j.players === 'object') {
        store.players = j.players;
      } else if (Array.isArray(j)) {
        for (const p of j) { const id = p.id || p.identity; if (!id) continue; store.players[id] = p; }
      } else {
        if (j?.id) store.players[j.id] = j;
      }
      radarStoreRef.current = store; writeRadarStore(store);
      setLog(l => [...l, `【Radar】已上传存档（共 ${Object.keys(store.players).length} 名玩家）`]);
    } catch (err:any) {
      setLog(l => [...l, `【Radar】上传解析失败：${err?.message || err}`]);
    } finally { e.target.value = ''; }
  };

  const handleSaveRadarArchive = () => {
    const blob = new Blob([JSON.stringify(radarStoreRef.current, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'radar_store.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
    setLog(l => [...l, '【Radar】已导出当前存档。']);
  };

  const getRadarStoredForSeat = (i:number) => {
    const id = seatIdentity(i);
    const p = radarStoreRef.current.players[id];
    return {
      overall: p?.overall ? ensureRadarAgg(p.overall) : null,
      landlord: p?.roles?.landlord ? ensureRadarAgg(p.roles.landlord) : null,
      farmer: p?.roles?.farmer ? ensureRadarAgg(p.roles.farmer) : null,
    };
  };

  // —— 主循环 —— //
  const runGame = async () => {
    if (running) return;
    setRunning(true);
    setFinishedCount(0);
    setLog([]);
    setPlays([]);
    setLandlord(null);
    setWinner(null);
    setDelta(null);
    setScoreSeries([[],[],[]]);
    setRoundCuts([0]);
    setRoundLords([]);

    // 修改：只在牌局开始时应用 TrueSkill 初始值
    applyTsFromStoreByRole(null, '牌局开始');

    const rewrite = makeRewriteRoundLabel(1);
    for (let round = 0; round < props.rounds; round++) {
      const rewriteThisRound = makeRewriteRoundLabel(round + 1);
      setLog(l => [...l, `开始第 ${round + 1} 局（共 ${props.rounds} 局）`]);

      // 重置手牌、地主、出牌记录等
      setHands([[],[],[]]);
      setLandlord(null);
      setPlays([]);
      setMultiplier(1);
      setWinner(null);
      setDelta(null);

      // 调用后端 API
      const params = new URLSearchParams();
      params.set('rob', String(props.rob));
      params.set('four2', props.four2);
      params.set('farmerCoop', String(props.farmerCoop));
      params.set('rounds', '1');
      params.set('startScore', String(props.startScore));
      params.set('seed', String(Date.now() + round));
      params.set('turnTimeoutSecs', (props.turnTimeoutSecs || [30,30,30]).join(','));
      params.set('seatDelayMs', (props.seatDelayMs || [0,0,0]).join(','));
      for (let i = 0; i < 3; i++) {
        params.set(`seats[${i}]`, props.seats[i]);
        params.set(`seatModels[${i}]`, props.seatModels[i] || '');
        if (props.seats[i] === 'http') {
          params.set(`seatKeys[${i}][httpBase]`, props.seatKeys[i]?.httpBase || '');
          params.set(`seatKeys[${i}][httpToken]`, props.seatKeys[i]?.httpToken || '');
        } else {
          params.set(`seatKeys[${i}][${props.seats[i].split(':')[1]}]`, props.seatKeys[i]?.[props.seats[i].split(':')[1] as keyof typeof props.seatKeys[0]] || '');
        }
      }

      const resp = await fetch('/api/doudizhu?' + params.toString());
      const data = await resp.json();
      const game = data.games?.[0];
      if (!game) {
        setLog(l => [...l, `第 ${round + 1} 局：后端返回数据异常`]);
        continue;
      }

      // 更新手牌
      const initialHands = game.initialHands || [[],[],[]];
      setHands(initialHands.map((h:string[]) => decorateHandCycle(h)));

      // 确定地主
      const lordIndex = game.landlord;
      setLandlord(lordIndex);
      setRoundLords(rl => [...rl, lordIndex]);

      // 修改：在确定地主后，按角色应用 TrueSkill 初始值
      applyTsFromStoreByRole(lordIndex, `第${round+1}局确定地主`);

      // 播放出牌过程
      const moves = game.moves || [];
      const playRecords: typeof plays = [];
      for (const move of moves) {
        const seat = move.seat;
        const action = move.action;
        const cards = action === 'play' ? (move.cards || []) : undefined;
        const reason = move.reason;
        playRecords.push({ seat, move: action, cards, reason });
        setPlays([...playRecords]);
        await new Promise(r => setTimeout(r, 800));
      }

      // 更新结果
      setWinner(game.winner);
      const deltaScores: [number, number, number] = game.deltaScores || [0,0,0];
      setDelta(deltaScores);
      const newTotals: [number,number,number] = [
        totals[0] + deltaScores[0],
        totals[1] + deltaScores[1],
        totals[2] + deltaScores[2],
      ];
      setTotals(newTotals);
      props.onTotals?.(newTotals);

      // 更新 TrueSkill
      const tsCur = [...tsRef.current];
      if (game.winner !== null) {
        const lord = game.landlord;
        if (lord != null) {
          if (game.winner === lord) {
            tsUpdateTwoTeams(tsCur, [lord], lord === 0 ? [1,2] : lord === 1 ? [0,2] : [0,1]);
          } else {
            tsUpdateTwoTeams(tsCur, lord === 0 ? [1,2] : lord === 1 ? [0,2] : [0,1], [lord]);
          }
          setTsArr([...tsCur]);
          updateStoreAfterRound(tsCur, lord);
        }
      }

      // 更新雷达图数据
      const radarScores: Score5[] = game.radarScores || Array(3).fill({ coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 });
      updateRadarStoreAfterRound(radarScores, lordIndex);

      // 更新天梯图数据
      const ladderDelta = game.ladderDelta || [0,0,0];
      const ids = [0,1,2].map(seatIdentity);
      try {
        const raw = localStorage.getItem('ddz_ladder_store_v1');
        const store = raw ? JSON.parse(raw) : { players:{} };
        for (let i=0;i<3;i++){
          const id = ids[i];
          const ent = store.players[id] || { current:{ n:0, deltaR:0, K:20 } };
          ent.current = ent.current || { n:0, deltaR:0, K:20 };
          ent.current.n += 1;
          ent.current.deltaR += ladderDelta[i];
          ent.current.K = Math.max(10, Math.min(100, Math.abs(ent.current.deltaR) / Math.max(1, ent.current.n)));
          store.players[id] = ent;
        }
        localStorage.setItem('ddz_ladder_store_v1', JSON.stringify(store));
        window.dispatchEvent(new Event('ddz-all-refresh'));
      } catch {}

      // 更新评分曲线
      const moveScores = game.moveScores || Array(3).fill([]);
      setScoreSeries(prev => {
        const next = [...prev];
        for (let i=0;i<3;i++) next[i] = [...prev[i], ...(moveScores[i] || [])];
        return next;
      });
      setRoundCuts(prev => [...prev, (roundCutsRef.current[roundCutsRef.current.length-1] + (moveScores[0]?.length || 0))]);

      setFinishedCount(c => c + 1);
      setLog(l => [...l, rewriteThisRound(`第 ${round + 1} 局结束：${['地主','农民','农民'][game.winner ?? -1]}胜利，得分 ${deltaScores.join(', ')}`)]);
      await new Promise(r => setTimeout(r, 1200));
    }
    setRunning(false);
    setLog(l => [...l, `全部 ${props.rounds} 局结束。`]);
  };

  return (
    <div style={{ padding:16, border:'1px solid #e5e7eb', borderRadius:8, background:'#f9fafb' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:18 }}>对局模拟</div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={runGame} disabled={running || !props.enabled}
            style={{ padding:'8px 16px', background: running||!props.enabled ? '#9ca3af' : '#3b82f6', color:'white', border:'none', borderRadius:6, fontWeight:600 }}>
            {running ? `运行中 (${finishedCount}/${props.rounds})` : '开始运行'}
          </button>
        </div>
      </div>

      {/* TrueSkill 存档管理 */}
      <Section title="TrueSkill 存档">
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
          <input type="file" accept=".json" ref={fileRef} onChange={handleUploadFile} style={{ display:'none' }} />
          <button onClick={()=>fileRef.current?.click()} style={{ padding:'6px 12px', background:'#f3f4f6', border:'1px solid #d1d5db', borderRadius:6, fontSize:14 }}>上传存档</button>
          <button onClick={handleSaveArchive} style={{ padding:'6px 12px', background:'#f3f4f6', border:'1px solid #d1d5db', borderRadius:6, fontSize:14 }}>导出存档</button>
          <div style={{ fontSize:12, color:'#6b7280' }}>用于 TrueSkill 分档（地主/农民/总体）</div>
        </div>
      </Section>

      {/* 雷达图存档管理 */}
      <Section title="战术画像存档">
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
          <input type="file" accept=".json" ref={radarFileRef} onChange={handleUploadRadarFile} style={{ display:'none' }} />
          <button onClick={()=>radarFileRef.current?.click()} style={{ padding:'6px 12px', background:'#f3f4f6', border:'1px solid #d1d5db', borderRadius:6, fontSize:14 }}>上传存档</button>
          <button onClick={handleSaveRadarArchive} style={{ padding:'6px 12px', background:'#f3f4f6', border:'1px solid #d1d5db', borderRadius:6, fontSize:14 }}>导出存档</button>
          <div style={{ fontSize:12, color:'#6b7280' }}>用于雷达图画像（地主/农民/总体）</div>
        </div>
      </Section>

      {/* 天梯图 */}
      <LadderPanel />

      {/* TrueSkill 显示 */}
      <Section title="TrueSkill 分档（前端实时）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          {[0,1,2].map(i=>{
            const stored = getStoredForSeat(i);
            const current = tsArr[i];
            return (
              <div key={i} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:12, background:'white' }}>
                <div style={{ fontWeight:700, marginBottom:8 }}><SeatTitle i={i} /> {choiceLabel(props.seats[i])}</div>
                <div style={{ fontSize:12, color:'#6b7280', marginBottom:4 }}>身份：{seatIdentity(i)}</div>
                <div style={{ fontSize:13, marginBottom:4 }}>当前：{muSig(current)}</div>
                <div style={{ fontSize:13, marginBottom:4 }}>存档-总体：{muSig(stored.overall)}</div>
                <div style={{ fontSize:13, marginBottom:4 }}>存档-地主：{muSig(stored.landlord)}</div>
                <div style={{ fontSize:13, marginBottom:4 }}>存档-农民：{muSig(stored.farmer)}</div>
                <div style={{ fontSize:13, fontWeight:600, color:'#dc2626' }}>保守分：{fmt2(tsCr(current))}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 雷达图显示 */}
      <Section title="战术画像（雷达图）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          {[0,1,2].map(i=>{
            const stored = getRadarStoredForSeat(i);
            const fmt = (x:number) => (Math.round(x*100)/100).toFixed(2);
            const renderScores = (s: Score5) => (
              <div style={{ fontSize:12 }}>
                合作{s.coop} 激进{s.agg} 稳健{s.cons} 效率{s.eff} 抢庄{s.rob}
              </div>
            );
            return (
              <div key={i} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:12, background:'white' }}>
                <div style={{ fontWeight:700, marginBottom:8 }}><SeatTitle i={i} /> {choiceLabel(props.seats[i])}</div>
                <div style={{ fontSize:12, color:'#6b7280', marginBottom:4 }}>身份：{seatIdentity(i)}</div>
                <div style={{ fontSize:13, marginBottom:4 }}>存档-总体：{stored.overall ? `(${stored.overall.count}局) ${renderScores(stored.overall.scores)}` : '—'}</div>
                <div style={{ fontSize:13, marginBottom:4 }}>存档-地主：{stored.landlord ? `(${stored.landlord.count}局) ${renderScores(stored.landlord.scores)}` : '—'}</div>
                <div style={{ fontSize:13, marginBottom:4 }}>存档-农民：{stored.farmer ? `(${stored.farmer.count}局) ${renderScores(stored.farmer.scores)}` : '—'}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* 对局信息 */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16 }}>
        <div>
          <Section title="手牌">
            {hands.map((h, i) => (
              <div key={i} style={{ marginBottom:12 }}>
                <div style={{ fontWeight:600, marginBottom:4 }}>
                  <SeatTitle i={i} /> {choiceLabel(props.seats[i])}
                  {landlord === i && <span style={{ color:'#dc2626', marginLeft:8 }}>👑 地主</span>}
                </div>
                <Hand cards={h} />
              </div>
            ))}
          </Section>
        </div>
        <div>
          <Section title="出牌记录">
            <div style={{ maxHeight:320, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:8, padding:12, background:'white' }}>
              {plays.map((p, idx) => <PlayRow key={idx} {...p} />)}
            </div>
          </Section>
        </div>
      </div>

      {/* 对局结果 */}
      {(winner !== null || delta) && (
        <Section title="对局结果">
          <div style={{ display:'flex', gap:16, alignItems:'center' }}>
            {winner !== null && (
              <div style={{ fontWeight:700, color: winner === landlord ? '#dc2626' : '#16a34a' }}>
                {winner === landlord ? '地主' : '农民'}胜利
              </div>
            )}
            {delta && (
              <div style={{ fontFamily:'ui-monospace,Menlo,Consolas,monospace' }}>
                得分：甲 {delta[0]} | 乙 {delta[1]} | 丙 {delta[2]}
              </div>
            )}
            {multiplier > 1 && (
              <div style={{ color:'#d97706' }}>倍率 ×{multiplier}</div>
            )}
          </div>
        </Section>
      )}

      {/* 累计得分 */}
      <Section title="累计得分">
        <div style={{ display:'flex', gap:16, fontFamily:'ui-monospace,Menlo,Consolas,monospace', fontWeight:600 }}>
          <div>甲：{totals[0]}</div>
          <div>乙：{totals[1]}</div>
          <div>丙：{totals[2]}</div>
        </div>
      </Section>

      {/* 对局日志 */}
      <Section title="对局日志">
        <div style={{ maxHeight:320, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:8, padding:12, background:'white' }}>
          {log.map((line, idx) => <LogLine key={idx} text={line} />)}
        </div>
      </Section>
    </div>
  );
}

/* ====== 主页面 ====== */
export default function Home() {
  const [enabled, setEnabled] = useState(false);
  const [rob, setRob] = useState(true);
  const [four2, setFour2] = useState<Four2Policy>('both');
  const [farmerCoop, setFarmerCoop] = useState(false);
  const [rounds, setRounds] = useState(1);
  const [startScore, setStartScore] = useState(0);
  const [totals, setTotals] = useState<[number,number,number]>([0,0,0]);

  const [seats, setSeats] = useState<BotChoice[]>(['built-in:greedy-max','built-in:greedy-min','built-in:random-legal']);
  const [seatModels, setSeatModels] = useState<string[]>(['','','']);
  const [seatKeys, setSeatKeys] = useState<{
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string;
    httpBase?: string; httpToken?: string;
  }[]>([{},{},{}]);

  const [turnTimeoutSecs, setTurnTimeoutSecs] = useState<number[]>([30,30,30]);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>([0,0,0]);

  const handleSeatChange = (i: number, choice: BotChoice) => {
    const newSeats = [...seats]; newSeats[i] = choice; setSeats(newSeats);
    const newModels = [...seatModels];
    if (choice.startsWith('ai:')) newModels[i] = defaultModelFor(choice);
    else newModels[i] = '';
    setSeatModels(newModels);
  };

  const handleModelChange = (i: number, model: string) => {
    const newModels = [...seatModels]; newModels[i] = model; setSeatModels(newModels);
  };

  const handleKeyChange = (i: number, key: string, value: string) => {
    const newKeys = [...seatKeys];
    if (seats[i] === 'http') {
      if (key === 'httpBase') newKeys[i] = { ...newKeys[i], httpBase: value };
      if (key === 'httpToken') newKeys[i] = { ...newKeys[i], httpToken: value };
    } else {
      const provider = seats[i].split(':')[1] as keyof typeof seatKeys[0];
      newKeys[i] = { ...newKeys[i], [provider]: value };
    }
    setSeatKeys(newKeys);
  };

  const handleTurnTimeoutChange = (i: number, value: string) => {
    const secs = Math.max(1, Math.min(300, Number(value)||30));
    const newTimeouts = [...turnTimeoutSecs]; newTimeouts[i] = secs; setTurnTimeoutSecs(newTimeouts);
  };

  const handleSeatDelayChange = (i: number, value: string) => {
    const ms = Math.max(0, Math.min(10000, Number(value)||0));
    const newDelays = [...seatDelayMs]; newDelays[i] = ms; setSeatDelayMs(newDelays);
  };

  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:16 }}>
      <h1 style={{ textAlign:'center', marginBottom:24 }}>斗地主 AI 对战平台</h1>

      {/* 控制面板 */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:16, background:'#f9fafb', marginBottom:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:16, marginBottom:16 }}>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>局数</label>
            <input type="number" min="1" max="100" value={rounds} onChange={e=>setRounds(Number(e.target.value))}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }} />
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>初始分数</label>
            <input type="number" value={startScore} onChange={e=>setStartScore(Number(e.target.value))}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }} />
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>抢地主</label>
            <select value={rob?'true':'false'} onChange={e=>setRob(e.target.value==='true')}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }}>
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>四带二</label>
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }}>
              <option value="both">四带两对或两张</option>
              <option value="2singles">四带两张</option>
              <option value="2pairs">四带两对</option>
            </select>
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>农民协作</label>
            <select value={farmerCoop?'true':'false'} onChange={e=>setFarmerCoop(e.target.value==='true')}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }}>
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          </div>
        </div>

        {/* 席位配置 */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontWeight:700, marginBottom:8 }}>席位配置</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:12 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:12, background:'white' }}>
                <div style={{ fontWeight:600, marginBottom:8 }}><SeatTitle i={i} /></div>
                
                <div style={{ marginBottom:8 }}>
                  <label style={{ display:'block', marginBottom:4, fontSize:14 }}>AI 类型</label>
                  <select value={seats[i]} onChange={e=>handleSeatChange(i, e.target.value as BotChoice)}
                    style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }}>
                    <optgroup label="内置策略">
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                      <option value="built-in:mininet">MiniNet</option>
                      <option value="built-in:ally-support">AllySupport</option>
                      <option value="built-in:endgame-rush">EndgameRush</option>
                    </optgroup>
                    <optgroup label="AI 服务">
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="ai:deepseek">DeepSeek</option>
                    </optgroup>
                    <option value="http">HTTP 服务</option>
                  </select>
                </div>

                {seats[i].startsWith('ai:') && (
                  <div style={{ marginBottom:8 }}>
                    <label style={{ display:'block', marginBottom:4, fontSize:14 }}>模型</label>
                    <input type="text" value={seatModels[i]} onChange={e=>handleModelChange(i, e.target.value)}
                      placeholder={defaultModelFor(seats[i])}
                      style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} />
                  </div>
                )}

                {(seats[i].startsWith('ai:') || seats[i] === 'http') && (
                  <div style={{ marginBottom:8 }}>
                    <label style={{ display:'block', marginBottom:4, fontSize:14 }}>
                      {seats[i] === 'http' ? 'HTTP 基础 URL' : 'API 密钥'}
                    </label>
                    <input type="text" value={
                      seats[i] === 'http' 
                        ? (seatKeys[i]?.httpBase || '')
                        : (seatKeys[i]?.[seats[i].split(':')[1] as keyof typeof seatKeys[0]] || '')
                    } onChange={e=>handleKeyChange(i, seats[i] === 'http' ? 'httpBase' : seats[i].split(':')[1], e.target.value)}
                      placeholder={seats[i] === 'http' ? 'https://api.example.com' : 'sk-...'}
                      style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} />
                  </div>
                )}

                {seats[i] === 'http' && (
                  <div style={{ marginBottom:8 }}>
                    <label style={{ display:'block', marginBottom:4, fontSize:14 }}>HTTP Token（可选）</label>
                    <input type="text" value={seatKeys[i]?.httpToken || ''} onChange={e=>handleKeyChange(i, 'httpToken', e.target.value)}
                      placeholder="Bearer token"
                      style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} />
                  </div>
                )}

                <div style={{ marginBottom:8 }}>
                  <label style={{ display:'block', marginBottom:4, fontSize:14 }}>出牌超时（秒）</label>
                  <input type="number" min="1" max="300" value={turnTimeoutSecs[i]} onChange={e=>handleTurnTimeoutChange(i, e.target.value)}
                    style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} />
                </div>

                <div>
                  <label style={{ display:'block', marginBottom:4, fontSize:14 }}>出牌延迟（毫秒）</label>
                  <input type="number" min="0" max="10000" value={seatDelayMs[i]} onChange={e=>handleSeatDelayChange(i, e.target.value)}
                    style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:14, color: enabled ? '#16a34a' : '#d97706' }}>
            {enabled ? '✅ 配置就绪' : '⚠ 请检查配置'}
          </div>
          <button onClick={()=>setEnabled(!enabled)} style={{ padding:'8px 16px', background: enabled ? '#dc2626' : '#16a34a', color:'white', border:'none', borderRadius:6, fontWeight:600 }}>
            {enabled ? '禁用' : '启用'}
          </button>
        </div>
      </div>

      {/* 对局面板 */}
      <LivePanel
        rounds={rounds}
        startScore={startScore}
        enabled={enabled}
        rob={rob}
        four2={four2}
        farmerCoop={farmerCoop}
        seats={seats}
        seatModels={seatModels}
        seatKeys={seatKeys}
        turnTimeoutSecs={turnTimeoutSecs}
        seatDelayMs={seatDelayMs}
        onTotals={setTotals}
      />
    </div>
  );
}