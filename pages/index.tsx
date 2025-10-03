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
                <div style={{ position:'absolute', left: pos ? '50%' : `${50 - pct*50}%`, width: `${pct*50}%`, top:2, bottom:2, background: pos ? '#16a34a' : '#ef4444', borderRadius:6}}/>
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
    case 'ai:kimi':   return /^kimi[-\\w]*/.test(low) ? m : '';
    case 'ai:openai': return /^(gpt-|o[34]|text-|omni)/.test(low) ? m : '';
    case 'ai:gemini': return /^gemini[-\\w.]*/.test(low) ? m : '';
    case 'ai:grok':   return /^grok[-\\w.]*/.test(low) ? m : '';
    case 'ai:qwen':   return /^qwen[-\\w.]*/.test(low) ? m : '';
    case 'ai:deepseek': return /^deepseek[-\\w.]*/.test(low) ? m : '';
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
  out = out.replace(/第\\s*\\d+\\s*局开始/g, `第 ${n} 局开始`);
  out = out.replace(/开始第\\s*\\d+\\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始第\\s*\\d+\\s*局\\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/开始连打\\s*\\d+\\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始连打\\s*\\d+\\s*局\\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/单局模式.*?(仅运行|运行)\\s*\\d+\\s*局（/g, `单局模式：开始第 ${n} 局（`);
  out = out.replace(/单局模式.*?(仅运行|运行)\\s*\\d+\\s*局\\(/g,  `单局模式：开始第 ${n} 局(`);
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
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
    setLog(l => [...l, '【TS】已导出当前存档。']);
  };

  // 刷新：按"当前地主身份"应用
  const handleRefreshApply = () => {
    applyTsFromStoreByRole(landlordRef.current, '手动刷新');
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
      if (j?.schema === 'ddz-radar@1' && j?.players) return j as RadarStore;
    } catch {}
    return emptyRadarStore();
  };
  const writeRadarStore = (s: RadarStore) => {
    try { s.updatedAt=new Date().toISOString();
      localStorage.setItem(RADAR_STORE_KEY, JSON.stringify(s));
    } catch {}
  };

  /** 用"均值 + 次数"合并（与前端 mean 聚合一致） */
  function mergeRadarAgg(prev: RadarAgg|null|undefined, inc: Score5): RadarAgg {
    if (!prev) return { scores: { ...inc }, count: 1 };
    const c = prev.count;
    const mean = (a:number,b:number)=> (a*c + b)/(c+1);
    return {
      scores: {
        coop: mean(prev.scores.coop, inc.coop),
        agg : mean(prev.scores.agg , inc.agg ),
        cons: mean(prev.scores.cons, inc.cons),
        eff : mean(prev.scores.eff , inc.eff ),
        rob : mean(prev.scores.rob , inc.rob ),
      },
      count: c + 1,
    };
  }

  // —— Radar 存档：读写/应用/上传/导出 —— //
  const radarStoreRef = useRef<RadarStore>(emptyRadarStore());
  useEffect(()=>{ try { radarStoreRef.current = readRadarStore(); } catch {} }, []);
  const radarFileRef = useRef<HTMLInputElement|null>(null);

  /** 取指定座位的（按角色可选）Radar 累计 */
  const resolveRadarForIdentity = (id:string, role?: 'landlord'|'farmer'): RadarAgg | null => {
    const p = radarStoreRef.current.players[id];
    if (!p) return null;
    if (role && p.roles?.[role]) return ensureRadarAgg(p.roles[role]);
    if (p.overall) return ensureRadarAgg(p.overall);
    const L = p.roles?.landlord, F = p.roles?.farmer;
    if (L && F) {
      const ll = ensureRadarAgg(L), ff = ensureRadarAgg(F);
      const tot = Math.max(1, ll.count + ff.count);
      const w = (a:number,b:number,ca:number,cb:number)=> (a*ca + b*cb)/tot;
      return {
        scores: {
          coop: w(ll.scores.coop, ff.scores.coop, ll.count, ff.count),
          agg : w(ll.scores.agg , ff.scores.agg , ll.count, ff.count),
          cons: w(ll.scores.cons, ff.scores.cons, ll.count, ff.count),
          eff : w(ll.scores.eff , ff.scores.eff , ll.count, ff.count),
          rob : w(ll.scores.rob , ff.scores.rob , ll.count, ff.count),
        },
        count: tot,
      };
    }
    if (L) return ensureRadarAgg(L);
    if (F) return ensureRadarAgg(F);
    return null;
  };

  /** 根据当前地主身份（已知/未知）把存档套到 UI 的 aggStats/aggCount */
  
  /* ===== 天梯（活动积分 ΔR_event）本地存档（localStorage 直接读写） ===== */
  type LadderAgg = { n:number; sum:number; delta:number; deltaR:number; K:number; N0:number };
  type LadderEntry = { id:string; label:string; current:LadderAgg; history?: { when:string; n:number; delta:number; deltaR:number }[] };
  type LadderStore = { schema:'ddz-ladder@1'; updatedAt:string; players: Record<string, LadderEntry> };
  const LADDER_KEY = 'ddz_ladder_store_v1';
  const LADDER_EMPTY: LadderStore = { schema:'ddz-ladder@1', updatedAt:new Date().toISOString(), players:{} };
  const LADDER_DEFAULT: LadderAgg = { n:0, sum:0, delta:0, deltaR:0, K:20, N0:20 };

  function readLadder(): LadderStore {
    try { const raw = localStorage.getItem(LADDER_KEY); if (raw) { const j = JSON.parse(raw); if (j?.schema==='ddz-ladder@1') return j as LadderStore; } } catch {}
    return { ...LADDER_EMPTY, updatedAt:new Date().toISOString() };
  }
  function writeLadder(s: LadderStore) {
    try { s.updatedAt = new Date().toISOString(); localStorage.setItem(LADDER_KEY, JSON.stringify(s)); } catch {}
  }
  function ladderUpdateLocal(id:string, label:string, sWin:number, pExp:number, weight:number=1) {
    const st = readLadder();
    const ent = st.players[id] || { id, label, current: { ...LADDER_DEFAULT }, history: [] };
    if (!ent.current) ent.current = { ...LADDER_DEFAULT };
    if (!ent.label) ent.label = label;
    const w = Math.max(0, Number(weight) || 0);
    ent.current.n += w;
    ent.current.sum += w * (sWin - pExp);
    const N0 = ent.current.N0 ?? 20;
    const K  = ent.current.K  ?? 20;
    ent.current.delta = ent.current.n > 0 ? (ent.current.sum / ent.current.n) : 0;
    const shrink = Math.sqrt(ent.current.n / (ent.current.n + Math.max(1, N0)));
    ent.current.deltaR = K * ent.current.delta * shrink;
    st.players[id] = ent;
    writeLadder(st);
    try { window.dispatchEvent(new Event('ddz-all-refresh')); } catch {}
  }
    const applyRadarFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0,1,2].map(seatIdentity);
    const s3 = [0,1,2].map(i=>{
      const role = (lord==null) ? undefined : (i===lord ? 'landlord' : 'farmer');
      return resolveRadarForIdentity(ids[i], role) || { scores: { coop:0, agg:0, cons:0, eff:0, rob:0 }, count: 0 };
    });
    setAggStats(s3.map(x=>({ ...x.scores })));
    setAggCount(Math.max(s3[0].count, s3[1].count, s3[2].count));
    setLog(l => [...l, `【Radar】已从存档应用（${why}，地主=${lord ?? '未知'}）`]);
  };

  /** 在收到一帧"本局画像 s3[0..2]"后，写入 Radar 存档（overall + 角色分档） */
  const updateRadarStoreFromStats = (s3: Score5[], lord: number | null) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry = (radarStoreRef.current.players[id] || { id, roles:{} }) as RadarStoreEntry;
      entry.overall = mergeRadarAgg(entry.overall, s3[i]);
      if (lord!=null) {
        const role: 'landlord' | 'farmer' = (i===lord ? 'landlord' : 'farmer');
        entry.roles = entry.roles || {};
        entry.roles[role] = mergeRadarAgg(entry.roles[role], s3[i]);
      }
      const choice = props.seats[i];
      const model  = (props.seatModels[i] || '').trim();
      const base   = choice==='http' ? (props.seatKeys[i]?.httpBase || '') : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      radarStoreRef.current.players[id] = entry;
    }
    writeRadarStore(radarStoreRef.current);
  };

  /** 上传 Radar 存档（JSON） */
  const handleRadarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: RadarStore = emptyRadarStore();

      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity || p.key; if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall ? ensureRadarAgg(p.overall) : null,
            roles: {
              landlord: p.roles?.landlord ? ensureRadarAgg(p.roles.landlord) : (p.landlord ? ensureRadarAgg(p.landlord) : null),
              farmer  : p.roles?.farmer   ? ensureRadarAgg(p.roles.farmer)   : (p.farmer   ? ensureRadarAgg(p.farmer)   : null),
            },
            meta: p.meta || {},
          };
        }
      } else if (j?.players && typeof j.players === 'object') {
        for (const [id, p] of Object.entries<any>(j.players)) {
          store.players[id] = {
            id,
            overall: p?.overall ? ensureRadarAgg(p.overall) : null,
            roles: {
              landlord: p?.roles?.landlord ? ensureRadarAgg(p.roles.landlord) : null,
              farmer  : p?.roles?.farmer   ? ensureRadarAgg(p.roles.farmer)   : null,
            },
            meta: p?.meta || {},
          };
        }
      } else if (Array.isArray(j)) {
        for (const p of j) { const id = p.id || p.identity; if (!id) continue; store.players[id] = p as any; }
      } else if (j?.id) {
        store.players[j.id] = j as any;
      }

      radarStoreRef.current = store; writeRadarStore(store);
      setLog(l => [...l, `【Radar】已上传存档（${Object.keys(store.players).length} 位）`]);
    } catch (err:any) {
      setLog(l => [...l, `【Radar】上传解析失败：${err?.message || err}`]);
    } finally { e.target.value = ''; }
  };

  /** 导出当前 Radar 存档 */
  const handleRadarSave = () => {
    if (aggStatsRef.current) {
      const ids = [0,1,2].map(seatIdentity);
      for (let i=0;i<3;i++){
        const id = ids[i];
        const entry = (radarStoreRef.current.players[id] || { id, roles:{} }) as RadarStoreEntry;
        const inc = aggStatsRef.current?.[i] as (Score5 | null | undefined);
        if (inc) { entry.overall = mergeRadarAgg(entry.overall, inc as Score5); }
        radarStoreRef.current.players[id] = entry;
      }
      writeRadarStore(radarStoreRef.current);
    }

    const blob = new Blob([JSON.stringify(radarStoreRef.current, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'radar_store.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
    setLog(l => [...l, '【Radar】已导出当前存档。']);
  };

  /** 手动刷新：按当前地主身份（未知则用 overall）把存档套到面板 */
  const handleRadarRefresh = () => {
    applyRadarFromStoreByRole(landlordRef.current, '手动刷新');
  };

  // 累计画像
  const [aggMode, setAggMode] = useState<'mean'|'ewma'>('ewma');
  const [alpha, setAlpha] = useState<number>(0.35);
  const [aggStats, setAggStats] = useState<Score5[] | null>(null);
  const [aggCount, setAggCount] = useState<number>(0);

  useEffect(() => { props.onTotals?.(totals); }, [totals]);
  useEffect(() => { props.onLog?.(log); }, [log]);

  const controllerRef = useRef<AbortController|null>(null);
  const handsRef = useRef(hands); useEffect(() => { handsRef.current = hands; }, [hands]);
  const playsRef = useRef(plays); useEffect(() => { playsRef.current = plays; }, [plays]);
  const totalsRef = useRef(totals); useEffect(() => { totalsRef.current = totals; }, [totals]);
  const finishedRef = useRef(finishedCount); useEffect(() => { finishedRef.current = finishedCount; }, [finishedCount]);
  const logRef = useRef(log); useEffect(() => { logRef.current = log; }, [log]);
  const landlordRef = useRef(landlord); useEffect(() => { landlordRef.current = landlord; }, [landlord]);
  const winnerRef = useRef(winner); useEffect(() => { winnerRef.current = winner; }, [winner]);
  const deltaRef = useRef(delta); useEffect(() => { deltaRef.current = delta; }, [delta]);
  const multiplierRef = useRef(multiplier); useEffect(() => { multiplierRef.current = multiplier; }, [multiplier]);

  const aggStatsRef = useRef(aggStats); useEffect(()=>{ aggStatsRef.current = aggStats; }, [aggStats]);
  const aggCountRef = useRef(aggCount); useEffect(()=>{ aggCountRef.current = aggCount; }, [aggCount]);
  const aggModeRef  = useRef(aggMode);  useEffect(()=>{ aggModeRef.current  = aggMode;  }, [aggMode]);
  const alphaRef    = useRef(alpha);    useEffect(()=>{ alphaRef.current    = alpha;    }, [alpha]);

  const lastReasonRef = useRef<(string|null)[]>([null, null, null]);

  // 每局观测标记
  const roundFinishedRef = useRef<boolean>(false);
  const seenStatsRef     = useRef<boolean>(false);

  
  const scoreFileRef = useRef<HTMLInputElement|null>(null);

  const agentIdForIndex = (i:number) => {
    const choice = props.seats[i] as BotChoice;
    const label = choiceLabel(choice);
    if ((choice as string).startsWith('built-in')) return label;
    const model = (props.seatModels?.[i]) || defaultModelFor(choice);
    return `${label}:${model}`;
  };

  // === 保存"出牌评分"存档（严格：按 identity 导出）===
const handleScoreSave = () => {
  const identities = [0,1,2].map(seatIdentity);
  const agents     = [0,1,2].map(agentIdForIndex);

  const n = Math.max(
    scoreSeriesRef.current[0]?.length||0,
    scoreSeriesRef.current[1]?.length||0,
    scoreSeriesRef.current[2]?.length||0
  );

  const rounds = Array.isArray(roundCutsRef.current) ? roundCutsRef.current.slice() : [0];

  const seriesByIdentity: Record<string,(number|null)[]> = {};
  for (let i=0;i<3;i++) {
    seriesByIdentity[identities[i]] = (scoreSeriesRef.current[i]||[]).slice();
  }

  const payload = {
    schema: 'ddz-scores@1',
    version: 2,
    createdAt: new Date().toISOString(),
    identities,
    agents,
    n,
    rounds,
    seriesByIdentity,
    // 兼容：保留旧字段，但导入不再使用
    seriesBySeat: scoreSeriesRef.current.map(a => Array.isArray(a) ? a.slice() : []),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'score_series.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
};

// === 上传"出牌评分"存档（严格：只按 identity 对齐）===
const handleScoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
  try {
    const f = e.target.files?.[0];
    if (!f) return;

    const fr = new FileReader();
    fr.onload = () => {
      try {
        const j:any = JSON.parse(String(fr.result || '{}'));
        if (!j || typeof j.seriesByIdentity !== 'object') {
          throw new Error('评分文件缺少 seriesByIdentity（按算法 ID 存储）。为避免错位，已拒绝导入。');
        }
        const ids = [0,1,2].map(seatIdentity);
        const mapped:(number|null)[][] = [[],[],[]];
        for (let i=0;i<3;i++) {
          const arr = j.seriesByIdentity[ids[i]];
          mapped[i] = Array.isArray(arr) ? arr.slice() : [];
        }
        setScoreSeries(mapped);
        if (Array.isArray(j.rounds))     setRoundCuts(j.rounds.slice());
        if (Array.isArray(j.landlords))  setRoundLords(j.landlords.slice());
        setLog(l => [...l, '【Score】评分序列已按 identity 对齐加载。']);
      } catch (err:any) {
        setLog(l => [...l, `【Score】上传解析失败：${err?.message || err}`]);
      } finally {
        if (e.target) e.target.value = '';
      }
    };
    fr.onerror = () => {
      setLog(l => [...l, '【Score】文件读取失败']);
      if (e.target) e.target.value = '';
    };
    fr.readAsText(f);
  } catch (err) { console.error('[score upload] error', err); }
};

  
  const handleStatsSave = () => {
    try {
      const payload = { when: new Date().toISOString(), stats: scoreStats, dists: scoreDists };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'score-stats.json';
      a.click();
      setTimeout(()=> URL.revokeObjectURL(url), 0);
    } catch (e) { console.error('[stats] save error', e); }
  };
  const handleStatsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const obj = JSON.parse(String(fr.result||'{}'));
          const targetIds = [0,1,2].map(seatIdentity);

          let statsMapped:any[] = [null,null,null];
          let distsMapped:any[] = [null,null,null];

          // 1) identity-keyed
          if (obj.statsByIdentity && obj.distsByIdentity) {
            statsMapped = [0,1,2].map((i:number)=> obj.statsByIdentity[targetIds[i]] || { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 });
            distsMapped = [0,1,2].map((i:number)=> obj.distsByIdentity[targetIds[i]] || []);
          } else if (Array.isArray(obj.identities) && Array.isArray(obj.stats) && Array.isArray(obj.dists)) {
            // 2) identities + arrays
            statsMapped = [0,1,2].map((i:number)=> {
              const k = obj.identities.indexOf(targetIds[i]);
              return (k>=0 && obj.stats[k]) ? obj.stats[k] : { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 };
            });
            distsMapped = [0,1,2].map((i:number)=> {
              const k = obj.identities.indexOf(targetIds[i]);
              return (k>=0 && Array.isArray(obj.dists[k])) ? obj.dists[k] : [];
            });
          } else if (Array.isArray(obj.stats) && Array.isArray(obj.dists) && obj.stats.length===3 && obj.dists.length===3) {
            // 3) fallback: seat-order
            statsMapped = obj.stats;
            distsMapped = obj.dists;
          }

          setScoreStats(statsMapped as any);
          setScoreDists(distsMapped as any);
        } catch (err) { console.error('[stats upload] parse error', err); }
        finally { if (e.target) e.target.value = ''; }
      };
      fr.readAsText(f);
    } catch (err) { console.error('[stats upload] error', err); }
    finally { if (statsFileRef.current) statsFileRef.current.value = ''; }
  };
  const handleStatsRefresh = () => { setRoundCuts(prev => [...prev]); };
const handleScoreRefresh = () => {
    setScoreSeries(prev => prev.map(arr => Array.isArray(arr) ? [...arr] : []));
    setRoundCuts(prev => [...prev]);
    setRoundLords(prev => [...prev]);
  };
const start = async () => {
    if (running) return;
    if (!props.enabled) { setLog(l => [...l, '【前端】未启用对局：请在设置中勾选"启用对局"。']); return; }

    setRunning(true);
    setLandlord(null); setHands([[], [], []]); setPlays([]);
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null); setAggCount(0);

    // TrueSkill：开始时先应用 overall（未知地主）
    setTsArr([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
    try { applyTsFromStore('比赛开始前'); } catch {}

    controllerRef.current = new AbortController();

    const buildSeatSpecs = (): any[] => {
      return props.seats.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai':   return { choice, model, apiKey: keys.openai || '' };
          case 'ai:gemini':   return { choice, model, apiKey: keys.gemini || '' };
          case 'ai:grok':     return { choice, model, apiKey: keys.grok || '' };
          case 'ai:kimi':     return { choice, model, apiKey: keys.kimi || '' };
          case 'ai:qwen':     return { choice, model, apiKey: keys.qwen || '' };
          case 'ai:deepseek': return { choice, model, apiKey: keys.deepseek || '' };
          case 'http':        return { choice, model, baseUrl: keys.httpBase || '', token: keys.httpToken || '' };
          default:            return { choice };
        }
      });
    };

    const seatSummaryText = (specs: any[]) =>
      specs.map((s, i) => {
        const nm = seatName(i);
        if (s.choice.startsWith('built-in')) return `${nm}=${choiceLabel(s.choice as BotChoice)}`;
        if (s.choice === 'http') return `${nm}=HTTP(${s.baseUrl ? 'custom' : 'default'})`;
        return `${nm}=${choiceLabel(s.choice as BotChoice)}(${s.model || defaultModelFor(s.choice as BotChoice)})`;
      }).join(', ');

    const markRoundFinishedIfNeeded = (
      nextFinished:number,
      nextAggStats: Score5[] | null,
      nextAggCount: number
    ) => {
      if (!roundFinishedRef.current) {
        if (!seenStatsRef.current) {
          const neutral: Score5 = { coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 };
          const mode = aggModeRef.current;
          const a    = alphaRef.current;
          if (!nextAggStats) {
            nextAggStats = [neutral, neutral, neutral];
            nextAggCount = 1;
          } else {
            nextAggStats = nextAggStats.map(prev => mergeScore(prev, neutral, mode, nextAggCount, a));
            nextAggCount = nextAggCount + 1;
          }
        }
        roundFinishedRef.current = true;
        nextFinished = nextFinished + 1;
      }
      return { nextFinished, nextAggStats, nextAggCount };
    };

    const playOneGame = async (_gameIndex: number, labelRoundNo: number) => {
    let lastEventTs = Date.now();
    const timeoutMs = (()=>{
      const arr = props.turnTimeoutSecs || [30,30,30];
      const norm = arr.map(x=> (Number.isFinite(x as any) && (x as any)>0 ? (x as any) : 30));
      const sec = Math.min(...norm);
      return Math.max(5000, sec*1000);
    })();
    let dogId: any = null;

      setLog([]); lastReasonRef.current = [null, null, null];
      const baseSpecs = buildSeatSpecs();
      const startShift = ((labelRoundNo - 1) % 3 + 3) % 3;
      const specs = [0,1,2].map(i => baseSpecs[(i + startShift) % 3]);
      const toUiSeat = (j:number) => (j + startShift) % 3;
      const remap3 = <T,>(arr: T[]) => ([ arr[(0 - startShift + 3) % 3], arr[(1 - startShift + 3) % 3], arr[(2 - startShift + 3) % 3] ]) as T[];
      const traceId = Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36);
      setLog(l => [...l, `【前端】开始第 ${labelRoundNo} 局 | 座位: ${seatSummaryText(baseSpecs)} | coop=${props.farmerCoop ? 'on' : 'off'} | trace=${traceId}`]);

      roundFinishedRef.current = false;
      seenStatsRef.current = false;

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rounds: 1,
          startScore: props.startScore,
          seatDelayMs: props.seatDelayMs,
          enabled: props.enabled,
          rob: props.rob,
          four2: props.four2,
          seats: specs,
          clientTraceId: traceId,
          stopBelowZero: true,
          farmerCoop: props.farmerCoop,
        turnTimeoutSec: (props.turnTimeoutSecs ?? [30,30,30])
        }),
        signal: controllerRef.current!.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      dogId = setInterval(() => {
        if (Date.now() - lastEventTs > timeoutMs) {
          setLog(l => [...l, `⏳ 超过 ${Math.round(timeoutMs/1000)}s 未收到事件，已触发前端提示（后端会按规则自动"过"或出最小牌），继续等待…`]);
          lastEventTs = Date.now(); // 防止重复提示
        }
      }, 1000);
    
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      const rewrite = makeRewriteRoundLabel(labelRoundNo);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        const batch: any[] = [];
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try { batch.push(JSON.parse(line)); } catch {}
        }

        if (batch.length) {
          let nextHands = handsRef.current.map(x => [...x]);
          let nextPlays = [...playsRef.current];
          let nextTotals = [...totalsRef.current] as [number, number, number];
          let nextFinished = finishedRef.current;
          let nextLog = [...logRef.current];
          let nextLandlord = landlordRef.current;
          let nextWinner = winnerRef.current as number | null;
          let nextDelta = deltaRef.current as [number, number, number] | null;
          let nextMultiplier = multiplierRef.current;
          let nextAggStats = aggStatsRef.current;
          let nextAggCount = aggCountRef.current;

          
          let nextScores = scoreSeriesRef.current.map(x => [...x]);
          let sawAnyTurn = false;
          let nextCuts = roundCutsRef.current.slice();
          let nextLords = roundLordsRef.current.slice();
for (const raw of batch) {
            let m: any = raw;
            // Remap engine->UI indices when startShift != 0
            if (startShift) {
              const mapMsg = (obj:any)=>{
                const out:any = { ...obj };
                const mapSeat = (x:any)=> (typeof x==='number' ? toUiSeat(x) : x);
                const mapArr = (a:any)=> (Array.isArray(a) && a.length===3 ? remap3(a) : a);
                out.seat = mapSeat(out.seat);
                if ('landlordIdx' in out) out.landlordIdx = mapSeat(out.landlordIdx);
                if ('landlord' in out) out.landlord = mapSeat(out.landlord);
                if ('winner' in out) out.winner = mapSeat(out.winner);
                if ('hands' in out) out.hands = mapArr(out.hands);
                if ('totals' in out) out.totals = mapArr(out.totals);
                if ('delta' in out) out.delta = mapArr(out.delta);
                if ('ratings' in out) out.ratings = mapArr(out.ratings);
                if (out.payload) {
                  const p:any = { ...out.payload };
                  if ('seat' in p) p.seat = mapSeat(p.seat);
                  if ('landlord' in p) p.landlord = mapSeat(p.landlord);
                  if ('hands' in p) p.hands = mapArr(p.hands);
                  if ('totals' in p) p.totals = mapArr(p.totals);
                  out.payload = p;
                }
                return out;
              };
              m = mapMsg(m);
            }

            // 处理消息类型
            if (m.type === 'landlord') {
              nextLandlord = m.landlord;
              setLandlord(nextLandlord);
              nextLog = [...nextLog, `【${seatName(nextLandlord)}】成为地主`];
            } else if (m.type === 'hands') {
              nextHands = m.hands;
              setHands(nextHands);
            } else if (m.type === 'play') {
              const seat = m.seat;
              const cards = m.cards || [];
              const reason = m.reason || '';
              nextPlays = [...nextPlays, { seat, move: 'play', cards, reason }];
              setPlays(nextPlays);
              lastReasonRef.current[seat] = reason;
              nextLog = [...nextLog, `【${seatName(seat)}】出牌 ${cards.join(', ')}${reason ? ` (${reason})` : ''}`];
            } else if (m.type === 'pass') {
              const seat = m.seat;
              const reason = m.reason || '';
              nextPlays = [...nextPlays, { seat, move: 'pass', reason }];
              setPlays(nextPlays);
              lastReasonRef.current[seat] = reason;
              nextLog = [...nextLog, `【${seatName(seat)}】过${reason ? ` (${reason})` : ''}`];
            } else if (m.type === 'multiplier') {
              nextMultiplier = m.multiplier;
              setMultiplier(nextMultiplier);
              nextLog = [...nextLog, `倍数更新为 ${nextMultiplier}`];
            } else if (m.type === 'round-end') {
              nextWinner = m.winner;
              nextDelta = m.delta;
              setWinner(nextWinner);
              setDelta(nextDelta);
              nextTotals = m.totals;
              setTotals(nextTotals);
              nextLog = [...nextLog, `【对局结束】${seatName(nextWinner)} 获胜，积分变化 ${nextDelta?.join(', ')}`];
              
              // 更新 TrueSkill
              if (nextWinner !== null && nextDelta && nextLandlord !== null) {
                const teamA = [nextLandlord];
                const teamB = [0,1,2].filter(i => i !== nextLandlord);
                const newRatings = [...tsRef.current];
                tsUpdateTwoTeams(newRatings, teamA, teamB);
                setTsArr(newRatings);
                updateStoreAfterRound(newRatings, nextLandlord);
                
                // 更新天梯积分
                const ids = [0,1,2].map(seatIdentity);
                const labels = [0,1,2].map(agentIdForIndex);
                const winTeam = (nextWinner === nextLandlord) ? 0 : 1;
                const expA = tsCr(tsRef.current[nextLandlord]);
                const expB = teamB.reduce((sum, i) => sum + tsCr(tsRef.current[i]), 0) / teamB.length;
                const sWin = winTeam === 0 ? 1 : 0;
                const pExp = winTeam === 0 ? expA : expB;
                const weight = nextMultiplier;
                ladderUpdateLocal(ids[nextLandlord], labels[nextLandlord], sWin, pExp, weight);
                for (const i of teamB) {
                  ladderUpdateLocal(ids[i], labels[i], 1-sWin, 1-pExp, weight);
                }
              }
              
              // 标记本局结束
              roundFinishedRef.current = true;
              nextFinished = nextFinished + 1;
              setFinishedCount(nextFinished);
            } else if (m.type === 'score') {
              const seat = m.seat;
              const score = m.score;
              if (typeof score === 'number' && seat >= 0 && seat < 3) {
                nextScores[seat].push(score);
                sawAnyTurn = true;
              }
            } else if (m.type === 'round-stats') {
              const s3 = m.scores as Score5[];
              if (Array.isArray(s3) && s3.length === 3) {
                nextAggStats = s3;
                nextAggCount = nextAggCount + 1;
                seenStatsRef.current = true;
                updateRadarStoreFromStats(s3, nextLandlord);
              }
            } else if (m.type === 'log') {
              const text = rewrite(m.text || '');
              nextLog = [...nextLog, text];
            }
          }

          // 更新状态
          if (sawAnyTurn) {
            setScoreSeries(nextScores);
          }
          if (nextCuts !== roundCutsRef.current) {
            setRoundCuts(nextCuts);
          }
          if (nextLords !== roundLordsRef.current) {
            setRoundLords(nextLords);
          }
          if (nextAggStats !== aggStatsRef.current) {
            setAggStats(nextAggStats);
          }
          if (nextAggCount !== aggCountRef.current) {
            setAggCount(nextAggCount);
          }
          setLog(nextLog);
          lastEventTs = Date.now();
        }
      }

      if (dogId) clearInterval(dogId);
    };

    // 运行多局
    try {
      for (let i = 0; i < props.rounds; i++) {
        if (!running) break;
        await playOneGame(i, i + 1);
      }
    } catch (err: any) {
      setLog(l => [...l, `【错误】${err.message || String(err)}`]);
    } finally {
      setRunning(false);
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    }
  };

  const stop = () => {
    if (!running) return;
    setRunning(false);
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={running ? stop : start} style={{ padding: '8px 16px' }}>
          {running ? '停止' : '开始'}
        </button>
        <div style={{ fontSize: 14, color: '#666' }}>
          已完成 {finishedCount} / {props.rounds} 局
        </div>
      </div>

      <Section title="当前状态">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                <SeatTitle i={i} />
                {landlord === i && <span style={{ marginLeft: 8, color: '#dc2626' }}>地主</span>}
                {winner === i && <span style={{ marginLeft: 8, color: '#16a34a' }}>获胜</span>}
              </div>
              <div style={{ marginBottom: 8 }}>
                <Hand cards={hands[i]} />
              </div>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
                积分: {totals[i]}
              </div>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
                TrueSkill: μ={tsArr[i].mu.toFixed(2)} σ={tsArr[i].sigma.toFixed(2)}
              </div>
              <div style={{ fontSize: 14, color: '#666' }}>
                {choiceLabel(props.seats[i])}
                {props.seatModels[i] && ` (${props.seatModels[i]})`}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="出牌记录">
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {plays.length === 0 ? (
            <div style={{ color: '#666', padding: 8 }}>暂无出牌记录</div>
          ) : (
            plays.map((play, idx) => (
              <PlayRow
                key={idx}
                seat={play.seat}
                move={play.move}
                cards={play.cards}
                reason={play.reason}
              />
            ))
          )}
        </div>
      </Section>

      <Section title="日志">
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {log.length === 0 ? (
            <div style={{ color: '#666', padding: 8 }}>暂无日志</div>
          ) : (
            log.map((line, idx) => (
              <LogLine key={idx} text={line} />
            ))
          )}
        </div>
      </Section>

      <Section title="天梯图">
        <LadderPanel />
      </Section>

      <Section title="TrueSkill 存档">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={handleRefreshApply}>刷新应用</button>
          <button onClick={handleSaveArchive}>导出存档</button>
          <input
            type="file"
            ref={fileRef}
            style={{ display: 'none' }}
            onChange={handleUploadFile}
            accept=".json"
          />
          <button onClick={() => fileRef.current?.click()}>上传存档</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[0, 1, 2].map(i => {
            const stored = getStoredForSeat(i);
            return (
              <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  <SeatTitle i={i} />
                </div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                  总体: {muSig(stored.overall)}
                </div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                  地主: {muSig(stored.landlord)}
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  农民: {muSig(stored.farmer)}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="雷达图存档">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={handleRadarRefresh}>刷新应用</button>
          <button onClick={handleRadarSave}>导出存档</button>
          <input
            type="file"
            ref={radarFileRef}
            style={{ display: 'none' }}
            onChange={handleRadarUpload}
            accept=".json"
          />
          <button onClick={() => radarFileRef.current?.click()}>上传存档</button>
        </div>
        <div style={{ fontSize: 14, color: '#666' }}>
          当前累计: {aggCount} 局
        </div>
      </Section>

      <Section title="评分统计">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={handleStatsRefresh}>刷新统计</button>
          <button onClick={handleStatsSave}>导出统计</button>
          <input
            type="file"
            ref={statsFileRef}
            style={{ display: 'none' }}
            onChange={handleStatsUpload}
            accept=".json"
          />
          <button onClick={() => statsFileRef.current?.click()}>上传统计</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                <SeatTitle i={i} />
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                局数: {scoreStats[i].rounds}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                平均分: {scoreStats[i].overallAvg.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                最高分: {scoreStats[i].best.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                最低分: {scoreStats[i].worst.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>
                标准差: {scoreStats[i].sigma.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="出牌评分">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={handleScoreRefresh}>刷新评分</button>
          <button onClick={handleScoreSave}>导出评分</button>
          <input
            type="file"
            ref={scoreFileRef}
            style={{ display: 'none' }}
            onChange={handleScoreUpload}
            accept=".json"
          />
          <button onClick={() => scoreFileRef.current?.click()}>上传评分</button>
        </div>
        <div style={{ fontSize: 14, color: '#666' }}>
          当前手数: {Math.max(
            scoreSeries[0]?.length || 0,
            scoreSeries[1]?.length || 0,
            scoreSeries[2]?.length || 0
          )}
        </div>
      </Section>
    </div>
  );
}

export default LivePanel;