// pages/api/stream_ndjson.ts (hardened, anti-stall version)
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
  seats: SeatSpec[];                     // 3 items
  seatDelayMs?: number[];
  rounds?: number;
  rob?: boolean;
  four2?: 'both' | '2singles' | '2pairs';
  stopBelowZero?: boolean;
  seatModels?: string[];
  seatKeys?: { openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; httpBase?: string; httpToken?: string; }[];
};

function writeLine(res: NextApiResponse, obj: any) {
  res.write(JSON.stringify(obj) + '\n');
}

function asBot(choice: BotChoice, spec?: SeatSpec): (ctx:any)=>Promise<any>|any {
  switch (choice) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai': return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-flash' });
    case 'ai:grok':   return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':   return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'moonshot-v1-8k' });
    case 'ai:qwen':   return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'http':      return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:          return GreedyMax;
  }
}

// Hardened single-round runner with stall guard
async function runOneRoundWithGuard(opts: { seats: any[], four2?: 'both'|'2singles'|'2pairs', delayMs?: number }, res: NextApiResponse, roundNo: number) {
  const MAX_EVENTS = 4000;              // safety ceiling: total events per round
  const MAX_REPEATED_HEARTBEAT = 200;   // safety ceiling: consecutive 'pass/pass/reset' type heartbeats
  const iter: AsyncIterator<any> = (runOneGame as any)({ seats: opts.seats, four2: opts.four2, delayMs: opts.delayMs });
  let evCount = 0;
  let landlord = -1;
  let trick = 0;
  let lastSignature = '';
  let repeated = 0;

  while (true) {
    const { value, done } = await (iter.next() as any);
    if (done) break;
    evCount++;

    // forward downstream
    writeLine(res, value);

    // book-keeping for diagnostics
    const kind = value?.kind || value?.type;
    if (value?.kind === 'init' && typeof value?.landlord === 'number') {
      landlord = value.landlord;
    }
    if (value?.kind === 'trick-reset') {
      trick += 1;
    }
    // simple repetition signature to catch livelocks
    const sig = JSON.stringify({
      kind: value?.kind,
      seat: value?.seat,
      move: value?.move,
      require: value?.require?.type || value?.comboType || null,
      leader: value?.leader,
      trick
    });

    if (sig === lastSignature) repeated++; else repeated = 0;
    lastSignature = sig;

    if (evCount > MAX_EVENTS || repeated > MAX_REPEATED_HEARTBEAT) {
      writeLine(res, { type:'log', message:`[防卡死] 触发安全阈值：${evCount} events, repeated=${repeated}。本局强制结束（判地主胜）。`});
      // Gracefully close the generator if possible
      try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined); } catch {}
      // Emit a synthetic win so前端能收尾
      const winner = landlord >= 0 ? landlord : 0;
      writeLine(res, { type:'event', kind:'win', winner, multiplier: 1, deltaScores: winner===landlord ? [+2,-1,-1] : [-2,+1,+1] });
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
  function writeLineKA(obj:any){ (res as any).write(JSON.stringify(obj)+'\n'); __lastWrite = Date.now(); }
  const __ka = setInterval(()=>{ try{ if((res as any).writableEnded){ clearInterval(__ka as any); return; } if(Date.now()-__lastWrite>2500){ writeLineKA({ type:'ka', ts: new Date().toISOString() }); } }catch{} }, 2500);

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    // build bots
    const seatBots = (body.seats || []).slice(0,3).map((s, i) => asBot(s.choice, s));

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    let scores: [number,number,number] = [0,0,0];
    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      // wrap seats with per-seat delay (防止显式 await 造成阻塞)
      const delayedSeats = seatBots.map((bot, idx) => async (ctx:any) => {
        const ms = delays[idx] || 0;
        if (ms) await new Promise(r => setTimeout(r, ms));
        return bot(ctx);
      });

      await runOneRoundWithGuard({ seats: delayedSeats, four2, delayMs: 0 }, res, round);

      // 前端会自行累计分数；这里只做可选的“低于0提前终止”
      if (body.stopBelowZero && (scores[0]<0 || scores[1]<0 || scores[2]<0)) {
        writeLine(res, { type:'log', message:`某方积分 < 0，提前终止。` });
        break;
      }

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try{ clearInterval(__ka as any);}catch{}; res.end();
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
    try { try{ clearInterval(__ka as any);}catch{}; res.end(); } catch {}
  }
}
