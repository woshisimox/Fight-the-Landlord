// ==== pages/api/stream_ndjson.ts ====
// 你原文件的 import/类型/实现都保留 —— 我只在 handler 里“猴补”日志，不改行为
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

// === 你原有的类型定义等，保持不动 ===
type Four2Policy = 'both' | '2singles' | '2pairs';
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
  four2?: Four2Policy;
  stopBelowZero?: boolean;
  debug?: boolean;
  seatModels?: { E?:string; S?:string; W?:string; } | null;
  seatKeys?: { E?:string; S?:string; W?:string; } | null;
};

// === 你原有的工具函数/chooseBot/playOneRound/handler 逻辑…都保留 ===
// 唯一新增：在 handler 内部“猴补 res.write”并加 BEGIN/CLOSE/FINISH 日志

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
    case 'http':      return HttpBot({ base: base ?? '', token: token ?? '' }) as unknown as BotFunc; // 不动业务，只去掉多余 model
    default:          return async (ctx:any)=>GreedyMax(ctx);
  }
}

async function* playOneRound(opts: {
  seats: BotFunc[];
  rob: boolean;
  four2: Four2Policy;
  delays: number[];
  res: NextApiResponse;
}) {
  const { seats, rob, four2, delays, res } = opts;
  const iter = runOneGame({ seats, rob, four2 });

  let landlord = -1;

  for await (const ev of iter as any) {
    if (ev.type === 'event' && ev.kind === 'init' && Array.isArray(ev.hands)) {
      if (typeof ev.landlord === 'number') landlord = ev.landlord;
      writeLine(res, { type:'state', kind:'init', landlord, hands: ev.hands });
      continue;
    }

    if (ev.type === 'event' && ev.kind === 'rob') {
      writeLine(res, { type:'event', kind:'rob', seat: ev.seat, rob: ev.rob });
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
      writeLine(res, payload);
      await new Promise(r=>setTimeout(r, Math.max(0, delays[ev.seat] || 0)));
      continue;
    }

    if (ev.type === 'event' && ev.kind === 'trick-reset') {
      writeLine(res, { type:'event', kind:'trick-reset' });
      continue;
    }

    if (ev.type === 'event' && ev.kind === 'win') {
      writeLine(res, { type:'event', kind:'win', winner: ev.winner, multiplier: ev.multiplier || 1, deltaScores: ev.deltaScores });
      return;
    }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // —— 只加日志：请求生命周期 & res.write 摘要 ——（不改返回内容）
  const reqTag = Math.random().toString(36).slice(2, 8);
  const slog = (...a: any[]) => console.log('[NDJSON/BE]', ...a);
  slog('BEGIN', reqTag);

  const __oldWrite = (res as any).write.bind(res);
  (res as any).write = (chunk: any, ...args: any[]) => {
    try {
      const s = typeof chunk === 'string'
        ? chunk
        : (typeof Buffer !== 'undefined' && (Buffer as any).isBuffer?.(chunk))
          ? (chunk as Buffer).toString('utf8')
          : '';

      if (s && s.length) {
        s.split('\n').forEach((line) => {
          if (!line) return;
          try {
            const obj = JSON.parse(line);
            const t = obj?.type, k = obj?.kind;
            if (t === 'state' && k === 'init') {
              slog(reqTag, 'out', 'init', 'LL=', obj?.landlord);
            } else if (t === 'event' && k === 'play') {
              slog(reqTag, 'out', 'play', obj?.seat, obj?.move, obj?.cards ? obj.cards.length : 0);
            } else if (t === 'event' && k === 'rob') {
              slog(reqTag, 'out', 'rob', obj?.seat, obj?.rob);
            } else if (t === 'event' && k === 'trick-reset') {
              slog(reqTag, 'out', 'trick-reset');
            } else if (t === 'event' && k === 'win') {
              slog(reqTag, 'out', 'win', obj?.winner, obj?.multiplier, obj?.deltaScores);
            } else if (t === 'log') {
              const msg = (obj?.message || '').toString();
              if (/(开始|结束|提前终止|错误)/.test(msg)) slog(reqTag, 'log', msg);
            }
          } catch { /* 非 JSON 行忽略 */ }
        });
      }
    } catch { /* 忽略解析错误，绝不影响写出 */ }
    return __oldWrite(chunk, ...args as any);
  };

  res.once('close',  () => console.log('[NDJSON/BE]', 'CLOSE',  reqTag));
  res.once('finish', () => console.log('[NDJSON/BE]', 'FINISH', reqTag));

  // —— 你原有的 header / 心跳 / 主循环逻辑 保持不动（仅示意） ——
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // 如果你原来就有 keepalive，就保留；如果没有，可以删掉下面 1s 的示例心跳
  const writeLineKA = (obj:any)=>{ (res as any).write(JSON.stringify(obj)+'\n'); };
  const __ka = setInterval(()=>{ try{ if((res as any).writableEnded){ clearInterval(__ka as any); } else { writeLineKA({ type:'ka', ts: new Date().toISOString() }); } }catch{} }, 1000);
  res.once('close', ()=>{ try{ clearInterval(__ka as any);}catch{} });
  res.once('finish', ()=>{ try{ clearInterval(__ka as any);}catch{} });

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
    const four2: Four2Policy = body.four2 || 'both';
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

      for await (const _ of iter as any) { /* no-op：事件已写出 */ }

      writeLine(res, { type:'log', message:`第 ${round} 局结束（详见 'win' 事件）。` });
      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try{ clearInterval(__ka as any);}catch{}; res.end();
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
    try { try{ clearInterval(__ka as any);}catch{}; res.end(); } catch {}
  }
}
