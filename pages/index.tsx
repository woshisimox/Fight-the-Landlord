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
const LivePanel = (_props: LiveProps) => {
  return (
    <div style={{ padding:12, border:'1px solid #e5e7eb', borderRadius:8 }}>
      <div style={{ fontSize:14, fontWeight:700, marginBottom:6 }}>对局（占位组件）</div>
      <div style={{ fontSize:12, color:'#6b7280' }}>该占位仅为恢复编译。后续我可以把你的完整对局逻辑回填到这里。</div>
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
