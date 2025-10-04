// pages/index.tsx — SAFE BASELINE (compiles)
// Feel free to diff this against your current file. It keeps structure simple and avoids
// cross-scope refs. You can re-integrate your logic section-by-section.

import React, { useEffect, useRef, useState } from 'react';

// ——— Ambient globals to avoid TS errors when you later wire real implementations ———
declare global {
  // optional external impl for all-in-one bundle build
  var _buildAllBundle_impl: undefined | (() => any);
}

// ——— Types ———

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

// Minimal rating types (if you need later)
type Rating = { mu:number; sigma:number };

// ——— DEFAULTS for initial UI state ———
const DEFAULTS = {
  enabled: true,
  rounds: 10,
  startScore: 0,
  rob: true,
  four2: 'both' as Four2Policy,
  farmerCoop: true,
  seatDelayMs: [1000, 1000, 1000] as number[],
  seats: ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'] as BotChoice[],
  seatModels: ['', '', ''] as string[],
  seatKeys: [{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }] as any[],
};

// ——— All-in-One bundle type and builder ———
type AllBundle = {
  schema: 'ddz-all@1';
  createdAt: string;
  agents: string[];
  trueskill?: any;
  radar?: any;
  ladder?: any;
};

function buildAllBundle(): AllBundle {
  // Prefer external impl if provided
  try {
    if (typeof globalThis._buildAllBundle_impl === 'function') {
      return globalThis._buildAllBundle_impl();
    }
  } catch {}

  // Fallback: localStorage only — no cross-scope refs
  let ladder: any = undefined;
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('ddz_ladder_store_v1');
      ladder = raw ? JSON.parse(raw) : undefined;
    }
  } catch {}

  return {
    schema: 'ddz-all@1',
    createdAt: new Date().toISOString(),
    agents: ['0','1','2'],
    trueskill: undefined,
    radar: undefined,
    ladder,
  };
}

// ——— Safe no-op helpers (placeholder) ———
function applyTsFromStoreByRole(_landlord: number | null, _why?: string) { /* no-op baseline */ }
function applyRadarFromStoreByRole(_landlord: number | null, _why?: string) { /* no-op baseline */ }

// ——— UI Stubs you can flesh out later ———
type LiveProps = {
  rounds: number;
  startScore: number;
  seatDelayMs: number[];
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: any[];
  farmerCoop: boolean;
  turnTimeoutSecs: number[];
  onAllSave?: () => void;
  onAllUpload?: (payload:any)=>void;
  onAllRefresh?: () => void;
};

const LivePanel = (props: LiveProps) => {
  const {
    rounds,
    startScore,
    seatDelayMs,
    enabled,
    rob,
    four2,
    seats,
    seatModels,
    seatKeys,
    farmerCoop,
    turnTimeoutSecs,
    onAllSave,
    onAllUpload,
    onAllRefresh,
  } = props;

  // --- simple Dou Dizhu helpers (rank-only model) ---
  const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
  const RANK_ORDER = Object.fromEntries(RANKS.map((r,i)=>[r,i]));
  type Rank = typeof RANKS[number];
  type Play = { seat:number; move:'play'|'pass'; cards?:Rank[]; reason?:string };

  const sortHand = (hand: Rank[]) => [...hand].sort((a,b)=>RANK_ORDER[a]-RANK_ORDER[b]);
  const createDeck = (): Rank[] => {
    const ranks: Rank[] = [];
    for (let i=0;i<13;i++) for (let k=0;k<4;k++) ranks.push(RANKS[i]);
    ranks.push('x' as Rank); ranks.push('X' as Rank);
    return ranks as Rank[];
  };
  const shuffle = <T,>(arr: T[]) => {
    const a = [...arr];
    for (let i=a.length-1;i>0;i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  };

  type SeatState = {
    hand: Rank[];
    total: number;
  };

  const [running, setRunning] = React.useState(false);
  const [roundIdx, setRoundIdx] = React.useState(0);
  const [landlord, setLandlord] = React.useState<number|null>(null);
  const [kitty, setKitty] = React.useState<Rank[]>([]);
  const [seatsState, setSeatsState] = React.useState<SeatState[]>([{hand:[], total:startScore},{hand:[], total:startScore},{hand:[], total:startScore}]);
  const [plays, setPlays] = React.useState<Play[]>([]);
  const [leader, setLeader] = React.useState<number>(0);
  const [turn, setTurn] = React.useState<number>(0);
  const [winner, setWinner] = React.useState<number|null>(null);
  const timerRef = React.useRef<number|undefined>(undefined);

  const newRound = () => {
    const deck = shuffle(createDeck());
    const h0 = sortHand(deck.slice(0,17) as Rank[]);
    const h1 = sortHand(deck.slice(17,34) as Rank[]);
    const h2 = sortHand(deck.slice(34,51) as Rank[]);
    const bottom = deck.slice(51) as Rank[];
    let lord = Math.floor(Math.random()*3);
    if (rob) {
      const counts = [h0,h1,h2].map(h=>h.filter(c=>c==='2').length);
      const best = counts.indexOf(Math.max(...counts));
      lord = best >= 0 ? best : lord;
    }
    const hands = [h0,h1,h2];
    hands[lord] = sortHand(hands[lord].concat(bottom));
    setKitty(bottom);
    setSeatsState([{hand:hands[0], total: seatsState[0]?.total ?? startScore},
                   {hand:hands[1], total: seatsState[1]?.total ?? startScore},
                   {hand:hands[2], total: seatsState[2]?.total ?? startScore}]);
    setLandlord(lord);
    setLeader(lord);
    setTurn(lord);
    setPlays([]);
    setWinner(null);
  };

  const pickPlay = (seat:number, history: Play[]): Play => {
    const prevLeadIndex = [...history].reverse().findIndex(p=>p.move==='play');
    const leadPlay = prevLeadIndex>=0 ? history[history.length-1-prevLeadIndex] : null;
    const hand = seatsState[seat].hand;
    if (!hand.length) return { seat, move:'pass' as const, reason:'empty' };

    const sorted = sortHand(hand);
    if (leadPlay && leadPlay.seat !== seat && leadPlay.cards && leadPlay.cards.length===1) {
      const target = leadPlay.cards[0] as Rank;
      const cand = sorted.find(r => RANK_ORDER[r] > RANK_ORDER[target]);
      if (cand) return { seat, move:'play', cards:[cand], reason:`beat ${target}` };
      return { seat, move:'pass', reason:'cannot beat' };
    }
    const card = sorted[0];
    return { seat, move:'play', cards:[card], reason:'lead' };
  };

  const removeCards = (hand: Rank[], used: Rank[]) => {
    const h = [...hand];
    used.forEach(u=>{
      const idx = h.indexOf(u);
      if (idx>=0) h.splice(idx,1);
    });
    return h;
  };

  const applyPlay = (p: Play) => {
    setPlays(prev => [...prev, p]);
    if (p.move === 'play' && p.cards?.length) {
      setSeatsState(prev => {
        const next = prev.map(s => ({...s}));
        next[p.seat].hand = removeCards(next[p.seat].hand, p.cards as Rank[]);
        return next;
      });
      setLeader(p.seat);
    }
    setTimeout(()=>{
      const emptySeat = [0,1,2].find(i=>seatsState[i].hand.length===0);
      if (emptySeat !== undefined) {
        setWinner(emptySeat!);
        setRunning(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined; }
      }
    }, 0);
    setTurn((p.seat + 1) % 3);
  };

  const step = () => {
    if (winner !== null) return;
    const p = pickPlay(turn, plays);
    applyPlay(p);
  };

  const start = () => {
    if (!seatsState[0].hand.length) newRound();
    setRunning(true);
    const delay = Math.max(200, Math.min(...seatDelayMs));
    timerRef.current = window.setInterval(()=>{ step(); }, delay) as unknown as number;
  };
  const pause = () => {
    setRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = undefined; }
  };
  const nextRound = () => {
    pause();
    setRoundIdx(i=>i+1);
    newRound();
  };

  React.useEffect(()=>{ return ()=>{ if (timerRef.current) clearInterval(timerRef.current); }; }, []);
  React.useEffect(()=>{}, [roundIdx]);
  React.useEffect(()=>{ newRound(); }, []);

  const seatName = (i:number) => i===0 ? '甲' : i===1 ? '乙' : '丙';
  const isLord = (i:number) => landlord === i;

  const HandView = ({i}:{i:number}) => {
    const s = seatsState[i];
    return (
      <div style={{ flex:1, border:'1px solid #e5e7eb', borderRadius:8, padding:8, background:isLord(i)?'rgba(250,204,21,0.12)':'#fff' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontWeight:800 }}>{seatName(i)} {isLord(i) && <span style={{ color:'#b45309' }}>（地主）</span>}</div>
          <div style={{ fontSize:12, color:'#6b7280' }}>手牌：{s.hand.length}</div>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {s.hand.map((c, idx)=>(
            <span key={idx} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'4px 6px', fontFamily:'monospace' }}>{c}</span>
          ))}
        </div>
      </div>
    );
  };

  const TurnBadge = ({i}:{i:number}) => (
    <span style={{ fontSize:12, color: turn===i ? '#1f2937' : '#9ca3af' }}>{turn===i?'出牌中':'等待'}</span>
  );

  return (
    <div style={{ border:'1px solid #e5e7eb', borderRadius:12, padding:12 }}>
      {/* 控制区 */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
        <button onClick={running?pause:start} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>
          {running ? '暂停' : '开始'}
        </button>
        <button onClick={step} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>单步</button>
        <button onClick={nextRound} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>新一局</button>
        <div style={{ fontSize:12, color:'#6b7280' }}>第 {roundIdx+1} 局</div>
        <div style={{ marginLeft:'auto', fontSize:12, color:'#6b7280' }}>
          地主底牌：{kitty.map((k,i)=><span key={i} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'2px 4px', marginLeft:4 }}>{k}</span>)}
        </div>
      </div>

      {/* 甲乙丙一行三列 */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
        <HandView i={0} />
        <HandView i={1} />
        <HandView i={2} />
      </div>

      {/* 出牌记录（位于手牌行下方） */}
      <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:8, background:'#fff' }}>
        <div style={{ fontWeight:800, marginBottom:6 }}>出牌记录</div>
        <div style={{ height:200, overflow:'auto' }}>
          {plays.map((p, idx)=>(
            <div key={idx} style={{ fontSize:12, color:'#374151', display:'flex', gap:6 }}>
              <span style={{ width:24, fontWeight:700 }}>{seatName(p.seat)}</span>
              <span>{p.move==='play' ? `出 ${p.cards?.join('')}` : '过'}</span>
              {p.reason && <span style={{ color:'#6b7280' }}>（{p.reason}）</span>}
            </div>
          ))}
        </div>
        <div style={{ marginTop:8, fontSize:12, color:'#6b7280' }}>
          轮到：{seatName(turn)} <TurnBadge i={turn} />
        </div>
        {winner!==null && (
          <div style={{ marginTop:8, fontWeight:800, color:'#065f46' }}>
            胜者：{seatName(winner)} {isLord(winner)?'（地主）':'（农民）'}
          </div>
        )}
      </div>
    </div>
  );
};


  const TurnBadge = ({i}:{i:number}) => (
    <span style={{ fontSize:12, color: turn===i ? '#1f2937' : '#9ca3af' }}>{turn===i?'出牌中':'等待'}</span>
  );

  return (
    <div style={{ border:'1px solid #e5e7eb', borderRadius:12, padding:12 }}>
      {/* Controls */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
        <button onClick={running?pause:start} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>
          {running ? '暂停' : '开始'}
        </button>
        <button onClick={step} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>单步</button>
        <button onClick={nextRound} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>新一局</button>
        <div style={{ fontSize:12, color:'#6b7280' }}>第 {roundIdx+1} 局</div>
        <div style={{ marginLeft:'auto', fontSize:12, color:'#6b7280' }}>
          地主底牌：{kitty.map((k,i)=><span key={i} style={{ border:'1px solid #e5e7eb', borderRadius:6, padding:'2px 4px', marginLeft:4 }}>{k}</span>)}
        </div>
      </div>

      {/* Table */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10 }}>
        <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
          <HandView i={0} />
          <div style={{ width:260 }}>
            <div style={{ fontWeight:800, marginBottom:6 }}>出牌记录</div>
            <div style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:8, height:180, overflow:'auto', background:'#fff' }}>
              {plays.map((p, idx)=>(
                <div key={idx} style={{ fontSize:12, color:'#374151', display:'flex', gap:6 }}>
                  <span style={{ width:24, fontWeight:700 }}>{seatName(p.seat)}</span>
                  <span>{p.move==='play' ? `出 ${p.cards?.join('')}` : '过'}</span>
                  {p.reason && <span style={{ color:'#6b7280' }}>（{p.reason}）</span>}
                </div>
              ))}
            </div>
            <div style={{ marginTop:8, fontSize:12, color:'#6b7280' }}>
              轮到：{seatName(turn)} <TurnBadge i={turn} />
            </div>
            {winner!==null && (
              <div style={{ marginTop:8, fontWeight:800, color:'#065f46' }}>胜者：{seatName(winner)} {isLord(winner)?'（地主）':'（农民）'}</div>
            )}
          </div>
          <HandView i={1} />
        </div>
        <div>
          <HandView i={2} />
        </div>
      </div>
    </div>
  );
};

const LadderPanel = () => {
  return (
    <div style={{ padding:12, border:'1px solid #e5e7eb', borderRadius:8, marginBottom:12 }}>
      <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>天梯图（占位）</div>
      <div style={{ fontSize:12, color:'#6b7280' }}>TODO: 回填你的天梯实现。</div>
    </div>
  );
};

const ScoreTimeline = () => {
  return (
    <div style={{ padding:12, border:'1px solid #e5e7eb', borderRadius:8, marginBottom:12 }}>
      <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>实时曲线（占位）</div>
      <div style={{ fontSize:12, color:'#6b7280' }}>TODO: 回填你的每手牌得分曲线。</div>
    </div>
  );
};

function RadarChart({ title }:{ title:string }) {
  return (
    <div style={{ padding:12, border:'1px solid #e5e7eb', borderRadius:8, display:'flex', gap:12, alignItems:'center' }}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="60" fill="none" stroke="#e5e7eb" />
        <polygon points="80,20 140,80 80,140 20,80" fill="rgba(59,130,246,0.15)" stroke="#3b82f6" />
      </svg>
      <div style={{ minWidth:60, fontSize:12, color:'#374151' }}>{title}</div>
    </div>
  );
}

// ——— Main Page ———
function Home() {
  // Basic state (keep names to ease later merge-back)
  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [turnTimeoutSecs, setTurnTimeoutSecs] = useState<number[]>([30,30,30]);

  const [rob, setRob] = useState<boolean>(DEFAULTS.rob);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState<boolean>(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState<any[]>(DEFAULTS.seatKeys);

  // All-in-One actions
  const handleAllSaveInner = () => {
    const payload = buildAllBundle();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ddz_all_stats.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const applyAllBundleInner = (obj:any) => {
    try {
      // Here you can map obj to states if needed
      // e.g., setSeatDelayMs(obj?.seatDelayMs ?? DEFAULTS.seatDelayMs);
      // For baseline, just no-op
      console.info('[ALL] upload received', obj);
    } catch (e:any) {
      console.error('[ALL] upload failed', e);
    }
  };
  const handleAllRefreshInner = () => {
    applyTsFromStoreByRole(null, '手动刷新');
    applyRadarFromStoreByRole(null, '手动刷新');
  };

  return (
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Bot Arena（安全基线）</h1>

      {/* 控件区（最小集） */}
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
          <div>
            <div style={{ fontSize:12, color:'#6b7280', marginBottom:6 }}>局数</div>
            <input type="number" value={rounds} onChange={e=>setRounds(Number(e.target.value)||0)} style={{ width:'100%' }}/>
          </div>
          <div>
            <div style={{ fontSize:12, color:'#6b7280', marginBottom:6 }}>初始分</div>
            <input type="number" value={startScore} onChange={e=>setStartScore(Number(e.target.value)||0)} style={{ width:'100%' }}/>
          </div>
        </div>

        <div style={{ display:'flex', gap:8, marginTop:12 }}>
          <button onClick={()=>setResetKey(k=>k+1)} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>刷新</button>
          <button onClick={handleAllSaveInner} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}>统一导出</button>
          <label style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, cursor:'pointer' }}>
            统一上传
            <input type="file" accept="application/json" style={{ display:'none' }}
              onChange={async (e)=>{
                const f = e.target.files?.[0];
                if (!f) return;
                const txt = await f.text();
                try { applyAllBundleInner(JSON.parse(txt)); } catch {}
              }}
            />
          </label>
        </div>
      </div>

      {/* 面板区 */}
      <ScoreTimeline />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        <RadarChart title="画像（占位）" />
        <LadderPanel />
      </div>

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
        turnTimeoutSecs={turnTimeoutSecs}
        onAllSave={handleAllSaveInner}
        onAllUpload={applyAllBundleInner}
        onAllRefresh={handleAllRefreshInner}
      />
    </div>
  );
}

export default Home;
