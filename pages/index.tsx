// pages/index.tsx
import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';

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

/* ==================== 以下全部沿用你已有的 TrueSkill 代码 ==================== */
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
/* ===== TrueSkill 本地存档 ===== */
type TsRole = 'landlord'|'farmer';
type TsStoreEntry = {
  id: string;
  label?: string;
  overall?: Rating | null;
  roles?: { landlord?: Rating | null; farmer?: Rating | null };
  meta?: { choice?: string; model?: string; httpBase?: string };
};
type TsStore = { schema: 'ddz-trueskill@1'; updatedAt: string; players: Record<string, TsStoreEntry> };
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

/* ===== 其余类型定义 ===== */
type LiveProps = {
  rounds: number;
  startScore: number;
  seatDelayMs?: number[];
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: { openai?:string; gemini?:string; grok?:string; kimi?:string; qwen?:string; deepseek?:string; httpBase?:string; httpToken?:string }[];
  farmerCoop: boolean;
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
  turnTimeoutSecs?: number[];
};

/* ===== 帮助函数 ===== */
const seatName = (i:number)=>['甲','乙','丙'][i]||String(i);
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
  const m = (input||'').trim(); if(!m) return '';
  const low=m.toLowerCase();
  switch(choice){
    case 'ai:kimi':return /^kimi[-\w]*/.test(low)?m:'';
    case 'ai:openai':return /^(gpt-|o[34]|text-|omni)/.test(low)?m:'';
    case 'ai:gemini':return /^gemini[-\w.]*/.test(low)?m:'';
    case 'ai:grok':return /^grok[-\w.]*/.test(low)?m:'';
    case 'ai:qwen':return /^qwen[-\w.]*/.test(low)?m:'';
    case 'ai:deepseek':return /^deepseek[-\w.]*/.test(low)?m:'';
    default:return '';
  }
}
function choiceLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max':return 'Greedy Max';
    case 'built-in:greedy-min':return 'Greedy Min';
    case 'built-in:random-legal':return 'Random Legal';
    case 'built-in:mininet':return 'MiniNet';
    case 'built-in:ally-support':return 'AllySupport';
    case 'built-in:endgame-rush':return 'EndgameRush';
    case 'ai:openai':return 'OpenAI';
    case 'ai:gemini':return 'Gemini';
    case 'ai:grok':return 'Grok';
    case 'ai:kimi':return 'Kimi';
    case 'ai:qwen':return 'Qwen';
    case 'ai:deepseek':return 'DeepSeek';
    case 'http':return 'HTTP';
    default:return String(choice);
  }
}

/* ==================== LivePanel（仅保留与 TS 刷新相关） ==================== */
const LivePanel = forwardRef<{ forceApplyByCurrentId: () => void }, LiveProps>((props, ref) => {
  /* ---------- TrueSkill ---------- */
  const [tsArr, setTsArr] = useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
  const tsRef = useRef(tsArr); useEffect(()=>{ tsRef.current=tsArr; }, [tsArr]);
  const tsCr = (r:Rating)=>(r.mu - 3*r.sigma);
  const tsStoreRef = useRef<TsStore>(emptyStore());
  useEffect(()=>{ try{ tsStoreRef.current=readStore(); }catch{} }, []);

  const seatIdentity = (i:number)=>{
    const choice = props.seats[i];
    const model = normalizeModelForProvider(choice, props.seatModels[i]||'')||defaultModelFor(choice);
    const base  = choice==='http'?(props.seatKeys[i]?.httpBase||''):'';
    return `${choice}|${model}|${base}`;
  };
  const resolveRatingForIdentity = (id:string, role?:TsRole):Rating|null=>{
    const p=tsStoreRef.current.players[id]; if(!p)return null;
    if(role&&p.roles?.[role])return ensureRating(p.roles[role]);
    if(p.overall)return ensureRating(p.overall);
    const L=p.roles?.landlord, F=p.roles?.farmer;
    if(L&&F)return {mu:(L.mu+F.mu)/2, sigma:(L.sigma+F.sigma)/2};
    if(L)return ensureRating(L);
    if(F)return ensureRating(F);
    return null;
  };
  const applyTsFromStoreByRole = (lord:number|null, why:string)=>{
    const ids=[0,1,2].map(seatIdentity);
    const init=[0,1,2].map(i=>{
      const role:TsRole|undefined=(lord==null)?undefined:(i===lord?'landlord':'farmer');
      return resolveRatingForIdentity(ids[i],role)||{...TS_DEFAULT};
    });
    setTsArr(init);
  };

  /* 暴露给父组件 */
  const handleRefreshApply = useCallback(()=>{
    applyTsFromStoreByRole(null, '上传后刷新');
  }, []);
  useImperativeHandle(ref, ()=>({ forceApplyByCurrentId: handleRefreshApply }), [handleRefreshApply]);

  /* 首次加载也刷一次 */
  useEffect(()=>{ applyTsFromStoreByRole(null, '组件装载'); }, []);

  const fmt2 = (x:number)=>(Math.round(x*100)/100).toFixed(2);
  const getStoredForSeat=(i:number)=>{
    const id=seatIdentity(i); const p=tsStoreRef.current.players[id];
    return {
      overall: p?.overall?ensureRating(p.overall):null,
      landlord: p?.roles?.landlord?ensureRating(p.roles.landlord):null,
      farmer: p?.roles?.farmer?ensureRating(p.roles.farmer):null,
    };
  };

  /* ---------- 仅画 TS 面板 ---------- */
  return (
    <div>
      <div style={{ fontWeight:700, marginBottom:8 }}>TrueSkill（实时）</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
        {[0,1,2].map(i=>{
          const stored=getStoredForSeat(i);
          return (
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>{seatName(i)}</div>
              <div style={{ fontSize:13 }}>
                <div>μ：<b>{fmt2(tsArr[i].mu)}</b></div>
                <div>σ：<b>{fmt2(tsArr[i].sigma)}</b></div>
                <div>CR = μ − 3σ：<b>{fmt2(tsCr(tsArr[i]))}</b></div>
              </div>
              <div style={{ borderTop:'1px dashed #eee', marginTop:8, paddingTop:8, fontSize:12, color:'#555' }}>
                <div>总体：{stored.overall?`μ ${fmt2(stored.overall.mu)} σ ${fmt2(stored.overall.sigma)}`:'—'}</div>
                <div>地主：{stored.landlord?`μ ${fmt2(stored.landlord.mu)} σ ${fmt2(stored.landlord.sigma)}`:'—'}</div>
                <div>农民：{stored.farmer?`μ ${fmt2(stored.farmer.mu)} σ ${fmt2(stored.farmer.sigma)}`:'—'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
LivePanel.displayName = 'LivePanel';

/* ==================== Home 页面 ==================== */
const DEFAULTS = {
  enabled:true, rounds:10, startScore:100,
  rob:true, four2:'both' as Four2Policy, farmerCoop:true,
  seatDelayMs:[1000,1000,1000],
  seats:['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'] as BotChoice[],
  seatModels:['','',''],
  seatKeys:[{},{},{}] as any[],
};

export default function Home() {
  const [enabled, setEnabled] = useState(DEFAULTS.enabled);
  const [rounds, setRounds] = useState(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState(DEFAULTS.startScore);
  const [rob, setRob] = useState(DEFAULTS.rob);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState<any[]>(DEFAULTS.seatKeys);

  const livePanelRef = useRef<{ forceApplyByCurrentId: () => void }>(null);
  const allFileRef = useRef<HTMLInputElement|null>(null);

  /* 上传 All 存档 */
  const handleAllFileUploadHome = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(String(rd.result || '{}'));
        window.dispatchEvent(new CustomEvent('ddz-all-upload', { detail: obj }));
        /* 🔥关键：立即按当前身份刷新 */
        livePanelRef.current?.forceApplyByCurrentId();
      } catch (err) {
        console.error('[ALL-UPLOAD] parse error', err);
      } finally {
        if (allFileRef.current) allFileRef.current.value = '';
      }
    };
    rd.readAsText(f);
  };

  /* 清空 */
  const doResetAll = () => {
    setEnabled(DEFAULTS.enabled); setRounds(DEFAULTS.rounds); setStartScore(DEFAULTS.startScore);
    setRob(DEFAULTS.rob); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]); setSeats([...DEFAULTS.seats]);
    setSeatModels([...DEFAULTS.seatModels]); setSeatKeys(DEFAULTS.seatKeys.map((x:any)=>({...x})));
    try { localStorage.removeItem('ddz_ts_store_v1'); } catch {}
  };

  /* 通用设置 JSX */
  const renderSeatCard = (i:number) => (
    <div key={i} style={{ border:'1px dashed #ccc', borderRadius:8, padding:10 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
      <label style={{ display:'block', marginBottom:6 }}>
        选择
        <select
          value={seats[i]}
          onChange={e=>{
            const v=e.target.value as BotChoice;
            setSeats(arr=>{ const n=[...arr]; n[i]=v; return n; });
            setSeatModels(arr=>{ const n=[...arr]; n[i]=defaultModelFor(v); return n; });
          }}
          style={{ width:'100%' }}
        >
          <optgroup label="内置">
            <option value="built-in:greedy-max">Greedy Max</option>
            <option value="built-in:greedy-min">Greedy Min</option>
            <option value="built-in:random-legal">Random Legal</option>
            <option value="built-in:mininet">MiniNet</option>
            <option value="built-in:ally-support">AllySupport</option>
            <option value="built-in:endgame-rush">EndgameRush</option>
          </optgroup>
          <optgroup label="AI">
            <option value="ai:openai">OpenAI</option>
            <option value="ai:gemini">Gemini</option>
            <option value="ai:grok">Grok</option>
            <option value="ai:kimi">Kimi</option>
            <option value="ai:qwen">Qwen</option>
            <option value="ai:deepseek">DeepSeek</option>
            <option value="http">HTTP</option>
          </optgroup>
        </select>
      </label>
      {seats[i].startsWith('ai:') && (
        <label style={{ display:'block', marginBottom:6 }}>
          模型（可选）
          <input
            type="text"
            value={seatModels[i]}
            placeholder={defaultModelFor(seats[i])}
            onChange={e=>{ const v=e.target.value; setSeatModels(arr=>{ const n=[...arr]; n[i]=v; return n; }); }}
            style={{ width:'100%' }}
          />
        </label>
      )}
      {seats[i]==='ai:openai' && (
        <label style={{ display:'block', marginBottom:6 }}>
          OpenAI API Key
          <input type="password" value={seatKeys[i]?.openai||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],openai:v}; return n; }); }} style={{ width:'100%' }} />
        </label>
      )}
      {seats[i]==='ai:gemini' && (
        <label style={{ display:'block', marginBottom:6 }}>
          Gemini API Key
          <input type="password" value={seatKeys[i]?.gemini||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],gemini:v}; return n; }); }} style={{ width:'100%' }} />
        </label>
      )}
      {seats[i]==='ai:grok' && (
        <label style={{ display:'block', marginBottom:6 }}>
          xAI (Grok) API Key
          <input type="password" value={seatKeys[i]?.grok||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],grok:v}; return n; }); }} style={{ width:'100%' }} />
        </label>
      )}
      {seats[i]==='ai:kimi' && (
        <label style={{ display:'block', marginBottom:6 }}>
          Kimi API Key
          <input type="password" value={seatKeys[i]?.kimi||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],kimi:v}; return n; }); }} style={{ width:'100%' }} />
        </label>
      )}
      {seats[i]==='ai:qwen' && (
        <label style={{ display:'block', marginBottom:6 }}>
          Qwen API Key
          <input type="password" value={seatKeys[i]?.qwen||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],qwen:v}; return n; }); }} style={{ width:'100%' }} />
        </label>
      )}
      {seats[i]==='ai:deepseek' && (
        <label style={{ display:'block', marginBottom:6 }}>
          DeepSeek API Key
          <input type="password" value={seatKeys[i]?.deepseek||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],deepseek:v}; return n; }); }} style={{ width:'100%' }} />
        </label>
      )}
      {seats[i]==='http' && (
        <>
          <label style={{ display:'block', marginBottom:6 }}>
            HTTP Base / URL
            <input type="text" value={seatKeys[i]?.httpBase||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],httpBase:v}; return n; }); }} style={{ width:'100%' }} />
          </label>
          <label style={{ display:'block', marginBottom:6 }}>
            HTTP Token（可选）
            <input type="password" value={seatKeys[i]?.httpToken||''} onChange={e=>{ const v=e.target.value; setSeatKeys(arr=>{ const n=[...arr]; n[i]={...n[i],httpToken:v}; return n; }); }} style={{ width:'100%' }} />
          </label>
        </>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth:1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Fight the Landlord</h1>

      {/* 设置区 */}
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12 }}>
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
          </div>
          <label>局数
            <input type="number" min={1} step={1} value={rounds} onChange={e=>setRounds(Math.max(1,Math.floor(Number(e.target.value)||1)))} style={{ width:'100%' }} />
          </label>
          <div style={{ gridColumn:'1/2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:24 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                可抢地主
                <input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} />
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                农民配合
                <input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} />
              </label>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:6 }}>
              <span style={{ fontSize:12 }}>天梯 / TrueSkill</span>
              <input ref={allFileRef} type="file" accept="application/json" style={{ display:'none' }} onChange={handleAllFileUploadHome} />
              <button onClick={()=>allFileRef.current?.click()} style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>上传</button>
              <button onClick={()=>window.dispatchEvent(new Event('ddz-all-save'))} style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>存档</button>
              <button onClick={()=>livePanelRef.current?.forceApplyByCurrentId()} style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>刷新</button>
            </div>
          </div>
          <div style={{ gridColumn:'2/3' }}>
            <label>初始分
              <input type="number" step={10} value={startScore} onChange={e=>setStartScore(Number(e.target.value)||0)} style={{ width:'100%' }} />
            </label>
          </div>
          <div style={{ gridColumn:'2/3' }}>
            <label>4带2 规则
              <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{ width:'100%' }}>
                <option value="both">都可</option>
                <option value="2singles">两张单牌</option>
                <option value="2pairs">两对</option>
              </select>
            </label>
          </div>
        </div>

        <div style={{ marginTop:10, borderTop:'1px dashed #eee', paddingTop:10 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>每家 AI 设置（独立）</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[0,1,2].map(renderSeatCard)}
          </div>
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家出牌最小间隔 (ms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                  <label style={{ display:'block' }}>
                    最小间隔 (ms)
                    <input type="number" min={0} step={100} value={seatDelayMs[i]e=>{ const v=e.target.value; setSeatModels(arr=>{ const n=[...arr]; n[i]=v; return n; }); }}
            style={{ width:'100%' }}
          />
        </label>
      )}
      {/* 密钥输入省略，需要可自行补回 */}
    </div>
  );

  return (
    <div style={{ maxWidth:1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Fight the Landlord</h1>

      {/* ===== 设置面板 ===== */}
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /> 启用对局</label>
              <button onClick={doResetAll} style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>清空</button>
            </div>
            <div style={{ fontSize:12, color:'#6b7280', marginTop:4 }}>关闭后不可开始/继续对局；再次勾选即可恢复。</div>
          </div>
          <label>局数
            <input type="number" min={1} step={1} value={rounds} onChange={e=>setRounds(Math.max(1,Math.floor(Number(e.target.value)||1)))} style={{ width:'100%' }}/>
          </label>
          <div style={{ display:'flex', alignItems:'center', gap:24 }}>
            <label><input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} /> 可抢地主</label>
            <label><input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} /> 农民配合</label>
          </div>
          <label>初始分
            <input type="number" step={10} value={startScore} onChange={e=>setStartScore(Number(e.target.value)||0)} style={{ width:'100%' }}/>
          </label>
          <div>
            <label>4带2 规则
              <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{ width:'100%' }}>
                <option value="both">都可</option>
                <option value="2singles">两张单牌</option>
                <option value="2pairs">两对</option>
              </select>
            </label>
          </div>
        </div>

        <div style={{ marginTop:12 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>每家 AI 设置（独立）</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[0,1,2].map(renderSeatCard)}
          </div>
        </div>

        <div style={{ marginTop:12 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>每家出牌最小间隔 (ms)</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                <label>
                  最小间隔 (ms)
                  <input type="number" min={0} step={100} value={seatDelayMs[i]} onChange={e=>{
                    const v=Math.max(0,Math.floor(Number(e.target.value)||0));
                    setSeatDelayMs(arr=>{ const n=[...arr]; n[i]=v; return n; });
                  }} style={{ width:'100%' }}/>
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== TrueSkill 面板 + 上传/存档 ===== */}
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div style={{ fontSize:18, fontWeight:800 }}>TrueSkill 存档</div>
          <div style={{ display:'flex', gap:8 }}>
            <input ref={allFileRef} type="file" accept="application/json" style={{ display:'none' }} onChange={handleAllFileUploadHome} />
            <button onClick={()=>allFileRef.current?.click()} style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>上传</button>
            <button onClick={()=>window.dispatchEvent(new Event('ddz-all-save'))} style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>存档</button>
            <button onClick={()=>livePanelRef.current?.forceApplyByCurrentId()} style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>刷新</button>
          </div>
        </div>
        <LivePanel
          ref={livePanelRef}
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
        />
      </div>
    </div>
  );
}