// pages/index.tsx
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
/* ======= Minimal i18n (zh/en) injection: BEGIN ======= */
type Lang = 'zh' | 'en';
const LangContext = createContext<Lang>('zh');

const I18N: Record<Lang, Record<string, string>> = {
  zh: {
    Title: '斗地主 · Fight the Landlord',
    Settings: '对局设置',
    Enable: '启用对局',
    Reset: '清空',
    EnableHint: '关闭后不可开始/继续对局；再次勾选即可恢复。',
    LadderTitle: '天梯图（活动积分 ΔR）',
    LadderRange: '范围 ±K（按局面权重加权，当前 K≈{K}；未参赛=历史或0）',
    Pass: '过',
    Play: '出牌',
    Empty: '（空）',
    Upload: '上传',
    Save: '存档',
    FarmerCoop: '农民配合',
  },
  en: {
    Title: 'Fight the Landlord',
    Settings: 'Match settings',
    Enable: 'Enable match',
    Reset: 'Reset',
    EnableHint: 'Disabled matches cannot start/continue; tick again to restore.',
    LadderTitle: 'Ladder (ΔR)',
    LadderRange: 'Range ±K (weighted by situation, current K≈{K}; no-participation = history or 0)',
    Pass: 'Pass',
    Play: 'Play',
    Empty: '(empty)',
    Upload: 'Upload',
    Save: 'Save',
    FarmerCoop: 'Farmer cooperation',
  }
};

function useI18n() {
  const lang = useContext(LangContext);
  const t = (key: string, vars: Record<string, any> = {}) => {
    let s = (I18N[lang]?.[key] ?? I18N.zh[key] ?? key);
    s = s.replace(/\{(\w+)\}/g, (_: any, k: string) => (vars[k] ?? `{${k}}`));
    return s;
  };
  return { lang, t };
}

function seatLabel(i: number, lang: Lang) {
  return (lang === 'en' ? ['A', 'B', 'C'] : ['甲', '乙', '丙'])[i] || String(i);
}
/* ======= Minimal i18n (zh/en) injection: END ======= */

/* ======= UI auto-translation utilities (DOM walker) ======= */
type TransRule = { zh: string | RegExp; en: string };

const TRANSLATIONS: TransRule[] = [
  { zh: '存档', en: 'Save' },
  { zh: '上传', en: 'Upload' },
  { zh: '下载', en: 'Download' },
  { zh: '导出', en: 'Export' },
  { zh: '导入', en: 'Import' },
  { zh: '刷新', en: 'Refresh' },
  { zh: '运行日志', en: 'Run Log' },
  { zh: '对局设置', en: 'Match settings' },
  { zh: '启用对局', en: 'Enable match' },
  { zh: '清空', en: 'Reset' },
  { zh: '出牌', en: 'Play' },
  { zh: '过', en: 'Pass' },
  { zh: '（空）', en: '(empty)' },
  { zh: '地主', en: 'Landlord' },
  { zh: '农民', en: 'Farmer' },
  { zh: '农民配合', en: 'Farmer cooperation' },
  { zh: '开始', en: 'Start' },
  { zh: '暂停', en: 'Pause' },
  { zh: '继续', en: 'Resume' },
  { zh: '停止', en: 'Stop' },
  { zh: '天梯图', en: 'Ladder' },
  { zh: '活动积分', en: 'ΔR' },
  { zh: '范围', en: 'Range' },
  { zh: '当前', en: 'Current' },
  { zh: '未参赛', en: 'Not played' },
  { zh: '历史', en: 'History' },

  // === Added for full UI coverage ===
  { zh: '局数', en: 'Rounds' },
  { zh: '初始分', en: 'Initial Score' },
  { zh: /4带2\s*规则/, en: '4-with-2 Rule' },
  { zh: '都可', en: 'Allowed' },
  { zh: '不可', en: 'Not allowed' },
  { zh: '选择', en: 'Select' },
  { zh: /每家AI设置（独立）|每家AI设置\s*\(独立\)/, en: 'Per-player AI (independent)' },
  { zh: /每家出牌最小间隔（ms）|每家出牌最小间隔\s*\(ms\)/, en: 'Per-player min play interval (ms)' },
  { zh: /每家思考超时（秒）|每家思考超时\s*\(秒\)/, en: 'Per-player think timeout (s)' },
  { zh: /最小间隔（ms）|最小间隔\s*\(ms\)/, en: 'Min interval (ms)' },
  { zh: /弃牌时间（秒）|弃牌时间\s*\(秒\)/, en: 'Discard time (s)' },
  { zh: /（独立）|\(独立\)/, en: '(independent)' },
  { zh: /（ms）|\(ms\)/, en: '(ms)' },
  { zh: /（秒）|\(秒\)/, en: '(s)' },
  { zh: /天梯\s*\/\s*TrueSkill/, en: 'Ladder / TrueSkill' },
  { zh: '可抢地主', en: 'Outbid the landlord' },
  { zh: '局', en: 'round(s)' },
  { zh: '开始', en: 'Start' },
  { zh: '暂停', en: 'Pause' },
  { zh: '继续', en: 'Resume' },
  { zh: '停止', en: 'Stop' },

  // === Added for extended UI coverage (batch 2) ===
  { zh: '甲', en: 'A' },
  { zh: '乙', en: 'B' },
  { zh: '丙', en: 'C' },

  { zh: '对局', en: 'Match' },
  { zh: /TrueSkill（实时）|TrueSkill\s*\(实时\)/, en: 'TrueSkill (live)' },
  { zh: /当前使用：?/, en: 'Current: ' },
  { zh: '总体档', en: 'Overall' },

  { zh: /战术画像（累计，0[-~~—––]5）|战术画像（累计，0~5）|战术画像\s*\(累计[,，]?\s*0\s*[-–~]\s*5\)/, en: 'Tactical profile (cumulative, 0–5)' },
  { zh: /汇总方式\s*指数加权（推荐）|汇总方式\s*指数加权\s*\(推荐\)/, en: 'Aggregation: exponentially weighted (recommended)' },

  { zh: /出牌评分（每局动态）|出牌评分\s*\(每局动态\)/, en: 'Play score (per hand, dynamic)' },
  { zh: /评分统计（每局汇总）|评分统计\s*\(每局汇总\)/, en: 'Score stats (per hand, summary)' },

  { zh: '最近一局均值：', en: 'Last-hand mean: ' },
  { zh: '最好局均值：', en: 'Best-hand mean: ' },
  { zh: '最差局均值：', en: 'Worst-hand mean: ' },
  { zh: '总体均值：', en: 'Overall mean: ' },
  { zh: '局数：', en: 'Hands: ' },

  { zh: '手牌', en: 'Cards on hand' },
  { zh: '结果', en: 'Result' },
  { zh: '倍数', en: 'Multiplier' },
  { zh: '胜者', en: 'Winner' },
  { zh: '本局加减分', en: 'Points this hand' },

  { zh: /（尚无出牌）|\(尚无出牌\)/, en: '(no plays yet)' },

  { zh: '剩余局数：', en: 'Remaining hands: ' },
  { zh: '剩余局数', en: 'Remaining hands' },

  // === Added for extended UI coverage (batch 3) ===
  { zh: /每家\s*AI\s*设置/, en: 'Per-player AI settings' },
  { zh: /（独立）/, en: '(independent)' },
  { zh: /\(独立\)/, en: '(independent)' },

  { zh: '总体档', en: 'Overall' },
  { zh: /总体(?!均值)/, en: 'Overall' },

  { zh: '汇总方式', en: 'Aggregation' },
  { zh: '指数加权（推荐）', en: 'Exponentially weighted (recommended)' },
  { zh: /\(推荐\)/, en: '(recommended)' },
  { zh: /越大越看重最近几局/, en: 'Larger value emphasizes recent hands' },
  { zh: /（等待至少一局完成后生成累计画像）/, en: '(Generated after at least one hand completes)' },
  { zh: /\(等待至少一局完成后生成累计画像\)/, en: '(Generated after at least one hand completes)' },

  { zh: /横轴[:：]\s*/, en: 'X-axis: ' },
  { zh: /纵轴[:：]\s*/, en: 'Y-axis: ' },
  { zh: /第几手牌/, en: 'hand index' },

  // === Added for extended UI coverage (batch 4) ===
  { zh: /按[“\"“]?内置\/AI\+模型\/版本\(\+HTTP Base\)[”\"”]?识别，并区分地主\/农民。?/, en: 'Recognize by "built-in/AI+model/version (+HTTP Base)" and distinguish Landlord/Farmer.' },
  { zh: /说明[:：]\s*CR 为置信下界（越高越稳）；每局结算后自动更新（也兼容后端直接推送 TS）。?/, en: 'Note: CR is the lower confidence bound (higher is more stable); updates after each hand (also supports backend-pushed TS).' },
  { zh: /每局开始时底色按[“\"“]?本局地主[”\"”]?的线色变化提示；上传文件可替换\/叠加历史，必要时点[“\"“]?刷新[”\"”]?。?/, en: 'At the start of each hand, background follows the current Landlord color; uploads can replace/append history; click "Refresh" if needed.' },
  { zh: /α/, en: 'alpha' },  // symbol label near alpha
  { zh: /指数加权（推荐）/, en: 'Exponentially weighted (recommended)' },
  { zh: /当前使用[:：]\s*/, en: 'Current: ' },
  { zh: /总体档/, en: 'Overall' },
  { zh: /总体(?!均值)/, en: 'Overall' },

  { zh: '关闭后不可开始/继续对局；再次勾选即可恢复。', en: 'Disabled matches cannot start/continue; tick again to restore.' },
];
function hasChinese(s: string) { return /[\u4e00-\u9fff]/.test(s); }

function translateTextLiteral(s: string): string {
  let out = s;
  for (const r of TRANSLATIONS) {
    if (typeof r.zh === 'string') {
      if (out === r.zh) out = r.en;
    } else {
      out = out.replace(r.zh, r.en);
    }
  }
  return out;
}

function autoTranslateContainer(root: HTMLElement | null, lang: Lang) {
  if (!root) return;
  const tags = new Set(['BUTTON','LABEL','DIV','SPAN','P','H1','H2','H3','H4','H5','H6','TD','TH','A','LI','STRONG','EM','SMALL','CODE','OPTION']);
  const accept = (node: any) => {
    const el = node.parentElement as HTMLElement | null;
    if (!el) return NodeFilter.FILTER_REJECT;
    if (!tags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
    if (el.closest('[data-i18n-ignore]')) return NodeFilter.FILTER_REJECT;
    const txt = String(node.nodeValue || '').trim();
    if (!txt || !/[\u4e00-\u9fff]/.test(txt)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  };
  const apply = (scope: HTMLElement) => {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: accept } as any);
    let n: any;
    while ((n = walker.nextNode())) {
      const textNode = n as Text;
      const el = textNode.parentElement as HTMLElement | null;
      if (!el) continue;
      if (lang === 'zh') {
        const orig = el.getAttribute('data-i18n-orig');
        if (orig != null) textNode.nodeValue = orig;
      } else {
        if (!el.hasAttribute('data-i18n-orig')) el.setAttribute('data-i18n-orig', textNode.nodeValue || '');
        const v = textNode.nodeValue || '';
        if (/[\u4e00-\u9fff]/.test(v)) textNode.nodeValue = translateTextLiteral(v);
        if (el) el.setAttribute('data-i18n-en', textNode.nodeValue || '');
      }
    }
  };
  // initial pass
  apply(root);
  // observe dynamic updates once
  if (typeof MutationObserver !== 'undefined' && !root.hasAttribute('data-i18n-observed')) {
    let i18nBatchQueue = new Set<HTMLElement>();
    let i18nBatchScheduled = false;
    const i18nSchedule = () => {
      if (i18nBatchScheduled) return;
      i18nBatchScheduled = true;
      requestAnimationFrame(() => {
        i18nBatchScheduled = false;
        i18nBatchQueue.forEach(n => { try { apply(n); } catch {} });
        i18nBatchQueue.clear();
      });
    };
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          (m.addedNodes || []).forEach((node: any) => {
            if (node && node.nodeType === 1) { i18nBatchQueue.add(node as HTMLElement); i18nSchedule(); }
          });
        } else if (m.type === 'characterData' && m.target && (m.target as any).parentElement) {
          i18nBatchQueue.add((m.target as any).parentElement as HTMLElement); i18nSchedule();
        }
      }
    });
    obs.observe(root, { childList: true, characterData: true, subtree: true });
    root.setAttribute('data-i18n-observed', '1');
  }
}

// --- i18n click-compat shim ---
// Ensures buttons translated to English still work if code checks Chinese text at click time.
if (typeof document !== 'undefined' && !document.body.hasAttribute('data-i18n-click-swapper')) {
  document.addEventListener('click', (ev) => {
    try {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const el = (target.closest('button, [role="button"], .btn, .Button') as HTMLElement) || null;
      if (!el) return;
      if (document.documentElement.lang !== 'en') return;
      const zh = el.getAttribute('data-i18n-orig');
      const en = el.getAttribute('data-i18n-en');
      const current = (el.textContent || '').trim();
      if (zh && en && current === en.trim()) {
        el.textContent = zh;
        setTimeout(() => { try { if (el.isConnected) el.textContent = en; } catch {} }, 0);
      }
    } catch {}
  }, true); // capture phase, before app handlers
  document.body.setAttribute('data-i18n-click-swapper', '1');
}

type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:mininet'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'human'
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
  turnTimeoutSecs?: number[];
};

function SeatTitle({ i }: { i:number }) {
  const { lang } = useI18n();
  return <span style={{ fontWeight:700 }}>{seatLabel(i, lang)}</span>;
}


type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];
const seatName = (i:number)=>['甲','乙','丙'][i] || String(i);

const rankOf = (l: string): string => {
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
  const { t } = useI18n();
  if (!cards || cards.length === 0) return <span style={{ opacity: 0.6 }}>{t('Empty')}</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {cards.map((c, idx) => <Card key={`${c}-${idx}`} label={c} />)}
    </div>
  );
}
function PlayRow({ seat, move, cards, reason }:{ seat:number; move:'play'|'pass'; cards?:string[]; reason?:string }) {
  const { t, lang } = useI18n();

  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0' }}>
      <div style={{ width:32, textAlign:'right', opacity:0.8 }}>{seatLabel(seat, lang)}</div>
      <div style={{ width:56, fontWeight:700 }}>{move === 'pass' ? t('Pass') : t('Play')}</div>
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
  const { t } = useI18n();
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
        <div style={{ fontWeight:700 }}>{t('LadderTitle')}</div>
        <div style={{ fontSize:12, color:'#6b7280' }}>{t('LadderRange', { K })}</div>
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
    case 'human':                 return 'Human';
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
/* ---------- 文本改写：把“第 x 局”固定到本局 ---------- */
const makeRewriteRoundLabel = (n: number) => (msg: string): string => {
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

  const submitHuman = async (move:'play'|'pass')=>{
    const seat = humanAwaitSeat;
    if (seat==null) return;
    if (move === 'play' && humanSel.length === 0) {
      setLog(l => [...l, '请选择牌']);
      return;
    }
    const body:any = {
      humanMove: {
        seat,
        move,
        cards: move==='play' ? humanSel.map(s=>{
          if (s.startsWith('🃏')) return s.includes('Y')?'X':'x';
          return s.slice(-1);
        }) : []
      },
      clientTraceId: traceIdRef.current
    };
    try {
      await fetch('/api/stream_ndjson', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      setHumanSel([]); setHumanAwaitSeat(null);
    } catch (e) { 
      console.error('[human move] submit fail', e); 
      setLog(l => [...l, `Human submit failed: ${e}`]);
    }
  };

  // —— Human play ——
  const [humanAwaitSeat, setHumanAwaitSeat] = useState<number|null>(null);
  const [humanSel, setHumanSel] = useState<string[]>([]);
  const traceIdRef = useRef<string>('');
  const isHumanSeat = (i:number)=> (props.seats?.[i] === 'human');

  const toggleCard = (label:string)=>{
    setHumanSel(prev => prev.includes(label) ? prev.filter(x=>x!==label) : [...prev, label]);
  };
  const undecorateToRaw = (labels:string[]) => labels.map(s => {
    if (s.startsWith('🃏')) {
      return s.includes('Y') ? 'X' : 'x';
    }
    return s.slice(-1);
  });
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
  const recomputeScoreStats = useCallback(() => {
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
  }, []);
  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries, recomputeScoreStats]);

  // —— TrueSkill（前端实时） —— //
  const [tsArr, setTsArr] = useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
  const tsRef = useRef(tsArr); useEffect(()=>{ tsRef.current=tsArr; }, [tsArr]);
  const tsCr = (r:Rating)=> (r.mu - 3*r.sigma);

  // ===== 新增：TS 存档（读/写/应用） =====
  const tsStoreRef = useRef<TsStore>(emptyStore());
  useEffect(()=>{ try { tsStoreRef.current = readStore(); } catch {} }, []);
  const fileRef = useRef<HTMLInputElement|null>(null);

  const seatIdentity = (i:number): string => {
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
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
    setLog(l => [...l, '【TS】已导出当前存档。']);
  };

  // —— 用于“区分显示”的帮助函数 —— //
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
  const writeRadarStore = (s: RadarStore) => { try { s.updatedAt = new Date().toISOString(); localStorage.setItem(RADAR_STORE_KEY, JSON.stringify(s)); } catch {} };

  /** 用“均值 + 次数”合并（与前端 mean 聚合一致） */
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

  const [aggStats, setAggStats] = useState<Score5[]>([
    { coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 },
    { coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 },
    { coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 },
  ]);
  const [aggCount, setAggCount] = useState(0);
  const [aggMode, setAggMode] = useState<'mean'|'ewma'>('ewma');
  const [alpha, setAlpha] = useState(0.35);

  /** 根据当前地主身份（已知/未知）把存档套到 UI 的 aggStats/aggCount */
  const applyRadarFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0,1,2].map(seatIdentity);
    const s3 = [0,1,2].map(i=>{
      const role = (lord==null) ? undefined : (i===lord ? 'landlord' : 'farmer');
      return resolveRadarForIdentity(ids[i], role) || { scores: { coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5 }, count: 0 };
    });
    setAggStats(s3.map(x=>({ ...x.scores })));
    setAggCount(Math.max(s3[0].count, s3[1].count, s3[2].count));
    setLog(l => [...l, `【Radar】已从存档应用（${why}，地主=${lord ?? '未知'}）`]);
  };

  /** 在收到一帧“本局画像 s3[0..2]”后，写入 Radar 存档（overall + 角色分档） */
  const updateRadarStoreFromStats = (s3: Score5[], lord: number | null) => {
    const ids = [0,1,2].map(seatIdentity);
    for (let i=0;i<3;i++){
      const id = ids[i];
      const entry: RadarStoreEntry = radarStoreRef.current.players[id] || { id, roles:{} };
      entry.overall = mergeRadarAgg(entry.overall, s3[i]);
      const role: 'landlord'|'farmer' = (i===lord) ? 'landlord' : 'farmer';
      entry.roles = entry.roles || {};
      entry.roles[role] = mergeRadarAgg(entry.roles[role], s3[i]);
      const choice = props.seats[i];
      const model  = (props.seatModels[i] || '').trim();
      const base   = choice==='http' ? (props.seatKeys[i]?.httpBase || '') : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      radarStoreRef.current.players[id] = entry;
    }
    writeRadarStore(radarStoreRef.current);
  };

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

  // Placeholder for remaining games count
  const remainingGames = props.rounds - finishedCount;

  // Placeholder for start/stop functions (implement as needed)
  const start = () => { setRunning(true); /* implement */ };
  const stop = () => { setRunning(false); /* implement */ };

  // Placeholder for agentIdForIndex
  const agentIdForIndex = (i: number) => seatIdentity(i);

  // Placeholder for allLogsRef
  const allLogsRef = useRef<string[]>([]);

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* ========= TrueSkill（实时） ========= */}
      <Section title="TrueSkill（实时）">
        {/* 上传 / 存档 / 刷新 */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
          <input ref={fileRef} type="file" accept="application/json" onChange={handleUploadFile} style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>{t('Upload')}</button>
          <button onClick={handleSaveArchive} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>{t('Save')}</button>
          <div style={{ fontSize:12, color:'#6b7280' }}>按“内置/AI+模型/版本(+HTTP Base)”识别，并区分地主/农民。</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>{
            const stored = getStoredForSeat(i);
            const usingRole: 'overall'|'landlord'|'farmer' =
              landlord==null ? 'overall' : (landlord===i ? 'landlord' : 'farmer');
            return (
              <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <div><SeatTitle i={i}/> {landlord===i && <span style={{ marginLeft:6, color:'#bf7f00' }}>（地主）</span>}</div>
                </div>
                <div style={{ fontSize:13, color:'#374151' }}>
                  <div>μ：<b>{fmt2(tsArr[i].mu)}</b></div>
                  <div>σ：<b>{fmt2(tsArr[i].sigma)}</b></div>
                  <div>CR = μ − 3σ：<b>{fmt2(tsCr(tsArr[i]))}</b></div>
                </div>

                {/* 区分显示总体/地主/农民三档，并标注当前使用 */}
                <div style={{ borderTop:'1px dashed #eee', marginTop:8, paddingTop:8 }}>
                  <div style={{ fontSize:12, marginBottom:6 }}>
                    当前使用：<b>
                      {usingRole === 'overall' ? '总体档' : usingRole === 'landlord' ? '地主档' : '农民档'}
                    </b>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, fontSize:12, color:'#374151' }}>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>总体</div>
                      <div>{muSig(stored.overall)}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>地主</div>
                      <div>{muSig(stored.landlord)}</div>
                    </div>
                    <div>
                      <div style={{ fontWeight:600, opacity:0.8 }}>农民</div>
                      <div>{muSig(stored.farmer)}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize:12, color:'#6b7280', marginTop:6 }}>
          说明：CR 为置信下界（越高越稳）；每局结算后自动更新（也兼容后端直接推送 TS）。</div>
      </Section>

      {/* ======= 积分下面、手牌上面：雷达图 ======= */}
      <Section title="战术画像（累计，0~5）">
        {/* Radar：上传 / 存档 / 刷新 */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
          <input ref={radarFileRef} type="file" accept="application/json" onChange={handleUploadFile} style={{ display: 'none' }} />
          <button onClick={() => radarFileRef.current?.click()} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>{t('Upload')}</button>
          <button onClick={handleSaveArchive} style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>{t('Save')}</button>
          <div style={{ fontSize:12, color:'#6b7280' }}>按“内置/AI+模型/版本(+HTTP Base)”识别，并区分地主/农民。</div>
        </div>

        <RadarPanel
          aggStats={aggStats}
          aggCount={aggCount}
          aggMode={aggMode}
          alpha={alpha}
          onChangeMode={setAggMode}
          onChangeAlpha={setAlpha}
        />
      </Section>

      
      <Section title="出牌评分（每局动态）">
        
<div style={{ fontSize:12, color:'#6b7280', marginBottom:6 }}>每局开始底色按“本局地主”的线色淡化显示；上传文件可替换/叠加历史，必要时点“刷新”。</div>
        <ScoreTimeline series={scoreSeries} bands={roundCuts} landlords={roundLords} labels={[0,1,2].map(i=>agentIdForIndex(i))} height={240} />
      </Section>
      <div style={{ marginTop:10 }}></div>
      <Section title="评分统计（每局汇总）">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          {[0,1,2].map(i=>{
            const st = scoreStats[i];
            return (
              <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8, background:'#fff' }}>
                <div style={{ fontWeight:700, marginBottom:6 }}><SeatTitle i={i} /></div>
                <div style={{ fontSize:12, color:'#6b7280' }}>局数：{st.rounds}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>总体均值：{st.overallAvg.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最近一局均值：{st.lastAvg.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最好局均值：{st.best.toFixed(3)}</div>
                <div style={{ fontSize:12, color:'#6b7280' }}>最差局均值：{st.worst.toFixed(3)}</div>
                {/* 分布直方图（每手score汇总：横轴=score，纵轴=频次；固定20桶） */}
                {(() => {
                  const samples = (scoreSeries[i] || []).filter(v => typeof v === 'number' && !Number.isNaN(v)) as number[];
                  if (!samples.length) return null;
                  const pad = 6, W = 220, H = 72;
                  // μ & σ 基于所有出牌评分样本
                  const mu = samples.reduce((a,b)=>a+b,0) / samples.length;
                  const sg = Math.sqrt(Math.max(0, samples.reduce((a,b)=>a + (b-mu)*(b-mu), 0) / samples.length));
                  // 固定20桶
                  const bins = 20;
                  const lo = Math.min(...samples);
                  const hi0 = Math.max(...samples);
                  const hi = hi0===lo ? lo + 1 : hi0; // 防零宽
                  const x = (v:number)=> pad + (hi>lo ? (v-lo)/(hi-lo) : 0.5) * (W - 2*pad);
                  const barW = (W - 2*pad) / bins;
                  // 计数
                  const counts = new Array(bins).fill(0);
                  for (const v of samples) {
                    let k = Math.floor((v - lo) / (hi - lo) * bins);
                    if (k < 0) k = 0; if (k >= bins) k = bins - 1;
                    counts[k]++;
                  }
                  const binWidthVal = (hi - lo) / bins;
                  const densities = counts.map(c => c / (samples.length * (binWidthVal || 1)));
                  const maxD = Math.max(...densities) || 1;
                  const bars = densities.map((d, k) => {
                    const x0 = pad + k * barW + 0.5;
                    const h = (H - 2*pad) * (d / maxD);
                    const y0 = H - pad - h;
                    return <rect key={k} x={x0} y={y0} width={Math.max(1, barW - 1)} height={Math.max(0, h)} fill="#9ca3af" opacity={0.45} />;
                  });
                  // μ & ±1σ 标注
                  const meanX = x(mu);
                  const sigL = x(mu - sg);
                  const sigR = x(mu + sg);
                  return (
                    <svg width={W} height={H} style={{ display:'block', marginTop:6 }}>
                      <rect x={0} y={0} width={W} height={H} fill="#ffffff" stroke="#e5e7eb"/>
                      {bars}
                      <line x1={meanX} y1={pad} x2={meanX} y2={H-pad} stroke="#ef4444" strokeDasharray="4 3" />
                      <line x1={sigL} y1={pad} x2={sigL} y2={H-pad} stroke="#60a5fa" strokeDasharray="2 3" />
                      <line x1={sigR} y1={pad} x2={sigR} y2={H-pad} stroke="#60a5fa" strokeDasharray="2 3" />
                      <text x={meanX+4} y={12} fontSize={10} fill="#ef4444">μ={mu.toFixed(2)}</text>
                      <text x={sigL+4} y={24} fontSize={10} fill="#60a5fa">-1σ</text>
                      <text x={sigR+4} y={24} fontSize={10} fill="#60a5fa">+1σ</text>
                    </svg>
                  );
                })()}
        
              </div>
            );
          })}
        </div>
      </Section>

<Section title="手牌">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8, position:'relative' }}>
                            <div style={{ position:'absolute', top:8, right:8, fontSize:16, fontWeight:800, background:'#fff', border:'1px solid #eee', borderRadius:6, padding:'2px 6px' }}>{totals[i]}</div>
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
        <Section title="">
  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
    <div style={{ fontWeight:700 }}>运行日志</div>
    <button
      onClick={() => {
        try { 
          const lines=(allLogsRef.current||[]) as string[]; 
          const ts=new Date().toISOString().replace(/[:.]/g,'-'); 
          const text=lines.length?lines.join('\n'):'（暂无）'; 
          const blob=new Blob([text],{type:'text/plain;charset=utf-8'}); 
          const url=URL.createObjectURL(blob); 
          const a=document.createElement('a'); 
          a.href=url; 
          a.download=`run-log_${ts}.txt`; 
          a.click(); 
          setTimeout(()=>URL.revokeObjectURL(url),1200);
        } catch(e){ console.error('[runlog] save error', e); } 
      }}
      style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >存档</button>
  </div>

<div style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px', maxHeight:420, overflow:'auto', background:'#fafafa' }}>
            {log.length === 0 ? <div style={{ opacity:0.6 }}>（暂无）</div> : log.map((t, idx) => <LogLine key={idx} text={t} />)}
          </div>
        
</Section>
      </div>
    </div>

      {/* Human play panel */}
      {humanAwaitSeat!=null && (
        <div style={{ position:'fixed', left:20, right:20, bottom:20, background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:12, boxShadow:'0 8px 28px rgba(0,0,0,0.18)', zIndex:50 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ fontWeight:800 }}>玩家出牌（{['甲','乙','丙'][humanAwaitSeat]}）</div>
            <button onClick={()=>{ setHumanAwaitSeat(null); setHumanSel([]); }} style={{ border:'1px solid #eee', borderRadius:8, padding:'4px 8px', background:'#fff' }}>关闭</button>
          </div>
          <div style={{ fontSize:12, color:'#6b7280', marginBottom:8 }}>点击选择要出的牌，再点“出牌”。如要过牌，直接点“过”。</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:10 }}>
            {(hands[humanAwaitSeat]||[]).map((c:string,idx:number)=>(
              <button key={idx} onClick={()=>toggleCard(c)}
                style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:10, background: humanSel.includes(c)?'#eff6ff':'#fff' }}>
                {c}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>submitHuman('play')} style={{ padding:'8px 14px', border:'1px solid #16a34a', color:'#16a34a', background:'#fff', borderRadius:10, fontWeight:700 }}>出牌</button>
            <button onClick={()=>submitHuman('pass')} style={{ padding:'8px 14px', border:'1px solid #ef4444', color:'#ef4444', background:'#fff', borderRadius:10, fontWeight:700 }}>过</button>
          </div>
        </div>
      )}

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

/* ================ 实时曲线：每手牌得分（按地主淡色分局） ================= */
function ScoreTimeline(
  { series, bands = [], landlords = [], labels = ['甲','乙','丙'], height = 220 }:
  { series:(number|null)[][]; bands?:number[]; landlords?:number[]; labels?:string[]; height?:number }
) {
  const ref = useRef<HTMLDivElement|null>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<null | { si:number; idx:number; x:number; y:number; v:number }>(null);

  useEffect(()=>{
    const el = ref.current; if(!el) return;
    const ro = new ResizeObserver(()=> setW(el.clientWidth || 600));
    ro.observe(el);
    return ()=> ro.disconnect();
  }, []);

  const data = series || [[],[],[]];
  const n = Math.max(data[0]?.length||0, data[1]?.length||0, data[2]?.length||0);
  const values:number[] = [];
  for (const arr of data) for (const v of (arr||[])) if (typeof v==='number') values.push(v);
  const vmin = values.length ? Math.min(...values) : -5;
  const vmax = values.length ? Math.max(...values) : 5;
  const pad = (vmax - vmin) * 0.15 + 1e-6;
  const y0 = vmin - pad, y1 = vmax + pad;

  const width = Math.max(320, w);
  const heightPx = height;
  const left = 36, right = 10, top = 10, bottom = 22;
  const iw = Math.max(10, width - left - right);
  const ih = Math.max(10, heightPx - top - bottom);

  const x = (i:number)=> (n<=1 ? 0 : (i/(n-1))*iw);
  const y = (v:number)=> ih - ( (v - y0) / (y1 - y0) ) * ih;

  const colorLine = ['#ef4444', '#3b82f6', '#10b981'];
  const colorBand = ['rgba(239,68,68,0.08)','rgba(59,130,246,0.08)','rgba(16,185,129,0.10)'];
  const colors = colorLine;

  const cuts = Array.isArray(bands) && bands.length ? [...bands] : [0];
  cuts.sort((a,b)=>a-b);
  if (cuts[0] !== 0) cuts.unshift(0);
  if (cuts[cuts.length-1] !== n) cuts.push(n);

  const landlordsArr = Array.isArray(landlords) ? landlords.slice(0) : [];
  while (landlordsArr.length < Math.max(0, cuts.length-1)) landlordsArr.push(-1);

  // —— 底色兜底：把未知地主段回填为最近一次已知的地主（前向填充 + 首段回填） ——
  const segCount = Math.max(0, cuts.length - 1);
  const landlordsFilled = landlordsArr.slice(0, segCount);
  while (landlordsFilled.length < segCount) landlordsFilled.push(-1);
  for (let j=0; j<landlordsFilled.length; j++) {
    const v = landlordsFilled[j];
    if (!(v===0 || v===1 || v===2)) landlordsFilled[j] = j>0 ? landlordsFilled[j-1] : landlordsFilled[j];
  }
  if (landlordsFilled.length && !(landlordsFilled[0]===0 || landlordsFilled[0]===1 || landlordsFilled[0]===2)) {
    const k = landlordsFilled.findIndex(v => v===0 || v===1 || v===2);
    if (k >= 0) { for (let j=0; j<k; j++) landlordsFilled[j] = landlordsFilled[k]; }
  }

  const makePath = (arr:(number|null)[])=>{
    let d=''; let open=false;
    const cutSet = new Set(cuts);
    for (let i=0;i<n;i++){
      if (cutSet.has(i) && i!==0) { open = false; }
      const v = arr[i];
      if (typeof v !== 'number') { open=false; continue; }
      const px = x(i), py = y(v);
      d += (open? ` L ${px} ${py}` : `M ${px} ${py}`);
      open = true;
    }
    return d;
  };

  // x 轴刻度（最多 12 个）
  const ticks = []; const maxTicks = 12;
  for (let i=0;i<n;i++){
    const step = Math.ceil(n / maxTicks);
    if (i % step === 0) ticks.push(i);
  }
  // y 轴刻度（5 条）
  const yTicks = []; for (let k=0;k<=4;k++){ yTicks.push(y0 + (k/4)*(y1-y0)); }

  // —— 悬浮处理 —— //
  const seatName = (i:number)=> labels?.[i] ?? ['甲','乙','丙'][i];
  const showTip = (si:number, idx:number, v:number) => {
    setHover({ si, idx, v, x: x(idx), y: y(v) });
  };
  const hideTip = () => setHover(null);

  // 估算文本宽度（无需测量 API）
  const tipText = hover ? `${seatName(hover.si)} 第${hover.idx+1}手：${hover.v.toFixed(2)}` : '';
  const tipW = 12 + tipText.length * 7;  // 近似
  const tipH = 20;
  const tipX = hover ? Math.min(Math.max(0, hover.x + 10), Math.max(0, iw - tipW)) : 0;
  const tipY = hover ? Math.max(0, hover.y - (tipH + 10)) : 0;

  return (
    <div ref={ref} style={{ width:'100%' }}>
      <svg width={width} height={heightPx} style={{ display:'block', width:'100%' }}>
        <g transform={`translate(${left},${top})`} onMouseLeave={hideTip}>
          {/* 按地主上色的局间底色 */}
          {cuts.slice(0, Math.max(0, cuts.length-1)).map((st, i)=>{
            const ed = cuts[i+1];
            if (ed <= st) return null;
            const x0 = x(st);
            const x1 = x(Math.max(st, ed-1));
            const w  = Math.max(0.5, x1 - x0);
            const lord = landlordsFilled[i] ?? -1;
            const fill = (lord===0||lord===1||lord===2) ? colorBand[lord] : (i%2===0 ? '#ffffff' : '#f8fafc');
            return <rect key={'band'+i} x={x0} y={0} width={w} height={ih} fill={fill} />;
          })}

          {/* 网格 + 轴 */}
          <line x1={0} y1={ih} x2={iw} y2={ih} stroke="#e5e7eb" />
          <line x1={0} y1={0} x2={0} y2={ih} stroke="#e5e7eb" />
          {yTicks.map((v,i)=>(
            <g key={i} transform={`translate(0,${y(v)})`}>
              <line x1={0} y1={0} x2={iw} y2={0} stroke="#f3f4f6" />
              <text x={-6} y={4} fontSize={10} fill="#6b7280" textAnchor="end">{v.toFixed(1)}</text>
            </g>
          ))}
          {ticks.map((i,idx)=>(
            <g key={idx} transform={`translate(${x(i)},0)`}>
              <line x1={0} y1={0} x2={0} y2={ih} stroke="#f8fafc" />
              <text x={0} y={ih+14} fontSize={10} fill="#6b7280" textAnchor="middle">{i+1}</text>
            </g>
          ))}

          {/* 三条曲线 + 数据点 */}
          {data.map((arr, si)=>(
            <g key={'g'+si}>
              <path d={makePath(arr)} fill="none" stroke={colors[si]} strokeWidth={2} />
              {arr.map((v,i)=> (typeof v==='number') && (
                <circle
                  key={'c'+si+'-'+i}
                  cx={x(i)} cy={y(v)} r={2.5} fill={colors[si]}
                  style={{ cursor:'crosshair' }}
                  onMouseEnter={()=>showTip(si, i, v)}
                  onMouseMove={()=>showTip(si, i, v)}
                  onMouseLeave={hideTip}
                >
                  {/* 备用：系统 tooltip（可保留） */}
                  <title>{`${seatName(si)} 第${i+1}手：${v.toFixed(2)}`}</title>
                </circle>
              ))}
            </g>
          ))}

          {/* 悬浮提示框 */}
          {hover && (
            <g transform={`translate(${tipX},${tipY})`} pointerEvents="none">
              <rect x={0} y={0} width={tipW} height={tipH} rx={6} ry={6} fill="#111111" opacity={0.9} />
              <text x={8} y={13} fontSize={11} fill="#ffffff">{tipText}</text>
            </g>
          )}
        </g>
      </svg>

      {/* 图例 */}
      <div style={{ display:'flex', gap:12, marginTop:6, fontSize:12, color:'#374151' }}>
        {[0,1,2].map(i=>(
          <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:10, height:10, borderRadius:5, background:colors[i], display:'inline-block' }} />
            <span>{labels?.[i] ?? ['甲','乙','丙'][i]}</span>
          </div>
        ))}
        <div style={{ marginLeft:'auto', color:'#6b7280' }}>横轴：第几手牌 ｜ 纵轴：score</div>
      </div>
    </div>
  );
}

/* ================ 雷达图（0~5） ================= */
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
      <div style={{ minWidth:60, fontSize:12, color:'#374151' }}>{title}</div>
    </div>
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
  // 让选择提供商时自动写入推荐模型；避免初始就带上 OpenAI 的模型名
  seatModels: ['', '', ''],
  seatKeys: [{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }] as any[],
};

function Home() {
  // Ensure language applies before paint on refresh
  useLayoutEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const v = localStorage.getItem('ddz_lang');
        if (v === 'en' || v === 'zh') {
          if (v !== lang) setLang(v as Lang);
          if (typeof document !== 'undefined') document.documentElement.lang = v;
        }
      }
    } catch {}
  }, []);

  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'zh';
    const v = localStorage.getItem('ddz_lang');
    return (v === 'en' || v === 'zh') ? (v as Lang) : 'zh';
  });
  useEffect(()=>{
    try {
      localStorage.setItem('ddz_lang', lang);
      if (typeof document !== 'undefined') document.documentElement.lang = lang;
    } catch {}
  }, [lang]);
  const mainRef = useRef<HTMLDivElement | null>(null);
  useEffect(()=>{ try { if (typeof document !== 'undefined') autoTranslateContainer(mainRef.current, lang); } catch {} }, [lang]);


  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [turnTimeoutSecs, setTurnTimeoutSecs] = useState<number[]>([30,30,30]);

  const [turnTimeoutSec, setTurnTimeoutSec] = useState<number>(30);

  const [rob, setRob] = useState<boolean>(DEFAULTS.rob);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState<boolean>(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const setSeatDelay = (i:number, v:number|string) => setSeatDelayMs(arr => { const n=[...arr]; n[i]=Math.max(0, Math.floor(Number(v)||0)); return n; });

  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState(DEFAULTS.seatKeys);

  const [liveLog, setLiveLog] = useState<string[]>([]);

  const doResetAll = () => {
    setEnabled(DEFAULTS.enabled); setRounds(DEFAULTS.rounds); setStartScore(DEFAULTS.startScore);
    setRob(DEFAULTS.rob); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]); setSeats([...DEFAULTS.seats]);
    setSeatModels([...DEFAULTS.seatModels]); setSeatKeys(DEFAULTS.seatKeys.map((x:any)=>({ ...x })));
    setLiveLog([]); setResetKey(k => k + 1);
    try { localStorage.removeItem('ddz_ladder_store_v1'); } catch {}
    try { window.dispatchEvent(new Event('ddz-all-refresh')); } catch {}
  };
  // —— 统一统计（TS + Radar + 出牌评分 + 评分统计）外层上传入口 ——
  const allFileRef = useRef<HTMLInputElement|null>(null);
  const handleAllFileUploadHome = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(String(rd.result || '{}'));
        window.dispatchEvent(new CustomEvent('ddz-all-upload', { detail: obj }));
      } catch (err) {
        console.error('[ALL-UPLOAD] parse error', err);
      } finally {
        if (allFileRef.current) allFileRef.current.value = '';
      }
    };
    rd.readAsText(f);
  };
  return (
    <LangContext.Provider value={lang}>
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }} ref={mainRef} key={lang}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Fight the Landlord</h1>
<div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }} data-i18n-ignore>
  <span aria-hidden="true" title={lang==='en'?'Language':'语言'} style={{ fontSize:14, opacity:0.75, display:'inline-flex', alignItems:'center' }}>🌐</span>
  <select aria-label={lang==='en'?'Language':'语言'} value={lang} onChange={e=>setLang((e.target.value as Lang))} style={{ padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
    <option value="zh">中文</option>
    <option value="en">English</option>
  </select>
</div>


      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12, gridAutoFlow:'row dense' }}>
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
          
          
<div style={{ gridColumn:'1 / 2' }}>
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
  <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:6, flexWrap:'wrap' }}>
    <label style={{ display:'flex', alignItems:'center', gap:8 }}>
      天梯  /  TrueSkill
    <input
      ref={allFileRef}
      type="file"
      accept="application/json"
      style={{ display:'none' }}
      onChange={handleAllFileUploadHome}
    />
    <button
      onClick={()=>allFileRef.current?.click()}
      style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >上传</button>
    
    </label>
<button
      onClick={()=>window.dispatchEvent(new Event('ddz-all-save'))}
      style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >存档</button>
  </div>
</div>
<div style={{ gridColumn:'2 / 3' }}>
  <label>初始分
          <input type="number" step={10} value={startScore}
           onChange={e=>setStartScore(Number(e.target.value)||0)}
           style={{ width:'100%' }} />
          </label>
</div>
          <div style={{ gridColumn:'2 / 3' }}>
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
                      // 新增：切换提供商时，把当前输入框改成该提供商的推荐模型
                      setSeatModels(arr => { const n=[...arr]; n[i] = defaultModelFor(v); return n; });
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
                    <optgroup label="人类">
                      <option value="human">Human</option>
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
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatModels(arr => { const n=[...arr]; n[i] = v; return n; });
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

                {seats[i] === 'ai:deepseek' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    DeepSeek API Key
                    <input type="password" value={seatKeys[i]?.deepseek||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), deepseek:v }; return n; });
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
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家思考超时（秒）</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{seatName(i)}</div>
                  <label style={{ display:'block' }}>
                    弃牌时间（秒）
                    <input
                      type="number" min={5} step={1}
                      value={ (turnTimeoutSecs[i] ?? 30) }
                      onChange={e=>{
                        const v = Math.max(5, Math.floor(Number(e.target.value)||0));
                        setTurnTimeoutSecs(arr=>{ const cp=[...(arr||[30,30,30])]; cp[i]=v; return cp; });
                      }}
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
        {/* —— 天梯图 —— */}
      <LadderPanel />
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
        
          turnTimeoutSecs={turnTimeoutSecs}
        />
      </div>
    </div>
    </LangContext.Provider>
  );
}

export default Home;