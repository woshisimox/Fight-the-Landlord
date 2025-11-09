// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  runOneGame,
  GreedyMax,
  GreedyMin,
  RandomLegal,
  AllySupport,
  EndgameRush,
  AdvancedHybrid,
  generateMoves,
  classify,
  singleDangerPenalty,
} from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';
// 如果你的仓库没有 DeepseekBot，可以删除本行和 asBot 里的分支
import { DeepseekBot } from '../../lib/bots/deepseek_bot';
import {
  registerHumanRequest,
  fulfillHumanRequest,
  releaseHumanRequest,
  resetSession as resetHumanSession,
} from '../../lib/humanStore';
import type { BotMove, Combo, Four2Policy } from '../../lib/doudizhu/engine';

// ---- stable hash for ruleId ----
function stableHash(s: string): string { let h=5381; for (let i=0;i<s.length;i++){ h=((h<<5)+h) ^ s.charCodeAt(i); } return 'h'+((h>>>0).toString(16).padStart(8,'0')); }



/* ========== 已出牌缓存（仅当前请求作用域） ========== */
declare global {
  var __DDZ_SEEN: string[] | undefined;
  var __DDZ_SEEN_BY_SEAT: string[][] | undefined;



}
(globalThis as any).__DDZ_SEEN ??= [];
(globalThis as any).__DDZ_SEEN_BY_SEAT ??= [[],[],[]];
/* ========== 统一打分（与内置算法口径一致） ========== */
const __SEQ = ['3','4','5','6','7','8','9','T','J','Q','K','A'];
const __POS: Record<string, number> = Object.fromEntries(__SEQ.map((r,i)=>[r,i])) as any;
const __ORDER = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
const __POSALL: Record<string, number> = Object.fromEntries(__ORDER.map((r,i)=>[r,i])) as any;
const __rank = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
const __count = (cs:string[])=>{ const m=new Map<string,number>(); for(const c of cs){const r=__rank(c); m.set(r,(m.get(r)||0)+1);} return m; };
const __remove=(h:string[],p:string[])=>{const a=h.slice(); for(const c of p){const i=a.indexOf(c); if(i>=0) a.splice(i,1);} return a; };
const __isStraight = (cnt:Map<string,number>)=>{
  const rs = Array.from(cnt.entries()).filter(([r,n])=>n===1 && r!=='2' && r!=='x' && r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  if (rs.length<5) return false;
  for (let i=1;i<rs.length;i++){ if ((__POS[rs[i]]??-1)!==(__POS[rs[i-1]]??-2)+1) return false; }
  return true;
};
const __isPairSeq = (cnt:Map<string,number>)=>{
  const rs = Array.from(cnt.entries()).filter(([r,n])=>n===2 && r!=='2' && r!=='x' && r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  if (rs.length<3) return false;
  for (let i=1;i<rs.length;i++){ if ((__POS[rs[i]]??-1)!==(__POS[rs[i-1]]??-2)+1) return false; }
  return true;
};
const __isPlane = (cnt:Map<string,number>)=>{
  const rs = Array.from(cnt.entries()).filter(([r,n])=>n===3 && r!=='2' && r!=='x' && r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  if (rs.length<2) return false;
  for (let i=1;i<rs.length;i++){ if ((__POS[rs[i]]??-1)!==(__POS[rs[i-1]]??-2)+1) return false; }
  return true;
};
const __keyRank = (mv:string[])=>{
  const cnt = __count(mv);
  if ((cnt.get('x')||0)>=1 && (cnt.get('X')||0)>=1 && mv.length===2) return 'X';
  for (const [r,n] of cnt.entries()) if (n===4) return r;
  let best:string|null=null, bp=-1;
  for (const [r,n] of cnt.entries()) if (n>=3 && (__POS[r]??-1)>bp){ best=r; bp=__POS[r]??-1; }
  if (best) return best;
  for (const [r,n] of cnt.entries()) if (n>=2 && (__POS[r]??-1)>bp){ best=r; bp=__POS[r]??-1; }
  if (best) return best;
  if (__isStraight(cnt) || __isPairSeq(cnt) || __isPlane(cnt)) {
    for (const r of Array.from(cnt.keys())) {
      if (r!=='2' && r!=='x' && r!=='X' && (__POS[r]??-1)>bp) { best=r; bp=__POS[r]??-1; }
    }
    if (best) return best;
  }
  for (const r of Array.from(cnt.keys())) {
    const p = __POSALL[r]??-1;
    if (p>bp){ best=r; bp=p; }
  }
  return best || '3';
};

const HUMAN_TIMEOUT_GRACE_MS = 600;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
const __longestSingleChain=(cs:string[])=>{
  const cnt=__count(cs);
  const rs=Array.from(cnt.keys()).filter(r=>r!=='2'&&r!=='x'&&r!=='X').sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  let best=0,i=0; while(i<rs.length){ let j=i; while(j+1<rs.length && (__POS[rs[j+1]]??-1)===(__POS[rs[j]]??-2)+1) j++; best=Math.max(best,j-i+1); i=j+1; } return best;
};
const __longestPairChain=(cs:string[])=>{
  const cnt=__count(cs);
  const rs=Array.from(cnt.entries()).filter(([r,n])=>n>=2&&r!=='2'&&r!=='x'&&r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  let best=0,i=0; while(i<rs.length){ let j=i; while(j+1<rs.length && (__POS[rs[j+1]]??-1)===(__POS[rs[j]]??-2)+1) j++; best=Math.max(best,j-i+1); i=j+1; } return best;
};

const __TYPE_PRIORITY: Record<string, number> = {
  single: 0,
  pair: 1,
  triple: 2,
  triple_one: 3,
  triple_pair: 4,
  straight: 5,
  pair_seq: 6,
  plane: 7,
  plane_single: 8,
  plane_pair: 9,
  four_two_singles: 10,
  four_two_pairs: 11,
  bomb: 12,
  rocket: 13,
};

function __cardValue(label: string): number {
  const rk = __rank(label);
  return __POSALL[rk] ?? -1;
}

function __lowestSingle(hand: string[]): string | undefined {
  if (!Array.isArray(hand) || hand.length === 0) return undefined;
  const sorted = hand.slice().sort((a, b) => {
    const va = __cardValue(a);
    const vb = __cardValue(b);
    if (va !== vb) return va - vb;
    return a.localeCompare(b);
  });
  return sorted[0];
}

function buildAutoTimeoutMove(ctx: any): BotMove {
  const policy = ((ctx?.policy?.four2) ?? 'both') as Four2Policy;
  const hand: string[] = Array.isArray(ctx?.hands) ? ctx.hands.slice() : [];
  const require = (ctx?.require ?? null) as Combo | null;
  const canPass = ctx?.canPass !== false;

  if (!hand.length) {
    return { move: 'pass', reason: 'auto:timeout-empty' };
  }

  if (require) {
    const legal = generateMoves(hand, require, policy);
    if (!legal.length) {
      if (canPass) return { move: 'pass', reason: 'auto:timeout-pass' };
      const fallback = __lowestSingle(hand);
      return fallback ? { move: 'play', cards: [fallback], reason: 'auto:timeout-force' } : { move: 'pass', reason: 'auto:timeout-empty' };
    }

    const scored = legal.map((cards) => {
      const info = classify(cards, policy) || undefined;
      let score = 0;
      if (!info) {
        score = 10_000;
      } else {
        if (require.type && info.type !== require.type) {
          score += 500;
        }
        if (typeof require.len === 'number') {
          const targetLen = require.len;
          const actualLen = typeof info.len === 'number' ? info.len : targetLen;
          if (info.type === require.type) {
            score += Math.abs(actualLen - targetLen) * 40;
          } else {
            score += 200;
          }
        }
        if (info.type === 'bomb' || info.type === 'rocket') {
          score += 1000;
        }
        score += info.rank;
        score += cards.length * 0.01;
        score -= singleDangerPenalty(ctx as any, cards, policy);
      }
      return { cards, info, score };
    });

    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const at = a.info?.type ?? '';
      const bt = b.info?.type ?? '';
      if (at !== bt) return (__TYPE_PRIORITY[at] ?? 99) - (__TYPE_PRIORITY[bt] ?? 99);
      const ar = a.info?.rank ?? 999;
      const br = b.info?.rank ?? 999;
      if (ar !== br) return ar - br;
      return a.cards.join('').localeCompare(b.cards.join(''));
    });

    const pick = scored[0]?.cards;
    if (pick && pick.length) {
      return { move: 'play', cards: pick, reason: 'auto:timeout-play' };
    }
  } else {
    const lowest = __lowestSingle(hand);
    if (lowest) {
      return { move: 'play', cards: [lowest], reason: 'auto:timeout-lead' };
    }
  }

  if (canPass) return { move: 'pass', reason: 'auto:timeout-pass' };
  const fallback = __lowestSingle(hand);
  return fallback ? { move: 'play', cards: [fallback], reason: 'auto:timeout-force' } : { move: 'pass', reason: 'auto:timeout-empty' };
}
function unifiedScore(ctx:any, mv:string[]): number {
  if (!Array.isArray(mv) || mv.length===0) return -999;
  const BASE:Record<string,number> = Object.fromEntries(__ORDER.map(r=>[r,(r==='x'||r==='X')?1:4])) as any;
  const seenAll:string[] = (globalThis as any).__DDZ_SEEN ?? [];
  const unseen = new Map<string,number>(Object.entries(BASE) as any);
  const sub=(arr:string[])=>{ for(const c of arr){ const r=__rank(c); unseen.set(r, Math.max(0,(unseen.get(r)||0)-1)); } };
  sub(ctx.hands||[]); sub(seenAll);
  const cnt = __count(mv);
  const isRocket = (cnt.get('x')||0)>=1 && (cnt.get('X')||0)>=1 && mv.length===2;
  const isBomb = Array.from(cnt.values()).some(n=>n===4);
  const kmax = Math.max( ...Array.from(cnt.values()) );
  const keyR = __keyRank(mv);
  const kp = __POSALL[keyR] ?? -1;
  let risk = 1;
  if (isRocket) risk = 0;
  else if (isBomb) {
    const rx = (unseen.get('x')||0)>0 && (unseen.get('X')||0)>0 ? 1 : 0;
    let hb=0; for (const r of __ORDER){ const p=__POSALL[r]??-1; if (p>kp && (unseen.get(r)||0)===4) hb++; }
    risk = hb*1.5 + (rx?2:0);
  } else if (__isPairSeq(cnt) || __isStraight(cnt) || __isPlane(cnt)) {
    let hm=0; for (const r of __SEQ){ const p=__POSALL[r]??-1; if (p>kp) hm += (unseen.get(r)||0); }
    risk = hm*0.1 + 0.6;
  } else if (kmax>=3) {
    let ht=0; for (const r of __ORDER){ const p=__POSALL[r]??-1; if (p>kp && (unseen.get(r)||0)>=3) ht++; }
    risk = ht + 0.5;
  } else if (kmax===2) {
    let hp=0; for (const r of __ORDER){ const p=__POSALL[r]??-1; if (p>kp && (unseen.get(r)||0)>=2) hp++; }
    const rx = (unseen.get('x')||0)>0 && (unseen.get('X')||0)>0 ? 0.5 : 0;
    risk = hp + rx;
  } else {
    let h=0; for (const r of __ORDER){ if ((__POSALL[r]??-1)>kp) h += (unseen.get(r)||0); }
    const rx = (unseen.get('x')||0)>0 && (unseen.get('X')||0)>0 ? 0.5 : 0;
    risk = h*0.2 + rx;
  }
  const afterSeats=[(ctx.seat+1)%3,(ctx.seat+2)%3];
  const isOpp=(s:number)=> (ctx.seat===ctx.landlord) ? true : (s===ctx.landlord);
  const numOppAfter=afterSeats.filter(isOpp).length;
  const numAllyAfter=afterSeats.length - numOppAfter;
  const seatRiskFactor=(numOppAfter + 0.25*numAllyAfter)/2;
  const before=ctx.hands||[];
  const after=__remove(before, mv);
  const pre=__count(before), post=__count(after);
  let singles=0,lowSingles=0,pairs=0,triples=0,bombs=0,jokers=0;
  for (const [r,n] of post.entries()) {
    if (n===1){ singles++; if(r!=='2'&&r!=='x'&&r!=='X') lowSingles++; }
    else if (n===2) pairs++;
    else if (n===3) triples++;
    else if (n===4) bombs++;
    if (r==='x'||r==='X') jokers+=n;
  }
  let breakPenalty=0; const used=__count(mv);
  for (const [r,k] of used.entries()) {
    const preN=pre.get(r)||0;
    if (preN>=2 && k<preN) breakPenalty += (preN===2?1.0:preN===3?0.8:1.2);
  }
  const chain=__longestSingleChain(after), pairSeq=__longestPairChain(after);
  const bombPenalty = isBomb || isRocket ? 1.2 : 0;
  const outReward = mv.length * 0.4;
  const shape = outReward - singles*1.0 - lowSingles*0.3 + pairs*0.4 + triples*0.5 + bombs*0.6 + jokers*0.2 + chain*0.25 + pairSeq*0.25 - breakPenalty - bombPenalty;
  const four2Policy = ((ctx?.policy?.four2) === '2singles' || (ctx?.policy?.four2) === '2pairs' || (ctx?.policy?.four2) === 'both')
    ? (ctx.policy.four2 as Four2Policy)
    : 'both';
  const guard = singleDangerPenalty(ctx as any, mv, four2Policy);
  const score = shape + (-risk * seatRiskFactor) * 0.35 - guard;
  return score;
}
/* ========== 小工具 ========== */
const clamp = (v:number, lo=0, hi=5)=> Math.max(lo, Math.min(hi, v));
const SECRET_KEYS = new Set([
  'apikey', 'api_key', 'api-key',
  'token', 'httptoken', 'http_token', 'http-token',
  'secret', 'password',
  'authorization', 'authorizationbearer',
  'x-api-key', 'x_api_key', 'xapikey',
]);

const isPlainObject = (value: any): value is Record<string, any> => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const redactSecrets = (input: any): any => {
  if (Array.isArray(input)) {
    return input.map(item => redactSecrets(item));
  }
  if (!isPlainObject(input)) return input;
  const clone: Record<string, any> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SECRET_KEYS.has(key)) continue;
    clone[rawKey] = redactSecrets(value);
  }
  return clone;
};

const writeLine = (res: NextApiResponse, obj: any) => {
  const payload = (obj && typeof obj === 'object') ? redactSecrets(obj) : obj;
  (res as any).write(JSON.stringify(payload) + '\n');
};

function stringifyMove(m:any){
  if (!m || m.move==='pass') return 'pass';
  const type = m.type ? `${m.type} ` : '';
  const cards = Array.isArray(m.cards) ? m.cards.join('') : String(m.cards||'');
  return `${type}${cards}`;
}

/** 解析每座位思考超时（毫秒） */
function parseTurnTimeoutMsArr(req: NextApiRequest): [number,number,number] {
  const fromQuery = (k:string) => {
    const v = (req.query as any)?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const body:any = (req as any).body || {};
  const secs = body.turnTimeoutSecs ?? body.turnTimeoutSec ?? body.__tt ?? body.tt;
  const clampMs = (x:number)=> Math.max(1000, Math.floor(Number(x||0)*1000));

  if (Array.isArray(secs) && secs.length) {
    const a = clampMs(secs[0] ?? 30);
    const b = clampMs(secs[1] ?? secs[0] ?? 30);
    const c = clampMs(secs[2] ?? secs[1] ?? secs[0] ?? 30);
    return [a,b,c];
  }
  if (typeof secs === 'number') {
    const ms = clampMs(secs);
    return [ms,ms,ms];
  }
  const raw = fromQuery('__tt') ?? fromQuery('tt') ?? fromQuery('turnTimeoutSec') ?? fromQuery('turnTimeoutSecs');
  if (typeof raw === 'string' && raw.trim()) {
    const parts = raw.split(/[\s,\/]+/).filter(Boolean).map(x=>clampMs(Number(x)));
    const a = parts[0] ?? 30000;
    const b = parts[1] ?? a;
    const c = parts[2] ?? b;
    return [a,b,c];
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = clampMs(raw as any);
    return [ms,ms,ms];
  }
  return [30000,30000,30000];
}

/* ========== 类型 ========== */
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'built-in:advanced-hybrid'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http'
  | 'human';

type SeatSpec = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  token?: string;
};

type RunBody = {
  rounds: number;
  four2?: 'both'|'2singles'|'2pairs';
  seats: SeatSpec[];
  seatDelayMs?: number[];
  farmerCoop?: boolean;
  startScore?: number;
  turnTimeoutSecs?: number[];  // [s0,s1,s2]
  turnTimeoutSec?: number | number[];
  clientTraceId?: string;
  rob?: boolean;
  debug?: any;
};

/* ========== Bot 工厂 ========== */
function providerLabel(choice: BotChoice) {
  switch (choice) {
    case 'built-in:greedy-max': return 'GreedyMax';
    case 'built-in:greedy-min': return 'GreedyMin';
    case 'built-in:random-legal': return 'RandomLegal';
    case 'built-in:ally-support': return 'AllySupport';
    case 'built-in:endgame-rush': return 'EndgameRush';
    case 'built-in:advanced-hybrid': return 'AdvancedHybrid';
    case 'human': return 'Human';
    case 'ai:openai': return 'OpenAI';
    case 'ai:gemini': return 'Gemini';
    case 'ai:grok': return 'Grok';
    case 'ai:kimi': return 'Kimi';
    case 'ai:qwen': return 'Qwen';
    case 'ai:deepseek': return 'DeepSeek';
    case 'http': return 'HTTP';
  }
}

function asBot(choice: BotChoice, spec?: SeatSpec) {
  switch (choice) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'built-in:ally-support': return AllySupport;
    case 'built-in:endgame-rush': return EndgameRush;
    case 'built-in:advanced-hybrid': return AdvancedHybrid;
    case 'human': {
      const stub = async () => ({ move: 'pass', reason: 'human-stub' });
      (stub as any).phaseAware = true;
      (stub as any).choice = 'human';
      return stub;
    }
    case 'ai:openai':  return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini':  return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-pro' });
    case 'ai:grok':    return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':    return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':    return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'ai:deepseek':return DeepseekBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'deepseek-chat' });
    case 'http':       return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:           return GreedyMax;
  }
}

/* ========== Trace 包装（记录 reason + 限时 + 调用事件） ========== */
function traceWrap(
  choice: BotChoice,
  spec: SeatSpec|undefined,
  bot: (ctx:any)=>any,
  res: NextApiResponse,
  onReason: (seat:number, reason?:string)=>void,
  onScore: (seat:number, sc?:number)=>void,
  turnTimeoutMs: number,
  startDelayMs: number,
  seatIndex: number,
  sessionId?: string,
){
  const isHuman = choice === 'human';
  const label = providerLabel(choice);
  const supportsPhase = typeof choice === 'string'
    ? (choice.startsWith('ai:') || choice === 'http' || isHuman)
    : false;
  const sessionKey = (sessionId && sessionId.trim()) ? sessionId.trim() : '__human__';

  const sanitizedTimeoutMs = (() => {
    const raw = Number.isFinite(turnTimeoutMs) ? Math.floor(turnTimeoutMs) : 30_000;
    const lowerBounded = Math.max(1_000, raw);
    const upperBounded = Math.min(120_000, lowerBounded); // allow slower external bots while keeping a hard ceiling (120s)
    return upperBounded;
  })();
  const sanitizeCtx = (ctx:any) => {
    try { return JSON.parse(JSON.stringify(ctx)); } catch { return ctx; }
  };

  const buildHumanHint = async (ctx: any) => {
    const handCards: string[] = Array.isArray(ctx?.hands) ? ctx.hands.slice() : [];
    const hasAllCards = (need: string[], have: string[]) => {
      if (!need.length) return true;
      if (!have.length) return false;
      const pool = new Map<string, number>();
      for (const card of have) {
        pool.set(card, (pool.get(card) || 0) + 1);
      }
      for (const card of need) {
        const remain = pool.get(card) || 0;
        if (remain <= 0) return false;
        pool.set(card, remain - 1);
      }
      return true;
    };
    try {
      const rec = await Promise.resolve(GreedyMax(ctx));
      if (rec && typeof rec === 'object') {
        if (rec.move === 'play' && Array.isArray(rec.cards) && rec.cards.length > 0) {
          if (!hasAllCards(rec.cards, handCards)) {
            console.debug('[HINT]', 'discarding hint without matching cards', rec.cards);
            return null;
          }
          const sc = unifiedScore(ctx, rec.cards);
          return {
            move: 'play' as const,
            cards: rec.cards.slice(),
            score: Number.isFinite(sc) ? Number(sc) : undefined,
            reason: typeof rec.reason === 'string' ? rec.reason : undefined,
            label: stringifyMove(rec),
            by: 'GreedyMax',
          };
        }
        if (rec.move === 'pass') {
          return {
            move: 'pass' as const,
            reason: typeof rec.reason === 'string' ? rec.reason : undefined,
            by: 'GreedyMax',
          };
        }
      }
    } catch (err) {
      console.debug('[HINT]', 'failed to build human hint', err);
    }
    return null;
  };

  const makeTimeout = (
    timeoutOrOnTimeout?: number | (() => void),
    onTimeoutOrFallback?: (() => void) | (() => BotMove | Promise<BotMove>),
    maybeFallback?: () => BotMove | Promise<BotMove>,
  ) => {
    let timeoutMs = sanitizedTimeoutMs;
    let onTimeout: (() => void) | undefined;
    let fallback: (() => BotMove | Promise<BotMove>) | undefined;

    if (typeof timeoutOrOnTimeout === 'number' && Number.isFinite(timeoutOrOnTimeout)) {
      timeoutMs = Math.max(0, Math.floor(timeoutOrOnTimeout));
      if (typeof maybeFallback === 'function') {
        if (typeof onTimeoutOrFallback === 'function') {
          onTimeout = onTimeoutOrFallback as () => void;
        }
        fallback = maybeFallback;
      } else if (typeof onTimeoutOrFallback === 'function') {
        fallback = onTimeoutOrFallback as () => BotMove | Promise<BotMove>;
      }
    } else {
      if (typeof timeoutOrOnTimeout === 'function') {
        onTimeout = timeoutOrOnTimeout as () => void;
      }
      if (typeof onTimeoutOrFallback === 'function') {
        fallback = onTimeoutOrFallback as () => BotMove | Promise<BotMove>;
      }
    }

    const timeoutSecondsLabel = Math.max(1, Math.round(timeoutMs / 1000));

    return new Promise<BotMove>((resolve) => {
      setTimeout(() => {
        const defaultPayload: BotMove = { move: 'pass', reason: `timeout@${timeoutSecondsLabel}s` };
        try { onTimeout?.(); } catch {}
        if (typeof fallback !== 'function') {
          resolve(defaultPayload);
          return;
        }
        try {
          const alt = fallback();
          if (alt && typeof (alt as any).then === 'function') {
            (alt as Promise<BotMove>)
              .then((value) => {
                if (value) resolve(value);
                else resolve(defaultPayload);
              })
              .catch((err: any) => {
                resolve({ move: 'pass', reason: `timeout-error:${err?.message || String(err)}` });
              });
            return;
          }
          if (alt) {
            resolve(alt as BotMove);
          } else {
            resolve(defaultPayload);
          }
        } catch (err: any) {
          resolve({ move: 'pass', reason: `timeout-error:${err?.message || String(err)}` });
        }
      }, timeoutMs);
    });
  };

  const wrapped = async (ctx:any) => {
    if (startDelayMs && startDelayMs>0) {
      await new Promise(r => setTimeout(r, Math.min(60_000, startDelayMs)));
    }
    const phase = ctx?.phase || 'play';
    const effectiveTimeoutMs = (isHuman && (phase === 'bid' || phase === 'double'))
      ? Math.max(sanitizedTimeoutMs, 30_000)
      : sanitizedTimeoutMs;
    const callIssuedAt = Date.now();
    const callExpiresAt = callIssuedAt + effectiveTimeoutMs;
    try {
      writeLine(res, {
        type:'event',
        kind:'bot-call',
        seat: seatIndex,
        by: label,
        model: spec?.model||'',
        phase,
        timeoutMs: effectiveTimeoutMs,
        issuedAt: callIssuedAt,
        expiresAt: callExpiresAt,
      });
    } catch{}

    let result:any;
    const t0 = Date.now();
    try {
      const ctxWithSeen = { ...ctx, seen: (globalThis as any).__DDZ_SEEN ?? [], seenBySeat: (globalThis as any).__DDZ_SEEN_BY_SEAT ?? [[],[],[]] };
      try { console.debug('[CTX]', `seat=${ctxWithSeen.seat}`, `landlord=${ctxWithSeen.landlord}`, `leader=${ctxWithSeen.leader}`, `trick=${ctxWithSeen.trick}`, `seen=${ctxWithSeen.seen?.length||0}`, `seatSeen=${(ctxWithSeen.seenBySeat||[]).map((a:any)=>Array.isArray(a)?a.length:0).join('/')}`); } catch {}

      if (isHuman) {
        const requestId = `${sessionKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`;
        const hintPayload = phase === 'play' ? await buildHumanHint(ctxWithSeen) : null;
        let legalCount: number | undefined;
        try {
          if (Array.isArray(ctxWithSeen?.hands) && ctxWithSeen?.require) {
            const four2Policy = (ctxWithSeen?.policy?.four2 || 'both') as any;
            const moves = generateMoves(ctxWithSeen.hands.slice(), ctxWithSeen.require, four2Policy);
            legalCount = moves.length;
          } else if (Array.isArray(ctxWithSeen?.hands) && ctxWithSeen?.require === null && ctxWithSeen?.canPass === false) {
            // 首家必须出牌，保持 legalCount 未定义以避免误导前端。
            legalCount = undefined;
          }
        } catch (err) {
          console.debug('[HUMAN]', 'failed to tally legal moves', err);
        }
        const payloadCtx = sanitizeCtx(ctxWithSeen);
        if (payloadCtx && typeof legalCount === 'number' && Number.isFinite(legalCount)) {
          try {
            (payloadCtx as any).legalCount = legalCount;
            if ((payloadCtx as any).require && legalCount <= 0 && (payloadCtx as any).canPass !== false) {
              (payloadCtx as any).mustPass = true;
            }
          } catch {}
        }
        const humanPromise = new Promise((resolve, reject) => {
          registerHumanRequest(
            sessionKey,
            requestId,
            seatIndex,
            (value) => resolve(value),
            (err) => reject(err),
          );
        });
        const issuedAt = Date.now();
        const expiresAt = issuedAt + effectiveTimeoutMs;
        try {
          writeLine(res, {
            type: 'human-request',
            seat: seatIndex,
            by: label,
            requestId,
            phase,
            ctx: payloadCtx,
            timeoutMs: effectiveTimeoutMs,
            delayMs: startDelayMs,
            sessionId: sessionKey,
            hint: hintPayload || undefined,
            issuedAt,
            expiresAt,
          });
        } catch {}
        let timedOut = false;
        const timeout = makeTimeout(
          effectiveTimeoutMs,
          () => {
            timedOut = true;
          },
          () => buildAutoTimeoutMove(ctxWithSeen),
        );
        try {
          const humanOutcome = humanPromise
            .then((value) => ({ source: 'human' as const, value }))
            .catch((error) => {
              const code = typeof (error as any)?.code === 'string' ? (error as any).code : '';
              const message = typeof (error as any)?.message === 'string' ? (error as any).message : '';
              if (code === 'timeout' || message === 'timeout' || message === 'error:timeout') {
                return { source: 'human-timeout' as const, error };
              }
              return { source: 'human-error' as const, error };
            });
          const timeoutOutcome = timeout.then((value) => ({ source: 'timeout' as const, value }));
          let outcome = await Promise.race([humanOutcome, timeoutOutcome]);
          if (outcome.source === 'human-timeout') {
            timedOut = true;
            outcome = await timeoutOutcome;
          }
          if (outcome.source === 'human') {
            result = outcome.value;
          } else if (outcome.source === 'human-error') {
            throw outcome.error;
          } else {
            if (timedOut && HUMAN_TIMEOUT_GRACE_MS > 0) {
              const graceOutcome = await Promise.race([
                humanOutcome,
                sleep(HUMAN_TIMEOUT_GRACE_MS).then(() => ({ source: 'grace' as const })),
              ]);
              if (graceOutcome.source === 'human') {
                timedOut = false;
                result = graceOutcome.value;
              } else if (graceOutcome.source === 'human-error') {
                throw graceOutcome.error;
              } else {
                result = outcome.value;
              }
            } else {
              result = outcome.value;
            }
            if (timedOut) {
              releaseHumanRequest(sessionKey, requestId);
            }
          }
        } catch (err:any) {
          if (timedOut) {
            try {
              const autoMove = await Promise.resolve(buildAutoTimeoutMove(ctxWithSeen));
              result = autoMove || { move: 'pass', reason: 'auto:timeout-pass' };
            } catch (autoErr: any) {
              result = { move: 'pass', reason: `timeout-error:${autoErr?.message || String(autoErr)}` };
            }
          } else {
            result = { move:'pass', reason:`error:${err?.message||String(err)}` };
          }
        }
      } else {
        const timeout = makeTimeout(effectiveTimeoutMs);
        result = await Promise.race([ Promise.resolve(bot(ctxWithSeen)), timeout ]);
      }
    } catch (e:any) {
      result = { move:'pass', reason:`error:${e?.message||String(e)}` };
    }

    const resPhase = (result && typeof result.phase === 'string') ? result.phase : phase;
    const unified = (resPhase === 'play' && result?.move==='play' && Array.isArray(result?.cards))
      ? unifiedScore(ctx, result.cards)
      : undefined;
    const scoreTag = (typeof unified === 'number') ? ` | score=${unified.toFixed(2)}` : '';

    let reasonText = '';
    if (typeof result?.reason === 'string' && result.reason) {
      reasonText = `[${label}] ${result.reason}${scoreTag}`;
    } else if (resPhase === 'bid') {
      const decision = typeof result?.bid === 'boolean' ? !!result.bid : (result?.move === 'pass' ? false : true);
      reasonText = `[${label}] bid=${decision ? '抢' : '不抢'}${scoreTag}`;
    } else if (resPhase === 'double') {
      const decision = typeof result?.double === 'boolean' ? !!result.double : (result?.move === 'pass' ? false : true);
      reasonText = `[${label}] double=${decision ? '加倍' : '不加倍'}${scoreTag}`;
    } else {
      reasonText = `[${label}] ${(result?.move==='play' ? stringifyMove(result) : 'pass')}${scoreTag}`;
    }

    try {
      const cstr = Array.isArray(result?.cards)?result.cards.join(''):'';
      const extra = resPhase === 'bid' ? ` bid=${result?.bid}` : resPhase === 'double' ? ` double=${result?.double}` : '';
      console.debug('[DECISION]', `seat=${seatIndex}`, `move=${result?.move}`, `cards=${cstr}`, (typeof unified==='number'?`score=${unified.toFixed(2)}`:'') , `phase=${resPhase}${extra}`, `reason=${reasonText}`);
    } catch {}
    onReason(seatIndex, reasonText);
    if (resPhase === 'play') {
      try { onScore(seatIndex, unified as any); } catch {}
    }
    try {
      const payload: any = { type:'event', kind:'bot-done', seat: seatIndex, by: label, model: spec?.model||'', tookMs: Date.now()-t0, reason: reasonText, score: unified, phase: resPhase };
      try {
        const rawUsage = result && typeof result === 'object' ? (result as any).usage : undefined;
        if (rawUsage && typeof rawUsage === 'object') {
          const total = Number((rawUsage as any).totalTokens ?? (rawUsage as any).total_tokens ?? NaN);
          const prompt = Number((rawUsage as any).promptTokens ?? (rawUsage as any).prompt_tokens ?? NaN);
          const completion = Number((rawUsage as any).completionTokens ?? (rawUsage as any).completion_tokens ?? NaN);
          const normalized: any = {};
          if (Number.isFinite(total) && total > 0) normalized.totalTokens = total;
          if (Number.isFinite(prompt) && prompt >= 0) normalized.promptTokens = prompt;
          if (Number.isFinite(completion) && completion >= 0) normalized.completionTokens = completion;
          if (Object.keys(normalized).length) payload.usage = normalized;
        }
      } catch {}
      if (resPhase === 'bid') payload.bid = typeof result?.bid === 'boolean' ? !!result.bid : (result?.move === 'pass' ? false : true);
      if (resPhase === 'double') payload.double = typeof result?.double === 'boolean' ? !!result.double : (result?.move === 'pass' ? false : true);
      writeLine(res, payload);
    } catch {}

    return result;
  };

  try {
    (wrapped as any).choice = choice;
    (wrapped as any).phaseAware = supportsPhase;
  } catch {}

  return wrapped;
}

/* ========== 单局执行（NDJSON 输出 + 画像统计） ========== */
async function runOneRoundWithGuard(
  { seats, four2, rule, ruleId, lastReason, lastScore }:
  { seats: ((ctx:any)=>Promise<any>)[]; four2: 'both'|'2singles'|'2pairs'; rule: any; ruleId: string; lastReason: (string|null)[]; lastScore: (number|null)[] },
  res: NextApiResponse,
  round: number
){
  const iter = runOneGame({ seats, four2, rule, ruleId } as any);
  let sentInit = false;
  let resultSent = false;

  // 画像统计
  let landlordIdx: number = -1;
  const stats = [0,1,2].map(()=>({
    plays: 0,
    passes: 0,
    cardsPlayed: 0,
    bombs: 0,
    rockets: 0
  }));

  const countPlay = (seat:number, move:'play'|'pass', cards?:string[])=>{
    const cc: string[] = Array.isArray(cards) ? cards : [];
    if (move === 'play') {
      try {
        const seenA: string[] = (globalThis as any).__DDZ_SEEN ?? ((globalThis as any).__DDZ_SEEN = []);
        const bySeat: string[][] = (globalThis as any).__DDZ_SEEN_BY_SEAT ?? ((globalThis as any).__DDZ_SEEN_BY_SEAT = [[],[],[]]);
        seenA.push(...cc);
        if (bySeat[seat]) bySeat[seat].push(...cc);
      } catch {}

      stats[seat].plays++;
      stats[seat].cardsPlayed += cc.length;
      const isRocket = cc.length === 2 && cc.includes('x') && cc.includes('X');
      const isBomb   = !isRocket && cc.length === 4 && (new Set(cc)).size === 1;
      if (isBomb)   stats[seat].bombs++;
      if (isRocket) stats[seat].rockets++;
    } else {
      stats[seat].passes++;
    }
  };

for await (const ev of (iter as any)) {
    // 初始发牌/地主
    if (!sentInit && ev?.type==='init') {
      sentInit = true;
      const rawLandlord = (typeof ev.landlordIdx === 'number')
        ? ev.landlordIdx
        : (typeof ev.landlord === 'number' ? ev.landlord : null);
      landlordIdx = (typeof rawLandlord === 'number' && rawLandlord >= 0) ? rawLandlord : -1;
      // 修复：添加 landlord 字段确保前端能正确识别地主
      writeLine(res, {
        type:'init',
        landlordIdx: rawLandlord,
        landlord: rawLandlord,
        bottom: ev.bottom,
        hands: ev.hands
      });
      (globalThis as any).__DDZ_SEEN.length = 0;
      (globalThis as any).__DDZ_SEEN_BY_SEAT = [[],[],[]];
      // —— 明牌后额外加倍阶段：从地主开始依次决定是否加倍 ——
if (landlordIdx >= 0) try {
  const __rank = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
  const __count = (cs:string[])=>{ const m=new Map<string,number>(); for(const c of cs){const r=__rank(c); m.set(r,(m.get(r)||0)+1);} return m; };
  const bottom: string[] = Array.isArray(ev.bottom) ? ev.bottom as string[] : [];
  const hands: string[][] = Array.isArray(ev.hands) ? ev.hands as string[][] : [[],[],[]];
  let extraMult = 1;
  const decideExtraDouble = (seat:number)=>{
    const role = (seat===landlordIdx) ? 'landlord' : 'farmer';
    const all = role==='landlord' ? ([] as string[]).concat(hands[seat]||[], bottom) : (hands[seat]||[]);
    const cnt = __count(all);
    const hasRocket = (cnt.get('x')||0)>=1 && (cnt.get('X')||0)>=1
    const hasBomb = Array.from(cnt.values()).some(n=>n===4)
    // 极简启发：地主看到炸弹则愿意加倍；农民看到底牌显著增强（火箭或炸弹）时愿意加倍
    if (role==='landlord') return hasBomb;
    return (hasRocket || hasBomb);
  };
  for (let k=0;k<3;k++){
    const s=(landlordIdx + k) % 3;
    const will = decideExtraDouble(s);
    writeLine(res, { type:'event', kind:'extra-double', seat: s, do: will });
    if (will) extraMult *= 2;
  }
  if (extraMult > 1) {
    // 同步一次倍数（可被前端用于兜底校准）
    writeLine(res, { type:'event', kind:'multiplier-sync', multiplier: extraMult });
  }
} catch {}
continue;
    }

    // 兼容两种出牌事件：turn 或 event:play
    if (ev?.type==='turn') {
      const { seat, move, cards, hand, totals } = ev;
      countPlay(seat, move, cards);
      const moveStr = stringifyMove({ move, cards });
      const reason = lastReason[seat] || null;
      // 确保发送完整的手牌信息
      writeLine(res, { 
        type:'turn', 
        seat, 
        move, 
        cards, 
        hand: hand || [],  // 确保手牌不为空
        moveStr, 
        reason, 
        score: (lastScore[seat] ?? undefined), 
        totals 
      });
      // —— 明牌后额外加倍阶段：从地主开始依次决定是否加倍 ——
if (landlordIdx >= 0) try {
  const __rank = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
  const __count = (cs:string[])=>{ const m=new Map<string,number>(); for(const c of cs){const r=__rank(c); m.set(r,(m.get(r)||0)+1);} return m; };
  const bottom: string[] = Array.isArray(ev.bottom) ? ev.bottom as string[] : [];
  const hands: string[][] = Array.isArray(ev.hands) ? ev.hands as string[][] : [[],[],[]];
  let extraMult = 1;
  const decideExtraDouble = (seat:number)=>{
    const role = (seat===landlordIdx) ? 'landlord' : 'farmer';
    const all = role==='landlord' ? ([] as string[]).concat(hands[seat]||[], bottom) : (hands[seat]||[]);
    const cnt = __count(all);
    const hasRocket = (cnt.get('x')||0)>=1 && (cnt.get('X')||0)>=1
    const hasBomb = Array.from(cnt.values()).some(n=>n===4)
    // 极简启发：地主看到炸弹则愿意加倍；农民看到底牌显著增强（火箭或炸弹）时愿意加倍
    if (role==='landlord') return hasBomb;
    return (hasRocket || hasBomb);
  };
  for (let k=0;k<3;k++){
    const s=(landlordIdx + k) % 3;
    const will = decideExtraDouble(s);
    writeLine(res, { type:'event', kind:'extra-double', seat: s, do: will });
    if (will) extraMult *= 2;
  }
  if (extraMult > 1) {
    // 同步一次倍数（可被前端用于兜底校准）
    writeLine(res, { type:'event', kind:'multiplier-sync', multiplier: extraMult });
  }
} catch {}
continue;
    }
    if (ev?.type==='event' && ev?.kind==='play') {
      const { seat, move, cards } = ev;
      countPlay(seat, move, cards);
      writeLine(res, ev);
      continue;
    }

    // 兼容多种"结果"别名
    const isResultLike =
      (ev?.type==='result') ||
      (ev?.type==='event' && (ev.kind==='win' || ev.kind==='result' || ev.kind==='game-over' || ev.kind==='game_end')) ||
      (ev?.type==='game-over') || (ev?.type==='game_end');

    if (isResultLike) {
      if (!resultSent) {
        // —— 在 result 之前产出画像（前端会立即累计，避免兜底 2.5）——
        const perSeat = [0,1,2].map((i)=>{
          const s = stats[i];
          const total = Math.max(1, s.plays + s.passes);
          const passRate = s.passes / total;
          const avgCards = s.plays ? (s.cardsPlayed / s.plays) : 0;

          const agg   = clamp(1.5*s.bombs + 2.0*s.rockets + (1-passRate)*3 + Math.min(4, avgCards)*0.25);
          const cons  = clamp(3 + passRate*2 - (s.bombs + s.rockets)*0.6);
          let   eff   = clamp(2 + avgCards*0.6 - passRate*1.5);
          if ((ev as any).winner === i) eff = clamp(eff + 0.8);
          const coop  = clamp((i===landlordIdx ? 2.0 : 2.5) + passRate*2.5 - (s.bombs + s.rockets)*0.4);
          const rob   = clamp((i===landlordIdx ? 3.5 : 2.0) + 0.3*s.bombs + 0.6*s.rockets - passRate);

          return { seat: i, scaled: {
            coop: +coop.toFixed(2),
            agg : +agg.toFixed(2),
            cons: +cons.toFixed(2),
            eff : +eff.toFixed(2),
            bid: +rob.toFixed(2),
          }};
        });

        // 两种画像格式都发，前端任一命中都不会兜底
        writeLine(res, { type:'stats', perSeat });
        writeLine(res, { type:'event', kind:'stats', perSeat });

        // 再写 result（展开 & 带 lastReason）
        const baseResult = (ev?.type==='result') ? ev : { type:'result', ...(ev||{}) };
        writeLine(res, { ...(baseResult||{}), lastReason: [...lastReason] });
      }
      resultSent = true;
      continue;
    }

    // 其它事件透传
    if (ev?.type === 'event' && ev.kind === 'reveal') {
      const raw = (typeof ev.landlordIdx === 'number')
        ? ev.landlordIdx
        : (typeof ev.landlord === 'number' ? ev.landlord : null);
      if (typeof raw === 'number' && raw >= 0) landlordIdx = raw;
    }

    if (ev && ev.type) writeLine(res, ev);
  }
}

/* ========== HTTP 处理 ========== */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
  } catch {}

  const keepAlive = setInterval(() => { try { (res as any).write('\n'); } catch {} }, 15000);

  let sessionKey = '';

  try {
    const body: RunBody = (req as any).body as any;
    const rounds = Math.max(1, Math.floor(Number(body.rounds || 1)));
    const four2  = (body.four2 || 'both') as 'both'|'2singles'|'2pairs';


    const rule = (body as any).rule ?? { four2, rob: body.rob !== false, farmerCoop: !!body.farmerCoop };
    const ruleId = (body as any).ruleId ?? stableHash(JSON.stringify(rule));

    sessionKey = (typeof body.clientTraceId === 'string' && body.clientTraceId.trim())
      ? body.clientTraceId.trim()
      : `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    try { resetHumanSession(sessionKey); } catch {}

    const turnTimeoutMsArr = parseTurnTimeoutMsArr(req);
    const seatSpecs = (body.seats || []).slice(0,3) as SeatSpec[];
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));
    const delays = ((body.seatDelayMs || []) as number[]);

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });





      // —— per-request buffers for reason/score ——
      const lastReason: (string|null)[] = [null, null, null];
      const lastScore:  (number|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };
      const onScore  = (seat:number, sc?:number)=>{ if (seat>=0 && seat<3) lastScore[seat] = (typeof sc==='number'? sc: null); };
      const wrapped = baseBots.map((bot, i) =>
        traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot as any, res, onReason, onScore,
                  turnTimeoutMsArr[i] ?? turnTimeoutMsArr[0],
                  Math.max(0, Math.floor(delays[i] ?? 0)),
                  i,
                  sessionKey)
      );

      await runOneRoundWithGuard({ seats: wrapped as any, four2, rule, ruleId, lastReason, lastScore }, res, round);

      writeLine(res, { type:'event', kind:'round-end', round });
      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{};
    try{ (res as any).end(); }catch{}
    if (sessionKey) {
      try { resetHumanSession(sessionKey); } catch {}
    }
  }
}