// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react';

type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

/* ========= TrueSkill（前端轻量实现，1v2：地主 vs 两农民） ========= */
type Rating = { mu:number; sigma:number };
const TS_DEFAULT: Rating = { mu:25, sigma:25/3 };
const TS_BETA = 25/6;
const TS_TAU  = 25/300;           // 轻度动态因子，赛季内可保留
const SQRT2 = Math.sqrt(2);

// 误差函数近似
function erf(x:number){ const s=Math.sign(x); const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const t=1/(1+p*Math.abs(x)); const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x); return s*y; }
function phi(x:number){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function Phi(x:number){ return 0.5*(1+erf(x/SQRT2)); }
function V_exceeds(t:number){ const d=Math.max(1e-12,Phi(t)); return phi(t)/d; }
function W_exceeds(t:number){ const v=V_exceeds(t); return v*(v+t); }

// TrueSkill 团队A(胜) vs 团队B(负) 更新
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

/* ========= TrueSkill 记录簿（导入/导出） ========= */
type Role = 'L'|'F';
type TSBookEntry = {
  label: string;
  L: Rating & { games?: number };
  F: Rating & { games?: number };
  overallCR?: number;           // 展示/导出使用，更新时不作为先验来源
  updatedAt?: string;
};
type TSBook = Record<string, TSBookEntry>;

// 目前支持的“参赛体”模板（含默认模型）
const SUPPORTED_DEFAULT_IDS = [
  'built-in:greedy-max',
  'built-in:greedy-min',
  'built-in:random-legal',
  'ai:openai:gpt-4o-mini',
  'ai:gemini:gemini-1.5-flash',
  'ai:grok:grok-2',
  'ai:grok:grok-2-latest',
  'ai:kimi:kimi-k2-0905-preview',
  'ai:qwen:qwen-plus',
  'http:default',
];

function labelForId(id:string): string {
  if (id.startsWith('built-in:')) {
    const m = id.split(':')[1];
    if (m === 'greedy-max') return 'Greedy Max';
    if (m === 'greedy-min') return 'Greedy Min';
    if (m === 'random-legal') return 'Random Legal';
    return id;
  }
  if (id.startsWith('ai:')) {
    const [_, prov, model] = id.split(':');
    const name = prov==='openai'?'OpenAI':prov==='gemini'?'Gemini':prov==='grok'?'Grok':prov==='kimi'?'Kimi':prov==='qwen'?'Qwen':prov;
    return `${name}(${model})`;
  }
  if (id.startsWith('http:')) return 'HTTP(' + id.slice(5) + ')';
  return id;
}
function makeEmptyEntry(label:string): TSBookEntry {
  return {
    label,
    L: { ...TS_DEFAULT, games:0 },
    F: { ...TS_DEFAULT, games:0 },
    overallCR: 0,
    updatedAt: new Date().toISOString(),
  };
}
function computeOverall(entry: TSBookEntry): number {
  const crL = entry.L.mu - 3*entry.L.sigma;
  const crF = entry.F.mu - 3*entry.F.sigma;
  return 0.5*crL + 0.5*crF;
}

/* ====== UI 及牌面渲染 ====== */
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
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string;
    httpBase?: string; httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;

  // TrueSkill 记录簿读写
  getTSRating?: (id:string, role:Role) => Rating | null;
  onTSApply?: (updates: {id:string; role:Role; rating: Rating}[], meta:{landlord:number; farmerIdxs:number[]; seatIds:string[]; round:number}) => void;

  // 暴露一个“刷新先验”的函数给父组件（导入后手动刷新）
  exposeRefresh?: (fn: ()=>void) => void;
};

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
    default: return '';
  }
}
function choiceLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max': return 'Greedy Max';
    case 'built-in:greedy-min': return 'Greedy Min';
    case 'built-in:random-legal': return 'Random Legal';
    case 'ai:openai': return 'OpenAI';
    case 'ai:gemini': return 'Gemini';
    case 'ai:grok':  return 'Grok';
    case 'ai:kimi':  return 'Kimi';
    case 'ai:qwen':  return 'Qwen';
    case 'http':     return 'HTTP';
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
function RadarChart({ title, scores }:{ title: string; scores: Score5; }) {
  const vals = [scores.coop, scores.agg, scores.cons, scores.eff, scores.rob];
  const size = 180, R = 70, cx = size/2, cy = size/2;
  const pts = vals.map((v, i)=>{
    const ang = (-90 + i*(360/5)) * Math.PI/180;
    const r = (Math.max(0, Math.min(5, v)) / 5) * R;
    return `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
  }).join(' ');
  return (
    <div style={{ border:'1px solid #eee', borderRadius:8, padding:8 }}>
      <div style={{ fontWeight:700, marginBottom:6 }}>{title}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {[1,2,3,4,5].map(k=>{
          const r = (k/5)*R;
          const polygon = Array.from({length:5}, (_,i)=>{
            const ang = (-90 + i*(360/5)) * Math.PI/180;
            return `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
          }).join(' ');
          return <polygon key={k} points={polygon} fill="none" stroke="#e5e7eb"/>;
        })}
        {Array.from({length:5}, (_,i)=>{
          const ang = (-90 + i*(360/5)) * Math.PI/180;
          return <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(ang)} y2={cy + R * Math.sin(ang)} stroke="#e5e7eb"/>;
        })}
        <polygon points={pts} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={2}/>
        {(['配合','激进','保守','效率','抢地主']).map((lab, i)=>{
          const ang = (-90 + i*(360/5)) * Math.PI/180;
          return <text key={i} x={cx + (R+14) * Math.cos(ang)} y={cy + (R+14) * Math.sin(ang)} fontSize="12" textAnchor="middle" dominantBaseline="middle" fill="#374151">{lab}</text>;
        })}
      </svg>
      <div style={{ fontSize:12, color:'#6b7280' }}>
        分数（0~5）：Coop {scores.coop} / Agg {scores.agg} / Cons {scores.cons} / Eff {scores.eff} / Rob {scores.rob}
      </div>
    </div>
  );
}

/* ---------- 文本改写：把“第 x 局”固定到本局 ---------- */
const makeRewriteRoundLabel = (n: number) => (msg: string) => {
  if (typeof msg !== 'string') return msg;
  let out = msg;
  out = out.replace(/第\s*\d+\s*局开始/g, `第 ${n} 局开始`);
  out = out.replace(/开始第\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始第\s*\d+\s*局\(/g,  `开始第 ${n} 局(`);
  out = out.replace(/开始连打\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始连打\s*\d+\\s*局\(/g,  `开始第 ${n} 局(`);
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

  // —— TrueSkill（前端实时） —— //
  const [tsArr, setTsArr] = useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
  const tsRef = useRef(tsArr); useEffect(()=>{ tsRef.current=tsArr; }, [tsArr]);
  const tsCr = (r:Rating)=> (r.mu - 3*r.sigma);

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

  // 本局是否已从记录簿载入过 TS 先验（用于屏蔽后端 before-round 覆盖）
  const appliedTSFromBookRef = useRef(false);

  // 本局参赛体 ID 列表（用于把 TS 更新写回记录簿）
  const seatIdsRef = useRef<string[]>([]);

  // 每局观测标记 —— 是否已计结束、是否收到 stats
  const roundFinishedRef = useRef<boolean>(false);
  const seenStatsRef     = useRef<boolean>(false);

  const fmt2 = (x:number)=> (Math.round(x*100)/100).toFixed(2);

  // 规范化参赛体 ID
  const idFromSpec = (s:any): string => {
    if (s.choice === 'http') {
      const base = (s.baseUrl || 'default').trim().toLowerCase();
      return `http:${base||'default'}`;
    }
    if (String(s.choice||'').startsWith('ai:')) {
      const choice = String(s.choice||'').toLowerCase();
      const model  = (s.model || '').trim() || defaultModelFor(s.choice as BotChoice);
      return `${choice}:${model.toLowerCase()}`;
    }
    return String(s.choice||'');
  };

  // ★ 刷新先验：支持“未发牌预览(F口径)”和“已发牌按真实角色(L/F)”
  const refreshTSFromBook = () => {
    if (!props.getTSRating) {
      setLog(l => [...l, '【TS】未配置记录簿读取函数 getTSRating。']);
      return;
    }
    const lord = landlordRef.current;

    if (lord == null) {
      // ① 未发牌：按当前三家选择生成 ID，临时以“农民(F)”口径载入预览
      const preSpecs = props.seats.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        return choice === 'http'
          ? { choice, baseUrl: keys.httpBase || '' }
          : { choice, model };
      });
      const ids = preSpecs.map(idFromSpec);
      const initR: Rating[] = [0,1,2].map(i => props.getTSRating!(ids[i], 'F') || TS_DEFAULT);
      setTsArr(initR);
      setLog(l => [...l, '【TS】手动刷新先验（预览）：尚未确定地主，按农民(F)口径载入。']);
      return;
    }

    // ② 已发牌：按真实角色(L/F)精确载入
    const ids = seatIdsRef.current;
    const initR: Rating[] = [0,1,2].map(i => {
      const role: Role = (i===lord)?'L':'F';
      return props.getTSRating!(ids[i], role) || TS_DEFAULT;
    });
    setTsArr(initR);
    appliedTSFromBookRef.current = true;

    const hitFlags = [0,1,2].map(i=>{
      const role: Role = (i===lord)?'L':'F';
      return props.getTSRating!(ids[i], role) ? '命中' : '默认';
    });
    setLog(l => [...l, `【TS】手动刷新先验：` +
      `${['甲','乙','丙'].map((n,i)=>`${n}(${i===lord?'L':'F'}):${hitFlags[i]}`).join(' ｜ ')}`]);
  };
  useEffect(()=>{ props.exposeRefresh?.(refreshTSFromBook); }, [props.exposeRefresh]);

  const start = async () => {
    if (running) return;
    if (!props.enabled) { setLog(l => [...l, '【前端】未启用对局：请在设置中勾选“启用对局”。']); return; }

    setRunning(true);
    setLandlord(null); setHands([[], [], []]); setPlays([]);
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null); setAggCount(0);

    // TrueSkill：每次“开始”重置 UI 实时值
    setTsArr([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);

    controllerRef.current = new AbortController();

    const buildSeatSpecs = (): any[] => {
      return props.seats.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai': return { choice, model, apiKey: keys.openai || '' };
          case 'ai:gemini': return { choice, model, apiKey: keys.gemini || '' };
          case 'ai:grok':   return { choice, model, apiKey: keys.grok || '' };
          case 'ai:kimi':   return { choice, model, apiKey: keys.kimi || '' };
          case 'ai:qwen':   return { choice, model, apiKey: keys.qwen || '' };
          case 'http':      return { choice, model, baseUrl: keys.httpBase || '', token: keys.httpToken || '' };
          default:          return { choice };
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
      setLog([]); lastReasonRef.current = [null, null, null];
      const specs = buildSeatSpecs();
      const traceId = Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36);
      setLog(l => [...l, `【前端】开始第 ${labelRoundNo} 局 | 座位: ${seatSummaryText(specs)} | coop=${props.farmerCoop ? 'on' : 'off'} | trace=${traceId}`]);

      // 新一局：重置标记
      roundFinishedRef.current = false;
      seenStatsRef.current = false;
      appliedTSFromBookRef.current = false;

      // 记录本局参赛体 ID 列表
      seatIdsRef.current = specs.map(idFromSpec);

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
        }),
        signal: controllerRef.current!.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
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

          for (const raw of batch) {
            const m: any = raw;
            try {
              if (m.type === 'ts' && Array.isArray(m.ratings) && m.ratings.length === 3) {
                const incoming: Rating[] = m.ratings.map((r:any)=>({ mu:Number(r.mu)||25, sigma:Number(r.sigma)||25/3 }));
                if (m.where === 'before-round' && appliedTSFromBookRef.current) {
                  nextLog = [...nextLog, `【TS】忽略后端 before-round 覆盖（已用导入先验）`];
                } else {
                  setTsArr(incoming);
                }

                if (m.where === 'after-round') {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                  nextLog = [...nextLog, `【TS】after-round 已更新 μ/σ`];
                } else if (m.where === 'before-round') {
                  nextLog = [...nextLog, `【TS】before-round μ/σ 准备就绪`];
                }
                continue;
              }

              if (m.type === 'event' && m.kind === 'round-start') {
                nextLog = [...nextLog, `【边界】round-start #${m.round}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'round-end') {
                nextLog = [...nextLog, `【边界】round-end #${m.round}`];
                const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                continue;
              }

              const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
              const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);
              if (hasHands) {
                nextPlays = []; nextWinner = null; nextDelta = null; nextMultiplier = 1;
                const decorated: string[][] = (rh as string[][]).map(decorateHandCycle);
                nextHands = decorated;
                const lord = m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
                nextLandlord = lord;
                nextLog = [...nextLog, `发牌完成，${lord != null ? seatName(lord) : '?'}为地主`];
                lastReasonRef.current = [null, null, null];

                if (lord != null && props.getTSRating) {
                  const ids = seatIdsRef.current;
                  const initR: Rating[] = [0,1,2].map(i=>{
                    const role: Role = (i===lord)?'L':'F';
                    return props.getTSRating!(ids[i], role) || TS_DEFAULT;
                  });
                  setTsArr(initR);
                  appliedTSFromBookRef.current = true;
                  const hitFlags = [0,1,2].map(i=>{
                    const role: Role = (i===lord)?'L':'F';
                    return props.getTSRating!(ids[i], role) ? '命中' : '默认';
                  });
                  nextLog = [...nextLog,
                    `【TS】载入先验（精确匹配）：` +
                    `${['甲','乙','丙'].map((n,i)=>`${n}(${i===lord?'L':'F'}):${hitFlags[i]}`).join(' ｜ ')}`
                  ];
                }

                continue;
              }

              if (m.type === 'event' && m.kind === 'bot-call') {
                nextLog = [...nextLog, `AI调用｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜阶段=${m.phase || 'unknown'}${m.need ? `｜需求=${m.need}` : ''}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'bot-done') {
                nextLog = [
                  ...nextLog,
                  `AI完成｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜耗时=${m.tookMs}ms`,
                  ...(m.reason ? [`AI理由｜${seatName(m.seat)}：${m.reason}`] : []),
                ];
                lastReasonRef.current[m.seat] = m.reason || null;
                continue;
              }

              if (m.type === 'event' && m.kind === 'rob') {
                nextLog = [...nextLog, `${seatName(m.seat)} ${m.rob ? '抢地主' : '不抢'}`];
                continue;
              }

              if (m.type === 'event' && m.kind === 'trick-reset') {
                nextLog = [...nextLog, '一轮结束，重新起牌'];
                nextPlays = [];
                continue;
              }

              if (m.type === 'event' && m.kind === 'play') {
                if (m.move === 'pass') {
                  const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                  lastReasonRef.current[m.seat] = null;
                  nextPlays = [...nextPlays, { seat: m.seat, move: 'pass', reason }];
                  nextLog = [...nextLog, `${seatName(m.seat)} 过${reason ? `（${reason}）` : ''}`];
                } else {
                  const pretty: string[] = [];
                  const seat = m.seat as number;
                  const cards: string[] = m.cards || [];
                  const nh = (nextHands && (nextHands as any[]).length === 3 ? nextHands : [[], [], []]).map((x: any) => [...x]);
                  for (const rawCard of cards) {
                    const options = candDecorations(rawCard);
                    const chosen = options.find((d: string) => nh[seat].includes(d)) || options[0];
                    const k = nh[seat].indexOf(chosen);
                    if (k >= 0) nh[seat].splice(k, 1);
                    pretty.push(chosen);
                  }
                  const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                  lastReasonRef.current[m.seat] = null;

                  nextHands = nh;
                  nextPlays = [...nextPlays, { seat: m.seat, move: 'play', cards: pretty, reason }];
                  nextLog = [...nextLog, `${seatName(m.seat)} 出牌：${pretty.join(' ')}${reason ? `（理由：${reason}）` : ''}`];
                }
                continue;
              }

              const isWinLike =
                (m.type === 'event' && (m.kind === 'win' || m.kind === 'result' || m.kind === 'game-over' || m.kind === 'game_end')) ||
                (m.type === 'result') || (m.type === 'game-over') || (m.type === 'game_end');
              if (isWinLike) {
                const L = (nextLandlord ?? 0) as number;
                const ds = (Array.isArray(m.deltaScores) ? m.deltaScores
                          : Array.isArray(m.delta) ? m.delta
                          : [0,0,0]) as [number,number,number];

                const rot: [number,number,number] = [
                  ds[(0 - L + 3) % 3],
                  ds[(1 - L + 3) % 3],
                  ds[(2 - L + 3) % 3],
                ];
                let nextWinnerLocal = m.winner ?? nextWinner ?? null;
                nextMultiplier = m.multiplier ?? nextMultiplier ?? 1;
                nextDelta      = rot;
                nextTotals     = [
                  nextTotals[0] + rot[0],
                  nextTotals[1] + rot[1],
                  nextTotals[2] + rot[2]
                ] as any;

                if (nextWinnerLocal == null) {
                  const landlordDelta = ds[0] ?? 0;
                  if (landlordDelta > 0) nextWinnerLocal = L;
                  else if (landlordDelta < 0) {
                    const farmer = [0,1,2].find(x => x !== L)!;
                    nextWinnerLocal = farmer;
                  }
                }
                nextWinner = nextWinnerLocal;

                {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                }

                const updated = tsRef.current.map(r => ({ ...r }));
                const farmers = [0,1,2].filter(s => s !== L);
                const landlordDelta = ds[0] ?? 0;
                const landlordWin = (nextWinnerLocal === L) || (landlordDelta > 0);
                if (landlordWin) tsUpdateTwoTeams(updated, [L], farmers);
                else             tsUpdateTwoTeams(updated, farmers, [L]);
                setTsArr(updated);

                if (props.onTSApply) {
                  const ids = seatIdsRef.current;
                  const ups = [
                    { id: ids[L], role:'L' as Role, rating: updated[L] },
                    { id: ids[farmers[0]], role:'F' as Role, rating: updated[farmers[0]] },
                    { id: ids[farmers[1]], role:'F' as Role, rating: updated[farmers[1]] },
                  ];
                  props.onTSApply(ups, { landlord:L, farmerIdxs:farmers, seatIds:ids, round:labelRoundNo });
                }

                nextLog = [
                  ...nextLog,
                  `TS(局后)：甲 μ=${fmt2(updated[0].mu)} σ=${fmt2(updated[0].sigma)}｜乙 μ=${fmt2(updated[1].mu)} σ=${fmt2(updated[1].sigma)}｜丙 μ=${fmt2(updated[2].mu)} σ=${fmt2(updated[2].sigma)}`
                ];
                nextLog = [
                  ...nextLog,
                  `胜者：${nextWinnerLocal == null ? '—' : seatName(nextWinnerLocal)}，倍数 x${nextMultiplier}，当局积分（按座位） ${rot.join(' / ')}｜原始（相对地主） ${ds.join(' / ')}｜地主=${seatName(L)}`
                ];
                continue;
              }

              const isStatsTop = (m.type === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats)));
              const isStatsEvt = (m.type === 'event' && m.kind === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats)));
              if (isStatsTop || isStatsEvt) {
                seenStatsRef.current = true;
                const arr = (m.perSeat ?? m.seats) as any[];
                const s3 = [0,1,2].map(i=>{
                  const rec = arr.find((x:any)=>x.seat===i || x.index===i);
                  const sc = rec?.scaled || rec?.score || {};
                  return {
                    coop: Number(sc.coop ?? 2.5),
                    agg : Number(sc.agg  ?? 2.5),
                    cons: Number(sc.cons ?? 2.5),
                    eff : Number(sc.eff  ?? 2.5),
                    rob : Number(sc.rob  ?? 2.5),
                  };
                }) as Score5[];

                const mode  = aggModeRef.current;
                const a     = alphaRef.current;

                if (!nextAggStats) {
                  nextAggStats = s3.map(x=>({ ...x }));
                  nextAggCount = 1;
                } else {
                  nextAggStats = nextAggStats.map((prev, idx) => mergeScore(prev, s3[idx], mode, nextAggCount, a));
                  nextAggCount = nextAggCount + 1;
                }

                const msg = s3.map((v, i)=>`${seatName(i)}：Coop ${v.coop}｜Agg ${v.agg}｜Cons ${v.cons}｜Eff ${v.eff}｜Rob ${v.rob}`).join(' ｜ ');
                nextLog = [...nextLog, `战术画像（本局）：${msg}（已累计 ${nextAggCount} 局）`];
                continue;
              }

              if (m.type === 'log' && typeof m.message === 'string') {
                nextLog = [...nextLog, rewrite(m.message)];
                continue;
              }
            } catch (e) { console.error('[ingest:batch]', e, raw); }
          }

          setHands(nextHands); setPlays(nextPlays);
          setTotals(nextTotals); setFinishedCount(nextFinished);
          setLog(nextLog); setLandlord(nextLandlord);
          setWinner(nextWinner); setMultiplier(nextMultiplier); setDelta(nextDelta);
          setAggStats(nextAggStats || null); setAggCount(nextAggCount || 0);
        }
      }

      setLog(l => [...l, `—— 本局流结束 ——`]);
    };

  try {
      for (let i = 0; i < props.rounds; i++) {
        if (controllerRef.current?.signal.aborted) break;
        const thisRound = i + 1;
        await playOneGame(i, thisRound);

        const hasNegative = Array.isArray(totalsRef.current) && totalsRef.current.some(v => (v as number) < 0);
        if (hasNegative) { setLog(l => [...l, '【前端】检测到总分 < 0，停止连打。']); break; }
        await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 600)));
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') setLog(l => [...l, '已手动停止。']);
      else setLog(l => [...l, `错误：${e?.message || e}`]);
    } finally { setRunning(false); }
  };

  const stop = () => { controllerRef.current?.abort(); setRunning(false); };

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* ========= TrueSkill（实时） ========= */}
      <Section title="TrueSkill（实时）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <div><SeatTitle i={i}/> {landlord===i && <span style={{ marginLeft:6, color:'#bf7f00' }}>（地主）</span>}</div>
              </div>
              <div style={{ fontSize:13, color:'#374151' }}>
                <div>μ：<b>{fmt2(tsArr[i].mu)}</b></div>
                <div>σ：<b>{fmt2(tsArr[i].sigma)}</b></div>
                <div>CR = μ − 3σ：<b>{fmt2(tsCr(tsArr[i]))}</b></div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize:12, color:'#6b7280', marginTop:6 }}>
          说明：CR 为置信下界（越高越稳）；每局结算后自动更新（也兼容后端直接推送 TS）。</div>
      </Section>

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

      {/* ======= 积分下面、手牌上面：雷达图 ======= */}
      <Section title="战术画像（累计，0~5）">
        <RadarPanel
          aggStats={aggStats}
          aggCount={aggCount}
          aggMode={aggMode}
          alpha={alpha}
          onChangeMode={setAggMode}
          onChangeAlpha={setAlpha}
        />
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
            : plays.map((p, idx) => <PlayRow key={idx} seat={p.seat} move={p.move} cards={p.cards} reason={p.reason} />)
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
            <div style={{ fontSize:24, fontWeight:800 }}>{winner == null ? '—' : seatName(winner)}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>本局加减分</div>
            <div style={{ fontSize:20, fontWeight:700 }}>{delta ? delta.join(' / ') : '—'}</div>
          </div>
        </div>
      </Section>

      <div style={{ display:'flex', gap:8 }}>
        <button onClick={start} style={{ padding:'8px 12px', borderRadius:8, background:'#222', color:'#fff' }}>开始</button>
        <button onClick={stop} style={{ padding:'8px 12px', borderRadius:8 }}>停止</button>
      </div>

      <div style={{ marginTop:18 }}>
        <Section title="运行日志">
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px', maxHeight:420, overflow:'auto', background:'#fafafa' }}>
            {log.length === 0 ? <div style={{ opacity:0.6 }}>（暂无）</div> : log.map((t, idx) => <LogLine key={idx} text={t} />)}
          </div>
        </Section>
      </div>
    </div>
  );
}

function RadarPanel({
  aggStats, aggCount, aggMode, alpha,
  onChangeMode, onChangeAlpha,
}:{ aggStats: Score5[] | null; aggCount: number; aggMode:'mean'|'ewma'; alpha:number;
   onChangeMode:(m:'mean'|'ewma')=>void; onChangeAlpha:(a:number)=>void; }) {
  const [mode, setMode] = useState<'mean'|'ewma'>(aggMode);
  const [a, setA] = useState<number>(alpha);

  useEffect(()=>{ setMode(aggMode); }, [aggMode]);
  useEffect(()=>{ setA(alpha); }, [alpha]);

  return (
    <>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:8 }}>
        <label>
          汇总方式
          <select value={mode} onChange={e=>{ const v=e.target.value as ('mean'|'ewma'); setMode(v); onChangeMode(v); }} style={{ marginLeft:6 }}>
            <option value="ewma">指数加权（推荐）</option>
            <option value="mean">简单平均</option>
          </select>
        </label>
        {mode === 'ewma' && (
          <label>
            α（0.05–0.95）
            <input type="number" min={0.05} max={0.95} step={0.05}
              value={a}
              onChange={e=>{
                const v = Math.min(0.95, Math.max(0.05, Number(e.target.value)||0.35));
                setA(v); onChangeAlpha(v);
              }}
              style={{ width:80, marginLeft:6 }}
            />
          </label>
        )}
        <div style={{ fontSize:12, color:'#6b7280' }}>
          {mode==='ewma' ? '越大越看重最近几局' : `已累计 ${aggCount} 局`}
        </div>
      </div>

      {aggStats
        ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <RadarChart key={i} title={`${['甲','乙','丙'][i]}（累计）`} scores={aggStats[i]} />
            ))}
          </div>
        )
        : <div style={{ opacity:0.6 }}>（等待至少一局完成后生成累计画像）</div>
      }
    </>
  );
}

/* ========= 默认值（含“清空”按钮的重置） ========= */
const DEFAULTS = {
  enabled: true,
  rounds: 10,
  startScore: 100,
  rob: true,
  four2: 'both' as Four2Policy,
  farmerCoop: true,
  seatDelayMs: [1000,1000,1000] as number[],
  seats: ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'] as BotChoice[],
  seatModels: ['gpt-4o-mini','gemini-1.5-flash','grok-2-latest'],
  seatKeys: [{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }] as any[],
};

function Home() {
  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [rob, setRob] = useState<boolean>(DEFAULTS.rob);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState<boolean>(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const setSeatDelay = (i:number, v:number|string) => setSeatDelayMs(arr => { const n=[...arr]; n[i]=Math.max(0, Math.floor(Number(v)||0)); return n; });

  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState(DEFAULTS.seatKeys);

  const [liveLog, setLiveLog] = useState<string[]>([]);

  /* ===== TrueSkill 记录簿（导入/导出 & 赛后写回） ===== */
  const [tsBook, setTsBook] = useState<TSBook>({});
  const upsertEntry = (id:string) => {
    setTsBook(prev=>{
      if (prev[id]) return prev;
      const label = labelForId(id);
      return { ...prev, [id]: makeEmptyEntry(label) };
    });
  };

  const getTSRating = (id:string, role:Role): Rating | null => {
    const rec = tsBook[id];
    if (!rec) return null;
    return role==='L' ? { mu: rec.L.mu, sigma: rec.L.sigma } : { mu: rec.F.mu, sigma: rec.F.sigma };
  };

  const onTSApply = (updates: {id:string; role:Role; rating: Rating}[]) => {
    setTsBook(prev=>{
      const next: TSBook = { ...prev };
      const nowISO = new Date().toISOString();
      for (const u of updates) {
        if (!next[u.id]) next[u.id] = makeEmptyEntry(labelForId(u.id));
        if (u.role === 'L') {
          next[u.id].L = { ...next[u.id].L, mu: u.rating.mu, sigma: u.rating.sigma, games:(next[u.id].L.games||0)+1 };
        } else {
          next[u.id].F = { ...next[u.id].F, mu: u.rating.mu, sigma: u.rating.sigma, games:(next[u.id].F.games||0)+1 };
        }
        next[u.id].overallCR = computeOverall(next[u.id]);
        next[u.id].updatedAt = nowISO;
      }
      return next;
    });
  };

  const normalizeSeatId = (choice: BotChoice, modelRaw: string, keys:any): string => {
    if (choice === 'http') {
      const base = (keys?.httpBase || 'default').trim().toLowerCase();
      return `http:${base||'default'}`;
    }
    if (String(choice).startsWith('ai:')) {
      const model = (normalizeModelForProvider(choice, modelRaw) || defaultModelFor(choice)).toLowerCase();
      return `${String(choice).toLowerCase()}:${model}`;
    }
    return String(choice);
  };

  const makeTemplate = () => {
    const entries: TSBook = {};
    for (const id of SUPPORTED_DEFAULT_IDS) {
      entries[id] = makeEmptyEntry(labelForId(id));
      entries[id].overallCR = computeOverall(entries[id]);
    }
    setTsBook(entries);
  };
  const downloadJSON = (obj:any, filename:string) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const onDownloadTS = () => {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      params: { mu0: 25, sigma0: 25/3, beta: TS_BETA, tau: TS_TAU, drawProbability: 0 },
      entries: tsBook,
    };
    downloadJSON(payload, `trueskill_book_${Date.now()}.json`);
  };
  const onUploadTS = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result||'{}'));
        if (obj && obj.entries && typeof obj.entries === 'object') {
          const ent: TSBook = obj.entries;
          const cleaned: TSBook = {};
          Object.entries(ent).forEach(([id, e])=>{
            if (!e || typeof e !== 'object') return;
            const label = e.label || labelForId(id);
            const L = e.L && typeof e.L.mu==='number' && typeof e.L.sigma==='number' ? { mu:e.L.mu, sigma:e.L.sigma, games:e.L.games||0 } : { ...TS_DEFAULT, games:0 };
            const F = e.F && typeof e.F.mu==='number' && typeof e.F.sigma==='number' ? { mu:e.F.mu, sigma:e.F.sigma, games:e.F.games||0 } : { ...TS_DEFAULT, games:0 };
            cleaned[id] = { label, L, F, overallCR: 0, updatedAt: e.updatedAt || new Date().toISOString() };
            cleaned[id].overallCR = computeOverall(cleaned[id]);
          });
          setTsBook(cleaned);
        } else {
          alert('文件格式不正确：缺少 entries 字段');
        }
      } catch (err:any) {
        alert('无法解析 JSON：' + (err?.message||String(err)));
      }
    };
    reader.readAsText(file);
  };

  const refreshTSFromBookRef = useRef<null | (()=>void)>(null);

  const doResetAll = () => {
    setEnabled(DEFAULTS.enabled); setRounds(DEFAULTS.rounds); setStartScore(DEFAULTS.startScore);
    setRob(DEFAULTS.rob); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]); setSeats([...DEFAULTS.seats]);
    setSeatModels([...DEFAULTS.seatModels]); setSeatKeys(DEFAULTS.seatKeys.map((x:any)=>({ ...x })));
    setLiveLog([]); setResetKey(k => k + 1);
  };

  return (
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Bot Arena</h1>

      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                启用对局
                <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />
              </label>
              <button onClick={doResetAll} style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
                清空
              </button>
            </div>
            <div style={{ fontSize:12, color:'#6b7280', marginTop:4 }}>关闭后不可开始/继续对局；再次勾选即可恢复。</div>
          </div>

          <label>局数
            <input type="number" min={1} step={1} value={rounds} onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||1)))} style={{ width:'100%' }}/>
          </label>

          <label>初始分
            <input type="number" step={10} value={startScore} onChange={e=>setStartScore(Number(e.target.value)||0)} style={{ width:'100%' }} />
          </label>

          <label>可抢地主
            <div><input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} /></div>
          </label>

          <label>农民配合
            <div><input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} /></div>
          </label>

          <label>4带2 规则
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{ width:'100%' }}>
              <option value="both">都可</option>
              <option value="2singles">两张单牌</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
        </div>

        {/* ===== TrueSkill 记录（导入/导出） ===== */}
        <div style={{ marginTop:12, borderTop:'1px dashed #eee', paddingTop:12 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>TrueSkill 记录（导入 / 导出）</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
            <button onClick={makeTemplate} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
              生成模板（含内置与 AI 默认）
            </button>
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff', cursor:'pointer' }}>
              导入 JSON
              <input type="file" accept="application/json" style={{ display:'none' }}
                onChange={e=>{ const f=e.target.files?.[0]; if (f) onUploadTS(f); e.currentTarget.value=''; }} />
            </label>

            {/* 与“导入 JSON”并排的刷新按钮 */}
            <button
              onClick={()=>{
                if (refreshTSFromBookRef.current) refreshTSFromBookRef.current();
              }}
              style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
            >
              刷新先验（从记录簿）
            </button>

            <button onClick={onDownloadTS} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
              下载当前记录
            </button>
            <div style={{ fontSize:12, color:'#6b7280' }}>
              说明：导入后将作为下一次比赛的先验；每局结束会把对应参赛体的 L/F 两套 TrueSkill 写回到记录中，并计算总分（CR_total）。
            </div>
          </div>
          {Object.keys(tsBook).length>0 && (
            <div style={{ marginTop:8, border:'1px dashed #eee', borderRadius:8, padding:10, maxHeight:220, overflow:'auto', background:'#fafafa' }}>
              <div style={{ fontSize:12, color:'#374151', marginBottom:6 }}>已维护 {Object.keys(tsBook).length} 个参赛体：</div>
              {Object.entries(tsBook).map(([id, e])=>(
                <div key={id} style={{ fontSize:12, color:'#4b5563', padding:'2px 0' }}>
                  <b>{e.label}</b> <span style={{ opacity:0.7 }}>（{id}）</span> ｜ L μ={e.L.mu.toFixed(2)} σ={e.L.sigma.toFixed(2)}（{e.L.games||0}）｜ F μ={e.F.mu.toFixed(2)} σ={e.F.sigma.toFixed(2)}（{e.F.games||0}）｜ 总分CR={Number(e.overallCR||0).toFixed(2)}
                </div>
              ))}
            </div>
          )}
        </div>

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
                      const id = normalizeSeatId(v, seatModels[i], seatKeys[i]);
                      upsertEntry(id);
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
                    <input
                      type="text"
                      value={normalizeModelForProvider(seats[i], seatModels[i])}
                      placeholder={defaultModelFor(seats[i])}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatModels(arr => { const n=[...arr]; n[i] = v; return n; });
                        const id = normalizeSeatId(seats[i], v, seatKeys[i]);
                        upsertEntry(id);
                      }}
                      style={{ width:'100%' }}
                    />
                    <div style={{ fontSize:12, color:'#777', marginTop:4 }}>
                      留空则使用推荐：{defaultModelFor(seats[i])}
                    </div>
                  </label>
                )}

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
                          const id = normalizeSeatId(seats[i], seatModels[i], { ...seatKeys[i], httpBase: v });
                          upsertEntry(id);
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

          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家出牌最小间隔 (ms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                  <label style={{ display:'block' }}>
                    最小间隔 (ms)
                    <input
                      type="number" min={0} step={100}
                      value={ (seatDelayMs[i] ?? 0) }
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

      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局</div>
        <LivePanel
          key={resetKey}
          rounds={rounds}
          startScore={startScore}
          seatDelayMs={seatDelayMs}
          enabled={enabled}
          rob={rob}
          four2={four2}
          seats={seats}
          seatModels={seatModels}
          seatKeys={seatKeys}
          farmerCoop={farmerCoop}
          onLog={setLiveLog}
          getTSRating={(id,role)=>getTSRating(id,role)}
          onTSApply={(ups)=>onTSApply(ups)}
          exposeRefresh={(fn)=>{ refreshTSFromBookRef.current = fn; }}
        />
      </div>
    </div>
  );
}

export default Home;
