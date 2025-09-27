// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';
import { DeepseekBot } from '../../lib/bots/deepseek_bot';

/** 解析“每手最大思考时长”（ms），返回三座位数组 */
function parseTurnTimeoutMsArr(req: import('next').NextApiRequest): [number, number, number] {
  const fromQuery = (k: string) => {
    const v = (req.query as any)?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const fromBody = (k: string) => (req.body as any)?.[k];

  const clampMs = (sec: any) => Math.max(1000, (Number(sec) && Number(sec) > 0 ? Number(sec) : 30) * 1000);

  // body: turnTimeoutSecs / turnTimeoutSec 传数组
  let arr = fromBody('turnTimeoutSecs') ?? fromBody('turnTimeoutSec');
  if (Array.isArray(arr)) {
    const nums = arr.map((x: any) => clampMs(x));
    if (nums.length >= 3) return [nums[0], nums[1], nums[2]];
    if (nums.length === 2) return [nums[0], nums[1], nums[1]];
    if (nums.length === 1) return [nums[0], nums[0], nums[0]];
  }

  // body: __tt / tt / turnTimeout （数字或字符串）
  const tryBodyKeys = [fromBody('__tt'), fromBody('tt'), fromBody('turnTimeout')];
  for (const v of tryBodyKeys) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const ms = clampMs(v);
      return [ms, ms, ms];
    }
    if (typeof v === 'string' && v.trim()) {
      const s = v.trim();
      if (s.includes(',') || s.includes('/') || /\s/.test(s)) {
        const vals = s.split(/[,\s/]+/).filter(Boolean).map(clampMs);
        const a = vals[0] ?? 30000;
        const b = vals[1] ?? a;
        const c = vals[2] ?? b;
        return [a, b, c];
      } else {
        const ms = clampMs(s);
        return [ms, ms, ms];
      }
    }
  }

  // query: 兼容同名参数
  const rawTT = fromQuery('__tt') ?? fromQuery('tt') ?? fromQuery('turnTimeout') ?? fromQuery('turnTimeoutSec') ?? fromQuery('turnTimeoutSecs');
  if (typeof rawTT === 'string' && rawTT.trim()) {
    const s = rawTT.trim();
    if (s.includes(',') || s.includes('/') || /\s/.test(s)) {
      const vals = s.split(/[,\s/]+/).filter(Boolean).map(clampMs);
      const a = vals[0] ?? 30000;
      const b = vals[1] ?? a;
      const c = vals[2] ?? b;
      return [a, b, c];
    } else {
      const ms = clampMs(s);
      return [ms, ms, ms];
    }
  } else if (typeof rawTT === 'number' && Number.isFinite(rawTT) && rawTT > 0) {
    const ms = clampMs(rawTT);
    return [ms, ms, ms];
  }

  return [30000, 30000, 30000];
}

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

type SeatSpec = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  token?: string;
};

type RunBody = {
  rounds: number;
  rob?: boolean;               // 是否抢地主
  four2?: 'both'|'2singles'|'2pairs';
  seats: SeatSpec[];           // 3 seats
  seatDelayMs?: number[];      // 3 delays
  turnTimeoutSec?: number | number[];
};

const clamp = (v:number, lo=0, hi=5)=> Math.max(lo, Math.min(hi, v));

function writeLine(res: NextApiResponse, obj: any) {
  (res as any).write(JSON.stringify(obj) + '\n');
}

function providerLabel(choice: BotChoice) {
  switch (choice) {
    case 'built-in:greedy-max': return 'GreedyMax';
    case 'built-in:greedy-min': return 'GreedyMin';
    case 'built-in:random-legal': return 'RandomLegal';
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
    case 'ai:openai': return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-pro' });
    case 'ai:grok':   return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':   return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':   return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'ai:deepseek': return DeepseekBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'deepseek-chat' });
    case 'http':      return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:          return GreedyMax;
  }
}

/* ---------- 轻量手牌/候选估算，丰富 strategy ---------- */
function rankScore(r:string){
  const map:any = { X:10, x:8, '2':7, A:6, K:5, Q:4, J:3, T:2 };
  return map[r] ?? 1;
}
function estimateHandEval(hand:any): number {
  // hand: string[] 例如 ['3','4','4','7','J','Q','A','2','x','X']
  const freq:Record<string, number> = {};
  for (const r of hand) freq[r] = (freq[r]||0)+1;
  let singles=0, pairs=0, triples=0, bombs=0, jokers=0;
  for (const [r,c] of Object.entries(freq)) {
    if (r==='x' || r==='X') { jokers++; continue; }
    if (c===1) singles++; else if (c===2) pairs++; else if (c===3) triples++; else if (c>=4) bombs++;
  }
  const hi = (freq['2']||0) + (freq['A']||0) + (freq['K']||0) + (freq['Q']||0);
  const pow = bombs*2 + (jokers===2?3:0);
  return hi*0.5 + pow*1.5 - singles*0.2 - Math.max(0, pairs-1)*0.1 + triples*0.4;
}

function stringifyMove(m:any){
  // m: { move:'pass' } or { move:'play', cards:string[], type?:string, reason?:string }
  if (!m || m.move==='pass') return 'pass';
  const type = m.type ? `${m.type} ` : '';
  const cards = Array.isArray(m.cards) ? m.cards.join('') : String(m.cards||'');
  return `${type}${cards}`;
}

function cardsBrief(cards:string[]):string{
  return cards.join('');
}

/* ---------- Trace 包裹：记录每步 reason 并限时 ---------- */
function traceWrap(
  choice: BotChoice,
  spec: SeatSpec|undefined,
  bot: (ctx:any)=>any,
  res: NextApiResponse,
  onReason: (seat:number, text?:string)=>void,
  onMove: (seat:number, move:any)=>void,
  timeoutMs: number
){
  const label = providerLabel(choice);
  return async (ctx:any) => {
    const t0 = Date.now();
    let timeout: any;
    const timeoutP = new Promise((_r, rej)=>{ timeout = setTimeout(()=>rej(new Error('timeout')), Math.max(1000, timeoutMs||0)); });

    const showInput = {
      role: ctx?.role,
      hand: Array.isArray(ctx?.hand) ? cardsBrief(ctx.hand) : ctx?.hand,
      public: {
        landlordIdx: ctx?.public?.landlordIdx,
        lastPlay: ctx?.public?.lastPlay ? {
          seat: ctx?.public?.lastPlay.seat,
          cards: cardsBrief(ctx?.public?.lastPlay.cards||[]),
          type: ctx?.public?.lastPlay.type,
        } : null,
        trick: Array.isArray(ctx?.public?.trick) ? ctx.public.trick.map((t:any)=>({
          seat: t.seat, move: stringifyMove(t.move)
        })) : [],
      }
    };

    try {
      const p = Promise.resolve(bot(ctx));
      const r:any = await Promise.race([p, timeoutP]);
      clearTimeout(timeout);

      // 包装 reason：对齐 UI 期望
      let reason = r?.reason;
      if (!reason) {
        const est = estimateHandEval(ctx?.hand||[]);
        if (r?.move==='play') {
          reason = `[${label}] ${ctx?.role==='L'?'地主':'农民'}：${stringifyMove(r)} — 估值=${est.toFixed(2)}`;
        } else {
          reason = `[${label}] ${ctx?.role==='L'?'地主':'农民'}：pass — 估值=${est.toFixed(2)}`;
        }
      } else {
        reason = `[${label}] ${reason}`;
      }

      onReason(ctx?.seatIndex ?? -1, reason);
      try { onMove(ctx?.seatIndex ?? -1, r); } catch {}
      writeLine(res, { type:'strategy', seat: ctx?.seatIndex ?? -1, reason, ms: Date.now()-t0 });
      return r;
    } catch (e:any) {
      clearTimeout(timeout);
      const fallback = await GreedyMax(ctx);
      const reason = `[${label}] ${ctx?.role==='L'?'地主':'农民'}：${stringifyMove(fallback)} — 理由：${e?.message||'外部AI超时/错误，已回退内建（GreedyMax）'}`;
      onReason(ctx?.seatIndex ?? -1, reason);
      writeLine(res, { type:'strategy', seat: ctx?.seatIndex ?? -1, reason, ms: Date.now()-t0, error: e?.message||String(e) });
      return fallback;
    }
  };
}

/* ---------- 单局运行 + 守护：产出 NDJSON ---------- */
async function runOneRoundWithGuard(
  { seats, four2, delayMs, lastReason, getLastMove }:
  { seats: ((ctx:any)=>Promise<any>)[]; four2: 'both'|'2singles'|'2pairs'; delayMs: number; lastReason: (string|null)[]; getLastMove?: (seat:number)=>any },
  res: NextApiResponse,
  round: number
){
  const iter = runOneGame({ seats, four2 } as any);
  let sentInit = false;
  
  
  // --- added: round stats accumulator and landlord capture ---
  let landlordIdx: number | null = null;
  const st = [0,1,2].map(()=>({ plays:0, passes:0, bombs:0, rockets:0, cards:0 }));
for await (const ev of iter as any) {
    if (!sentInit && ev?.type==='init') {
      sentInit = true;
      landlordIdx = (ev as any).landlordIdx ?? null;
      writeLine(res, { type:'init', landlordIdx: ev.landlordIdx, bottom: ev.bottom, hands: ev.hands });
      continue;
    }

    if (ev?.type === 'turn') {
  // === 统一的“看牌说话”逻辑（三家一致） ===
  let seat = (ev as any).seat ?? (ev as any).player ?? (ev as any).index ?? 0;
  seat = Math.max(0, Math.min(2, Number(seat) || 0));

  // 优先从事件取牌，其次从 move.cards 兜底；仍为空则尝试使用刚才 bot 的返回
  let cardsArr: string[] =
    Array.isArray((ev as any).cards) ? (ev as any).cards
    : (Array.isArray((ev as any).move?.cards) ? (ev as any).move.cards : []);

  if ((!Array.isArray(cardsArr) || cardsArr.length === 0) && getLastMove) {
    const lm = getLastMove(seat) as any;
    if (lm?.move === 'play' && Array.isArray(lm.cards) && lm.cards.length > 0) {
      cardsArr = lm.cards;
    }
  }

  const reason = lastReason[seat] || null;

  if (Array.isArray(cardsArr) && cardsArr.length > 0) {
    // 统计 & 事件
    try {
      st[seat].plays++;
      st[seat].cards += cardsArr.length;
    } catch {}
    writeLine(res, { type: 'event', kind: 'play', seat, move: 'play', cards: cardsArr, reason });
  } else {
    try { st[seat].passes++; } catch {}
    writeLine(res, { type: 'event', kind: 'play', seat, move: 'pass', reason });
  }
  continue;
}
    
    if (ev?.type === 'result') {
  // --- added: per-round radar stats event ---
  try {
    const perSeat = [0,1,2].map(i => {
      const s = st[i] || {plays:0,passes:0,bombs:0,rockets:0,cards:0};
      const p = Math.max(1, s.plays || 0);
      const agg  = clamp( ( (s.bombs||0)*2 + (s.rockets||0)*3 + Math.max(0, (s.cards||0)/p - 2) ), 0, 5 );
      const eff  = clamp( (s.cards||0) / p, 0, 5 );
      const cons = clamp( 5 - agg, 0, 5 );
      const rob  = clamp( (landlordIdx === i ? 5 : 2), 0, 5 );
      const coop = 2.5;
      return { seat:i, scaled:{ coop, agg, cons, eff, rob } };
    });
    writeLine(res, { type:'event', kind:'stats', perSeat });
  } catch {}
      const deltaScores = Array.isArray((ev as any).deltaScores)
        ? (ev as any).deltaScores
        : (Array.isArray((ev as any).delta) ? (ev as any).delta : [0,0,0]);
      writeLine(res, {
        type: 'result',
        winner: (ev as any).winner ?? null,
        landlordIdx: (ev as any).landlordIdx ?? null,
        multiplier: (ev as any).multiplier ?? 1,
        deltaScores,
      });
      writeLine(res, { type: 'event', kind: 'round-end', round });
      break;
    }

    // 透传其他日志/事件（如果引擎有）
    if (ev?.type) writeLine(res, ev);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const keepAlive = setInterval(()=>{ try{ (res as any).write('\n'); }catch{} }, 15000);

  try {
    const body = req.body as RunBody;
    const rounds = Math.max(1, Math.min(9999, Number(body.rounds)||1));
    const rob = !!body.rob;
    const four2 = (body.four2||'both') as 'both'|'2singles'|'2pairs';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    // 每座位的最大思考时长（毫秒）
    const turnTimeoutMsArr = parseTurnTimeoutMsArr(req);

    const seatSpecs = (body.seats || []).slice(0,3);
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });
      const lastBotMove: any[] = [null, null, null];
      const onMove = (seat:number, mv:any)=>{ if (seat>=0&&seat<3) lastBotMove[seat]=mv; };


      const lastReason: (string|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };

      const roundBots = baseBots.map((bot, i) => traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot, res, onReason, onMove, turnTimeoutMsArr[i]));

      const delayedSeats = roundBots.map((bot, idx) => async (ctx:any) => {
        const ms = delays[idx] || 0; if (ms) await new Promise(r => setTimeout(r, ms));
        return bot(ctx);
      });

      await runOneRoundWithGuard({ seats: delayedSeats, four2, delayMs: 0, lastReason, getLastMove: (seat:number)=> lastBotMove[seat] }, res, round);

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{};
    try{ (res as any).end(); }catch{}
  }
}
