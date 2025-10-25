// pages/index.tsx
import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
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
    FarmerCoop: 'Farmer cooperation',}
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
    const i18nSchedule = () => { if (i18nBatchScheduled) return; i18nBatchScheduled = true; requestAnimationFrame(() => { i18nBatchScheduled = false; i18nBatchQueue.forEach(n=>{ try { apply(n); } catch {} }); i18nBatchQueue.clear(); }); };
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          (m.addedNodes || []).forEach((node: any) => { if (node && node.nodeType === 1) { i18nBatchQueue.add(node as HTMLElement); i18nSchedule(); } });
        } else if (m.type === 'characterData' && m.target && (m.target as any).parentElement) {
          i18nBatchQueue.add((m.target as any).parentElement as HTMLElement); i18nSchedule();
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

      }
    });
    obs.observe(root, { childList: true, characterData: true, subtree: true });
    root.setAttribute('data-i18n-observed', '1');
  }
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
  | 'http'
  | 'human';

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

const KO_BYE = '__KO_BYE__';
type KnockoutPlayer = string | null;
type KnockoutMatch = { id: string; players: KnockoutPlayer[]; eliminated: KnockoutPlayer | null; };
type KnockoutRound = { matches: KnockoutMatch[] };
type KnockoutFinalStandings = { placements: { token: KnockoutPlayer; total: number }[] };

type KnockoutMatchContext = {
  roundIdx: number;
  matchIdx: number;
  tokens: string[];
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: BotCredentials[];
  delays: number[];
  timeouts: number[];
  labels: string[];
};
type BotCredentials = {
  openai?: string;
  gemini?: string;
  grok?: string;
  kimi?: string;
  qwen?: string;
  deepseek?: string;
  httpBase?: string;
  httpToken?: string;
};
type KnockoutEntry = {
  id: string;
  choice: BotChoice;
  name: string;
  model: string;
  keys: BotCredentials;
  delayMs: number;
  timeoutSecs: number;
};

type KnockoutSettings = {
  enabled: boolean;
  roundsPerGroup: number;
  startScore: number;
  bid: boolean;
  four2: Four2Policy;
  farmerCoop: boolean;
};

const KO_ENTRY_STORAGE = 'ddz_knockout_entries';
const KO_SETTINGS_STORAGE = 'ddz_knockout_settings';
const KO_DEFAULT_DELAY = 1000;
const KO_DEFAULT_TIMEOUT = 30;
const KO_DEFAULT_CHOICES: BotChoice[] = [
  'built-in:greedy-max',
  'built-in:greedy-min',
  'built-in:random-legal',
  'built-in:mininet',
];
const KO_ALL_CHOICES: BotChoice[] = [
  'built-in:greedy-max',
  'built-in:greedy-min',
  'built-in:random-legal',
  'built-in:mininet',
  'built-in:ally-support',
  'built-in:endgame-rush',
  'ai:openai',
  'ai:gemini',
  'ai:grok',
  'ai:kimi',
  'ai:qwen',
  'ai:deepseek',
  'http',
  'human',
];

const KO_DEFAULT_SETTINGS: KnockoutSettings = {
  enabled: true,
  roundsPerGroup: 10,
  startScore: 100,
  bid: true,
  four2: 'both',
  farmerCoop: true,
};

function defaultKnockoutSettings(): KnockoutSettings {
  return { ...KO_DEFAULT_SETTINGS };
}

function sanitizeKnockoutSettings(raw: any): KnockoutSettings {
  const base = typeof raw === 'object' && raw ? raw : {};
  const next = defaultKnockoutSettings();
  if (typeof base.enabled === 'boolean') next.enabled = base.enabled;
  const rounds = Math.max(1, Math.floor(Number(base.roundsPerGroup) || 0));
  if (Number.isFinite(rounds) && rounds > 0) next.roundsPerGroup = rounds;
  const start = Number(base.startScore);
  if (Number.isFinite(start)) next.startScore = start;
  if (typeof base.bid === 'boolean') next.bid = base.bid;
  if (typeof base.farmerCoop === 'boolean') next.farmerCoop = base.farmerCoop;
  if (base.four2 === 'both' || base.four2 === '2singles' || base.four2 === '2pairs') {
    next.four2 = base.four2;
  }
  return next;
}

function makeKnockoutEntryId() {
  return `ko-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function defaultAliasForChoice(choice: BotChoice, existing: KnockoutEntry[]): string {
  const base = choiceLabel(choice);
  const taken = new Set(existing.map(e => e.name.trim()));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} #${suffix}`)) suffix += 1;
  return `${base} #${suffix}`;
}

function deriveAutoAliasSuffix(alias: string, choice: BotChoice): string | undefined {
  const base = choiceLabel(choice);
  const trimmed = alias.trim();
  if (!trimmed) return '';
  if (trimmed === base) return '';
  const prefix = `${base} #`;
  if (trimmed.startsWith(prefix)) {
    const rest = trimmed.slice(prefix.length);
    if (/^\d+$/.test(rest)) return ` #${rest}`;
  }
  return undefined;
}

function createDefaultKnockoutEntry(choice: BotChoice, existing: KnockoutEntry[]): KnockoutEntry {
  return {
    id: makeKnockoutEntryId(),
    choice,
    name: defaultAliasForChoice(choice, existing),
    model: '',
    keys: {},
    delayMs: KO_DEFAULT_DELAY,
    timeoutSecs: KO_DEFAULT_TIMEOUT,
  };
}

function makeDefaultKnockoutEntries(): KnockoutEntry[] {
  const entries: KnockoutEntry[] = [];
  for (const choice of KO_DEFAULT_CHOICES) {
    entries.push(createDefaultKnockoutEntry(choice, entries));
  }
  return entries;
}

function sanitizeKnockoutKeys(choice: BotChoice, raw: any): BotCredentials {
  const base: BotCredentials = typeof raw === 'object' && raw ? raw : {};
  const out: BotCredentials = {};
  if (typeof base.openai === 'string') out.openai = base.openai;
  if (typeof base.gemini === 'string') out.gemini = base.gemini;
  if (typeof base.grok === 'string') out.grok = base.grok;
  if (typeof base.kimi === 'string') out.kimi = base.kimi;
  if (typeof base.qwen === 'string') out.qwen = base.qwen;
  if (typeof base.deepseek === 'string') out.deepseek = base.deepseek;
  if (typeof base.httpBase === 'string') out.httpBase = base.httpBase;
  if (typeof base.httpToken === 'string') out.httpToken = base.httpToken;
  if (choice === 'http') {
    if (out.httpBase === undefined) out.httpBase = '';
    if (out.httpToken === undefined) out.httpToken = '';
  }
  return out;
}

function reviveStoredKnockoutKeys(choice: BotChoice, raw: any): BotCredentials {
  if (choice === 'http') {
    const base = typeof raw?.httpBase === 'string' ? raw.httpBase : '';
    return base ? { httpBase: base } : {};
  }
  return {};
}

function persistableKnockoutEntry(entry: KnockoutEntry) {
  const { keys, ...rest } = entry;
  if (entry.choice === 'http') {
    const base = typeof keys?.httpBase === 'string' ? keys.httpBase.trim() : '';
    const safe: BotCredentials = {};
    if (base) safe.httpBase = base;
    if (Object.keys(safe).length) return { ...rest, keys: safe };
    return rest;
  }
  return rest;
}

function normalizeKnockoutEntries(raw: any): KnockoutEntry[] {
  if (!Array.isArray(raw)) return makeDefaultKnockoutEntries();
  const entries: KnockoutEntry[] = [];
  for (const item of raw) {
    const choice = KO_ALL_CHOICES.includes(item?.choice) ? (item.choice as BotChoice) : 'built-in:greedy-max';
    const name = typeof item?.name === 'string' && item.name.trim()
      ? item.name.trim()
      : defaultAliasForChoice(choice, entries);
    const id = typeof item?.id === 'string' && item.id
      ? item.id
      : makeKnockoutEntryId();
    const model = choice.startsWith('ai:') && typeof item?.model === 'string'
      ? item.model
      : '';
    const keys = reviveStoredKnockoutKeys(choice, item?.keys);
    const delayMs = Number.isFinite(Number(item?.delayMs)) ? Math.max(0, Math.floor(Number(item.delayMs))) : KO_DEFAULT_DELAY;
    const timeoutSecs = Number.isFinite(Number(item?.timeoutSecs))
      ? Math.max(5, Math.floor(Number(item.timeoutSecs)))
      : KO_DEFAULT_TIMEOUT;
    entries.push({ id, choice, name, model, keys, delayMs, timeoutSecs });
  }
  if (entries.length < 2) return makeDefaultKnockoutEntries();
  return entries;
}

function cloneKnockoutRounds(rounds: KnockoutRound[]): KnockoutRound[] {
  return rounds
    .map((round, ridx) => ({
      matches: (round?.matches || [])
        .map((match, midx) => {
          const rawPlayers = Array.isArray(match?.players) ? match.players : [];
          const players = rawPlayers
            .filter((p, idx) => idx < 3 && typeof p === 'string' && p)
            .map(p => (p === KO_BYE ? KO_BYE : (p as KnockoutPlayer)));
          if (!players.length) return null;
          const eliminated = typeof match?.eliminated === 'string' && players.includes(match.eliminated as KnockoutPlayer)
            ? match.eliminated
            : typeof (match as any)?.winner === 'string' && players.includes((match as any).winner as KnockoutPlayer)
              ? (match as any).winner
              : null;
          return {
            id: typeof match?.id === 'string' && match.id ? match.id : `R${ridx}-M${midx}`,
            players: players as KnockoutPlayer[],
            eliminated,
          };
        })
        .filter((match): match is KnockoutMatch => !!match),
    }))
    .filter(round => round.matches.length);
}

function distributeKnockoutPlayers(pool: KnockoutPlayer[]): KnockoutPlayer[][] {
  const players = pool.filter(p => !!p);
  if (!players.length) return [];
  const padded: KnockoutPlayer[] = [...players];
  while (padded.length % 3 !== 0) {
    padded.push(KO_BYE);
  }
  const groups: KnockoutPlayer[][] = [];
  for (let idx = 0; idx < padded.length; idx += 3) {
    groups.push(padded.slice(idx, idx + 3));
  }
  return groups;
}

function buildMatchesFromPool(
  pool: KnockoutPlayer[],
  roundIdx: number,
  template?: KnockoutRound,
): KnockoutMatch[] {
  const templateMatches = template ? cloneKnockoutRounds([template])[0]?.matches ?? [] : [];
  const groups = distributeKnockoutPlayers(pool);
  return groups.map((players, midx) => {
    const templateMatch = templateMatches[midx];
    const samePlayers =
      templateMatch?.players?.length === players.length &&
      templateMatch.players.every((p, i) => p === players[i]);
    const eliminated = samePlayers && templateMatch?.eliminated && players.includes(templateMatch.eliminated)
      ? templateMatch.eliminated
      : null;
    return {
      id: templateMatch?.id ?? `R${roundIdx}-M${midx}`,
      players,
      eliminated,
    };
  });
}

function isRoundComplete(round: KnockoutRound): boolean {
  return round.matches.every(match => {
    const active = match.players.filter(p => !!p && p !== KO_BYE);
    if (active.length <= 1) return true;
    const hasBye = match.players.some(p => p === KO_BYE);
    if (hasBye && match.eliminated === KO_BYE) return true;
    return !!match.eliminated && active.includes(match.eliminated);
  });
}

function collectSurvivors(round: KnockoutRound): KnockoutPlayer[] {
  const survivors: KnockoutPlayer[] = [];
  for (const match of round.matches) {
    for (const player of match.players) {
      if (player && player !== match.eliminated && player !== KO_BYE) {
        survivors.push(player);
      }
    }
  }
  return survivors;
}

function isFinalRoundStructure(round: KnockoutRound | null | undefined): boolean {
  if (!round || !Array.isArray(round.matches) || round.matches.length !== 1) return false;
  const match = round.matches[0];
  if (!match) return false;
  const active = match.players.filter(p => p && p !== KO_BYE);
  return active.length === 3;
}

function isFinalRoundMatch(rounds: KnockoutRound[], roundIdx: number, matchIdx: number): boolean {
  if (!rounds.length) return false;
  if (roundIdx !== rounds.length - 1) return false;
  const round = rounds[roundIdx];
  if (!isFinalRoundStructure(round)) return false;
  const match = round.matches[matchIdx];
  if (!match) return false;
  const active = match.players.filter(p => p && p !== KO_BYE);
  return active.length === 3;
}

function shuffleArray<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeKnockoutRounds(base: KnockoutRound[]): KnockoutRound[] {
  const sanitized = cloneKnockoutRounds(base);
  if (!sanitized.length) return [];
  const rounds: KnockoutRound[] = [];
  const first = sanitized[0];
  if (!first.matches.length) return [];
  rounds.push({ matches: first.matches });
  if (!isRoundComplete(first)) return rounds;

  let survivors = collectSurvivors(first);
  let roundIndex = 1;
  while (survivors.length > 1) {
    const template = sanitized[roundIndex];
    const nextMatches = buildMatchesFromPool(survivors, roundIndex, template);
    if (!nextMatches.length) break;
    const nextRound: KnockoutRound = { matches: nextMatches };
    rounds.push(nextRound);
    if (!isRoundComplete(nextRound)) break;
    survivors = collectSurvivors(nextRound);
    roundIndex += 1;
  }
  return rounds;
}

function applyEliminationToDraft(
  draft: KnockoutRound[],
  roundIdx: number,
  matchIdx: number,
  eliminated: KnockoutPlayer | null,
) {
  const match = draft[roundIdx]?.matches?.[matchIdx];
  if (!match) return;
  match.eliminated = eliminated;
  draft.length = roundIdx + 1;
  const current = draft[roundIdx];
  if (!current || !isRoundComplete(current)) return;
  const survivors = collectSurvivors(current);
  if (isFinalRoundStructure(current)) return;
  if (survivors.length <= 1) return;
  const shuffled = shuffleArray(survivors);
  const nextMatches = buildMatchesFromPool(shuffled, roundIdx + 1);
  if (nextMatches.length) {
    draft.push({ matches: nextMatches });
  }
}

function findNextPlayableMatch(rounds: KnockoutRound[]): { roundIdx: number; matchIdx: number } | null {
  for (let ridx = 0; ridx < rounds.length; ridx++) {
    const round = rounds[ridx];
    if (!round?.matches?.length) continue;
    for (let midx = 0; midx < round.matches.length; midx++) {
      const match = round.matches[midx];
      if (!match) continue;
      const active = match.players.filter(p => p && p !== KO_BYE);
      if (active.length >= 3 && !match.eliminated) {
        return { roundIdx: ridx, matchIdx: midx };
      }
      if (active.length < 3 && !match.eliminated) {
        return { roundIdx: ridx, matchIdx: midx };
      }
    }
  }
  return null;
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
  bid: boolean;
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
  onRunningChange?: (running: boolean) => void;
  onPauseChange?: (paused: boolean) => void;
  onFinished?: (result: LivePanelFinishPayload) => void;
  controlsHidden?: boolean;
  initialTotals?: [number, number, number] | null;
  turnTimeoutSecs?: number[];};

type LivePanelHandle = {
  start: () => Promise<void>;
  stop: () => void;
  togglePause: () => void;
  isRunning: () => boolean;
  isPaused: () => boolean;
};

type LivePanelFinishPayload = {
  aborted: boolean;
  finishedCount: number;
  totals: [number, number, number];
  completedAll: boolean;
  endedEarlyForNegative?: boolean;
};

type HumanHint = {
  move: 'play' | 'pass';
  cards?: string[];
  score?: number;
  reason?: string;
  label?: string;
  by?: string;
};

type HumanPrompt = {
  seat: number;
  requestId: string;
  phase: string;
  ctx: any;
  timeoutMs?: number;
  delayMs?: number;
  by?: string;
  hint?: HumanHint;
};

function SeatTitle({ i }: { i:number }) {
  const { lang } = useI18n();
  return <span style={{ fontWeight:700 }}>{seatLabel(i, lang)}</span>;
}


type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];
const seatName = (i:number)=>['甲','乙','丙'][i] || String(i);
type BottomInfo = {
  landlord: number | null;
  cards: { label: string; used: boolean }[];
  revealed: boolean;
};

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

const RANK_ORDER = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
const RANK_POS: Record<string, number> = Object.fromEntries(RANK_ORDER.map((r, i) => [r, i])) as Record<string, number>;

function rankKeyForDisplay(label: string): string {
  if (!label) return '';
  if (label.startsWith('🃏')) {
    const tail = label.slice(2).toUpperCase();
    if (tail === 'X') return 'x';
    if (tail === 'Y') return 'X';
    return tail;
  }
  if (label === 'x' || label === 'X') return label;
  const rk = rankOf(label);
  if (rk === 'Y') return 'X';
  return rk;
}

function sortDisplayHand(cards: string[]): string[] {
  return [...cards].sort((a, b) => {
    const va = RANK_POS[rankKeyForDisplay(a)] ?? -1;
    const vb = RANK_POS[rankKeyForDisplay(b)] ?? -1;
    if (va !== vb) return va - vb;
    return a.localeCompare(b);
  });
}

function displayLabelFromRaw(label: string): string {
  if (!label) return label;
  if (label.startsWith('🃏')) return label;
  if (label === 'x') return '🃏X';
  if (label === 'X') return '🃏Y';
  if ('♠♥♦♣'.includes(label[0])) return label;
  return decorateHandCycle([label])[0];
}

function resolveBottomDecorations(raw: string[], landlord: number | null, hands: string[][]): string[] {
  if (!Array.isArray(raw)) return [];
  const seat = (typeof landlord === 'number' && landlord >= 0 && landlord < 3) ? landlord : null;
  if (seat == null) return decorateHandCycle(raw);
  const pool = [...(hands?.[seat] || [])];
  return raw.map(card => {
    const options = candDecorations(card);
    for (const opt of options) {
      const idx = pool.indexOf(opt);
      if (idx >= 0) {
        pool.splice(idx, 1);
        return opt;
      }
    }
    return options[0] || card;
  });
}

type CardProps = {
  label: string;
  dimmed?: boolean;
  compact?: boolean;
  interactive?: boolean;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  hidden?: boolean;
};

function Card({ label, dimmed = false, compact = false, interactive = false, selected = false, onClick, disabled = false, hidden = false }: CardProps) {
  const dims = compact
    ? { width: 28, height: 44, gap: 2, backSize: 18, suitSize: 16, rankSize: 12, paddingShown: '6px 4px', paddingHidden: '4px' }
    : { width: 38, height: 58, gap: 4, backSize: 24, suitSize: 22, rankSize: 16, paddingShown: '8px 6px', paddingHidden: '6px' };

  let background = '#fff';
  let borderColor = '#ddd';
  let color = '#1f2937';
  let opacity = 1;
  let inner: ReactNode;

  if (hidden) {
    background = selected ? '#bfdbfe' : '#1f2937';
    borderColor = selected ? '#2563eb' : '#111827';
    color = '#f9fafb';
    inner = <span style={{ fontSize: dims.backSize, lineHeight: 1 }}>🂠</span>;
  } else {
    const suit = label.startsWith('🃏') ? '🃏' : label.charAt(0);
    const baseColor = (suit === '♥' || suit === '♦') ? '#af1d22' : '#1a1a1a';
    const rank = label.startsWith('🃏') ? (label.slice(2) || '') : label.slice(1);
    const rankColor = suit === '🃏' ? (rank === 'Y' ? '#d11' : '#16a34a') : undefined;
    const suitColor = dimmed ? '#9ca3af' : baseColor;
    const rankStyle = dimmed
      ? { color: '#9ca3af' }
      : (rankColor ? { color: rankColor } : {});
    background = selected ? '#dbeafe' : (dimmed ? '#f3f4f6' : '#fff');
    borderColor = selected ? '#2563eb' : (dimmed ? '#d1d5db' : '#ddd');
    color = suitColor;
    opacity = dimmed ? 0.65 : 1;
    inner = (
      <>
        <span style={{ fontSize: dims.suitSize, lineHeight: 1 }}>{suit}</span>
        <span style={{ fontSize: dims.rankSize, lineHeight: 1, ...rankStyle }}>{rank === 'T' ? '10' : rank}</span>
      </>
    );
  }

  const style: React.CSSProperties = {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: hidden ? 0 : dims.gap,
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 8,
    padding: hidden ? dims.paddingHidden : dims.paddingShown,
    marginRight: compact ? 4 : 6,
    marginBottom: compact ? 4 : 6,
    fontWeight: 800,
    cursor: interactive ? (disabled ? 'not-allowed' : 'pointer') : 'default',
    outline: selected ? '2px solid #2563eb' : 'none',
    userSelect: 'none',
    width: dims.width,
    minWidth: dims.width,
    height: dims.height,
    boxSizing: 'border-box',
    background,
    borderColor,
    color,
    opacity,
  };

  if (interactive) {
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        style={style}
        title={hidden ? label : undefined}
      >
        {inner}
      </button>
    );
  }

  return (
    <span style={style} title={hidden ? label : undefined}>
      {inner}
    </span>
  );
}
type HandProps = {
  cards: string[];
  interactive?: boolean;
  selectedIndices?: Set<number>;
  onToggle?: (index: number) => void;
  disabled?: boolean;
  faceDown?: boolean;
};

function Hand({ cards, interactive = false, selectedIndices, onToggle, disabled = false, faceDown = false }: HandProps) {
  const { t } = useI18n();
  if (!cards || cards.length === 0) return <span style={{ opacity: 0.6 }}>{t('Empty')}</span>;
  const selected = selectedIndices ?? new Set<number>();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {cards.map((c, idx) => (
        <Card
          key={`${c}-${idx}`}
          label={c}
          interactive={interactive}
          selected={selected.has(idx)}
          onClick={interactive && onToggle ? () => onToggle(idx) : undefined}
          disabled={disabled}
          hidden={faceDown && !interactive}
        />
      ))}
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
    'ai:openai','ai:gemini','ai:grok','ai:kimi','ai:qwen','ai:deepseek','http','human'
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

  const valsForRange = (arr.some(x=> x.n>0) ? arr.filter(x=> x.n>0) : arr);
  const minVal = Math.min(0, ...valsForRange.map(x=> x.val));
  const maxVal = Math.max(0, ...valsForRange.map(x=> x.val));
  const maxAbs = Math.max(Math.abs(minVal), Math.abs(maxVal));
  const K = Math.max(1, maxAbs * 1.1);

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

function KnockoutPanel() {
  const { lang } = useI18n();
  const humanOptionLabel = lang === 'en' ? 'Human' : '人类选手';
  const humanProviderLabel = lang === 'en' ? 'Human player' : '人类选手';
  const [settings, setSettings] = useState<KnockoutSettings>(() => {
    if (typeof window === 'undefined') return defaultKnockoutSettings();
    try {
      const stored = localStorage.getItem(KO_SETTINGS_STORAGE);
      if (stored) {
        return sanitizeKnockoutSettings(JSON.parse(stored));
      }
    } catch {}
    return defaultKnockoutSettings();
  });
  const [entries, setEntries] = useState<KnockoutEntry[]>(() => {
    if (typeof window === 'undefined') return makeDefaultKnockoutEntries();
    try {
      const stored = localStorage.getItem(KO_ENTRY_STORAGE);
      if (stored) {
        const parsed = JSON.parse(stored);
        const normalized = normalizeKnockoutEntries(parsed);
        if (normalized?.length) return normalized;
      }
      const legacySeed = localStorage.getItem('ddz_knockout_seed');
      if (legacySeed) {
        const names = legacySeed.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (names.length >= 2) {
          const provisional = names.map((name, idx) => ({
            id: makeKnockoutEntryId(),
            choice: KO_DEFAULT_CHOICES[idx % KO_DEFAULT_CHOICES.length] ?? 'built-in:greedy-max',
            name,
          }));
          const normalized = normalizeKnockoutEntries(provisional);
          if (normalized.length) return normalized;
        }
      }
    } catch {}
    return makeDefaultKnockoutEntries();
  });
  const [rounds, setRounds] = useState<KnockoutRound[]>([]);
  const [currentMatch, setCurrentMatch] = useState<KnockoutMatchContext | null>(null);
  const currentMatchRef = useRef<KnockoutMatchContext | null>(null);
  useEffect(() => { currentMatchRef.current = currentMatch; }, [currentMatch]);
  const [matchKey, setMatchKey] = useState(0);
  const [liveTotals, setLiveTotals] = useState<[number, number, number] | null>(null);
  const liveTotalsRef = useRef<[number, number, number] | null>(null);
  useEffect(() => { liveTotalsRef.current = liveTotals; }, [liveTotals]);
  const [seriesTotals, setSeriesTotals] = useState<[number, number, number] | null>(null);
  const seriesTotalsRef = useRef<[number, number, number] | null>(seriesTotals);
  useEffect(() => { seriesTotalsRef.current = seriesTotals; }, [seriesTotals]);
  const [seriesRounds, setSeriesRounds] = useState<number>(() => settings.roundsPerGroup);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [overtimeReason, setOvertimeReason] = useState<'lowest' | 'final'>('lowest');
  const overtimeCountRef = useRef(overtimeCount);
  useEffect(() => { overtimeCountRef.current = overtimeCount; }, [overtimeCount]);
  const [liveRunning, setLiveRunning] = useState(false);
  const [livePaused, setLivePaused] = useState(false);
  const [automationActive, setAutomationActive] = useState(false);
  const [finalStandings, setFinalStandings] = useState<KnockoutFinalStandings | null>(null);
  const livePanelRef = useRef<LivePanelHandle | null>(null);
  const roundsRef = useRef<KnockoutRound[]>(rounds);
  useEffect(() => { roundsRef.current = rounds; }, [rounds]);
  const entriesRef = useRef<KnockoutEntry[]>(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  const autoRunRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allFileRef = useRef<HTMLInputElement|null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(KO_SETTINGS_STORAGE, JSON.stringify(settings)); } catch {}
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedRounds = localStorage.getItem('ddz_knockout_rounds');
      if (storedRounds) {
        const parsed = JSON.parse(storedRounds);
        if (Array.isArray(parsed)) {
          setRounds(normalizeKnockoutRounds(parsed as KnockoutRound[]));
        }
      }
      localStorage.removeItem('ddz_knockout_seed');
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const payload = entries.map(persistableKnockoutEntry);
      localStorage.setItem(KO_ENTRY_STORAGE, JSON.stringify(payload));
    } catch {}
  }, [entries]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('ddz_knockout_rounds', JSON.stringify(rounds)); } catch {}
  }, [rounds]);

  useEffect(() => {
    if (rounds.length) return;
    autoRunRef.current = false;
    setAutomationActive(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setSeriesTotals(null);
    setSeriesRounds(settings.roundsPerGroup);
    setOvertimeCount(0);
    setLiveRunning(false);
    setLivePaused(false);
    setFinalStandings(null);
  }, [rounds.length]);

  const participantLabel = (idx: number) => (lang === 'en' ? `Player ${idx + 1}` : `选手${idx + 1}`);
  const updateSettings = (patch: Partial<KnockoutSettings>) => {
    setSettings(prev => sanitizeKnockoutSettings({ ...prev, ...patch }));
  };
  const { enabled, roundsPerGroup, startScore, bid, four2, farmerCoop } = settings;

  const setAutomation = (active: boolean) => {
    autoRunRef.current = active;
    setAutomationActive(active);
  };

  const handleAllFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || '{}'));
        window.dispatchEvent(new CustomEvent('ddz-all-upload', { detail: obj }));
      } catch (err) {
        console.error('[ALL-UPLOAD] parse error', err);
      } finally {
        if (allFileRef.current) allFileRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const entryIdentity = (entry: KnockoutEntry) => {
    const payload: Record<string, string> = {
      name: entry.name.trim(),
      choice: entry.choice,
    };
    if (entry.choice.startsWith('ai:')) {
      payload.model = entry.model.trim();
    }
    if (entry.choice === 'http') {
      payload.httpBase = (entry.keys?.httpBase || '').trim();
    }
    return JSON.stringify(payload);
  };

  const entryToken = (entry: KnockoutEntry, slot: number) => {
    const payload: Record<string, string | number> = {
      id: entry.id,
      slot,
      name: entry.name.trim(),
      choice: entry.choice,
    };
    if (entry.choice.startsWith('ai:')) {
      const model = entry.model.trim();
      if (model) payload.model = model;
    }
    if (entry.choice === 'http') {
      const base = (entry.keys?.httpBase || '').trim();
      if (base) payload.httpBase = base;
    }
    return JSON.stringify(payload);
  };

  const handleGenerate = () => {
    if (!enabled) {
      setError(lang === 'en' ? 'Enable the tournament before generating a bracket.' : '请先启用淘汰赛。');
      setNotice(null);
      return;
    }
    setAutomation(false);
    if (livePanelRef.current?.isRunning()) livePanelRef.current.stop();
    setLiveRunning(false);
    setLivePaused(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setFinalStandings(null);
    const roster = entries.map((entry, idx) => ({
      token: entryToken(entry, idx + 1),
      identity: entryIdentity(entry),
    })).filter(item => item.identity);
    if (roster.length < 3) {
      setError(lang === 'en' ? 'Add at least three participants.' : '请至少添加三名参赛选手。');
      setNotice(null);
      setRounds([]);
      if (typeof window !== 'undefined') {
        try { localStorage.removeItem('ddz_knockout_rounds'); } catch {}
      }
      return;
    }
    const uniqueTokens = new Set(roster.map(item => item.identity));
    if (uniqueTokens.size < roster.length) {
      setError(lang === 'en' ? 'Participant configurations must be unique.' : '参赛选手配置需要唯一，请调整选择。');
      setNotice(null);
      return;
    }
    const shuffled = shuffleArray(roster.map(item => item.token));
    const firstRoundMatches = buildMatchesFromPool(shuffled, 0);
    if (!firstRoundMatches.length) {
      setError(lang === 'en' ? 'Unable to build initial groups.' : '无法生成首轮对阵，请重试。');
      setRounds([]);
      return;
    }
    const firstRound: KnockoutRound = { matches: firstRoundMatches };
    setRounds([firstRound]);
    setError(null);
    setNotice(lang === 'en'
      ? `Participants shuffled into groups of three where possible. Each trio plays ${roundsPerGroup} game(s).`
      : `已尽量按每组三人随机分组。每组三人对局 ${roundsPerGroup} 局。`);
  };

  const handleReset = () => {
    setAutomation(false);
    if (livePanelRef.current?.isRunning()) livePanelRef.current.stop();
    setLiveRunning(false);
    setLivePaused(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setSeriesTotals(null);
    setSeriesRounds(settings.roundsPerGroup);
    setOvertimeCount(0);
    setFinalStandings(null);
    setRounds([]);
    setError(null);
    setNotice(null);
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem('ddz_knockout_rounds'); } catch {}
    }
  };

  const handleResetAll = () => {
    setAutomation(false);
    if (livePanelRef.current?.isRunning()) livePanelRef.current.stop();
    setLiveRunning(false);
    setLivePaused(false);
    setCurrentMatch(null);
    setLiveTotals(null);
    setSeriesTotals(null);
    setSeriesRounds(KO_DEFAULT_SETTINGS.roundsPerGroup);
    setOvertimeCount(0);
    setOvertimeReason('lowest');
    setSettings(defaultKnockoutSettings());
    setEntries(makeDefaultKnockoutEntries());
    setFinalStandings(null);
    setRounds([]);
    setError(null);
    setNotice(null);
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(KO_SETTINGS_STORAGE); } catch {}
      try { localStorage.removeItem(KO_ENTRY_STORAGE); } catch {}
      try { localStorage.removeItem('ddz_knockout_rounds'); } catch {}
    }
  };

  const handleToggleEliminated = (roundIdx: number, matchIdx: number, player: string) => {
    if (!enabled) {
      setError(lang === 'en' ? 'Enable the tournament to record eliminations.' : '请先启用淘汰赛以记录淘汰结果。');
      setNotice(null);
      return;
    }
    setFinalStandings(null);
    setRounds(prev => {
      const draft = cloneKnockoutRounds(prev);
      const match = draft[roundIdx]?.matches?.[matchIdx];
      if (!match) return prev;
      const nextElimination = match.eliminated === player ? null : player;
      applyEliminationToDraft(draft, roundIdx, matchIdx, nextElimination);
      return draft;
    });
  };

  const displayName = (value: KnockoutPlayer | null) => {
    if (value === KO_BYE) return lang === 'en' ? 'BYE' : '轮空';
    if (!value) return lang === 'en' ? 'TBD' : '待定';
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          const slotNumber = Number((parsed as any).slot);
          if (Number.isFinite(slotNumber) && slotNumber >= 1) {
            return participantLabel(slotNumber - 1);
          }
          if (typeof (parsed as any).id === 'string') {
            const idx = entries.findIndex(entry => entry.id === (parsed as any).id);
            if (idx >= 0) return participantLabel(idx);
          }
          const alias = typeof parsed.name === 'string' ? parsed.name.trim() : '';
          const rawChoice = typeof parsed.choice === 'string' ? parsed.choice : '';
          const provider = KO_ALL_CHOICES.includes(rawChoice as BotChoice) ? choiceLabel(rawChoice as BotChoice) : '';
          let providerLabel = provider;
          if (KO_ALL_CHOICES.includes(rawChoice as BotChoice)) {
            const normalized = rawChoice as BotChoice;
            if (normalized === 'human') {
              providerLabel = humanProviderLabel;
            } else {
              const model = typeof parsed.model === 'string' ? parsed.model : '';
              const base = typeof parsed.httpBase === 'string' ? parsed.httpBase : '';
              providerLabel = providerSummary(normalized, model, base, lang);
            }
          }
          if (alias && providerLabel) return `${alias} · ${providerLabel}`;
          if (alias) return alias;
          if (providerLabel) return providerLabel;
        }
      } catch {}
    }
    return value;
  };

  const playerMeta = (value: KnockoutPlayer | null): { label: string; provider: string } => {
    const label = displayName(value);
    if (!value || value === KO_BYE) return { label, provider: '' };
    try {
      const parsed = JSON.parse(String(value));
      const entryId = typeof parsed?.id === 'string' ? parsed.id : '';
      const entry = entryId ? entries.find(item => item.id === entryId) : null;
      if (entry) {
        return {
          label,
          provider: entry.choice === 'human'
            ? humanProviderLabel
            : providerSummary(entry.choice, entry.model, entry.keys?.httpBase, lang),
        };
      }
      const rawChoice = typeof parsed?.choice === 'string' ? parsed.choice : '';
      if (KO_ALL_CHOICES.includes(rawChoice as BotChoice)) {
        const model = typeof parsed?.model === 'string' ? parsed.model : '';
        const httpBase = typeof parsed?.httpBase === 'string' ? parsed.httpBase : '';
        return {
          label,
          provider: rawChoice === 'human'
            ? humanProviderLabel
            : providerSummary(rawChoice as BotChoice, model, httpBase, lang),
        };
      }
    } catch {}
    return { label, provider: '' };
  };

  const fallbackLive = useMemo(() => ({
    seats: KO_DEFAULT_CHOICES.slice(0, 3),
    seatModels: ['', '', ''],
    seatKeys: [{}, {}, {}] as BotCredentials[],
    delays: [KO_DEFAULT_DELAY, KO_DEFAULT_DELAY, KO_DEFAULT_DELAY],
    timeouts: [KO_DEFAULT_TIMEOUT, KO_DEFAULT_TIMEOUT, KO_DEFAULT_TIMEOUT],
  }), []);

  const buildMatchContext = (roundIdx: number, matchIdx: number): KnockoutMatchContext | null => {
    const round = roundsRef.current?.[roundIdx];
    const match = round?.matches?.[matchIdx];
    if (!match) return null;
    const tokens = match.players.filter(p => p && p !== KO_BYE) as string[];
    if (tokens.length !== 3) return null;
    const details = tokens.map(token => {
      try {
        const parsed = JSON.parse(String(token));
        const id = parsed?.id;
        if (!id) return null;
        const entry = entriesRef.current.find(item => item.id === id);
        if (!entry) return null;
        const rawSlot = Number(parsed?.slot);
        const slot = Number.isFinite(rawSlot) ? rawSlot : null;
        return { token, entry, slot };
      } catch {
        return null;
      }
    });
    if (details.some(detail => !detail)) return null;
    return {
      roundIdx,
      matchIdx,
      tokens: details.map(detail => detail!.token),
      seats: details.map(detail => detail!.entry.choice),
      seatModels: details.map(detail => detail!.entry.model || ''),
      seatKeys: details.map(detail => ({ ...(detail!.entry.keys || {}) })),
      delays: details.map(detail => {
        const raw = Number(detail!.entry.delayMs);
        return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : KO_DEFAULT_DELAY;
      }),
      timeouts: details.map(detail => {
        const raw = Number(detail!.entry.timeoutSecs);
        return Number.isFinite(raw) ? Math.max(5, Math.floor(raw)) : KO_DEFAULT_TIMEOUT;
      }),
      labels: details.map(detail => {
        const slot = detail!.slot;
        if (typeof slot === 'number' && Number.isFinite(slot) && slot > 0) {
          return participantLabel(slot - 1);
        }
        return displayName(detail!.token);
      }),
    };
  };

  const launchMatch = (roundIdx: number, matchIdx: number) => {
    const context = buildMatchContext(roundIdx, matchIdx);
    if (!context) {
      setAutomation(false);
      setNotice(lang === 'en'
        ? 'Unable to launch the next trio. Please verify participant settings.'
        : '无法启动下一组三人对局，请检查参赛设置。');
      return false;
    }
    setCurrentMatch(context);
    const baseScore = Number.isFinite(startScore) ? startScore : 0;
    const baseTotals = [baseScore, baseScore, baseScore] as [number, number, number];
    setSeriesRounds(roundsPerGroup);
    setSeriesTotals(baseTotals);
    setOvertimeCount(0);
    setOvertimeReason('lowest');
    setLiveTotals(baseTotals);
    setMatchKey(key => key + 1);
    setTimeout(() => { livePanelRef.current?.start(); }, 0);
    return true;
  };

  const scheduleNextMatch = () => {
    if (!autoRunRef.current) return;
    if (livePanelRef.current?.isRunning()) return;
    const pendingContext = currentMatchRef.current;
    if (overtimeCountRef.current > 0 && pendingContext) {
      const round = roundsRef.current?.[pendingContext.roundIdx];
      const match = round?.matches?.[pendingContext.matchIdx];
      if (match && !match.eliminated) {
        const active = match.players.filter(p => p && p !== KO_BYE);
        if (active.length >= 3) {
          if (seriesTotalsRef.current) setLiveTotals(seriesTotalsRef.current);
          setSeriesRounds(3);
          setMatchKey(key => key + 1);
          setTimeout(() => { livePanelRef.current?.start(); }, 0);
          return;
        }
      }
    }
    const next = findNextPlayableMatch(roundsRef.current || []);
    if (!next) {
      setAutomation(false);
      setNotice(lang === 'en' ? 'All scheduled rounds are complete.' : '当前所有轮次的对局均已完成。');
      return;
    }
    const round = roundsRef.current?.[next.roundIdx];
    const match = round?.matches?.[next.matchIdx];
    if (!match) {
      setAutomation(false);
      return;
    }
    const active = match.players.filter(p => p && p !== KO_BYE);
    if (active.length < 3) {
      const byeToken = match.players.find(p => p === KO_BYE || !p) ?? KO_BYE;
      setSeriesTotals(null);
      setLiveTotals(null);
      setSeriesRounds(roundsPerGroup);
      setOvertimeCount(0);
      setOvertimeReason('lowest');
      setRounds(prev => {
        const draft = cloneKnockoutRounds(prev);
        applyEliminationToDraft(draft, next.roundIdx, next.matchIdx, byeToken);
        return draft;
      });
      setTimeout(() => { if (autoRunRef.current) scheduleNextMatch(); }, 0);
      return;
    }
    const launched = launchMatch(next.roundIdx, next.matchIdx);
    if (!launched) {
      setAutomation(false);
    }
  };

  const handleLiveFinished = (result: LivePanelFinishPayload) => {
    if (result.aborted) {
      setAutomation(false);
      return;
    }
    const endedEarly = !!result.endedEarlyForNegative;
    if (!result.completedAll && !endedEarly) {
      setAutomation(false);
      setNotice(lang === 'en'
        ? 'The trio stopped before finishing all games; automation has been paused.'
        : '该组三人未跑完全部局数，已暂停自动流程。');
      return;
    }
    const ctx = currentMatchRef.current;
    if (!ctx) return;
    const wasFinalMatch = isFinalRoundMatch(roundsRef.current || [], ctx.roundIdx, ctx.matchIdx);
    const totals = result.totals || liveTotalsRef.current;
    if (!totals) return;
    const baseScore = Number.isFinite(startScore) ? startScore : 0;
    const totalsTuple = [0, 0, 0] as [number, number, number];
    for (let i = 0; i < 3; i++) {
      const raw = Number((totals as number[])[i]);
      totalsTuple[i] = Number.isFinite(raw) ? raw : baseScore;
    }
    setLiveTotals(totalsTuple);
    setSeriesTotals(totalsTuple);
    const scored = ctx.tokens.map((token, idx) => {
      const val = Number(totals[idx]);
      return {
        token,
        total: Number.isFinite(val) ? val : Number.POSITIVE_INFINITY,
      };
    });
    const ranked = scored
      .filter(entry => !!entry.token)
      .sort((a, b) => a.total - b.total);
    const placementsDesc = wasFinalMatch
      ? ctx.tokens
          .map((token, idx) => ({ token, total: totalsTuple[idx] }))
          .filter(entry => !!entry.token && entry.token !== KO_BYE)
          .sort((a, b) => b.total - a.total)
      : null;
    const epsilon = 1e-6;
    if (wasFinalMatch) {
      const trioTotals = ctx.tokens.map((token, idx) => ({ token, total: totalsTuple[idx] }))
        .filter(entry => !!entry.token && entry.token !== KO_BYE);
      const tiedFinalTokens = new Set<string>();
      for (let i = 0; i < trioTotals.length; i++) {
        for (let j = i + 1; j < trioTotals.length; j++) {
          const a = trioTotals[i];
          const b = trioTotals[j];
          if (Math.abs(a.total - b.total) <= epsilon) {
            tiedFinalTokens.add(String(a.token));
            tiedFinalTokens.add(String(b.token));
          }
        }
      }
      if (tiedFinalTokens.size > 0) {
        const tiedLabels = ctx.tokens
          .filter(token => tiedFinalTokens.has(String(token)))
          .map(token => displayName(token))
          .join(lang === 'en' ? ', ' : '、');
        const nextAttempt = overtimeCountRef.current + 1;
        setOvertimeCount(nextAttempt);
        setOvertimeReason('final');
        setSeriesRounds(3);
        setFinalStandings(null);
        setNotice(lang === 'en'
          ? `Final round tie among ${tiedLabels}. Starting 3-game playoff #${nextAttempt}.`
          : `决赛积分出现平局（${tiedLabels}），开始第 ${nextAttempt} 次加时赛（3 局）。`);
        setMatchKey(key => key + 1);
        setTimeout(() => { livePanelRef.current?.start(); }, 0);
        return;
      }
    }
    const lowest = ranked[0];
    if (!lowest) {
      setAutomation(false);
      return;
    }
    if (!Number.isFinite(lowest.total)) {
      setAutomation(false);
      setNotice(lang === 'en'
        ? 'The trio did not record valid scores. Please review the results and mark the eliminated player manually.'
        : '该组三人未产生有效积分，请核对结果并手动标记淘汰选手。');
      return;
    }
    const tiedLowest = ranked.filter(entry => Math.abs(entry.total - lowest.total) <= epsilon);
    if (tiedLowest.length !== 1) {
      const tiedLabels = tiedLowest
        .map(entry => displayName(entry.token))
        .join(lang === 'en' ? ', ' : '、');
      const nextAttempt = overtimeCountRef.current + 1;
      setOvertimeCount(nextAttempt);
      setOvertimeReason('lowest');
      setSeriesRounds(3);
      setNotice(lang === 'en'
        ? `Round ${ctx.roundIdx + 1}${endedEarly ? ' ended early after a negative score;' : ''} lowest score tie among ${tiedLabels}. Starting 3-game playoff #${nextAttempt}.`
        : `第 ${ctx.roundIdx + 1} 轮${endedEarly ? '出现负分提前结束，' : ''}积分最低出现平局（${tiedLabels}），开始第 ${nextAttempt} 次加时赛（3 局）。`);
      setMatchKey(key => key + 1);
      setTimeout(() => { livePanelRef.current?.start(); }, 0);
      return;
    }
    const eliminatedToken = tiedLowest[0]?.token;
    if (!eliminatedToken) {
      setAutomation(false);
      return;
    }
    const label = displayName(eliminatedToken);
    setRounds(prev => {
      const draft = cloneKnockoutRounds(prev);
      applyEliminationToDraft(draft, ctx.roundIdx, ctx.matchIdx, eliminatedToken);
      return draft;
    });
    setSeriesRounds(roundsPerGroup);
    setOvertimeCount(0);
    setOvertimeReason('lowest');
    if (wasFinalMatch) {
      const ordered = (placementsDesc && placementsDesc.length
        ? placementsDesc
        : ranked.slice().reverse())
        .slice(0, 3);
      if (ordered.length) {
        setFinalStandings({ placements: ordered });
      } else {
        setFinalStandings(null);
      }
      if (ordered.length >= 3) {
        const championLabel = displayName(ordered[0].token);
        const runnerUpLabel = displayName(ordered[1].token);
        const thirdLabel = displayName(ordered[2].token);
        setNotice(lang === 'en'
          ? `Final standings — Champion: ${championLabel}, Runner-up: ${runnerUpLabel}, Third: ${thirdLabel}.`
          : `最终排名：冠军 ${championLabel}，亚军 ${runnerUpLabel}，季军 ${thirdLabel}。`);
      } else {
        setNotice(lang === 'en'
          ? `Final round complete. Eliminated ${label}${endedEarly ? ' after an early finish caused by a negative score.' : '.'}`
          : `决赛结束：淘汰 ${label}${endedEarly ? '（因出现负分提前结束）' : ''}`);
      }
      setAutomation(false);
      return;
    }
    setFinalStandings(null);
    setNotice(lang === 'en'
      ? `Round ${ctx.roundIdx + 1}: eliminated ${label}${endedEarly ? ' after an early finish caused by a negative score.' : '.'}`
      : `第 ${ctx.roundIdx + 1} 轮淘汰：${label}${endedEarly ? '（因出现负分提前结束）' : ''}`);
    setTimeout(() => { if (autoRunRef.current) scheduleNextMatch(); else setAutomation(false); }, 0);
  };

  const handleStartRound = () => {
    if (livePanelRef.current?.isRunning() || liveRunning) return;
    if (!enabled) {
      setError(lang === 'en' ? 'Enable the tournament before starting.' : '请先启用淘汰赛再开始运行。');
      setNotice(null);
      return;
    }
    if (!rounds.length) {
      setError(lang === 'en' ? 'Generate the bracket before starting.' : '请先生成淘汰赛对阵。');
      setNotice(null);
      return;
    }
    if (!findNextPlayableMatch(rounds)) {
      setNotice(lang === 'en' ? 'All rounds are already complete.' : '所有轮次已经完成。');
      return;
    }
    setError(null);
    setNotice(null);
    setAutomation(true);
    scheduleNextMatch();
  };

  const handlePauseRound = () => {
    if (!livePanelRef.current) return;
    if (!livePanelRef.current.isRunning()) return;
    livePanelRef.current.togglePause();
  };

  const handleStopRound = () => {
    setAutomation(false);
    setLivePaused(false);
    if (livePanelRef.current?.isRunning()) {
      livePanelRef.current.stop();
    }
  };

  const hasPendingMatch = useMemo(() => !!findNextPlayableMatch(rounds), [rounds]);
  const currentRoundNumber = useMemo(() => {
    if (!rounds.length) return null;
    for (let ridx = 0; ridx < rounds.length; ridx++) {
      const round = rounds[ridx];
      if (!round?.matches?.length) continue;
      const pending = round.matches.some(match => {
        const active = match.players.filter(p => p && p !== KO_BYE);
        if (!active.length) return false;
        if (active.length < 3) return !match.eliminated;
        return !match.eliminated;
      });
      if (pending) return ridx + 1;
    }
    return rounds.length;
  }, [rounds]);
  const podiumPlacements = useMemo(() => {
    if (!finalStandings?.placements?.length) return [] as { token: KnockoutPlayer; total: number | null }[];
    return finalStandings.placements
      .filter(entry => entry?.token && entry.token !== KO_BYE)
      .slice(0, 3)
      .map(entry => {
        const numericTotal = Number(entry.total);
        return {
          token: entry.token,
          total: Number.isFinite(numericTotal) ? numericTotal : null,
        };
      })
      .sort((a, b) => {
        const aScore = typeof a.total === 'number' ? a.total : Number.NEGATIVE_INFINITY;
        const bScore = typeof b.total === 'number' ? b.total : Number.NEGATIVE_INFINITY;
        return bScore - aScore;
      });
  }, [finalStandings]);

  const finalPlacementLookup = useMemo(() => {
    const map = new Map<string, { rank: number; total: number | null }>();
    podiumPlacements.forEach((placement, idx) => {
      const token = typeof placement.token === 'string' ? placement.token : null;
      if (!token) return;
      map.set(token, {
        rank: idx,
        total: typeof placement.total === 'number' ? placement.total : null,
      });
    });
    return map;
  }, [podiumPlacements]);

  const scoreboardTotals = useMemo(() => {
    if (liveTotals) return liveTotals;
    if (seriesTotals) return seriesTotals;
    if (!currentMatch) return null;
    const base = Number.isFinite(startScore) ? startScore : 0;
    return [base, base, base] as [number, number, number];
  }, [liveTotals, seriesTotals, currentMatch, startScore]);

  const seatsForLive = currentMatch ? currentMatch.seats : fallbackLive.seats;
  const modelsForLive = currentMatch ? currentMatch.seatModels : fallbackLive.seatModels;
  const keysForLive = currentMatch ? currentMatch.seatKeys : fallbackLive.seatKeys;
  const delaysForLive = currentMatch ? currentMatch.delays : fallbackLive.delays;
  const timeoutsForLive = currentMatch ? currentMatch.timeouts : fallbackLive.timeouts;

  const handleAddEntry = () => {
    setEntries(prev => {
      const choice = KO_ALL_CHOICES[prev.length % KO_ALL_CHOICES.length] ?? 'built-in:greedy-max';
      return [...prev, createDefaultKnockoutEntry(choice, prev)];
    });
  };

  const handleRemoveEntry = (id: string) => {
    setEntries(prev => prev.filter(entry => entry.id !== id));
  };

  const handleEntryChoiceChange = (id: string, choice: BotChoice) => {
    setEntries(prev => prev.map(entry => {
      if (entry.id !== id) return entry;
      const others = prev.filter(e => e.id !== id);
      const suffix = deriveAutoAliasSuffix(entry.name, entry.choice);
      let nextName = entry.name;
      if (suffix !== undefined) {
        if (suffix) {
          const candidate = `${choiceLabel(choice)}${suffix}`;
          nextName = others.some(o => o.name.trim() === candidate)
            ? defaultAliasForChoice(choice, others)
            : candidate;
        } else {
          nextName = defaultAliasForChoice(choice, others);
        }
      }
      const nextKeys = sanitizeKnockoutKeys(choice, entry.keys);
      const nextModel = choice.startsWith('ai:')
        ? (choice === entry.choice ? entry.model : '')
        : '';
      return { ...entry, choice, name: nextName, keys: nextKeys, model: nextModel };
    }));
  };

  const updateEntry = (id: string, mutator: (entry: KnockoutEntry) => KnockoutEntry) => {
    setEntries(prev => prev.map(entry => entry.id === id ? mutator(entry) : entry));
  };

  const handleEntryModelChange = (id: string, model: string) => {
    updateEntry(id, entry => ({ ...entry, model }));
  };

  const handleEntryKeyChange = (id: string, key: keyof BotCredentials, value: string) => {
    updateEntry(id, entry => ({ ...entry, keys: { ...(entry.keys || {}), [key]: value } }));
  };

  const handleEntryDelayChange = (id: string, value: string) => {
    const num = Math.max(0, Math.floor(Number(value) || 0));
    updateEntry(id, entry => ({ ...entry, delayMs: num }));
  };

  const handleEntryTimeoutChange = (id: string, value: string) => {
    const num = Math.max(5, Math.floor(Number(value) || 0));
    updateEntry(id, entry => ({ ...entry, timeoutSecs: num }));
  };

  const participantsTitle = lang === 'en' ? 'Participants' : '参赛选手';
  const participantsHint = lang === 'en'
    ? 'Pick bots, AIs, or a human player just like regular matches.'
    : '从常规赛使用的内置 / 外置 AI 或人类选手中选择参赛选手。';

  const intervalTitle = lang === 'en' ? 'Min play interval (ms)' : '最小间隔 (ms)';
  const timeoutTitle = lang === 'en' ? 'Think timeout (s)' : '弃牌时间（秒）';

  return (
    <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
      <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>{lang === 'en' ? 'Knockout tournament' : '淘汰赛'}</div>
      <div style={{ fontSize:14, color:'#4b5563', marginBottom:12 }}>
        {lang === 'en'
          ? 'Generate a single-elimination bracket. Add participants below; byes are inserted automatically when required.'
          : '快速生成单败淘汰赛对阵。先在下方选择参赛选手，不足时会自动补齐轮空。'}
      </div>
      <div style={{ border:'1px solid #e5e7eb', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:10 }}>{lang === 'en' ? 'Match settings' : '对局设置'}</div>
        <div
          style={{
            display:'grid',
            gridTemplateColumns:'repeat(2, minmax(0, 1fr))',
            gap:12,
            gridAutoFlow:'row dense',
            alignItems:'center',
          }}
        >
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Enable match' : '启用对局'}
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => updateSettings({ enabled: e.target.checked })}
                />
              </label>
              <button
                onClick={handleResetAll}
                style={{ padding:'4px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
              >{lang === 'en' ? 'Reset' : '清空'}</button>
            </div>
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:8 }}>
            {lang === 'en' ? 'Games per trio' : '每组三人局数'}
            <input
              type="number"
              min={1}
              step={1}
              value={roundsPerGroup}
              onChange={e => updateSettings({ roundsPerGroup: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              style={{ flex:'1 1 120px', minWidth:0 }}
            />
          </label>
          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:24, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Outbid landlord' : '可抢地主'}
                <input
                  type="checkbox"
                  checked={bid}
                  onChange={e => updateSettings({ bid: e.target.checked })}
                />
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Farmer cooperation' : '农民配合'}
                <input
                  type="checkbox"
                  checked={farmerCoop}
                  onChange={e => updateSettings({ farmerCoop: e.target.checked })}
                />
              </label>
            </div>
          </div>
          <div style={{ gridColumn:'2 / 3' }}>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>
              {lang === 'en' ? 'Initial score' : '初始分'}
              <input
                type="number"
                step={10}
                value={startScore}
                onChange={e => updateSettings({ startScore: Number(e.target.value) || 0 })}
                style={{ flex:'1 1 120px', minWidth:0 }}
              />
            </label>
          </div>
          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                {lang === 'en' ? 'Ladder / TrueSkill' : '天梯  /  TrueSkill'}
                <input
                  ref={allFileRef}
                  type="file"
                  accept="application/json"
                  style={{ display:'none' }}
                  onChange={handleAllFileUpload}
                />
                <button
                  onClick={() => allFileRef.current?.click()}
                  style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
                >{lang === 'en' ? 'Upload' : '上传'}</button>
              </label>
              <button
                onClick={() => window.dispatchEvent(new Event('ddz-all-save'))}
                style={{ padding:'3px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
              >{lang === 'en' ? 'Save' : '存档'}</button>
            </div>
          </div>
          <label style={{ gridColumn:'2 / 3', display:'flex', alignItems:'center', gap:8 }}>
            {lang === 'en' ? '4-with-2 rule' : '4带2 规则'}
            <select
              value={four2}
              onChange={e => updateSettings({ four2: e.target.value as Four2Policy })}
              style={{ flex:'1 1 160px', minWidth:0 }}
            >
              <option value="both">{lang === 'en' ? 'Allowed' : '都可'}</option>
              <option value="2singles">{lang === 'en' ? 'Two singles' : '两张单牌'}</option>
              <option value="2pairs">{lang === 'en' ? 'Two pairs' : '两对'}</option>
            </select>
          </label>
          <div style={{ gridColumn:'1 / -1', fontSize:12, color:'#6b7280' }}>
            {lang === 'en'
              ? 'Applies to each elimination trio per round.'
              : '用于本轮每组三名选手的对局局数。'}
          </div>
        </div>
      </div>
      <div style={{ border:'1px dashed #d1d5db', borderRadius:10, padding:12, marginBottom:12 }}>
        <div style={{ fontWeight:700, marginBottom:4 }}>{participantsTitle}</div>
        <div style={{ fontSize:13, color:'#4b5563', marginBottom:12 }}>{participantsHint}</div>
        <div
          style={{
              display:'grid',
              gap:12,
              gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))',
              alignItems:'stretch',
            }}
          >
            {entries.map((entry, idx) => {
              const canRemove = entries.length > 3;
              return (
              <div
                key={entry.id}
                style={{
                  border:'1px solid #e5e7eb',
                  borderRadius:8,
                  padding:10,
                  display:'flex',
                  flexDirection:'column',
                  gap:8,
                  height:'100%',
                }}
              >
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                  <div style={{ fontWeight:600 }}>{participantLabel(idx)}</div>
                  <button
                    onClick={() => handleRemoveEntry(entry.id)}
                    disabled={!canRemove}
                    style={{
                      padding:'4px 8px',
                      borderRadius:6,
                      border:'1px solid #d1d5db',
                      background: canRemove ? '#fff' : '#f3f4f6',
                      color:'#1f2937',
                      cursor: canRemove ? 'pointer' : 'not-allowed',
                    }}
                  >{lang === 'en' ? 'Remove' : '移除'}</button>
                </div>
                <label style={{ display:'block' }}>
                  {lang === 'en' ? 'Select' : '选择'}
                  <select
                    value={entry.choice}
                    onChange={e => handleEntryChoiceChange(entry.id, e.target.value as BotChoice)}
                    style={{ width:'100%', marginTop:4 }}
                  >
                    <optgroup label={lang === 'en' ? 'Built-in' : '内置'}>
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                      <option value="built-in:mininet">MiniNet</option>
                      <option value="built-in:ally-support">AllySupport</option>
                      <option value="built-in:endgame-rush">EndgameRush</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'AI / External' : 'AI / 外置'}>
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="ai:deepseek">DeepSeek</option>
                      <option value="http">HTTP</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'Human' : '人类选手'}>
                      <option value="human">{humanOptionLabel}</option>
                    </optgroup>
                  </select>
                </label>
                {entry.choice.startsWith('ai:') && (
                  <label style={{ display:'block' }}>
                    {lang === 'en' ? 'Model (optional)' : '模型（可选）'}
                    <input
                      type="text"
                      value={entry.model}
                      placeholder={defaultModelFor(entry.choice)}
                      onChange={e => handleEntryModelChange(entry.id, e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                    <div style={{ fontSize:12, color:'#777', marginTop:4 }}>
                      {lang === 'en'
                        ? `Leave blank to use ${defaultModelFor(entry.choice)}.`
                        : `留空则使用推荐：${defaultModelFor(entry.choice)}`}
                    </div>
                  </label>
                )}

                {entry.choice === 'ai:openai' && (
                  <label style={{ display:'block' }}>
                    OpenAI API Key
                    <input
                      type="password"
                      value={entry.keys?.openai || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'openai', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:gemini' && (
                  <label style={{ display:'block' }}>
                    Gemini API Key
                    <input
                      type="password"
                      value={entry.keys?.gemini || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'gemini', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:grok' && (
                  <label style={{ display:'block' }}>
                    xAI (Grok) API Key
                    <input
                      type="password"
                      value={entry.keys?.grok || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'grok', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:kimi' && (
                  <label style={{ display:'block' }}>
                    Kimi API Key
                    <input
                      type="password"
                      value={entry.keys?.kimi || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'kimi', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:qwen' && (
                  <label style={{ display:'block' }}>
                    Qwen API Key
                    <input
                      type="password"
                      value={entry.keys?.qwen || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'qwen', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'ai:deepseek' && (
                  <label style={{ display:'block' }}>
                    DeepSeek API Key
                    <input
                      type="password"
                      value={entry.keys?.deepseek || ''}
                      onChange={e => handleEntryKeyChange(entry.id, 'deepseek', e.target.value)}
                      style={{ width:'100%', marginTop:4 }}
                    />
                  </label>
                )}

                {entry.choice === 'http' && (
                  <>
                    <label style={{ display:'block' }}>
                      HTTP Base / URL
                      <input
                        type="text"
                        value={entry.keys?.httpBase || ''}
                        onChange={e => handleEntryKeyChange(entry.id, 'httpBase', e.target.value)}
                        style={{ width:'100%', marginTop:4 }}
                      />
                    </label>
                    <label style={{ display:'block' }}>
                      HTTP Token（可选）
                      <input
                        type="password"
                        value={entry.keys?.httpToken || ''}
                        onChange={e => handleEntryKeyChange(entry.id, 'httpToken', e.target.value)}
                        style={{ width:'100%', marginTop:4 }}
                      />
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={handleAddEntry}
          style={{ marginTop:12, padding:'6px 12px', borderRadius:8, border:'1px solid #d1d5db', background:'#f9fafb', cursor:'pointer' }}
        >{lang === 'en' ? 'Add participant' : '新增参赛者'}</button>
      </div>

      <div style={{ marginTop:12 }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>{lang === 'en' ? 'Min play interval per participant (ms)' : '每位参赛者出牌最小间隔 (ms)'}</div>
        <div
          style={{
            display:'grid',
            gap:12,
            gridTemplateColumns:'repeat(3, minmax(0, 1fr))',
            alignItems:'stretch',
          }}
        >
          {entries.map((entry, idx) => (
            <div key={`${entry.id}-delay`} style={{ border:'1px dashed #e5e7eb', borderRadius:6, padding:10 }}>
              <div style={{ fontWeight:700, marginBottom:8 }}>{participantLabel(idx)}</div>
              <label style={{ display:'block' }}>
                {intervalTitle}
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={entry.delayMs}
                  onChange={e => handleEntryDelayChange(entry.id, e.target.value)}
                  style={{ width:'100%', marginTop:4 }}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop:12 }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>{lang === 'en' ? 'Think timeout per participant (s)' : '每位参赛者思考超时（秒）'}</div>
        <div
          style={{
            display:'grid',
            gap:12,
            gridTemplateColumns:'repeat(3, minmax(0, 1fr))',
            alignItems:'stretch',
          }}
        >
          {entries.map((entry, idx) => (
            <div key={`${entry.id}-timeout`} style={{ border:'1px dashed #e5e7eb', borderRadius:6, padding:10 }}>
              <div style={{ fontWeight:700, marginBottom:8 }}>{participantLabel(idx)}</div>
              <label style={{ display:'block' }}>
                {timeoutTitle}
                <input
                  type="number"
                  min={5}
                  step={1}
                  value={entry.timeoutSecs}
                  onChange={e => handleEntryTimeoutChange(entry.id, e.target.value)}
                  style={{ width:'100%', marginTop:4 }}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:16 }}>
        <button
          onClick={handleGenerate}
          disabled={!enabled}
          style={{
            padding:'6px 12px',
            borderRadius:8,
            border:'1px solid #d1d5db',
            background: enabled ? '#2563eb' : '#9ca3af',
            color:'#fff',
            cursor: enabled ? 'pointer' : 'not-allowed',
          }}
        >{lang === 'en' ? 'Generate bracket' : '生成对阵'}</button>
        <button
          onClick={handleReset}
          disabled={!enabled || !rounds.length}
          style={{
            padding:'6px 12px',
            borderRadius:8,
            border:'1px solid #d1d5db',
            background: rounds.length && enabled ? '#fff' : '#f3f4f6',
            color:'#1f2937',
            cursor: rounds.length && enabled ? 'pointer' : 'not-allowed',
          }}
        >{lang === 'en' ? 'Reset bracket' : '重置对阵'}</button>
      </div>
      {error && (
        <div style={{ marginTop:8, color:'#dc2626', fontSize:13 }}>{error}</div>
      )}
      {notice && !error && (
        <div style={{ marginTop:8, color:'#2563eb', fontSize:13 }}>{notice}</div>
      )}

      <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:12, marginTop:16 }}>
        <LadderPanel />
      </div>

      {rounds.length > 0 && (
        <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:12 }}>
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div style={{ fontWeight:700 }}>
                {currentRoundNumber
                  ? (lang === 'en' ? `Current round: Round ${currentRoundNumber}` : `当前轮次：第 ${currentRoundNumber} 轮`)
                  : (lang === 'en' ? 'No pending rounds.' : '暂无待运行轮次。')}
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {(() => {
                  const startDisabled = !enabled || liveRunning || automationActive || !hasPendingMatch;
                  return (
                    <button
                      onClick={handleStartRound}
                      disabled={startDisabled}
                      style={{
                        padding:'6px 12px',
                        borderRadius:8,
                        border:'1px solid #d1d5db',
                        background: startDisabled ? '#f3f4f6' : '#2563eb',
                        color: startDisabled ? '#9ca3af' : '#fff',
                        cursor: startDisabled ? 'not-allowed' : 'pointer',
                        fontWeight:600,
                      }}
                    >{lang === 'en' ? 'Start' : '开始'}</button>
                  );
                })()}
                {(() => {
                  const pauseDisabled = !liveRunning;
                  return (
                    <button
                      onClick={handlePauseRound}
                      disabled={pauseDisabled}
                      style={{
                        padding:'6px 12px',
                        borderRadius:8,
                        border:'1px solid #d1d5db',
                        background: pauseDisabled ? '#f3f4f6' : (livePaused ? '#bfdbfe' : '#fde68a'),
                        color: pauseDisabled ? '#9ca3af' : (livePaused ? '#1e3a8a' : '#92400e'),
                        cursor: pauseDisabled ? 'not-allowed' : 'pointer',
                        fontWeight:600,
                      }}
                    >{livePaused ? (lang === 'en' ? 'Resume' : '继续') : (lang === 'en' ? 'Pause' : '暂停')}</button>
                  );
                })()}
                {(() => {
                  const stopDisabled = !liveRunning && !automationActive;
                  return (
                    <button
                      onClick={handleStopRound}
                      disabled={stopDisabled}
                      style={{
                        padding:'6px 12px',
                        borderRadius:8,
                        border:'1px solid #d1d5db',
                        background: stopDisabled ? '#f3f4f6' : '#fee2e2',
                        color: stopDisabled ? '#9ca3af' : '#b91c1c',
                        cursor: stopDisabled ? 'not-allowed' : 'pointer',
                        fontWeight:600,
                      }}
                    >{lang === 'en' ? 'Stop' : '停止'}</button>
                  );
                })()}
              </div>
            </div>
            <div style={{ marginTop:12, display:'grid', gap:12 }}>
              {rounds.map((round, ridx) => (
                <div key={`round-${ridx}`} style={{ border:'1px dashed #d1d5db', borderRadius:10, padding:12 }}>
                  <div style={{ fontWeight:700, marginBottom:6 }}>
                    {lang === 'en' ? `Round ${ridx + 1}` : `第 ${ridx + 1} 轮`}
                  </div>
                  <div style={{ fontSize:13, color:'#4b5563', marginBottom:8 }}>
                    {lang === 'en'
                      ? `Each trio plays ${roundsPerGroup} game(s) this round.`
                      : `本轮每组三人进行 ${roundsPerGroup} 局。`}
                  </div>
                  <div style={{ display:'grid', gap:10 }}>
                    {round.matches.map((match, midx) => {
                      const actionable = match.players.filter(p => p && p !== KO_BYE) as string[];
                      const eliminatedLabel = match.eliminated ? displayName(match.eliminated) : null;
                      const survivors = match.eliminated
                        ? match.players.filter(p => p && p !== match.eliminated && p !== KO_BYE)
                        : [];
                      const isActiveMatch = currentMatch?.roundIdx === ridx && currentMatch?.matchIdx === midx;
                      const cardBorder = isActiveMatch ? '#2563eb' : '#e5e7eb';
                      const cardBackground = isActiveMatch ? '#f0f9ff' : '#fff';
                      const manualDisabled = automationActive || liveRunning;
                      const isFinalMatchCard = isFinalRoundMatch(rounds, ridx, midx);
                      const finalStatusNodes = isFinalMatchCard
                        ? (() => {
                            const placements = match.players
                              .filter((playerToken): playerToken is string => typeof playerToken === 'string')
                              .map(playerToken => {
                                const placement = finalPlacementLookup.get(playerToken);
                                return placement ? { playerToken, placement } : null;
                              })
                              .filter((entry): entry is { playerToken: string; placement: { rank: number; total: number | null } } => !!entry)
                              .sort((a, b) => a.placement.rank - b.placement.rank);
                            return placements.map(({ playerToken, placement }) => {
                              const labelText = placement.rank === 0
                                ? (lang === 'en' ? 'Champion' : '冠军')
                                : placement.rank === 1
                                  ? (lang === 'en' ? 'Runner-up' : '亚军')
                                  : (lang === 'en' ? 'Third place' : '季军');
                              const baseText = lang === 'en'
                                ? `${labelText}: ${displayName(playerToken)}`
                                : `${labelText}：${displayName(playerToken)}`;
                              const scoreText = placement.total != null
                                ? (lang === 'en'
                                  ? ` (Points: ${placement.total})`
                                  : `（积分：${placement.total}）`)
                                : '';
                              return (
                                <span
                                  key={`${match.id || `match-${midx}`}-final-${playerToken}`}
                                  style={{ fontSize:12, color:'#047857', fontWeight:600 }}
                                >
                                  {baseText}{scoreText}
                                </span>
                              );
                            });
                          })()
                        : [];
                      return (
                        <div
                          key={match.id || `round-${ridx}-match-${midx}`}
                          style={{
                            border:`1px solid ${cardBorder}`,
                            borderRadius:8,
                            padding:10,
                            background: cardBackground,
                          }}
                        >
                          <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:8 }}>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
                              {match.players.map((playerToken, pidx) => {
                                const meta = playerMeta(playerToken);
                                const eliminated = match.eliminated === playerToken || playerToken === KO_BYE;
                                const labelColor = eliminated ? '#9ca3af' : '#1f2937';
                                const detailColor = eliminated ? '#9ca3af' : '#6b7280';
                                return (
                                  <div key={`${match.id || `match-${midx}`}-player-${pidx}`} style={{ display:'flex', alignItems:'center', gap:6 }}>
                                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2 }}>
                                      <span style={{ fontWeight:700, fontSize:16, color: labelColor, opacity: eliminated ? 0.7 : 1 }}>
                                        {meta.label}
                                      </span>
                                      {meta.provider && (
                                        <span style={{ fontSize:12, color: detailColor, opacity: eliminated ? 0.65 : 1 }}>
                                          {meta.provider}
                                        </span>
                                      )}
                                    </div>
                                    {pidx < match.players.length - 1 && <span style={{ color:'#6b7280', fontSize:14 }}>vs</span>}
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
                              {finalStatusNodes.length > 0 ? (
                                finalStatusNodes
                              ) : (
                                <>
                                  {eliminatedLabel && (
                                    <span style={{ fontSize:12, color:'#b91c1c' }}>
                                      {lang === 'en' ? `Eliminated: ${eliminatedLabel}` : `淘汰：${eliminatedLabel}`}
                                    </span>
                                  )}
                                  {match.eliminated && survivors.length > 0 && (
                                    <span style={{ fontSize:12, color:'#047857' }}>
                                      {lang === 'en'
                                        ? `Advancing: ${survivors.map(p => displayName(p)).join(', ')}`
                                        : `晋级：${survivors.map(p => displayName(p)).join('，')}`}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          {actionable.length ? (
                            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                              {actionable.map(player => {
                                const isActive = match.eliminated === player;
                                const disabled = manualDisabled;
                                return (
                                  <button
                                    key={player}
                                    onClick={() => handleToggleEliminated(ridx, midx, player)}
                                    disabled={disabled}
                                    style={{
                                      padding:'4px 10px',
                                      borderRadius:8,
                                      border:'1px solid #d1d5db',
                                      background: isActive ? '#dc2626' : disabled ? '#f3f4f6' : '#fff',
                                      color: isActive ? '#fff' : disabled ? '#9ca3af' : '#1f2937',
                                      cursor: disabled ? 'not-allowed' : 'pointer',
                                    }}
                                  >{lang === 'en' ? `Eliminate ${displayName(player)}` : `淘汰 ${displayName(player)}`}</button>
                                );
                              })}
                            </div>
                          ) : (
                            <div style={{ fontSize:12, color:'#6b7280' }}>
                              {lang === 'en' ? 'Waiting for previous results.' : '等待上一轮结果。'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ border:'1px solid #e5e7eb', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>
              {lang === 'en' ? 'Live trio monitor' : '实时对局面板'}
            </div>
            {currentMatch ? (
              <>
                <div style={{ fontSize:13, color:'#4b5563', marginBottom:8 }}>
                  {currentMatch.tokens.map((token, idx) => (
                    <span key={`${token}-label`}>
                      {displayName(token)}{idx < currentMatch.tokens.length - 1 ? ' vs ' : ''}
                    </span>
                  ))}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, marginBottom:12 }}>
                  {currentMatch.tokens.map((token, idx) => {
                    const label = currentMatch.labels[idx] || displayName(token);
                    const total = scoreboardTotals ? scoreboardTotals[idx] : null;
                    const seatChoice = currentMatch.seats[idx];
                    const model = (currentMatch.seatModels[idx] || '').trim();
                    const httpBase = typeof currentMatch.seatKeys[idx]?.httpBase === 'string'
                      ? currentMatch.seatKeys[idx]!.httpBase!.trim()
                      : '';
                    const providerText = seatChoice === 'human'
                      ? humanProviderLabel
                      : providerSummary(seatChoice, model, httpBase, lang);
                    return (
                      <div key={`${token}-score`} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:10, background:'#fff' }}>
                        <div style={{ fontWeight:700, marginBottom:4 }}>{label}</div>
                        <div style={{ fontSize:12, color:'#6b7280', marginBottom:6 }}>{providerText}</div>
                        <div style={{ fontSize:24, fontWeight:800, color:'#111827' }}>{total != null ? total : '—'}</div>
                      </div>
                    );
                  })}
                </div>
                {overtimeCount > 0 && (
                  <div style={{ fontSize:12, color:'#b91c1c', marginBottom:12 }}>
                    {overtimeReason === 'final'
                      ? (lang === 'en'
                        ? `Final round overtime #${overtimeCount} (3 games) is running to break the tie.`
                        : `决赛积分出现平局，正在进行第 ${overtimeCount} 次加时赛（每次 3 局）。`)
                      : (lang === 'en'
                        ? `Overtime playoff #${overtimeCount} (3 games) is running because of a lowest-score tie.`
                        : `由于积分最低出现平局，正在进行第 ${overtimeCount} 次加时赛（每次 3 局）。`)}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize:13, color:'#6b7280', marginBottom:12 }}>
                {lang === 'en' ? 'Click “Start” to run the next trio.' : '点击“开始”运行下一组三人对局。'}
              </div>
            )}
            <div>
              <LivePanel
                key={matchKey}
                ref={livePanelRef}
                rounds={seriesRounds}
                startScore={startScore}
                seatDelayMs={delaysForLive}
                enabled={enabled && !!currentMatch}
                bid={bid}
                four2={four2}
                seats={seatsForLive}
                seatModels={modelsForLive}
                seatKeys={keysForLive}
                farmerCoop={farmerCoop}
                onTotals={setLiveTotals}
                onRunningChange={setLiveRunning}
                onPauseChange={setLivePaused}
                onFinished={handleLiveFinished}
                controlsHidden
                initialTotals={seriesTotals}
                turnTimeoutSecs={timeoutsForLive}
              />
            </div>
          </div>
        </div>
      )}

      {podiumPlacements.length ? (
        <div style={{
          marginTop:16,
          padding:12,
          border:'1px solid #bbf7d0',
          background:'#ecfdf5',
          borderRadius:10,
          color:'#047857',
        }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>
            {lang === 'en' ? 'Final standings' : '最终排名'}
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:16 }}>
            {podiumPlacements.map((placement, idx) => {
              const label = idx === 0
                ? (lang === 'en' ? 'Champion' : '冠军')
                : idx === 1
                  ? (lang === 'en' ? 'Runner-up' : '亚军')
                  : (lang === 'en' ? 'Third place' : '季军');
              const score = typeof placement.total === 'number'
                ? placement.total
                : '';
              return (
                <div
                  key={`${placement.token || 'placement'}-${idx}`}
                  style={{
                    display:'flex',
                    flexWrap:'wrap',
                    gap:8,
                    fontWeight:700,
                    fontSize:24,
                  }}
                >
                  <span>{`${label}：${displayName(placement.token)}`}</span>
                  {score !== '' && (
                    <span style={{ fontSize:22, color:'#047857cc' }}>
                      {lang === 'en' ? `(Points: ${score})` : `（积分：${score}）`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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

function providerSummary(choice: BotChoice, model: string | undefined, httpBase: string | undefined, lang: Lang = 'zh'): string {
  const provider = choiceLabel(choice);
  if (choice === 'http') {
    const base = (httpBase || '').trim();
    if (!base) return provider;
    const customLabel = lang === 'en' ? 'custom' : '自定义';
    return `${provider} · ${customLabel}`;
  }
  if (choice.startsWith('ai:')) {
    const trimmedModel = (model || '').trim();
    return trimmedModel ? `${provider} · ${trimmedModel}` : provider;
  }
  return provider;
}
/* ====== 雷达图累计（0~5） ====== */
type Score5 = { coop:number; agg:number; cons:number; eff:number; bid:number };
function mergeScore(prev: Score5, curr: Score5, mode: 'mean'|'ewma', count:number, alpha:number): Score5 {
  if (mode === 'mean') {
    const c = Math.max(0, count);
    return {
      coop: (prev.coop*c + curr.coop)/(c+1),
      agg:  (prev.agg *c + curr.agg )/(c+1),
      cons: (prev.cons*c + curr.cons)/(c+1),
      eff:  (prev.eff *c + curr.eff )/(c+1),
      bid: (prev.bid *c + curr.bid )/(c+1),
    };
  }
  const a = Math.min(0.95, Math.max(0.05, alpha || 0.35));
  return {
    coop: a*curr.coop + (1-a)*prev.coop,
    agg:  a*curr.agg  + (1-a)*prev.agg,
    cons: a*curr.cons + (1-a)*prev.cons,
    eff:  a*curr.eff  + (1-a)*prev.eff,
    bid: a*curr.bid  + (1-a)*prev.bid,
  };
}

type RadarPanelProps = {
  aggStats: Score5[] | null;
  aggCount: number;
  aggMode: 'mean'|'ewma';
  alpha: number;
  onChangeMode: (m: 'mean'|'ewma') => void;
  onChangeAlpha: (a: number) => void;
};

const RadarPanel = ({ aggStats, aggCount, aggMode, alpha, onChangeMode, onChangeAlpha }: RadarPanelProps) => {
  const [mode, setMode] = useState<'mean'|'ewma'>(aggMode);
  const [a, setA] = useState<number>(alpha);

  useEffect(() => { setMode(aggMode); }, [aggMode]);
  useEffect(() => { setA(alpha); }, [alpha]);

  return (
    <>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:8 }}>
        <label>
          汇总方式
          <select
            value={mode}
            onChange={e => {
              const v = e.target.value as ('mean'|'ewma');
              setMode(v);
              onChangeMode(v);
            }}
            style={{ marginLeft:6 }}
          >
            <option value="ewma">指数加权（推荐）</option>
            <option value="mean">简单平均</option>
          </select>
        </label>
        {mode === 'ewma' && (
          <label>
            α（0.05–0.95）
            <input
              type="number"
              min={0.05}
              max={0.95}
              step={0.05}
              value={a}
              onChange={e => {
                const v = Math.min(0.95, Math.max(0.05, Number(e.target.value) || 0.35));
                setA(v);
                onChangeAlpha(v);
              }}
              style={{ width:80, marginLeft:6 }}
            />
          </label>
        )}
        <div style={{ fontSize:12, color:'#6b7280' }}>
          {mode === 'ewma' ? '越大越看重最近几局' : `已累计 ${aggCount} 局`}
        </div>
      </div>

      {aggStats
        ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0, 1, 2].map(i => (
              <RadarChart key={i} title={`${['甲', '乙', '丙'][i]}（累计）`} scores={aggStats[i]} />
            ))}
          </div>
        )
        : <div style={{ opacity:0.6 }}>（等待至少一局完成后生成累计画像）</div>
      }
    </>
  );
};

/* ---------- 文本改写：把“第 x 局”固定到本局 ---------- */
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

const sanitizeTotalsArray = (
  value: [number, number, number] | number[] | null | undefined,
  fallback: number,
): [number, number, number] => {
  const safe = Number.isFinite(fallback) ? fallback : 0;
  if (Array.isArray(value) && value.length === 3) {
    const mapped = value.map(v => {
      const num = Number(v);
      return Number.isFinite(num) ? num : safe;
    }) as number[];
    return [mapped[0], mapped[1], mapped[2]] as [number, number, number];
  }
  return [safe, safe, safe];
};

/* ==================== LivePanel（对局） ==================== */
const LivePanel = forwardRef<LivePanelHandle, LiveProps>(function LivePanel(props, ref) {
  const { t, lang } = useI18n();
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(false);
  const pauseResolversRef = useRef<Array<() => void>>([]);
  const runningRef = useRef(running);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { props.onRunningChange?.(running); }, [running, props.onRunningChange]);
  useEffect(() => { props.onPauseChange?.(paused); }, [paused, props.onPauseChange]);

  const flushPauseResolvers = () => {
    const list = pauseResolversRef.current.slice();
    pauseResolversRef.current.length = 0;
    for (const fn of list) {
      try { fn(); } catch {}
    }
  };
  const enterPause = () => {
    if (pauseRef.current) return;
    pauseRef.current = true;
    setPaused(true);
  };
  const exitPause = () => {
    pauseRef.current = false;
    setPaused(false);
    flushPauseResolvers();
  };
  const waitWhilePaused = async () => {
    if (!pauseRef.current) return;
    while (pauseRef.current) {
      await new Promise<void>(resolve => {
        pauseResolversRef.current.push(resolve);
      });
    }
  };

  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [plays, setPlays] = useState<{seat:number; move:'play'|'pass'; cards?:string[]; reason?:string}[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [bidMultiplier, setBidMultiplier] = useState(1);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [bottomInfo, setBottomInfo] = useState<BottomInfo>({ landlord: null, cards: [], revealed: false });
  const [log, setLog] = useState<string[]>([]);
  const humanTraceRef = useRef<string>('');
  const [humanRequest, setHumanRequest] = useState<HumanPrompt | null>(null);
  const [humanSelectedIdx, setHumanSelectedIdx] = useState<number[]>([]);
  const [humanSubmitting, setHumanSubmitting] = useState(false);
  const [humanError, setHumanError] = useState<string | null>(null);
  const humanSelectedSet = useMemo(() => new Set(humanSelectedIdx), [humanSelectedIdx]);
  const humanHint = humanRequest?.hint ?? null;
  const humanHintDecorated = useMemo(() => {
    if (!humanRequest || humanRequest.phase !== 'play') return [] as string[];
    if (!humanHint || humanHint.move !== 'play' || !Array.isArray(humanHint.cards)) return [] as string[];
    const seat = humanRequest.seat;
    if (seat == null || seat < 0 || seat >= hands.length) return [] as string[];
    const seatHand = hands[seat] || [];
    const desired = humanHint.cards.map(displayLabelFromRaw);
    const used = new Set<number>();
    const out: string[] = [];
    for (const label of desired) {
      const idx = seatHand.findIndex((card, i) => !used.has(i) && card === label);
      if (idx >= 0) {
        used.add(idx);
        out.push(seatHand[idx]);
      } else {
        out.push(label);
      }
    }
    return out;
  }, [humanRequest, humanHint, hands]);
  const humanHintMeta = useMemo(() => {
    if (!humanHint) return [] as string[];
    const items: string[] = [];
    if (humanHint.by) items.push(lang === 'en' ? `Source: ${humanHint.by}` : `来自：${humanHint.by}`);
    if (typeof humanHint.score === 'number' && Number.isFinite(humanHint.score)) {
      const scoreText = humanHint.score.toFixed(2);
      items.push(lang === 'en' ? `Estimated score ${scoreText}` : `估分：${scoreText}`);
    }
    if (humanHint.label && humanHint.move === 'play') {
      items.push(lang === 'en' ? `Pattern: ${humanHint.label}` : `牌型：${humanHint.label}`);
    }
    if (humanHint.reason) items.push(humanHint.reason);
    return items;
  }, [humanHint, lang]);

  const resetHumanState = useCallback(() => {
    setHumanRequest(null);
    setHumanSelectedIdx([]);
    setHumanSubmitting(false);
    setHumanError(null);
  }, []);

  const toggleHumanCard = useCallback((idx: number) => {
    setHumanSelectedIdx(prev => {
      if (prev.includes(idx)) return prev.filter(i => i !== idx);
      return [...prev, idx];
    });
  }, []);

  const hasHumanSeat = useMemo(() => {
    if (!Array.isArray(props.seats)) return false;
    return props.seats.some(choice => choice === 'human');
  }, [props.seats]);

  const isHumanSeat = useCallback((seat: number) => props.seats?.[seat] === 'human', [props.seats]);

  const submitHumanAction = useCallback(async (payload: any) => {
    if (!humanRequest || humanSubmitting) return;
    const trace = humanTraceRef.current;
    if (!trace) {
      setHumanError(lang === 'en' ? 'Client trace missing' : '缺少客户端标识');
      return;
    }
    setHumanSubmitting(true);
    setHumanError(null);
    try {
      const resp = await fetch('/api/human_action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientTraceId: trace,
          requestId: humanRequest.requestId,
          payload,
        }),
      });
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const data = await resp.json();
          if (data?.error) msg = data.error;
        } catch {}
        throw new Error(msg);
      }
    } catch (err:any) {
      setHumanSubmitting(false);
      setHumanError(err?.message || String(err));
    }
  }, [humanRequest, humanSubmitting, lang]);

  const handleHumanPlay = useCallback(async () => {
    if (!humanRequest || humanRequest.phase !== 'play') return;
    const seat = humanRequest.seat;
    const hand = hands[seat] || [];
    const cards = humanSelectedIdx
      .slice()
      .sort((a,b) => a - b)
      .map(idx => hand[idx])
      .filter((c): c is string => typeof c === 'string' && c.length > 0);
    if (cards.length === 0) {
      setHumanError(lang === 'en' ? 'Select at least one card.' : '请先选择要出的牌');
      return;
    }
    await submitHumanAction({ phase:'play', move:'play', cards });
  }, [humanRequest, humanSelectedIdx, submitHumanAction, hands, lang]);

  const handleHumanPass = useCallback(async () => {
    if (!humanRequest || humanRequest.phase !== 'play') return;
    await submitHumanAction({ phase:'play', move:'pass' });
  }, [humanRequest, submitHumanAction]);

  const handleHumanBid = useCallback(async (decision: boolean) => {
    if (!humanRequest || humanRequest.phase !== 'bid') return;
    await submitHumanAction({ phase:'bid', bid: decision });
  }, [humanRequest, submitHumanAction]);

  const handleHumanDouble = useCallback(async (decision: boolean) => {
    if (!humanRequest || humanRequest.phase !== 'double') return;
    await submitHumanAction({ phase:'double', double: decision });
  }, [humanRequest, submitHumanAction]);

  const handleHumanClear = useCallback(() => {
    setHumanSelectedIdx([]);
    setHumanError(null);
  }, []);

  const applyHumanHint = useCallback(() => {
    if (!humanRequest || humanRequest.phase !== 'play') return;
    const hint = humanRequest.hint;
    if (!hint || hint.move !== 'play' || !Array.isArray(hint.cards)) return;
    const seat = humanRequest.seat;
    if (seat == null || seat < 0 || seat >= hands.length) return;
    const seatHand = hands[seat] || [];
    const desired = hint.cards.map(displayLabelFromRaw);
    const used = new Set<number>();
    const indices: number[] = [];
    for (const label of desired) {
      const idx = seatHand.findIndex((card, i) => !used.has(i) && card === label);
      if (idx >= 0) {
        used.add(idx);
        indices.push(idx);
      }
    }
    if (indices.length > 0) {
      setHumanSelectedIdx(indices.sort((a, b) => a - b));
      setHumanError(null);
    }
  }, [humanRequest, hands, setHumanError, setHumanSelectedIdx]);

  const currentHumanSeat = humanRequest?.seat ?? null;
  const humanPhase = humanRequest?.phase ?? 'play';
  const humanSeatLabel = currentHumanSeat != null ? seatName(currentHumanSeat) : '';
  const humanPhaseText = humanPhase === 'bid'
    ? (lang === 'en' ? 'Bidding' : '抢地主')
    : humanPhase === 'double'
      ? (lang === 'en' ? 'Double' : '加倍')
      : (lang === 'en' ? 'Play cards' : '出牌');
  const humanRequireText = (() => {
    if (humanPhase !== 'play') return '';
    const req = humanRequest?.ctx?.require;
    if (!req) return lang === 'en' ? 'Any legal play' : '任意合法牌型';
    if (typeof req === 'string') return req;
    if (typeof req?.type === 'string') return req.type;
    return lang === 'en' ? 'Follow previous play' : '跟牌';
  })();
  const humanCanPass = humanPhase === 'play' ? humanRequest?.ctx?.canPass !== false : true;
  const humanSelectedCount = humanSelectedIdx.length;
  const canAdoptHint = humanPhase === 'play' && humanHint?.move === 'play' && humanHintDecorated.length > 0;
  const initialTotals = useMemo(
    () => sanitizeTotalsArray(props.initialTotals, props.startScore || 0),
    [props.initialTotals, props.startScore],
  );
  const [totals, setTotals] = useState<[number, number, number]>(() => (
    [initialTotals[0], initialTotals[1], initialTotals[2]]
  ));
  const initialTotalsRef = useRef<[number, number, number]>(initialTotals);
  useEffect(() => {
    initialTotalsRef.current = initialTotals;
    if (!runningRef.current) {
      setTotals(prev => {
        if (
          prev[0] === initialTotals[0] &&
          prev[1] === initialTotals[1] &&
          prev[2] === initialTotals[2]
        ) {
          return prev;
        }
        return [initialTotals[0], initialTotals[1], initialTotals[2]] as [number, number, number];
      });
    }
  }, [initialTotals]);
  const [finishedCount, setFinishedCount] = useState(0);
  // —— 每手牌得分（动态曲线）+ 分局切割与地主 ——
  const [scoreSeries, setScoreSeries] = useState<(number|null)[][]>([[],[],[]]);
  const scoreSeriesRef = useRef(scoreSeries); useEffect(()=>{ scoreSeriesRef.current = scoreSeries; }, [scoreSeries]);
  const [scoreBreaks, setScoreBreaks] = useState<number[]>([]);
  const scoreBreaksRef = useRef(scoreBreaks); useEffect(()=>{ scoreBreaksRef.current = scoreBreaks; }, [scoreBreaks]);
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
  const bottomRef = useRef(bottomInfo); useEffect(()=>{ bottomRef.current = bottomInfo; }, [bottomInfo]);

  // 依据 scoreSeries（每手评分）与 roundCuts（每局切点）计算每局均值，并汇总到席位统计
  const recomputeScoreStats = () => {
    try {
      const series = scoreSeriesRef.current;   // number[][]
      const cuts = roundCutsRef.current;       // number[]
      const n = Math.max(series[0]?.length||0, series[1]?.length||0, series[2]?.length||0);
      const bands = (cuts && cuts.length ? [...cuts] : [0]).sort((a,b)=>a-b);
      if (bands[0] !== 0) bands.unshift(0);
      if (bands[bands.length-1] !== n) bands.push(n);
      let totalRounds = 0;
      const perSeatRounds:number[][] = [[],[],[]];
      for (let b=0;b<bands.length-1;b++){
        const st = bands[b], ed = bands[b+1];
        const len = Math.max(0, ed - st);
        if (len <= 0) continue;
        totalRounds++;
        for (let s=0;s<3;s++){
          const arr = series[s]||[];
          let sum = 0, cnt = 0;
          for (let i=st;i<ed;i++){
            const v = arr[i];
            if (typeof v === 'number' && Number.isFinite(v)) { sum += v; cnt++; }
          }
          if (cnt>0) perSeatRounds[s].push(sum/cnt);
          else perSeatRounds[s].push(Number.NaN);
        }
      }
      const stats = [0,1,2].map(s=>{
        const rs = perSeatRounds[s];
        const rounds = totalRounds;
        if (rounds===0) return { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 };
        const valid = rs.filter(v => Number.isFinite(v));
        const overall = valid.length ? (valid.reduce((a,b)=>a+b,0) / valid.length) : 0;
        const last = (() => {
          for (let idx = rs.length - 1; idx >= 0; idx--) {
            const v = rs[idx];
            if (Number.isFinite(v)) return v as number;
          }
          return 0;
        })();
        const best = valid.length ? Math.max(...valid) : 0;
        const worst = valid.length ? Math.min(...valid) : 0;
        const mu = overall;
        const sigma = valid.length
          ? Math.sqrt(Math.max(0, valid.reduce((a,b)=>a + (b-mu)*(b-mu), 0) / valid.length))
          : 0;
        return { rounds, overallAvg: overall, lastAvg: last, best, worst, mean: mu, sigma };
      });
      setScoreStats(stats);
      setScoreDists(perSeatRounds.map(rs => rs.filter(v => Number.isFinite(v))));
    } catch (e) { console.error('[stats] recompute error', e); }
  }
  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);

  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);

  // 每局结束或数据变化时刷新统计
  useEffect(()=>{ recomputeScoreStats(); }, [roundCuts, scoreSeries]);
;
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

  const makeArchiveName = (suffix: string) => {
    const d = new Date();
    const pad = (n:number) => String(n).padStart(2, '0');
    const tag = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `ddz_all_stats_${tag}${suffix}`;
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
    const a = document.createElement('a'); a.href = url; a.download = makeArchiveName('_trueskill.json'); a.click();
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
    bid : Number(x?.bid ?? 2.5),
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
  const writeRadarStore = (_s: RadarStore) => { /* no-op: radar not persisted */ };

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
        bid : mean(prev.scores.bid, inc.bid),
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
          bid : w(ll.scores.bid, ff.scores.bid, ll.count, ff.count),
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
      return resolveRadarForIdentity(ids[i], role) || { scores: { coop:2.5, agg:2.5, cons:2.5, eff:2.5, bid:2.5 }, count: 0 };
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
    // writeRadarStore disabled (no radar persistence)
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
  setLog(l => [...l, '【Radar】存档已禁用（仅支持查看/刷新，不再保存到本地或 ALL 文件）。']);
};
;

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
  const bidMultiplierRef = useRef(bidMultiplier); useEffect(() => { bidMultiplierRef.current = bidMultiplier; }, [bidMultiplier]);

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
    if ((choice as string).startsWith('built-in') || choice === 'human') return label;
    const model = (props.seatModels?.[i]) || defaultModelFor(choice);
    return `${label}:${model}`;
  };

  const handleScoreSave = () => {
    const agents = [0,1,2].map(agentIdForIndex);
    const n = Math.max(scoreSeries[0]?.length||0, scoreSeries[1]?.length||0, scoreSeries[2]?.length||0);
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      agents,
      rounds: roundCutsRef.current,
      breaks: scoreBreaksRef.current,
      n,
      seriesBySeat: scoreSeriesRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'score_series.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
  };

  const handleScoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const j = JSON.parse(String(rd.result||'{}'));
          const fileAgents: string[] = j.agents || (Array.isArray(j.seats)? j.seats.map((s:any)=> s.agent || s.label) : []);
          const targetAgents = [0,1,2].map(agentIdForIndex);
          const mapped:(number|null)[][] = [[],[],[]];
          for (let i=0;i<3;i++){
            const idx = fileAgents.indexOf(targetAgents[i]);
            mapped[i] = (idx>=0 && Array.isArray(j.seriesBySeat?.[idx])) ? j.seriesBySeat[idx] : [];
          }
          setScoreSeries(mapped);
          if (Array.isArray(j.breaks)) setScoreBreaks(j.breaks as number[]);
          else setScoreBreaks([]);
          if (Array.isArray(j.rounds)) setRoundCuts(j.rounds as number[]);
        } catch (err) {
          console.error('[score upload] parse error', err);
        }
      };
      rd.readAsText(f);
    } catch (err) {
      console.error('[score upload] error', err);
    } finally {
      if (scoreFileRef.current) scoreFileRef.current.value = '';
    }
  };

  
  const handleStatsSave = () => {
    try {
      const payload = { when: new Date().toISOString(), stats: scoreStats, dists: scoreDists };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'score-stats.json';
      a.click();
      setTimeout(()=> URL.revokeObjectURL(a.href), 0);
    } catch (e) { console.error('[stats] save error', e); }
  };
  const handleStatsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const obj = JSON.parse(String(rd.result||'{}'));
          if (Array.isArray(obj.stats) && obj.stats.length===3) setScoreStats(obj.stats as any);
          if (Array.isArray(obj.dists) && obj.dists.length===3) setScoreDists(obj.dists as any);
        } catch (err) { console.error('[stats upload] parse error', err); }
      };
      rd.readAsText(f);
    } catch (err) { console.error('[stats upload] error', err); }
    finally { if (statsFileRef.current) statsFileRef.current.value = ''; }
  };
  const handleStatsRefresh = () => { setRoundCuts(prev => [...prev]); };
const handleScoreRefresh = () => {
    setScoreSeries(prev => prev.map(arr => Array.isArray(arr) ? [...arr] : []));
    setRoundCuts(prev => [...prev]);
    setRoundLords(prev => [...prev]);
    setScoreBreaks(prev => [...prev]);
  };
const [allLogs, setAllLogs] = useState<string[]>([]);
const allLogsRef = useRef(allLogs);
useEffect(() => { allLogsRef.current = allLogs; }, [allLogs]);
  const start = async () => {
    if (running) return;
    if (!props.enabled) { setLog(l => [...l, '【前端】未启用对局：请在设置中勾选“启用对局”。']); return; }

    exitPause();
    setRunning(true);
    setAllLogs([]);
    setLandlord(null); setHands([[], [], []]); setPlays([]);
    setBottomInfo({ landlord: null, cards: [], revealed: false });
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    const base = initialTotalsRef.current;
    setTotals([base[0], base[1], base[2]] as [number, number, number]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null); setAggCount(0);
    resetHumanState();
    humanTraceRef.current = '';

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
          const neutral: Score5 = { coop:2.5, agg:2.5, cons:2.5, eff:2.5, bid:2.5 };
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
      humanTraceRef.current = traceId;
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
          bid: props.bid,
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
          setLog(l => [...l, `⏳ 超过 ${Math.round(timeoutMs/1000)}s 未收到事件，已触发前端提示（后端会按规则自动“过”或出最小牌），继续等待…`]);
          lastEventTs = Date.now(); // 防止重复提示
        }
      }, 1000);
    
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      const rewrite = makeRewriteRoundLabel(labelRoundNo);

      while (true) {
        if (controllerRef.current?.signal.aborted) break;
        if (pauseRef.current) await waitWhilePaused();
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
          let nextBidMultiplier = bidMultiplierRef.current;
          let nextAggStats = aggStatsRef.current;
          let nextAggCount = aggCountRef.current;


          let nextScores = scoreSeriesRef.current.map(x => [...x]);
          let nextBreaks = scoreBreaksRef.current.slice();
          let sawAnyTurn = false;
          let nextCuts = roundCutsRef.current.slice();
          let nextLords = roundLordsRef.current.slice();
          let nextBottom = (() => {
            const cur = bottomRef.current;
            return {
              landlord: cur?.landlord ?? null,
              cards: (cur?.cards || []).map(c => ({ ...c })),
              revealed: !!cur?.revealed,
            } as BottomInfo;
          })();
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
              m = mapMsg(raw);
            } else {
              const m_any:any = raw; m = m_any;
            }

            // m already defined above
            try {
              // -------- TS 帧（后端主动提供） --------
              if (m.type === 'ts' && Array.isArray(m.ratings) && m.ratings.length === 3) {
                const incoming: Rating[] = m.ratings.map((r:any)=>({ mu:Number(r.mu)||25, sigma:Number(r.sigma)||25/3 }));
                setTsArr(incoming);

                if (m.where === 'after-round') {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                  nextLog = [...nextLog, `【TS】after-round 已更新 μ/σ`];
                } else if (m.where === 'before-round') {
                  nextLog = [...nextLog, `【TS】before-round μ/σ 准备就绪`];
                }
                continue;
              }

              // -------- 事件边界 --------
              if (m.type === 'event' && m.kind === 'round-start') {
                nextBidMultiplier = 1;
                nextMultiplier = 1;
                // 清空上一局残余手牌/出牌；等待 init/hands 再填充
                nextPlays = [];
                nextHands = [[], [], []] as any;
                nextLandlord = null;
                nextBottom = { landlord: null, cards: [], revealed: false };
                resetHumanState();

                nextLog = [...nextLog, `【边界】round-start #${m.round}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'round-end') {
                nextLog = [...nextLog, `【边界】round-end #${m.round}`];
                const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                resetHumanState();
                continue;
              }

              // -------- 初始发牌（仅限 init 帧） --------
              if (m.type === 'init') {
                const rh = m.hands;
                if (Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0])) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  nextMultiplier = 1; // 仅开局重置；后续“抢”只做×2
                  nextHands = (rh as string[][]).map(decorateHandCycle);

                  const rawLord = m.landlordIdx ?? m.landlord;
                  const lord = (typeof rawLord === 'number' && rawLord >= 0 && rawLord < 3)
                    ? rawLord
                    : null;
                  nextLandlord = lord;
                  const bottomRaw = Array.isArray(m.bottom) ? (m.bottom as string[]) : [];
                  const decoratedBottom = bottomRaw.length ? decorateHandCycle(bottomRaw) : [];
                  nextBottom = {
                    landlord: lord ?? null,
                    cards: decoratedBottom.map(label => ({ label, used: false })),
                    revealed: false,
                  };
                  {
                    const n0 = Math.max(nextScores[0]?.length||0, nextScores[1]?.length||0, nextScores[2]?.length||0);
                    const lordVal = (lord ?? -1) as number | -1;
                    if (nextCuts.length === 0) { nextCuts = [n0]; nextLords = [lordVal]; }
                    else if (nextCuts[nextCuts.length-1] !== n0) { nextCuts = [...nextCuts, n0]; nextLords = [...nextLords, lordVal]; }
                  }
                  // 若本局地主刚刚确认，回填到最近一段的 roundLords，避免底色为白
                  if (nextCuts.length > 0) {
                    const idxBand = Math.max(0, nextCuts.length - 1);
                    const lordVal2 = (nextLandlord ?? -1) as number | -1;
                    if (nextLords[idxBand] !== lordVal2) {
                      nextLords = Object.assign([], nextLords, { [idxBand]: lordVal2 });
                    }
                  }

                  nextLog = [...nextLog, `发牌完成，${lord != null ? seatName(lord) : '?' }为地主`];

                  try { applyTsFromStoreByRole(lord, '发牌后'); } catch {}
                  lastReasonRef.current = [null, null, null];
                }
                continue;
              }

              
              // -------- 首次手牌兜底注入（若没有 init 帧但消息里带了 hands） --------
              {
                const rh0 = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                if ((!nextHands || !(nextHands[0]?.length)) && Array.isArray(rh0) && rh0.length === 3 && Array.isArray(rh0[0])) {
                  nextHands = (rh0 as string[][]).map(decorateHandCycle);
                  const rawLord2 = m.landlordIdx ?? m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
                  const lord2 = (typeof rawLord2 === 'number' && rawLord2 >= 0 && rawLord2 < 3)
                    ? rawLord2
                    : null;
                  if (lord2 != null) {
                    nextLandlord = lord2;
                    if (nextBottom.landlord !== lord2) {
                      const keep = Array.isArray(nextBottom.cards)
                        ? nextBottom.cards.map(c => ({ ...c }))
                        : [];
                      nextBottom = { landlord: lord2, cards: keep, revealed: !!nextBottom.revealed };
                    }
                  }
                  const bottom0 = m.bottom ?? m.payload?.bottom ?? m.state?.bottom ?? m.init?.bottom;
                  if (Array.isArray(bottom0)) {
                    const decoratedBottom0 = decorateHandCycle(bottom0 as string[]);
                    nextBottom = {
                      landlord: nextLandlord ?? nextBottom.landlord ?? null,
                      cards: decoratedBottom0.map(label => ({ label, used: false })),
                      revealed: false,
                    };
                  }
                  // 不重置倍数/不清空已产生的出牌，避免覆盖后续事件
                  nextLog = [...nextLog, `发牌完成（推断），${lord2 != null ? seatName(lord2) : '?' }为地主`];
                  {
                    // —— 兜底：没有 init 帧也要推进 roundCuts / roundLords ——
                    const n0 = Math.max(
                      nextScores[0]?.length||0,
                      nextScores[1]?.length||0,
                      nextScores[2]?.length||0
                    );
                    const lordVal = (nextLandlord ?? -1) as number | -1;
                    if (nextCuts.length === 0) { nextCuts = [n0]; nextLords = [lordVal]; }
                    else if (nextCuts[nextCuts.length-1] !== n0) {
                      nextCuts = [...nextCuts, n0];
                      nextLords = [...nextLords, lordVal];
                    }
                    // 若本局地主刚刚确认，回填最近一段的 roundLords，避免底色为白
                    if (nextCuts.length > 0) {
                      const idxBand = Math.max(0, nextCuts.length - 1);
                      const lordVal2 = (nextLandlord ?? -1) as number | -1;
                      if (nextLords[idxBand] !== lordVal2) {
                        nextLords = Object.assign([], nextLords, { [idxBand]: lordVal2 });
                      }
                    }
                  }

                }
              }

              if (m.type === 'human-request') {
                const seat = typeof m.seat === 'number' ? m.seat : -1;
                if (seat >= 0 && seat < 3) {
                  const requestId = typeof m.requestId === 'string' ? m.requestId : `${Date.now()}-${Math.random()}`;
                  const rawHint = (m as any).hint ?? (m as any).suggestion;
                  let hint: HumanHint | undefined;
                  if (rawHint && typeof rawHint === 'object') {
                    const move = rawHint.move === 'play' ? 'play' : 'pass';
                    const cards = Array.isArray(rawHint.cards) ? rawHint.cards.map((c: any) => String(c)) : undefined;
                    const scoreVal = Number((rawHint as any).score);
                    const score = Number.isFinite(scoreVal) ? scoreVal : undefined;
                    const reason = typeof rawHint.reason === 'string' ? rawHint.reason : undefined;
                    const label = typeof rawHint.label === 'string' ? rawHint.label : undefined;
                    const byHint = typeof rawHint.by === 'string' ? rawHint.by : undefined;
                    hint = { move, cards, score, reason, label, by: byHint };
                  }
                  setHumanRequest({
                    seat,
                    requestId,
                    phase: typeof m.phase === 'string' ? m.phase : 'play',
                    ctx: m.ctx ?? {},
                    timeoutMs: typeof m.timeoutMs === 'number' ? m.timeoutMs : undefined,
                    delayMs: typeof m.delayMs === 'number' ? m.delayMs : undefined,
                    by: typeof m.by === 'string' ? m.by : undefined,
                    hint,
                  });
                  setHumanSelectedIdx([]);
                  setHumanSubmitting(false);
                  setHumanError(null);
                  const label = seatName(seat);
                  const phaseLabel = typeof m.phase === 'string' ? m.phase : 'play';
                  nextLog = [...nextLog, `【Human】${label} 等待操作｜phase=${phaseLabel}`];
                }
                continue;
              }

              // -------- AI 过程日志 --------
              if (m.type === 'event' && m.kind === 'bot-call') {
                const prefix = isHumanSeat(m.seat) ? 'Human' : 'AI';
                nextLog = [...nextLog, `${prefix}调用｜${seatName(m.seat)}｜${m.by ?? agentIdForIndex(m.seat)}${m.model ? `(${m.model})` : ''}｜阶段=${m.phase || 'unknown'}${m.need ? `｜需求=${m.need}` : ''}`];
                continue;
              }
              if (m.type === 'event' && m.kind === 'bot-done') {
                const prefix = isHumanSeat(m.seat) ? 'Human' : 'AI';
                nextLog = [
                  ...nextLog,
                  `${prefix}完成｜${seatName(m.seat)}｜${m.by ?? agentIdForIndex(m.seat)}${m.model ? `(${m.model})` : ''}｜耗时=${m.tookMs}ms`,
                  ...(m.reason ? [`${prefix}理由｜${seatName(m.seat)}：${m.reason}`] : []),
                ];
                if (isHumanSeat(m.seat)) {
                  setHumanSubmitting(false);
                  setHumanRequest(prev => (prev && prev.seat === m.seat ? null : prev));
                  setHumanSelectedIdx([]);
                }
                lastReasonRef.current[m.seat] = m.reason || null;
                continue;
              }

              // -------- 抢/不抢 --------
              if (m.type === 'event' && m.kind === 'bid') {
  const mm = Number((m as any).mult || 0);
  const bb = Number((m as any).bidMult || 0);
  if (Number.isFinite(bb) && bb > 0) nextBidMultiplier = Math.max(nextBidMultiplier || 1, bb);
  else if (m.bid) nextBidMultiplier = Math.min(64, Math.max(1, (nextBidMultiplier || 1) * 2));
  if (Number.isFinite(mm) && mm > 0) nextMultiplier = Math.max(nextMultiplier || 1, mm);
  else if (m.bid) nextMultiplier = Math.min(64, Math.max(1, (nextMultiplier || 1) * 2));
  const sc = (typeof (m as any).score === 'number' ? (m as any).score : Number((m as any).score || NaN));
  const scTxt = Number.isFinite(sc) ? sc.toFixed(2) : '-';
  nextLog = [...nextLog, `${seatName(m.seat)} ${m.bid ? '抢地主' : '不抢'}｜score=${scTxt}｜叫抢x${nextBidMultiplier}｜对局x${nextMultiplier}`];
  continue;
              }
else if (m.type === 'event' && m.kind === 'bid-eval') {
  const who = (typeof seatName==='function') ? seatName(m.seat) : `seat${m.seat}`;
  const sc  = (typeof m.score==='number' && isFinite(m.score)) ? m.score.toFixed(2) : String(m.score);
  const thr = (typeof m.threshold==='number' && isFinite(m.threshold)) ? m.threshold.toFixed(2) : String(m.threshold ?? '');
  const dec = m.decision || 'pass';
  const line = `${who} 评估｜score=${sc}｜阈值=${thr}｜决策=${dec}`;
  nextLog.push(line);
}


              // -------- 明牌后额外加倍 --------
// -------- 倍数校准（兜底） --------

// ------ 明牌（显示底牌） ------
if (m.type === 'event' && m.kind === 'reveal') {
  const btm = Array.isArray((m as any).bottom) ? (m as any).bottom : [];
  const seatIdxRaw = (typeof (m.landlordIdx ?? m.landlord) === 'number')
    ? (m.landlordIdx ?? m.landlord) as number
    : nextLandlord;
  const landlordSeat = (typeof seatIdxRaw === 'number') ? seatIdxRaw : (nextLandlord ?? nextBottom.landlord ?? null);
  const mapped = resolveBottomDecorations(btm, landlordSeat, nextHands as string[][]);

  if (typeof landlordSeat === 'number' && landlordSeat >= 0 && landlordSeat < 3) {
    let seatHand = Array.isArray(nextHands[landlordSeat]) ? [...nextHands[landlordSeat]] : [];
    const prevBottom = bottomRef.current;
    if (prevBottom && prevBottom.landlord === landlordSeat && Array.isArray(prevBottom.cards)) {
      for (const prevCard of prevBottom.cards) {
        const idxPrev = seatHand.indexOf(prevCard.label);
        if (idxPrev >= 0) seatHand.splice(idxPrev, 1);
      }
    }
    seatHand = sortDisplayHand([...seatHand, ...mapped]);
    nextHands = Object.assign([], nextHands, { [landlordSeat]: seatHand });
  }

  nextBottom = {
    landlord: landlordSeat ?? nextBottom.landlord ?? null,
    cards: mapped.map(label => ({ label, used: false })),
    revealed: true,
  };
  const pretty = mapped.length ? mapped : (decorateHandCycle ? decorateHandCycle(btm) : btm);
  nextLog = [...nextLog, `明牌｜底牌：${pretty.join(' ')}`];
  // 不改变 nextMultiplier，仅展示
  continue;
}
if (m.type === 'event' && m.kind === 'multiplier-sync') {
  const cur = Math.max(1, (nextMultiplier || 1));
  const mlt = Math.max(1, Number((m as any).multiplier || 1));
  nextMultiplier = Math.max(cur, mlt);
  const bcur = Math.max(1, (nextBidMultiplier || 1));
  const bmlt = Math.max(1, Number((m as any).bidMult || 1));
  nextBidMultiplier = Math.max(bcur, bmlt);
  nextLog = [...nextLog, `倍数校准为 叫抢x${nextBidMultiplier}｜对局x${nextMultiplier}`];
  continue;
}


// ------ 明牌后独立加倍：逐家决策 ------
if (m.type === 'event' && m.kind === 'double-decision') {
  const who = seatName(m.seat);
  const decided = m.double ? '加倍' : '不加倍';
  const parts: string[] = [ `[加倍阶段] ${who}${m.role==='landlord'?'(地主)':''} ${decided}` ];
  if (typeof m.delta === 'number' && isFinite(m.delta)) parts.push(`Δ=${m.delta.toFixed(2)}`);
  if (typeof m.dLhat === 'number' && isFinite(m.dLhat)) parts.push(`Δ̂=${m.dLhat.toFixed(2)}`);
  if (typeof m.counter === 'number' && isFinite(m.counter)) parts.push(`counter=${m.counter.toFixed(2)}`);
  if (typeof m.reason === 'string') parts.push(`理由=${m.reason}`);
  if (m.bayes && (typeof m.bayes.landlord!=='undefined' || typeof m.bayes.farmerY!=='undefined')) {
    const l = Number(m.bayes.landlord||0), y = Number(m.bayes.farmerY||0);
    parts.push(`bayes:{L=${l},Y=${y}}`);
  }
  nextLog = [...nextLog, parts.join('｜')];
  continue;
}

// ------ 明牌后独立加倍：汇总 ------
if (m.type === 'event' && m.kind === 'double-summary') {
  const base = Math.max(1, Number((m as any).base || 1));
  const yi   = Math.max(1, Number((m as any).mulY || (m as any).multiplierYi || 1));
  const bing = Math.max(1, Number((m as any).mulB || (m as any).multiplierBing || 1));
  nextLog = [...nextLog,
    `明牌加倍汇总｜基础x${base}`,
    `对乙x${yi}｜对丙x${bing}`
  ];
  // 不直接改 nextMultiplier，保持旧逻辑一致性
  continue;
}
if (m.type === 'event' && (m.kind === 'extra-double' || m.kind === 'post-double')) {
  if (m.do) nextMultiplier = Math.max(1, (nextMultiplier || 1) * 2);
  nextLog = [...nextLog, `${seatName(m.seat)} ${m.do ? '加倍' : '不加倍'}（明牌后）`];
  continue;
}
// -------- 起新墩 --------
              if (m.type === 'event' && m.kind === 'trick-reset') {
                nextLog = [...nextLog, '一轮结束，重新起牌'];
                nextPlays = [];
                const idxBreak = Math.max(
                  nextScores[0]?.length||0,
                  nextScores[1]?.length||0,
                  nextScores[2]?.length||0,
                );
                if (idxBreak > 0 && nextBreaks[nextBreaks.length-1] !== idxBreak) {
                  nextBreaks = [...nextBreaks, idxBreak];
                }
                continue;
              }

              // -------- 出/过 --------
              
                // （fallback）若本批次没有收到 'turn' 行，则从 event:play 中恢复 score
                if (!sawAnyTurn) {
                  const s = (typeof m.seat === 'number') ? m.seat as number : -1;
                  if (s>=0 && s<3) {
                    let val: number|null = (typeof (m as any).score === 'number') ? (m as any).score as number : null;
                    if (typeof val !== 'number') {
                      const rr = (m.reason ?? lastReasonRef.current?.[s] ?? '') as string;
                      const mm = /score=([+-]?\d+(?:\.\d+)?)/.exec(rr || '');
                      if (mm) { val = parseFloat(mm[1]); }
                    }
                    for (let i=0;i<3;i++){
                      if (!Array.isArray(nextScores[i])) nextScores[i]=[];
                      nextScores[i] = [...nextScores[i], (i===s ? val : null)];
                    }
                  }
                }

              // -------- 记录 turn（含 score） --------
              if (m.type === 'turn') {
                const s = (typeof m.seat === 'number') ? m.seat as number : -1;
                if (s>=0 && s<3) {
                  sawAnyTurn = true;
                  const val = (typeof m.score === 'number') ? (m.score as number) : null;
                  for (let i=0;i<3;i++){
                    if (!Array.isArray(nextScores[i])) nextScores[i]=[];
                    nextScores[i] = [...nextScores[i], (i===s ? val : null)];
                  }
                }
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
                  if (seat === (nextBottom.landlord ?? -1) && pretty.length && nextBottom.cards.length) {
                    const updated = nextBottom.cards.map(c => ({ ...c }));
                    for (const label of pretty) {
                      const idxCard = updated.findIndex(c => !c.used && c.label === label);
                      if (idxCard >= 0) {
                        updated[idxCard] = { ...updated[idxCard], used: true };
                      }
                    }
                    nextBottom = { ...nextBottom, cards: updated };
                  }
                  const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                  lastReasonRef.current[m.seat] = null;

                  nextHands = nh;
                  nextPlays = [...nextPlays, { seat: m.seat, move: 'play', cards: pretty, reason }];
                  nextLog = [...nextLog, `${seatName(m.seat)} 出牌：${pretty.join(' ')}${reason ? `（理由：${reason}）` : ''}`];
                }
                continue;
              }

              // -------- 结算（多种别名兼容） --------
              const isWinLike =
                (m.type === 'event' && (m.kind === 'win' || m.kind === 'result' || m.kind === 'game-over' || m.kind === 'game_end')) ||
                (m.type === 'result') || (m.type === 'game-over') || (m.type === 'game_end');
              if (isWinLike) {
                const L = (nextLandlord ?? 0) as number;
                const ds = (Array.isArray(m.deltaScores) ? m.deltaScores
                          : Array.isArray(m.delta) ? m.delta
                          : [0,0,0]) as [number,number,number];

                // 将“以地主为基准”的增减分旋转成“按座位顺序”的展示
                const rot: [number,number,number] = [
                  ds[(0 - L + 3) % 3],
                  ds[(1 - L + 3) % 3],
                  ds[(2 - L + 3) % 3],
                ];
                let nextWinnerLocal     = m.winner ?? nextWinner ?? null;
                const effMult = (m.multiplier ?? (nextMultiplier ?? 1));
// 判定 rot 是否已经按倍数放大：基分 |-2|+|+1|+|+1| = 4
const sumAbs = Math.abs(rot[0]) + Math.abs(rot[1]) + Math.abs(rot[2]);
const needScale = effMult > 1 && (sumAbs === 4 || (sumAbs % effMult !== 0));
const rot2 = needScale
  ? (rot.map(v => (typeof v === 'number' ? v * effMult : v)) as [number, number, number])
  : rot;
nextMultiplier = effMult;
nextDelta      = rot2;
nextTotals     = [
  nextTotals[0] + rot2[0],
  nextTotals[1] + rot2[1],
  nextTotals[2] + rot2[2]
] as any;
                {
                  const mYi  = Number(((m as any).multiplierYi ?? 0));
                  const mBing= Number(((m as any).multiplierBing ?? 0));
                  if ((mYi && mYi > 0) || (mBing && mBing > 0)) {
                    nextLog = [...nextLog, `结算倍数拆分｜对乙x${mYi || 1}｜对丙x${mBing || 1}`];
                  }
                }


                // 若后端没给 winner，依据“地主增减”推断胜负：ds[0] > 0 => 地主胜
                if (nextWinnerLocal == null) {
                  const landlordDelta = ds[0] ?? 0;
                  if (landlordDelta > 0) nextWinnerLocal = L;
                  else if (landlordDelta < 0) {
                    const farmer = [0,1,2].find(x => x !== L)!;
                    nextWinnerLocal = farmer;
                  }
                }
                nextWinner = nextWinnerLocal;

                // 标记一局结束 & 雷达图兜底
                {
                  const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = res.nextFinished; nextAggStats = res.nextAggStats; nextAggCount = res.nextAggCount;
                }

                
                // ✅ Ladder（活动积分 ΔR）：按本局分差幅度加权（独立于胜负方向）
                try {
                  const pre = tsRef.current.map(r => ({ ...r })); // 局前 TS 快照
                  const farmers = [0,1,2].filter(x => x !== L);
                  const farmerWin = (nextWinner === L) ? false : true;
                  const teamWin = (seat:number) => (seat === L) ? (!farmerWin) : farmerWin;
                  const teamP = (seat:number) => {
                    const teamA = (seat === L) ? [L] : farmers;
                    const teamB = (seat === L) ? farmers : [L];
                    const muA = teamA.reduce((ss,i)=> ss + pre[i].mu, 0);
                    const muB = teamB.reduce((ss,i)=> ss + pre[i].mu, 0);
                    const vA  = teamA.reduce((ss,i)=> ss + pre[i].sigma*pre[i].sigma + TS_BETA*TS_BETA, 0);
                    const vB  = teamB.reduce((ss,i)=> ss + pre[i].sigma*pre[i].sigma + TS_BETA*TS_BETA, 0);
                    const c = Math.sqrt(vA + vB);
                    return Phi( (muA - muB) / c );
                  };
                  const mag = Math.max(Math.abs(ds[0]||0), Math.abs(ds[1]||0), Math.abs(ds[2]||0));
                  const base = 20, cap = 3, gamma = 1;
                  const weight = 1 + gamma * Math.min(cap, mag / base);
                  for (let i=0;i<3;i++) {
                    const sWinTeam = teamWin(i) ? 1 : 0;
                    const pExpTeam = teamP(i);
                    const scale    = (i === L) ? 1 : 0.5;  // 地主记一份，两个农民各记半份
                    const id = seatIdentity(i);
                    const label = agentIdForIndex(i);
                    ladderUpdateLocal(id, label, sWinTeam * scale, pExpTeam * scale, weight);
                  }
                } catch {}
// ✅ TrueSkill：局后更新 + 写入“角色分档”存档
                {
                  const updated = tsRef.current.map(r => ({ ...r }));
                  const farmers = [0,1,2].filter(s => s !== L);
                  const landlordDelta = ds[0] ?? 0;
                  const landlordWin = (nextWinner === L) || (landlordDelta > 0);
                  if (landlordWin) tsUpdateTwoTeams(updated, [L], farmers);
                  else             tsUpdateTwoTeams(updated, farmers, [L]);

                  setTsArr(updated);
                  updateStoreAfterRound(updated, L);

                  nextLog = [
                    ...nextLog,
                    `TS(局后)：甲 μ=${fmt2(updated[0].mu)} σ=${fmt2(updated[0].sigma)}｜乙 μ=${fmt2(updated[1].mu)} σ=${fmt2(updated[1].sigma)}｜丙 μ=${fmt2(updated[2].mu)} σ=${fmt2(updated[2].sigma)}`
                  ];
                }

                nextLog = [
                  ...nextLog,
                  `胜者：${nextWinner == null ? '—' : seatName(nextWinner)}，倍数 x${nextMultiplier}，当局积分（按座位） ${rot.join(' / ')}｜原始（相对地主） ${ds.join(' / ')}｜地主=${seatName(L)}`
                ];
                continue;
              }

              // -------- 画像统计（两种形态） --------
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
                    bid : Number(sc.bid ?? 2.5),
                  };
                }) as Score5[];

                // 同步写入 Radar 本地存档（overall + 角色分档）
                updateRadarStoreFromStats(s3, nextLandlord);

                const mode  = aggModeRef.current;
                const a     = alphaRef.current;

                if (!nextAggStats) {
                  nextAggStats = s3.map(x=>({ ...x }));
                  nextAggCount = 1;
                } else {
                  nextAggStats = nextAggStats.map((prev, idx) => mergeScore(prev, s3[idx], mode, nextAggCount, a));
                  nextAggCount = nextAggCount + 1;
                }

                const msg = s3.map((v, i)=>`${seatName(i)}：Coop ${v.coop}｜Agg ${v.agg}｜Cons ${v.cons}｜Eff ${v.eff}｜抢地主倾向 ${v.bid}`).join(' ｜ ');
                nextLog = [...nextLog, `战术画像（本局）：${msg}（已累计 ${nextAggCount} 局）`];
                continue;
              }

              // -------- 文本日志 --------
              if (m.type === 'log' && typeof m.message === 'string') {
                nextLog = [...nextLog, rewrite(m.message)];
                continue;
              }
            } catch (e) { console.error('[ingest:batch]', e, raw); }
          }

          if (nextLandlord != null && nextBottom.landlord !== nextLandlord) {
            const keep = Array.isArray(nextBottom.cards)
              ? nextBottom.cards.map(c => ({ ...c }))
              : [];
            nextBottom = { landlord: nextLandlord, cards: keep, revealed: !!nextBottom.revealed };
          }

          setRoundLords(nextLords);
          setRoundCuts(nextCuts);
          setScoreSeries(nextScores);
          setScoreBreaks(nextBreaks);
          setHands(nextHands); setPlays(nextPlays);
          setBottomInfo(nextBottom);
          setTotals(nextTotals); setFinishedCount(nextFinished);
          setLog(nextLog); setLandlord(nextLandlord);
          setWinner(nextWinner); setMultiplier(nextMultiplier); setBidMultiplier(nextBidMultiplier); setDelta(nextDelta);
          setAggStats(nextAggStats || null); setAggCount(nextAggCount || 0);
        }
        if (pauseRef.current) await waitWhilePaused();
      }

          if (dogId) { try { clearInterval(dogId); } catch {} }
    setLog((l:any)=>{
  const __snapshot = [...(Array.isArray(l)?l:[]), `—— 本局流结束 ——`];
  (logRef as any).current = __snapshot;
  setAllLogs((prev:any)=>[...(Array.isArray(prev)?prev:[]), ...__snapshot, `
--- End of Round ${labelRoundNo} ---
`]);
  return __snapshot;
});
};

    const restBetweenRounds = async () => {
      const base = 800 + Math.floor(Math.random() * 600);
      const step = 120;
      let elapsed = 0;
      while (elapsed < base) {
        if (controllerRef.current?.signal.aborted || pauseRef.current) break;
        const slice = Math.min(step, base - elapsed);
        await new Promise(resolve => setTimeout(resolve, slice));
        elapsed += slice;
      }
      if (!controllerRef.current?.signal.aborted) {
        await waitWhilePaused();
      }
    };

    let aborted = false;
    let endedEarlyForNegative = false;
    try {
      for (let i = 0; i < props.rounds; i++) {
        if (controllerRef.current?.signal.aborted) break;
        if (pauseRef.current) await waitWhilePaused();
        const thisRound = i + 1;
        await playOneGame(i, thisRound);
        if (controllerRef.current?.signal.aborted) break;
        if (pauseRef.current) await waitWhilePaused();
        const hasNegative = Array.isArray(totalsRef.current) && totalsRef.current.some(v => (v as number) < 0);
        if (hasNegative) {
          endedEarlyForNegative = true;
          setLog(l => [...l, '【前端】检测到总分 < 0，停止连打。']);
          break;
        }
        await restBetweenRounds();
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') { aborted = true; setLog(l => [...l, '已手动停止。']); }
      else setLog(l => [...l, `错误：${e?.message || e}`]);
    } finally {
      exitPause();
      setRunning(false);
      resetHumanState();
      humanTraceRef.current = '';
      const totalsSnap = (() => {
        const value = totalsRef.current;
        if (value && Array.isArray(value) && value.length === 3) {
          return [value[0], value[1], value[2]] as [number, number, number];
        }
        const base = initialTotalsRef.current;
        return [base[0], base[1], base[2]] as [number, number, number];
      })();
      const finishedGames = finishedRef.current || 0;
      const targetRounds = Math.max(1, Number(props.rounds) || 1);
      props.onFinished?.({
        aborted,
        finishedCount: finishedGames,
        totals: totalsSnap,
        completedAll: !aborted && (finishedGames >= targetRounds || endedEarlyForNegative),
        endedEarlyForNegative,
      });
    }
  };

  const stop = () => {
    exitPause();
    controllerRef.current?.abort();
    setRunning(false);
    resetHumanState();
    humanTraceRef.current = '';
  };

  const togglePause = () => {
    if (!running) return;
    if (pauseRef.current) exitPause();
    else enterPause();
  };

  useImperativeHandle(ref, () => ({
    start,
    stop,
    togglePause,
    isRunning: () => runningRef.current,
    isPaused: () => pauseRef.current,
  }));

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  // ===== 统一统计打包（All-in-One） =====
type AllBundle = {
  schema: 'ddz-all@1';
  createdAt: string;
  identities: string[];
  trueskill?: TsStore;
  /* radar?: RadarStore;  // disabled */
  ladder?: { schema:'ddz-ladder@1'; updatedAt:string; players: Record<string, any> };
};

const buildAllBundle = (): AllBundle => {
  const identities = [0,1,2].map(seatIdentity);
  let ladder: any = null;
  try {
    const raw = localStorage.getItem('ddz_ladder_store_v1');
    ladder = raw ? JSON.parse(raw) : null;
  } catch {}
  return {
    schema: 'ddz-all@1',
    createdAt: new Date().toISOString(),
    identities,
    trueskill: tsStoreRef.current,
    /* radar excluded */
    ladder,
  };
};

const applyAllBundleInner = (obj:any) => {
  try {
    if (obj?.trueskill?.players) {
      tsStoreRef.current = obj.trueskill as TsStore;
      writeStore(tsStoreRef.current);
    }
    // radar ignored for ALL upload (persistence disabled)

    if (obj?.ladder?.schema === 'ddz-ladder@1') {
      try { localStorage.setItem('ddz_ladder_store_v1', JSON.stringify(obj.ladder)); } catch {}
    }
    setLog(l => [...l, '【ALL】统一上传完成（TS / 画像 / 天梯）。']);
  } catch (e:any) {
    setLog(l => [...l, `【ALL】统一上传失败：${e?.message || e}`]);
  }
};
const handleAllSaveInner = () => {
    const payload = buildAllBundle();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = makeArchiveName('.json'); a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    setLog(l => [...l, '【ALL】已导出统一统计文件。']);
  };

  

  const handleAllRefreshInner = () => {
    applyTsFromStoreByRole(landlordRef.current, '手动刷新');
    applyRadarFromStoreByRole(landlordRef.current, '手动刷新');
    setScoreSeries(prev => prev.map(arr => Array.isArray(arr) ? [...arr] : []));
    setScoreBreaks(prev => [...prev]);
    setRoundCuts(prev => [...prev]);
    setRoundLords(prev => [...prev]);
    setLog(l => [...l, '【ALL】已刷新面板数据。']);
  };

  useEffect(()=>{
    const onSave = () => handleAllSaveInner();
    const onRefresh = () => handleAllRefreshInner();
    const onUpload = (e: Event) => {
      const ce = e as CustomEvent<any>;
      applyAllBundleInner(ce.detail);
    };
    window.addEventListener('ddz-all-save', onSave as any);
    window.addEventListener('ddz-all-refresh', onRefresh as any);
    window.addEventListener('ddz-all-upload', onUpload as any);
    return () => {
      window.removeEventListener('ddz-all-save', onSave as any);
      window.removeEventListener('ddz-all-refresh', onRefresh as any);
      window.removeEventListener('ddz-all-upload', onUpload as any);
    };
  }, []);

  return (
    <div>
      {!props.controlsHidden && (
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
        <button
          onClick={start}
          disabled={running}
          style={{
            padding:'8px 12px',
            borderRadius:8,
            border:'1px solid #d1d5db',
            background: running ? '#f3f4f6' : '#2563eb',
            color: running ? '#9ca3af' : '#fff',
            cursor: running ? 'not-allowed' : 'pointer',
            fontWeight:600,
          }}
        >开始</button>
        <button
          onClick={togglePause}
          disabled={!running}
          style={{
            padding:'8px 12px',
            borderRadius:8,
            border:'1px solid #d1d5db',
            background: !running ? '#f3f4f6' : (paused ? '#bfdbfe' : '#fde68a'),
            color: !running ? '#9ca3af' : (paused ? '#1e3a8a' : '#92400e'),
            cursor: !running ? 'not-allowed' : 'pointer',
            fontWeight:600,
          }}
        >{paused ? '继续' : '暂停'}</button>
        <button
          onClick={stop}
          disabled={!running}
          style={{
            padding:'8px 12px',
            borderRadius:8,
            border:'1px solid #d1d5db',
            background: running ? '#fee2e2' : '#f3f4f6',
            color: running ? '#b91c1c' : '#9ca3af',
            cursor: running ? 'pointer' : 'not-allowed',
            fontWeight:600,
          }}
        >停止</button>
        <span style={{ display:'inline-flex', alignItems:'center', padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>
      )}

      {/* ========= TrueSkill（实时） ========= */}
      <Section title="TrueSkill（实时）">
        {/* 上传 / 存档 / 刷新 */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
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
        <ScoreTimeline
          series={scoreSeries}
          bands={roundCuts}
          landlords={roundLords}
          breaks={scoreBreaks}
          labels={[0,1,2].map(i=>agentIdForIndex(i))}
          height={240}
        />
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
                {/* 分布曲线（每局均值的分布） */}
                
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
              <Hand
                cards={hands[i]}
                interactive={!!(humanRequest && humanRequest.seat === i && humanRequest.phase === 'play')}
                selectedIndices={humanRequest && humanRequest.seat === i ? humanSelectedSet : undefined}
                onToggle={humanRequest && humanRequest.seat === i && humanRequest.phase === 'play' ? toggleHumanCard : undefined}
                disabled={humanSubmitting}
                faceDown={hasHumanSeat ? !isHumanSeat(i) : false}
              />
            </div>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginTop:8 }}>
          {[0,1,2].map(i=>{
            const showAllBottom = !bottomInfo.revealed && bottomInfo.cards.length > 0;
            const isLandlord = bottomInfo.landlord === i;
            const showCards = showAllBottom
              ? true
              : bottomInfo.revealed
                ? isLandlord
                : (!hasHumanSeat);
            const cards = showCards ? bottomInfo.cards : [];
            const labelText = lang === 'en'
              ? `Bottom${showAllBottom ? ' (pre-bid)' : ''}`
              : `底牌${showAllBottom ? '（待抢地主）' : ''}`;
            const background = showAllBottom
              ? '#fef3c7'
              : (isLandlord ? '#f0fdf4' : '#f9fafb');
            return (
              <div
                key={`bottom-${i}`}
                style={{
                  border:'1px dashed #d1d5db',
                  borderRadius:8,
                  padding:'6px 8px',
                  minHeight:64,
                  display:'flex',
                  flexDirection:'column',
                  justifyContent:'center',
                  alignItems:'center',
                  background
                }}
              >
                <div style={{ fontSize:12, color:'#6b7280', marginBottom:4 }}>{labelText}</div>
                {showCards ? (
                  cards.length ? (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4, justifyContent:'center' }}>
                      {cards.map((c, idx) => (
                        <Card key={`${c.label}-${idx}`} label={c.label} dimmed={c.used} compact />
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize:12, color:'#9ca3af' }}>
                      {lang === 'en' ? '(awaiting reveal)' : '（待明牌）'}
                    </div>
                  )
                ) : (
                  <div style={{ fontSize:12, color:'#d1d5db' }}>—</div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {humanRequest && (
        <Section title={lang === 'en' ? 'Human control' : '人类操作'}>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ fontWeight:700 }}>
              {lang === 'en'
                ? `Seat ${humanSeatLabel} · ${humanPhaseText}`
                : `${humanSeatLabel} ｜ ${humanPhaseText}`}
            </div>
            {humanPhase === 'play' && (
              <>
                <div style={{ fontSize:12, color:'#6b7280' }}>
                  {lang === 'en'
                    ? `Requirement: ${humanRequireText} · Can pass: ${humanCanPass ? 'Yes' : 'No'} · Selected: ${humanSelectedCount}`
                    : `需求：${humanRequireText} ｜ 可过：${humanCanPass ? '是' : '否'} ｜ 已选：${humanSelectedCount}`}
                </div>
                {humanHint && (
                  <div
                    style={{
                      border:'1px solid #bfdbfe',
                      background:'#eff6ff',
                      borderRadius:8,
                      padding:'8px 10px',
                      display:'flex',
                      flexDirection:'column',
                      gap:6,
                    }}
                  >
                    <div style={{ fontWeight:600, color:'#1d4ed8' }}>
                      {lang === 'en'
                        ? (humanHint.move === 'play' ? 'Suggestion: play these cards' : 'Suggestion: pass this turn')
                        : (humanHint.move === 'play' ? '提示：建议出牌' : '提示：建议过牌')}
                    </div>
                    {humanHint.move === 'play' ? (
                      humanHintDecorated.length > 0 ? (
                        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                          {humanHintDecorated.map((card, idx) => (
                            <Card key={`hint-${card}-${idx}`} label={card} compact />
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize:12, color:'#4b5563' }}>
                          {lang === 'en'
                            ? 'No specific combination suggested; choose any legal play.'
                            : '暂无具体牌型建议，可根据规则自由选择。'}
                        </div>
                      )
                    ) : (
                      <div style={{ fontSize:12, color:'#4b5563' }}>
                        {lang === 'en'
                          ? 'Hint: passing keeps stronger responses for later.'
                          : '提示：建议过牌以保留更强的牌型。'}
                      </div>
                    )}
                    {humanHintMeta.length > 0 && (
                      <div style={{ fontSize:12, color:'#4b5563' }}>
                        {humanHintMeta.join(lang === 'en' ? ' · ' : ' ｜ ')}
                      </div>
                    )}
                    {canAdoptHint && (
                      <div>
                        <button
                          onClick={applyHumanHint}
                          disabled={humanSubmitting}
                          style={{
                            padding:'4px 10px',
                            border:'1px solid #3b82f6',
                            borderRadius:6,
                            background: humanSubmitting ? '#dbeafe' : '#3b82f6',
                            color: humanSubmitting ? '#6b7280' : '#fff',
                          }}
                        >
                          {lang === 'en' ? 'Adopt suggestion' : '采纳建议'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  <button
                    onClick={handleHumanPlay}
                    disabled={humanSubmitting || humanSelectedCount === 0}
                    style={{ padding:'6px 12px', border:'1px solid #2563eb', borderRadius:8, background: humanSubmitting || humanSelectedCount === 0 ? '#e5e7eb' : '#2563eb', color: humanSubmitting || humanSelectedCount === 0 ? '#6b7280' : '#fff' }}
                  >{lang === 'en' ? 'Play selected' : '出牌'}</button>
                  <button
                    onClick={handleHumanPass}
                    disabled={humanSubmitting || !humanCanPass}
                    style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:8, background: humanSubmitting || !humanCanPass ? '#f3f4f6' : '#fff', color:'#1f2937' }}
                  >{lang === 'en' ? 'Pass' : '过'}</button>
                  <button
                    onClick={handleHumanClear}
                    disabled={humanSubmitting || humanSelectedCount === 0}
                    style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff', color:'#1f2937' }}
                  >{lang === 'en' ? 'Clear selection' : '清空选择'}</button>
                </div>
              </>
            )}
            {humanPhase === 'bid' && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                <button
                  onClick={() => handleHumanBid(true)}
                  disabled={humanSubmitting}
                  style={{ padding:'6px 12px', border:'1px solid #2563eb', borderRadius:8, background: humanSubmitting ? '#e5e7eb' : '#2563eb', color: humanSubmitting ? '#6b7280' : '#fff' }}
                >{lang === 'en' ? 'Bid' : '抢地主'}</button>
                <button
                  onClick={() => handleHumanBid(false)}
                  disabled={humanSubmitting}
                  style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff', color:'#1f2937' }}
                >{lang === 'en' ? 'Pass' : '不抢'}</button>
              </div>
            )}
            {humanPhase === 'double' && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                <button
                  onClick={() => handleHumanDouble(true)}
                  disabled={humanSubmitting}
                  style={{ padding:'6px 12px', border:'1px solid #2563eb', borderRadius:8, background: humanSubmitting ? '#e5e7eb' : '#2563eb', color: humanSubmitting ? '#6b7280' : '#fff' }}
                >{lang === 'en' ? 'Double' : '加倍'}</button>
                <button
                  onClick={() => handleHumanDouble(false)}
                  disabled={humanSubmitting}
                  style={{ padding:'6px 12px', border:'1px solid #d1d5db', borderRadius:8, background:'#fff', color:'#1f2937' }}
                >{lang === 'en' ? 'No double' : '不加倍'}</button>
              </div>
            )}
            {humanError && (
              <div style={{ color:'#dc2626', fontSize:12 }}>{humanError}</div>
            )}
            {humanSubmitting && (
              <div style={{ color:'#2563eb', fontSize:12 }}>
                {lang === 'en' ? 'Submitted. Waiting for engine...' : '已提交，等待引擎响应…'}
              </div>
            )}
          </div>
        </Section>
      )}

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
            <div>叫抢倍数</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{bidMultiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>对局倍数</div>
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
<div style={{ marginTop:18 }}>
        <Section title="">
  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
    <div style={{ fontWeight:700 }}>运行日志</div>
    <button
      onClick={() => { try { const lines=(allLogsRef.current||[]) as string[]; const ts=new Date().toISOString().replace(/[:.]/g,'-'); const text=lines.length?lines.join('\n'):'（暂无）'; const blob=new Blob([text],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`run-log_${ts}.txt`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1200);} catch(e){ console.error('[runlog] save error', e); } }}
      style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}
    >存档</button>
  </div>

<div style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px', maxHeight:420, overflow:'auto', background:'#fafafa' }}>
            {log.length === 0 ? <div style={{ opacity:0.6 }}>（暂无）</div> : log.map((t, idx) => <LogLine key={idx} text={t} />)}
          </div>
        
</Section>
      </div>
    </div>
  );
});

/* ========= 默认值（含“清空”按钮的重置） ========= */
const DEFAULTS = {
  enabled: true,
  bid: true,
  rounds: 10,
  startScore: 100,
  four2: 'both' as Four2Policy,
  farmerCoop: true,
  seatDelayMs: [1000,1000,1000] as number[],
  seats: ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'] as BotChoice[],
  // 让选择提供商时自动写入推荐模型；避免初始就带上 OpenAI 的模型名
  seatModels: ['', '', ''],
  seatKeys: [{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }] as any[],};

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
  const [matchMode, setMatchMode] = useState<'regular'|'knockout'>(() => {
    if (typeof window === 'undefined') return 'regular';
    const v = localStorage.getItem('ddz_match_mode');
    return v === 'knockout' ? 'knockout' : 'regular';
  });
  const humanOptionLabel = lang === 'en' ? 'Human' : '人类选手';
  useEffect(()=>{
    try {
      localStorage.setItem('ddz_lang', lang);
      if (typeof document !== 'undefined') document.documentElement.lang = lang;
    } catch {}
  }, [lang]);
  useEffect(() => {
    try { localStorage.setItem('ddz_match_mode', matchMode); } catch {}
  }, [matchMode]);
  const mainRef = useRef<HTMLDivElement | null>(null);
  useEffect(()=>{ try { if (typeof document !== 'undefined') autoTranslateContainer(mainRef.current, lang); } catch {} }, [lang]);


  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [turnTimeoutSecs, setTurnTimeoutSecs] = useState<number[]>([30,30,30]);

  const [turnTimeoutSec, setTurnTimeoutSec] = useState<number>(30);

  const [bid, setBid] = useState<boolean>(DEFAULTS.bid);
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
    setBid(DEFAULTS.bid); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
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
  const isRegularMode = matchMode === 'regular';
  const regularLabel = lang === 'en' ? 'Regular match' : '常规赛';
  const knockoutLabel = lang === 'en' ? 'Knockout' : '淘汰赛';
  return (<> 
    <LangContext.Provider value={lang}>
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }} ref={mainRef} key={lang}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Fight the Landlord</h1>
      <div style={{ marginLeft:'auto', marginBottom:24, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:12 }} data-i18n-ignore>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span aria-hidden="true" title={lang==='en'?'Language':'语言'} style={{ fontSize:14, opacity:0.75, display:'inline-flex', alignItems:'center' }}>🌐</span>
          <select aria-label={lang==='en'?'Language':'语言'} value={lang} onChange={e=>setLang((e.target.value as Lang))} style={{ padding:'4px 8px', border:'1px solid #e5e7eb', borderRadius:8, background:'#fff' }}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'flex-end' }}>
          <button
            onClick={()=>setMatchMode('regular')}
            aria-pressed={isRegularMode}
            style={{
              padding:'6px 12px',
              borderRadius:8,
              border:'1px solid #d1d5db',
              background: isRegularMode ? '#2563eb' : '#fff',
              color: isRegularMode ? '#fff' : '#1f2937',
              cursor:'pointer',
              fontWeight:600,
            }}
          >{regularLabel}</button>
          <button
            onClick={()=>setMatchMode('knockout')}
            aria-pressed={!isRegularMode}
            style={{
              padding:'6px 12px',
              borderRadius:8,
              border:'1px solid #d1d5db',
              background: !isRegularMode ? '#2563eb' : '#fff',
              color: !isRegularMode ? '#fff' : '#1f2937',
              cursor:'pointer',
              fontWeight:600,
            }}
          >{knockoutLabel}</button>
        </div>
      </div>


      {isRegularMode ? (
        <>
        <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>
          <div style={{
            display:'grid',
            gridTemplateColumns:'repeat(2, minmax(0, 1fr))',
            gap:12,
            gridAutoFlow:'row dense',
            alignItems:'center'
          }}>
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

          <label style={{ display:'flex', alignItems:'center', gap:8 }}>局数
            <input
              type="number"
              min={1}
              step={1}
              value={rounds}
              onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||1)))}
              style={{ flex:'1 1 120px', minWidth:0 }}
            />
          </label>


          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:24, flexWrap:'wrap' }}>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                可抢地主
                <input type="checkbox" checked={bid} onChange={e=>setBid(e.target.checked)} />
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:8 }}>
                农民配合
                <input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} />
              </label>
            </div>
          </div>
          <div style={{ gridColumn:'2 / 3' }}>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>初始分
            <input
              type="number"
              step={10}
              value={startScore}
              onChange={e=>setStartScore(Number(e.target.value)||0)}
              style={{ flex:'1 1 120px', minWidth:0 }} />
            </label>
          </div>
          <div style={{ gridColumn:'1 / 2' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
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
          <label style={{ gridColumn:'2 / 3', display:'flex', alignItems:'center', gap:8 }}>4带2 规则
            <select
              value={four2}
              onChange={e=>setFour2(e.target.value as Four2Policy)}
              style={{ flex:'1 1 160px', minWidth:0 }}>
              <option value="both">都可</option>
              <option value="2singles">两张单牌</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
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
                    <optgroup label={lang === 'en' ? 'Built-in' : '内置'}>
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                      <option value="built-in:mininet">MiniNet</option>
                      <option value="built-in:ally-support">AllySupport</option>
                      <option value="built-in:endgame-rush">EndgameRush</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'AI / External' : 'AI / 外置'}>
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="ai:deepseek">DeepSeek</option>
                      <option value="http">HTTP</option>
                    </optgroup>
                    <optgroup label={lang === 'en' ? 'Human' : '人类选手'}>
                      <option value="human">{humanOptionLabel}</option>
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
            bid={bid}
            four2={four2}
            seats={seats}
            seatModels={seatModels}
            seatKeys={seatKeys}
            farmerCoop={farmerCoop}
            onLog={setLiveLog}

            turnTimeoutSecs={turnTimeoutSecs}
          />
        </div>
        </>
      ) : (
        <KnockoutPanel />
      )}
    </div>
    </LangContext.Provider>
  </>);
}

export default Home;

/* ================ 实时曲线：每手牌得分（按地主淡色分局） ================= */
function ScoreTimeline(
  { series, bands = [], landlords = [], labels = ['甲','乙','丙'], height = 220, breaks = [] }:
  { series:(number|null)[][]; bands?:number[]; landlords?:number[]; labels?:string[]; height?:number; breaks?:number[] }
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
  const colorBand = ['rgba(239,68,68,0.16)','rgba(59,130,246,0.16)','rgba(16,185,129,0.20)'];
  const colorBandFallback = ['#fef2f2', '#eff6ff', '#f0fdf4'];
  const colors = colorLine;

  const parseBandValue = (v: any): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const parsed = Number(v.trim());
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  };

  const rawCuts = Array.isArray(bands) ? bands : [];
  const sanitizedCuts = rawCuts
    .map(parseBandValue)
    .filter(v => Number.isFinite(v))
    .map(v => {
      const rounded = Math.round(v);
      return Math.max(0, Math.min(n, rounded));
    });
  const cuts = Array.from(new Set(sanitizedCuts));
  cuts.sort((a,b)=>a-b);
  if (cuts.length === 0 || cuts[0] !== 0) cuts.unshift(0);
  if (cuts[cuts.length-1] !== n) cuts.push(n);
  const cutSet = new Set(cuts);

  const explicitBreaks = Array.isArray(breaks)
    ? breaks
        .filter((v) => typeof v === 'number' && Number.isFinite(v))
        .map((v) => Math.max(0, Math.floor(v)))
        .sort((a, b) => a - b)
    : [];
  const breakSet = new Set(explicitBreaks);
  {
    let lastSeatWithValue = -1;
    for (let idx = 0; idx < n; idx++) {
      let seat = -1;
      for (let si = 0; si < data.length; si++) {
        const val = data[si]?.[idx];
        if (typeof val === 'number' && Number.isFinite(val)) { seat = si; break; }
      }
      if (seat < 0) continue;
      if (idx !== 0 && seat === lastSeatWithValue && !cutSet.has(idx) && !breakSet.has(idx)) {
        breakSet.add(idx);
      }
      lastSeatWithValue = seat;
    }
  }

  const landlordsArr = Array.isArray(landlords)
    ? landlords.map(v => {
        const parsed = parseBandValue(v);
        return parsed === 0 || parsed === 1 || parsed === 2 ? parsed : -1;
      })
    : [];
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
    for (let i=0;i<n;i++){
      if ((cutSet.has(i) || breakSet.has(i)) && i!==0) { open = false; }
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
            const fill = (lord===0||lord===1||lord===2)
              ? colorBand[lord]
              : colorBandFallback[i % colorBandFallback.length];
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
  const vals = [scores.coop, scores.agg, scores.cons, scores.eff, scores.bid];
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
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', gap:8 }}>
      <div style={{ width:'100%', display:'flex', justifyContent:'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow:'visible' }}>
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
      </div>
      <div style={{ fontSize:12, color:'#374151' }}>{title}</div>
    </div>
  );
}