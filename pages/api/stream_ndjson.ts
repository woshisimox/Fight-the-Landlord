// pages/api/stream_ndjson.ts (hardened, anti-stall + stopBelowZero + rob-eval)
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

type SeatSpec = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  token?: string;
};

type StartPayload = {
  seats: SeatSpec[];                     // 3 items
  seatDelayMs?: number[];
  rounds?: number;
  rob?: boolean;
  four2?: 'both' | '2singles' | '2pairs';
  stopBelowZero?: boolean;               // NEW: 可控（默认 true）
  startScore?: number;                   // NEW: 用于服务端累计
  seatModels?: string[];
  seatKeys?: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string;
    httpBase?: string; httpToken?: string;
  }[];
};

function writeLine(res: NextApiResponse, obj: any) {
  (res as any).write(JSON.stringify(obj) + '\n');
}

function providerOf(choice?: BotChoice): string {
  if (!choice) return 'unknown';
  if (choice.startsWith('ai:')) return choice.split(':')[1]; // ai:kimi -> kimi
  if (choice.startsWith('built-in')) return 'built-in';
  if (choice === 'http') return 'http';
  return 'unknown';
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
async function runOneRoundWithGuard(
  opts: {
    seats: any[];
    four2?: 'both'|'2singles'|'2pairs';
    delayMs?: number;
    seatMeta?: SeatSpec[];        // for rob-eval
  },
  res: NextApiResponse,
  roundNo: number
): Promise<{ rotatedDelta: [number,number,number] | null }> {
  const MAX_EVENTS = 4000;              // safety ceiling: total events per round
  const MAX_REPEATED_HEARTBEAT = 200;   // safety ceiling: consecutive 'pass/pass/reset' style
  const iter: AsyncIterator<any> = (runOneGame as any)({ seats: opts.seats, four2: opts.four2, delayMs: opts.delayMs });

  let evCount = 0;
  let landlord = -1;
  let trick = 0;
  let lastSignature = '';
  let repeated = 0;
  let rotatedDelta: [number,number,number] | null = null;

  // 小工具：将“相对地主顺序”的 ds 旋转为“座位顺序”
  const rotateByLandlord = (ds: number[], L: number): [number,number,number] => {
    const a = (idx:number) => ds[(idx - L + 3) % 3] || 0;
    return [a(0), a(1), a(2)];
  };

  while (true) {
    const { value, done } = await (iter.next() as any);
    if (done) break;
    evCount++;

    // forward downstream
    writeLine(res, value);

    // rob-eval 注入（用于前端确认 provider / model）
    if (value?.type === 'event' && value?.kind === 'rob' && typeof value?.seat === 'number') {
      const seat: number = value.seat | 0;
      const spec = (opts.seatMeta && opts.seatMeta[seat]) ? opts.seatMeta[seat] : undefined;
      writeLine(res, {
        type: 'event',
        kind: 'rob-eval',
        seat,
        score: value?.rob ? 1 : 0,   // 伪分数；如需真实分数可改为引擎侧发
        threshold: 0,
        features: {
          by: providerOf(spec?.choice),
          model: spec?.model || '',
          choice: spec?.choice || '',
        },
      });
    }

    // book-keeping
    if (value?.kind === 'init' && typeof value?.landlord === 'number') {
      landlord = value.landlord;
    }
    if (value?.kind === 'trick-reset') {
      trick += 1;
    }

    // 记录 win 的 rotatedDelta，供服务端累计
    if (value?.type === 'event' && value?.kind === 'win') {
      const ds = Array.isArray(value?.deltaScores) ? value.deltaScores as number[] : [0,0,0];
      // 按“相对地主顺序”解释为 [L, L+1, L+2]，旋转到座位顺序
      rotatedDelta = rotateByLandlord(ds, Math.max(0, landlord));
    }

    // livelock guard
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

      // 生成“相对地主顺序”的合成胜利 ds，并旋转计入
      const winner = landlord >= 0 ? landlord : 0;
      const dsRel = (winner === landlord) ? [+2, -1, -1] : [-2, +1, +1]; // 相对地主顺序
      const rot = rotateByLandlord(dsRel, Math.max(0, landlord));
      rotatedDelta = rot;

      // 下发合成 win（deltaScores 保持“相对地主顺序”）
      writeLine(res, { type:'event', kind:'win', winner, multiplier: 1, deltaScores: dsRel });
      return { rotatedDelta };
    }
  }

  return { rotatedDelta };
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
  const __ka = setInterval(()=>{ try{
    if((res as any).writableEnded){ clearInterval(__ka as any); return; }
    if(Date.now()-__lastWrite>2500){ writeLineKA({ type:'ka', ts: new Date().toISOString() }); }
  }catch{} }, 2500);

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    const startScore = Number(body.startScore ?? 0) || 0;
    const stopBelowZero = body.stopBelowZero ?? true;  // 默认开启“<0 停赛”

    // build bots
    const seatBots = (body.seats || []).slice(0,3).map((s) => asBot(s.choice, s));
    const seatMeta = (body.seats || []).slice(0,3); // 用于 rob-eval 的元信息

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    // 服务端累计总分，仅用于“<0 停赛”判定；初始为 startScore
    let scores: [number,number,number] = [startScore, startScore, startScore];

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      // wrap seats with per-seat delay
      const delayedSeats = seatBots.map((bot, idx) => async (ctx:any) => {
        const ms = delays[idx] || 0;
        if (ms) await new Promise(r => setTimeout(r, ms));
        return bot(ctx);
      });

      const { rotatedDelta } = await runOneRoundWithGuard({ seats: delayedSeats, four2, delayMs: 0, seatMeta }, res, round);

      // 将“座位顺序”的本局增量累加到服务端分数，并判断是否 < 0
      if (rotatedDelta) {
        scores = [
          scores[0] + rotatedDelta[0],
          scores[1] + rotatedDelta[1],
          scores[2] + rotatedDelta[2],
        ];
      }

      if (stopBelowZero && (scores[0] < 0 || scores[1] < 0 || scores[2] < 0)) {
        writeLine(res, { type:'log', message:`某方积分 < 0，提前终止。当前总分（座位顺序）：${scores.join(' / ')}` });
        break;  // 停止后续局数
      }

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try{ clearInterval(__ka as any);}catch{}; res.end();
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
    try { try{ clearInterval(__ka as any);}catch{}; res.end(); } catch {}
  }
}
