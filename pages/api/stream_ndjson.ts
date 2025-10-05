// pages/api/stream_ndjson.ts
/* eslint-disable no-console */
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal, AllySupport, EndgameRush } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';
// 如果你的仓库没有 DeepseekBot，可以删除本行和 asBot 里的分支
import { DeepseekBot } from '../../lib/bots/deepseek_bot';

/* ========== 工具 ========== */
const nowISO = () => new Date().toISOString();
const clamp = (x:number, lo:number, hi:number) => Math.max(lo, Math.min(hi, x));

function writeLine(res: NextApiResponse, obj: any) {
  try {
    res.write(`${JSON.stringify(obj)}\n`);
  } catch (e) {
    try { res.write(`{"type":"log","message":"write error: ${String(e)}" }\n`); } catch {}
  }
}

/* ========== 已出牌缓存（仅当前请求作用域） ========== */
declare global {
  // eslint-disable-next-line no-var
  var __DDZ_SEEN: string[] | undefined;
  // eslint-disable-next-line no-var
  var __DDZ_SEEN_BY_SEAT: string[][] | undefined;
}
const seenReset = () => { (globalThis as any).__DDZ_SEEN = []; (globalThis as any).__DDZ_SEEN_BY_SEAT = [[], [], []]; };
const seenPush = (seat:number, cards:string[]) => {
  try {
    const g:any = globalThis as any;
    const a: string[] = g.__DDZ_SEEN ?? (g.__DDZ_SEEN = []);
    const b: string[][] = g.__DDZ_SEEN_BY_SEAT ?? (g.__DDZ_SEEN_BY_SEAT = [[],[],[]]);
    a.push(...cards);
    if (b[seat]) b[seat].push(...cards);
  } catch {}
};

/* ========== 严格出牌顺序历史（本次请求作用域） ========== */
type PlayEvent = {
  t: number;
  seat: number;  // 0/1/2；非出牌类事件用 -1
  action: 'init' | 'play' | 'pass' | 'bomb' | 'rocket' | 'bid' | 'rob' | 'turn-start' | 'turn-end' | 'round-end';
  cards?: string[];
  trick?: number;
  lead?: number;
  remain?: [number, number, number];
};
declare global {
  // eslint-disable-next-line no-var
  var __DDZ_HISTORY: PlayEvent[] | undefined;
}
const ph_get = (): PlayEvent[] => { if (!global.__DDZ_HISTORY) global.__DDZ_HISTORY = []; return global.__DDZ_HISTORY!; };
const ph_reset = () => { const a = ph_get(); a.length = 0; };
const ph_push  = (ev: Omit<PlayEvent, 't'>) => { ph_get().push({ ...ev, t: Date.now() }); };
const ph_snapshot = (): PlayEvent[] => ph_get().map(e => ({ ...e, cards: e.cards ? [...e.cards] : undefined }));

/* ========== Bot 选择 ========== */
export type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

export type SeatSpec = {
  choice: BotChoice;
  // for AI/http
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  token?: string;
  // UI 显示名
  label?: string;
};

function asBot(choice: BotChoice, spec?: SeatSpec) {
  switch (choice) {
    case 'built-in:greedy-max':   return GreedyMax;
    case 'built-in:greedy-min':   return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'built-in:ally-support': return AllySupport;
    case 'built-in:endgame-rush': return EndgameRush;
    case 'ai:openai':   return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o' });
    case 'ai:gemini':   return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-pro' });
    case 'ai:grok':     return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':     return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':     return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'ai:deepseek': return DeepseekBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'deepseek-chat' });
    case 'http':        return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:            return GreedyMax;
  }
}

/* ========== Trace 包装（注入 seen / playHistory + 限时 + 记录 reason/score） ========== */
function traceWrap(
  choice: BotChoice,
  spec: SeatSpec|undefined,
  bot: (ctx:any)=>Promise<any> | any,
  res: NextApiResponse,
  onReason: (seat:number, reason?:string)=>void,
  onScore:  (seat:number, score?:number)=>void,
  turnTimeoutMs: number,
  startDelayMs: number,
  seat: number
){
  return async (ctx:any) => {
    if (startDelayMs > 0) {
      await new Promise(r => setTimeout(r, Math.min(60_000, startDelayMs)));
    }

    // 记录一次 bot 调用
    try { writeLine(res, { type:'event', kind:'bot-call', seat, choice, model: spec?.model||'', phase: ctx?.phase || 'play' }); } catch {}

    // 构造上下文：严格时序 + 已出牌缓存
    const ctxPlus = {
      ...ctx,
      playHistory: ph_snapshot(),
      seen: (globalThis as any).__DDZ_SEEN ?? [],
      seenBySeat: (globalThis as any).__DDZ_SEEN_BY_SEAT ?? [[],[],[]],
    };

    // 限时
    const timeout = new Promise(resolve =>
      setTimeout(()=> resolve({ move:'pass', reason:`timeout@${Math.round(turnTimeoutMs/1000)}s` }), Math.max(1000, turnTimeoutMs))
    );

    let result: any;
    const t0 = Date.now();
    try {
      result = await Promise.race([ Promise.resolve(bot(ctxPlus)), timeout ]);
    } catch (e:any) {
      result = { move:'pass', reason: `error:${String(e?.message || e)}` };
    } finally {
      try {
        const dt = Date.now() - t0;
        if (typeof result?.reason === 'string') onReason(seat, result.reason);
        if (typeof result?.score === 'number')  onScore(seat, Number(result.score)||0);
        writeLine(res, { type:'event', kind:'bot-return', seat, ms: dt });
      } catch {}
    }

    return result;
  };
}

/* ========== 一局（round）驱动：消费 runOneGame 的事件流 ========== */
async function runOneRoundWithGuard(
  { seats, four2, lastReason, lastScore }:
  { seats: ((ctx:any)=>Promise<any>)[]; four2: 'both'|'2singles'|'2pairs'; lastReason: (string|null)[]; lastScore:(number|null)[] },
  res: NextApiResponse,
  round: number
){
  const iter = runOneGame({ seats, four2 } as any);

  // 重置观察缓存与历史
  seenReset();
  ph_reset();
  ph_push({ seat:-1, action:'init' });

  // 画像统计（保留你现有用途，不影响 bot）
  const stats = [0,1,2].map(()=>({ plays:0, passes:0, cardsPlayed:0, bombs:0, rockets:0 }));
  const countPlay = (seat:number, move:'play'|'pass', cards?:string[]) => {
    const cc = Array.isArray(cards) ? cards : [];
    if (move === 'play') {
      seenPush(seat, cc);
      stats[seat].plays++;
      stats[seat].cardsPlayed += cc.length;
      const uniq = new Set(cc);
      if (cc.length === 2 && uniq.has('x') && uniq.has('X')) stats[seat].rockets++;
      if (uniq.size === 1 && cc.length >= 4) stats[seat].bombs++;
      // 严格时序（不知道 trick/lead 时，省略可选字段）
      ph_push({ seat, action: (cc.length===2 && uniq.has('x') && uniq.has('X'))?'rocket': (uniq.size===1 && cc.length>=4)?'bomb':'play', cards: cc });
    } else {
      stats[seat].passes++;
      ph_push({ seat, action:'pass' });
    }
  };

  for await (const ev of iter as any) {
    if (!ev) continue;

    // 兼容两种出牌事件：turn 或 event:play
    if (ev?.type === 'turn') {
      const { seat, move, cards, hand, totals } = ev;
      countPlay(seat, move, cards);
      const moveStr = stringifyMove({ move, cards });
      const reason = lastReason[seat] || null;
      writeLine(res, { type:'turn', seat, move, cards, hand, moveStr, reason, score:(lastScore[seat] ?? undefined), totals, history: ph_snapshot() });
      continue;
    }
    if (ev?.type === 'event') {
      if (ev?.kind === 'play') {
        const { seat, move, cards } = ev;
        countPlay(seat, move, cards);
        const moveStr = stringifyMove({ move, cards });
        const reason = lastReason[seat] || null;
        writeLine(res, { type:'turn', seat, move, cards, moveStr, reason, score:(lastScore[seat] ?? undefined), history: ph_snapshot() });
        continue;
      }
      // 其它事件直接转发
      writeLine(res, ev);
      continue;
    }

    // 未知帧，原样透传
    writeLine(res, ev);
  }

  // 结尾
  ph_push({ seat:-1, action:'round-end' });
}

/* ========== move -> string ========== */
function stringifyMove({ move, cards }:{ move:'play'|'pass', cards?:string[] }) {
  if (move === 'pass') return '过牌';
  const cs = Array.isArray(cards) ? cards.slice() : [];
  return cs.length ? cs.join('') : '(?)';
}

/* ========== Next.js API ========== */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // NDJSON
  res.status(200);
  try { res.setHeader('Content-Type', 'application/x-ndjson'); } catch {}
  try { res.setHeader('Cache-Control', 'no-cache, no-transform'); } catch {}

  const body = (req.body || {}) as any;
  const seatSpecs: SeatSpec[] = body?.seats || [
    { choice:'built-in:greedy-max', label:'Greedy Max' },
    { choice:'built-in:greedy-min', label:'Greedy Min' },
    { choice:'built-in:random-legal', label:'Random Legal' },
  ];
  const four2: 'both'|'2singles'|'2pairs' = body?.four2 || 'both';
  const rounds: number = clamp(Math.floor(Number(body?.rounds ?? 1)), 1, 999);
  const delays: number[] = Array.isArray(body?.delays) ? body.delays : [0,0,0];
  const turnTimeoutMsArr: number[] = Array.isArray(body?.turnTimeoutSecs) ? body.turnTimeoutSecs.map((s:number)=>Math.max(1000, Math.floor(Number(s)||0)*1000)) : [30000,30000,30000];

  // Keep-alive: 避免代理超时
  const keepAlive = setInterval(()=>{ try{ res.write(' \n'); }catch{} }, 15000);

  try {
    writeLine(res, { type:'log', message:`开始 ${rounds} 局，four2=${four2}` });

    // 构建基础 bots
    const baseBots = seatSpecs.map(spec => asBot(spec.choice as BotChoice, spec));

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'event', kind:'round-start', round });

      // —— per-round buffers for reason/score ——
      const lastReason: (string|null)[] = [null, null, null];
      const lastScore:  (number|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };
      const onScore  = (seat:number, sc?:number)=>{ if (seat>=0 && seat<3) lastScore[seat] = (typeof sc==='number'? sc: null); };

      // 包装：限时 + 上下文注入 + 记录返回时间
      const wrapped = baseBots.map((bot, i) =>
        traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot as any, res, onReason, onScore,
                  turnTimeoutMsArr[i] ?? turnTimeoutMsArr[0],
                  Math.max(0, Math.floor(delays[i] ?? 0)),
                  i)
      );

      await runOneRoundWithGuard({ seats: wrapped as any, four2, lastReason, lastScore }, res, round);

      writeLine(res, { type:'event', kind:'round-end', round });
      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{};
    try{ (res as any).end(); }catch{}
  }
}
