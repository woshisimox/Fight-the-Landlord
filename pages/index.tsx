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

  // ===== TS 存档 =====
  const tsStoreRef = useRef<TsStore>(emptyStore());
  useEffect(()=>{ try { tsStoreRef.current = readStore(); } catch {} }, []);
  const fileRef = useRef<HTMLInputElement|null>(null);

  const seatIdentity = (i:number) => {
    const choice = props.seats[i];
    const model = normalizeModelForProvider(choice, props.seatModels[i] || '') || defaultModelFor(choice);
    const base = choice === 'http' ? (props.seatKeys[i]?.httpBase || '') : '';
    return `${choice}|${model}|${base}`;
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

  // —— 雷达图状态 —— //
  const [radarStats, setRadarStats] = useState<Score5[] | null>(null);
  const [radarCount, setRadarCount] = useState<number>(0);

  // 更新雷达图数据
  const updateRadarStats = (scores: Score5[]) => {
    if (!radarStats) {
      setRadarStats(scores);
      setRadarCount(1);
    } else {
      const newStats = radarStats.map((prev, idx) => 
        mergeScore(prev, scores[idx], 'mean', radarCount, 0.35)
      );
      setRadarStats(newStats);
      setRadarCount(prev => prev + 1);
    }
  };

  // —— 主循环 —— //
  const runGame = async () => {
    if (running) return;
    if (!props.enabled) {
      setLog(l => [...l, '【前端】未启用对局：请在设置中勾选"启用对局"。']);
      return;
    }

    setRunning(true);
    setFinishedCount(0);
    setLog([]);
    setPlays([]);
    setLandlord(null);
    setWinner(null);
    setDelta(null);
    setHands([[],[],[]]);
    setMultiplier(1);
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);

    // 只在牌局开始时应用 TrueSkill 初始值
    applyTsFromStoreByRole(null, '牌局开始');

    try {
      for (let round = 0; round < props.rounds; round++) {
        if (!props.enabled) break;

        setLog(l => [...l, `开始第 ${round + 1} 局（共 ${props.rounds} 局）`]);

        // 构建请求参数
        const requestBody = {
          rounds: 1,
          startScore: props.startScore,
          seatDelayMs: props.seatDelayMs || [0,0,0],
          enabled: props.enabled,
          rob: props.rob,
          four2: props.four2,
          farmerCoop: props.farmerCoop,
          turnTimeoutSecs: props.turnTimeoutSecs || [30,30,30],
          seats: props.seats.map((choice, i) => {
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
          })
        };

        setLog(l => [...l, '正在调用后端 API...']);

        // 调用后端 API
        const response = await fetch('/api/stream_ndjson', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              const data = JSON.parse(line);
              console.log('Received data:', data);

              // 处理初始化数据
              if (data.type === 'init') {
                const gameHands = data.hands || [[],[],[]];
                const decoratedHands = gameHands.map((h:string[]) => decorateHandCycle(h));
                setHands(decoratedHands);
                const lordIndex = data.landlordIdx ?? data.landlord ?? null;
                setLandlord(lordIndex);
                
                // 确定地主后更新 TrueSkill
                if (lordIndex !== null) {
                  applyTsFromStoreByRole(lordIndex, `第${round+1}局确定地主`);
                }
                
                setLog(l => [...l, `发牌完成，${lordIndex !== null ? seatName(lordIndex) : '?'}为地主`]);
              }

              // 处理出牌事件 - 修复手牌实时更新
              if (data.type === 'event' && data.kind === 'play') {
                const seat = data.seat;
                const move = data.move;
                const cards = data.cards || [];
                const reason = data.reason;

                if (move === 'pass') {
                  setPlays(prev => [...prev, { seat, move: 'pass', reason }]);
                  setLog(l => [...l, `${seatName(seat)} 过${reason ? `（${reason}）` : ''}`]);
                } else {
                  // 实时更新手牌 - 修复版
                  setHands(prev => {
                    const newHands = [...prev];
                    const playerHand = [...newHands[seat]];
                    
                    // 从手牌中移除打出的牌
                    for (const card of cards) {
                      // 查找匹配的牌（考虑花色）
                      const cardIndex = playerHand.findIndex(c => {
                        // 如果是带花色的牌，精确匹配
                        if (card.startsWith('🃏') || '♠♥♦♣'.includes(card[0])) {
                          return c === card;
                        }
                        // 如果是不带花色的牌，匹配点数
                        return c.includes(card);
                      });
                      if (cardIndex > -1) {
                        playerHand.splice(cardIndex, 1);
                      }
                    }
                    newHands[seat] = playerHand;
                    return newHands;
                  });

                  // 修复：为 card 参数添加明确的 string 类型
                  setPlays(prev => [...prev, { 
                    seat, 
                    move: 'play', 
                    cards: cards.map((card: string) => {
                      // 确保卡片有花色装饰
                      if (card.startsWith('🃏') || '♠♥♦♣'.includes(card[0])) {
                        return card;
                      }
                      // 为没有花色的卡片添加默认花色
                      return `♠${card}`;
                    }), 
                    reason 
                  }]);
                  setLog(l => [...l, `${seatName(seat)} 出牌：${cards.join(' ')}${reason ? `（理由：${reason}）` : ''}`]);
                }

                // 添加延迟以便观察手牌变化
                await new Promise(resolve => setTimeout(resolve, 500));
              }

              // 处理游戏结果
              if ((data.type === 'event' && data.kind === 'win') || data.type === 'result') {
                const winnerSeat = data.winner;
                const deltaScores = data.deltaScores || data.delta || [0,0,0];
                const gameMultiplier = data.multiplier || 1;

                setWinner(winnerSeat);
                setDelta(deltaScores);
                setMultiplier(gameMultiplier);

                // 更新总分
                setTotals(prev => [
                  prev[0] + deltaScores[0],
                  prev[1] + deltaScores[1],
                  prev[2] + deltaScores[2],
                ]);

                // 更新 TrueSkill - 确保每局结束后更新
                const tsCur = [...tsRef.current];
                if (winnerSeat !== null && landlord !== null) {
                  if (winnerSeat === landlord) {
                    tsUpdateTwoTeams(tsCur, [landlord], landlord === 0 ? [1,2] : landlord === 1 ? [0,2] : [0,1]);
                  } else {
                    tsUpdateTwoTeams(tsCur, landlord === 0 ? [1,2] : landlord === 1 ? [0,2] : [0,1], [landlord]);
                  }
                  setTsArr([...tsCur]);
                  updateStoreAfterRound(tsCur, landlord);
                  setLog(l => [...l, `【TS】第${round+1}局后更新完成`]);
                }

                // 更新雷达图数据
                if (data.radarScores) {
                  updateRadarStats(data.radarScores);
                  setLog(l => [...l, `【雷达图】第${round+1}局数据已记录`]);
                }

                setLog(l => [...l, 
                  `胜者：${winnerSeat == null ? '—' : seatName(winnerSeat)}，倍数 x${gameMultiplier}，` +
                  `当局积分：${deltaScores.join(' / ')}`
                ]);

                // 更新天梯图
                try {
                  const ladderDelta = data.ladderDelta || [0,0,0];
                  const ids = [0,1,2].map(seatIdentity);
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
                } catch (e) {
                  console.error('更新天梯图失败:', e);
                }
              }

              // 处理雷达图数据
              if (data.type === 'stats' && Array.isArray(data.perSeat)) {
                const radarScores = data.perSeat.map((seatData: any) => ({
                  coop: Number(seatData.scaled?.coop ?? 2.5),
                  agg: Number(seatData.scaled?.agg ?? 2.5),
                  cons: Number(seatData.scaled?.cons ?? 2.5),
                  eff: Number(seatData.scaled?.eff ?? 2.5),
                  rob: Number(seatData.scaled?.rob ?? 2.5),
                }));
                updateRadarStats(radarScores);
                setLog(l => [...l, `【雷达图】收到统计数据，已更新`]);
              }

              // 处理日志
              if (data.type === 'log' && data.message) {
                setLog(l => [...l, data.message]);
              }

            } catch (error) {
              console.error('解析数据错误:', error, line);
            }
          }
        }

        setFinishedCount(prev => prev + 1);
        setLog(l => [...l, `第 ${round + 1} 局结束`]);
        
        // 局间延迟
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      setLog(l => [...l, `错误：${error?.message || error}`]);
      console.error('对局错误:', error);
    } finally {
      setRunning(false);
      setLog(l => [...l, `全部 ${props.rounds} 局结束。`]);
    }
  };

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  return (
    <div style={{ padding:16, border:'1px solid #e5e7eb', borderRadius:8, background:'#f9fafb' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:18 }}>对局模拟</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:14, color:'#6b7280' }}>剩余局数：{remainingGames}</span>
          <button onClick={runGame} disabled={running || !props.enabled}
            style={{ 
              padding:'8px 16px', 
              background: running || !props.enabled ? '#9ca3af' : '#3b82f6', 
              color:'white', 
              border:'none', 
              borderRadius:6, 
              fontWeight:600,
              cursor: running || !props.enabled ? 'not-allowed' : 'pointer'
            }}>
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
                <div style={{ fontWeight:700, marginBottom:8 }}>
                  <SeatTitle i={i} /> {choiceLabel(props.seats[i])}
                  {landlord === i && <span style={{ marginLeft:6, color:'#bf7f00' }}>（地主）</span>}
                </div>
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
        {radarStats ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <RadarChart 
                key={i}
                title={`${['甲','乙','丙'][i]}（${radarCount}局）`}
                scores={radarStats[i]} 
              />
            ))}
          </div>
        ) : (
          <div style={{ opacity:0.6, textAlign:'center', padding:20 }}>（等待对局数据生成雷达图）</div>
        )}
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
                  <span style={{ marginLeft:8, fontWeight:400 }}>{h.length}张</span>
                </div>
                <Hand cards={h} />
              </div>
            ))}
          </Section>
        </div>
        <div>
          <Section title="出牌记录">
            <div style={{ maxHeight:320, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:8, padding:12, background:'white' }}>
              {plays.length === 0 ? (
                <div style={{ opacity:0.6, textAlign:'center', padding:20 }}>（尚无出牌）</div>
              ) : (
                plays.map((p, idx) => <PlayRow key={idx} {...p} />)
              )}
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
          {log.length === 0 ? (
            <div style={{ opacity:0.6, textAlign:'center', padding:20 }}>（暂无日志）</div>
          ) : (
            log.map((line, idx) => <LogLine key={idx} text={line} />)
          )}
        </div>
      </Section>
    </div>
  );
}

/* ====== 雷达图组件 ====== */
function RadarChart({ title, scores }: { title: string; scores: Score5 }) {
  const vals = [scores.coop, scores.agg, scores.cons, scores.eff, scores.rob];
  const labels = ['配合','激进','保守','效率','抢地主'];
  const size = 180, R = 70, cx = size/2, cy = size/2;

  const ang = (i:number)=> (-90 + i*(360/5)) * Math.PI/180;

  const ringPoints = (r:number)=> Array.from({length:5}, (_,i)=> {
    return `${cx + r * Math.cos(ang(i))},${cy + r * Math.sin(ang(i))}`;
  }).join(' ');

  const valuePoints = Array.from({length:5}, (_,i)=> {
    const r = Math.max(0, Math.min(5, vals[i] ?? 0)) / 5 * R;
    return `${cx + r * Math.cos(ang(i))},${cy + r * Math.sin(ang(i))}`;
  }).join(' ');

  return (
    <div style={{ display:'flex', gap:10, alignItems:'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 环形网格 */}
        {[1,2,3,4].map(k=>{
          const r = (k/4) * R;
          return <polygon key={k} points={ringPoints(r)} fill="none" stroke="#e5e7eb"/>;
        })}
        {/* 轴线 */}
        {Array.from({length:5}, (_,i)=>{
          return <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(ang(i))} y2={cy + R * Math.sin(ang(i))} stroke="#e5e7eb"/>;
        })}
        {/* 值多边形 */}
        <polygon points={valuePoints} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={2}/>
        {/* 标签 */}
        {labels.map((lab, i)=>{
          const lx = cx + (R + 14) * Math.cos(ang(i));
          const ly = cy + (R + 14) * Math.sin(ang(i));
          return <text key={i} x={lx} y={ly} fontSize={11} textAnchor="middle" dominantBaseline="middle" fill="#374151">{lab}</text>;
        })}
      </svg>
      <div style={{ minWidth:60, fontSize:12, color:'#374151' }}>
        <div style={{ fontWeight:600 }}>{title}</div>
        <div style={{ marginTop:4 }}>
          合作: {scores.coop.toFixed(1)}<br/>
          激进: {scores.agg.toFixed(1)}<br/>
          稳健: {scores.cons.toFixed(1)}<br/>
          效率: {scores.eff.toFixed(1)}<br/>
          抢庄: {scores.rob.toFixed(1)}
        </div>
      </div>
    </div>
  );
}

/* ====== 主页面 ====== */
export default function Home() {
  const [enabled, setEnabled] = useState(true);
  const [rob, setRob] = useState(true);
  const [four2, setFour2] = useState<Four2Policy>('both');
  const [farmerCoop, setFarmerCoop] = useState(true);
  const [rounds, setRounds] = useState(1);
  const [startScore, setStartScore] = useState(100);
  const [totals, setTotals] = useState<[number,number,number]>([100,100,100]);

  const [seats, setSeats] = useState<BotChoice[]>([
    'built-in:greedy-max',
    'built-in:greedy-min', 
    'built-in:random-legal'
  ]);
  const [seatModels, setSeatModels] = useState<string[]>(['','','']);
  const [seatKeys, setSeatKeys] = useState<{
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string;
    httpBase?: string; httpToken?: string;
  }[]>([{},{},{}]);

  const [turnTimeoutSecs, setTurnTimeoutSecs] = useState<number[]>([30,30,30]);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>([1000,1000,1000]);

  const handleSeatChange = (i: number, choice: BotChoice) => {
    const newSeats = [...seats]; 
    newSeats[i] = choice; 
    setSeats(newSeats);
    
    const newModels = [...seatModels];
    if (choice.startsWith('ai:')) {
      newModels[i] = defaultModelFor(choice);
    } else {
      newModels[i] = '';
    }
    setSeatModels(newModels);
  };

  const handleModelChange = (i: number, model: string) => {
    const newModels = [...seatModels]; 
    newModels[i] = model; 
    setSeatModels(newModels);
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
    const newTimeouts = [...turnTimeoutSecs]; 
    newTimeouts[i] = secs; 
    setTurnTimeoutSecs(newTimeouts);
  };

  const handleSeatDelayChange = (i: number, value: string) => {
    const ms = Math.max(0, Math.min(10000, Number(value)||0));
    const newDelays = [...seatDelayMs]; 
    newDelays[i] = ms; 
    setSeatDelayMs(newDelays);
  };

  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:16 }}>
      <h1 style={{ textAlign:'center', marginBottom:24 }}>斗地主 AI 对战平台</h1>

      {/* 控制面板 */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:16, background:'#f9fafb', marginBottom:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:16, marginBottom:16 }}>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>局数</label>
            <input 
              type="number" 
              min="1" 
              max="100" 
              value={rounds} 
              onChange={e=>setRounds(Math.max(1, Number(e.target.value)))}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }} 
            />
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>初始分数</label>
            <input 
              type="number" 
              value={startScore} 
              onChange={e=>setStartScore(Number(e.target.value))}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }} 
            />
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>抢地主</label>
            <select 
              value={rob?'true':'false'} 
              onChange={e=>setRob(e.target.value==='true')}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }}
            >
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>四带二</label>
            <select 
              value={four2} 
              onChange={e=>setFour2(e.target.value as Four2Policy)}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }}
            >
              <option value="both">四带两对或两张</option>
              <option value="2singles">四带两张</option>
              <option value="2pairs">四带两对</option>
            </select>
          </div>
          <div>
            <label style={{ display:'block', marginBottom:4, fontWeight:600 }}>农民协作</label>
            <select 
              value={farmerCoop?'true':'false'} 
              onChange={e=>setFarmerCoop(e.target.value==='true')}
              style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6 }}
            >
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
                  <select 
                    value={seats[i]} 
                    onChange={e=>handleSeatChange(i, e.target.value as BotChoice)}
                    style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }}
                  >
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
                    <input 
                      type="text" 
                      value={seatModels[i]} 
                      onChange={e=>handleModelChange(i, e.target.value)}
                      placeholder={defaultModelFor(seats[i])}
                      style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} 
                    />
                  </div>
                )}

                {(seats[i].startsWith('ai:') || seats[i] === 'http') && (
                  <div style={{ marginBottom:8 }}>
                    <label style={{ display:'block', marginBottom:4, fontSize:14 }}>
                      {seats[i] === 'http' ? 'HTTP 基础 URL' : 'API 密钥'}
                    </label>
                    <input 
                      type="text" 
                      value={
                        seats[i] === 'http' 
                          ? (seatKeys[i]?.httpBase || '')
                          : (seatKeys[i]?.[seats[i].split(':')[1] as keyof typeof seatKeys[0]] || '')
                      } 
                      onChange={e=>handleKeyChange(i, seats[i] === 'http' ? 'httpBase' : seats[i].split(':')[1], e.target.value)}
                      placeholder={seats[i] === 'http' ? 'https://api.example.com' : 'sk-...'}
                      style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} 
                    />
                  </div>
                )}

                {seats[i] === 'http' && (
                  <div style={{ marginBottom:8 }}>
                    <label style={{ display:'block', marginBottom:4, fontSize:14 }}>HTTP Token（可选）</label>
                    <input 
                      type="text" 
                      value={seatKeys[i]?.httpToken || ''} 
                      onChange={e=>handleKeyChange(i, 'httpToken', e.target.value)}
                      placeholder="Bearer token"
                      style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} 
                    />
                  </div>
                )}

                <div style={{ marginBottom:8 }}>
                  <label style={{ display:'block', marginBottom:4, fontSize:14 }}>出牌超时（秒）</label>
                  <input 
                    type="number" 
                    min="1" 
                    max="300" 
                    value={turnTimeoutSecs[i]} 
                    onChange={e=>handleTurnTimeoutChange(i, e.target.value)}
                    style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} 
                  />
                </div>

                <div>
                  <label style={{ display:'block', marginBottom:4, fontSize:14 }}>出牌延迟（毫秒）</label>
                  <input 
                    type="number" 
                    min="0" 
                    max="10000" 
                    value={seatDelayMs[i]} 
                    onChange={e=>handleSeatDelayChange(i, e.target.value)}
                    style={{ width:'100%', padding:'6px 8px', border:'1px solid #d1d5db', borderRadius:4, fontSize:14 }} 
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:14, color: enabled ? '#16a34a' : '#d97706' }}>
            {enabled ? '✅ 配置就绪' : '⚠ 请检查配置'}
          </div>
          <button 
            onClick={()=>setEnabled(!enabled)} 
            style={{ 
              padding:'8px 16px', 
              background: enabled ? '#dc2626' : '#16a34a', 
              color:'white', 
              border:'none', 
              borderRadius:6, 
              fontWeight:600 
            }}
          >
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