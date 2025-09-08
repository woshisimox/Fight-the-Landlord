// pages/api/stream_ndjson.ts (anti-stall + type-safe)
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type SeatSpec = { choice: BotChoice; model?: string; apiKey?: string; baseUrl?: string; token?: string };

type StartPayload = {
  seats: SeatSpec[];
  seatDelayMs?: number[];
  rounds?: number;
  rob?: boolean;
  four2?: 'both' | '2singles' | '2pairs';
  stopBelowZero?: boolean;
  debug?: boolean; // 保留字段但本文件不再传给 engine
  seatModels?: { E?:string; S?:string; W?:string; } | null;
  seatKeys?: { E?:string; S?:string; W?:string; } | null;
};

function writeLine(res: NextApiResponse, obj: any) {
  (res as any).write(JSON.stringify(obj) + '\n');
}

type BotFunc = (ctx:any)=>Promise<any>;

function chooseBot(
  kind: BotChoice,
  model?: string,
  keys?: Partial<{ openai:string; gemini:string; grok:string; kimi:string; qwen:string }>,
  base?: string,
  token?: string
): BotFunc {
  switch (kind) {
    case 'built-in:greedy-max': return async (ctx:any)=>GreedyMax(ctx);
    case 'built-in:greedy-min': return async (ctx:any)=>GreedyMin(ctx);
    case 'built-in:random-legal': return async (ctx:any)=>RandomLegal(ctx);
    case 'ai:openai': return OpenAIBot({ apiKey: keys?.openai ?? '', model }) as unknown as BotFunc;
    case 'ai:gemini': return GeminiBot({ apiKey: keys?.gemini ?? '', model }) as unknown as BotFunc;
    case 'ai:grok':   return GrokBot({ apiKey: keys?.grok   ?? '', model }) as unknown as BotFunc;
    case 'ai:kimi':   return KimiBot({ apiKey: keys?.kimi   ?? '', model }) as unknown as BotFunc;
    case 'ai:qwen':   return QwenBot({ apiKey: keys?.qwen   ?? '', model }) as unknown as BotFunc;
    case 'http':      return HttpBot({ base: base ?? '', token: token ?? '' }) as unknown as BotFunc; // http 入参不支持 model
    default:          return async (ctx:any)=>GreedyMax(ctx);
  }
}

async function* playOneRound(opts: any) {
  const { seats, rob, four2, delays } = opts; // 不再解构 debug
  const iter = runOneGame({ seats, rob, four2 }); // 不再传 debug

  let landlord = -1;
  let multiplier = 1;
  let evCount = 0;
  let repeated = 0;
  let lastKey = '';

  for await (const ev of iter as any) {
    evCount++;
    const key = JSON.stringify([ev.type, ev.kind, ev.seat, ev.move, ev.cards]);
    if (key === lastKey) repeated++; else repeated = 0;
    lastKey = key;

    if (ev.type === 'event' && ev.kind === 'init' && Array.isArray(ev.hands)) {
      landlord = typeof ev.landlord === 'number' ? ev.landlord : landlord;
      writeLine(opts.res, { type:'state', kind:'init', landlord, hands: ev.hands });
      continue;
    }

    if (ev.type === 'event' && ev.kind === 'rob') {
      writeLine(opts.res, { type:'event', kind:'rob', seat: ev.seat, rob: ev.rob });
      await new Promise(r=>setTimeout(r, Math.max(0, delays[ev.seat] || 0)));
      if (ev.rob) landlord = ev.seat;
      continue;
    }

    if (ev.type === 'event' && ev.kind === 'play') {
      const payload:any = { type:'event', kind:'play', seat: ev.seat, move: ev.move };
      if (ev.move === 'play') {
        payload.cards = ev.cards;
        payload.comboType = ev.comboType;
        payload.reason = ev.reason || '';
      } else {
        payload.reason = ev.reason || 'pass';
      }
      writeLine(opts.res, payload);
      await new Promise(r=>setTimeout(r, Math.max(0, delays[ev.seat] || 0)));
      continue;
    }

    if (ev.type === 'event' && ev.kind === 'trick-reset') {
      writeLine(opts.res, { type:'event', kind:'trick-reset' });
      continue;
    }

    if (ev.type === 'event' && ev.kind === 'win') {
      multiplier = ev.multiplier || 1;
      writeLine(opts.res, { type:'event', kind:'win', winner: ev.winner, multiplier, deltaScores: ev.deltaScores });
      return;
    }

    // 防卡死：极端情况下，若事件重复过多，强制收尾
    if (evCount > 5000 || repeated > 500) {
      writeLine(opts.res, { type:'log', message:`[防卡死] 触发安全阈值：${evCount} events, repeated=${repeated}。本局强制结束（判地主胜）。`});
      try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined); } catch {}
      const winner = landlord >= 0 ? landlord : 0;
      writeLine(opts.res, { type:'event', kind:'win', winner, multiplier: 1, deltaScores: winner===landlord ? [+2,-1,-1] : [-2,+1,+1] });
      return;
    }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let __lastWrite = Date.now();
  const writeLineKA = (obj:any)=>{ (res as any).write(JSON.stringify(obj)+'\n'); __lastWrite = Date.now(); };
  const __ka = setInterval(()=>{ try{ if((res as any).writableEnded){ clearInterval(__ka as any); } else { writeLineKA({ type:'ka', ts: new Date().toISOString() }); } }catch{} }, 1000);
  res.once('close', ()=>{ try{ clearInterval(__ka as any);}catch{} });
  res.once('finish', ()=>{ try{ clearInterval(__ka as any);}catch{} });

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    const keys = {
      openai:  body.seatKeys?.E ?? body.seatKeys?.S ?? body.seatKeys?.W ?? '',
      gemini:  body.seatKeys?.S ?? '',
      grok:    '',
      kimi:    body.seatKeys?.E ?? body.seatKeys?.S ?? body.seatKeys?.W ?? '',
      qwen:    body.seatKeys?.W ?? '',
    };

    for (let round=1; round<=rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      const seatFuncs: BotFunc[] = (body.seats || []).slice(0,3).map((s)=>{
        return chooseBot(s.choice, s.model, keys, s.baseUrl, s.token);
      });

      const iter = playOneRound({
        seats: seatFuncs,
        rob: !!body.rob,
        four2,
        delays,
        res,
      });

      // 消耗迭代器（事件已在 playOneRound 内 writeLine 输出）
      for await (const _ of iter as any) { /* no-op */ }

      writeLine(res, { type:'log', message:`第 ${round} 局结束（详见 'win' 事件）。` });
      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try{ clearInterval(__ka as any);}catch{}; res.end();
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
    try { try{ clearInterval(__ka as any);}catch{}; res.end(); } catch {}
  }
}
