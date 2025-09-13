// pages/api/stream_ndjson.ts
// hardened anti-stall + rob-eval + bot-call/done(+reason) + stopBelowZero(服务端累计)
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
  stopBelowZero?: boolean;               // 默认 true
  startScore?: number;                   // 服务端累计的起始分
  seatModels?: string[];
  seatKeys?: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string;
    httpBase?: string; httpToken?: string;
  }[];
};

function writeLine(res: NextApiResponse, obj: any) {
  try { (res as any).write(JSON.stringify(obj) + '\n'); } catch {}
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
    case 'ai:kimi':   return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':   return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'http':      return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:          return GreedyMax;
  }
}

/** 从 bot 返回值里提取“理由”字段，并做清洗/截断，避免日志过长 */
function extractReason(raw: any): string | undefined {
  try {
    let r =
      (typeof raw?.reason === 'string' && raw.reason) ||
      (typeof raw?.explanation === 'string' && raw.explanation) ||
      (typeof raw?.explain === 'string' && raw.explain) ||
      (typeof raw?.analysis === 'string' && raw.analysis) ||
      (typeof raw?.why === 'string' && raw.why) ||
      (typeof raw?.meta?.reason === 'string' && raw.meta.reason) ||
      (typeof raw === 'string' ? raw : '');

    if (!r) return undefined;
    // 清洗：压缩换行和空白，去掉多余空格
    r = String(r).replace(/\s+/g, ' ').trim();
    // 截断到 400 字符，避免日志爆长
    const MAX = 400;
    if (r.length > MAX) r = r.slice(0, MAX) + '…';
    return r;
  } catch { return undefined; }
}

// 单局 runner + 防卡死 + rob-eval 注入；返回“座位顺序”的本局增量
async function runOneRoundWithGuard(
  opts: {
    seats: any[];
    four2?: 'both'|'2singles'|'2pairs';
    delayMs?: number;
    seatMeta?: SeatSpec[];        // for rob-eval & bot-call/done
  },
  res: NextApiResponse,
  roundNo: number
): Promise<{ rotatedDelta: [number,number,number] | null }> {
  const MAX_EVENTS = 4000;
  const MAX_REPEATED_HEARTBEAT = 200;
  const iter: AsyncIterator<any> = (runOneGame as any)({ seats: opts.seats, four2: opts.four2, delayMs: opts.delayMs });

  let evCount = 0;
  let landlord = -1;
  let trick = 0;
  let lastSignature = '';
  let repeated = 0;
  let rotatedDelta: [number,number,number] | null = null;

  const rotateByLandlord = (ds: number[], L: number): [number,number,number] => {
    const a = (idx:number) => ds[(idx - L + 3) % 3] || 0;
    return [a(0), a(1), a(2)];
  };

  while (true) {
    const { value, done } = await (iter.next() as any);
    if (done) break;
    evCount++;

    writeLine(res, value);

    // rob-eval 注入：用于前端确认 provider / model
    if (value?.type === 'event' && value?.kind === 'rob' && typeof value?.seat === 'number') {
      const seat: number = value.seat | 0;
      const spec = (opts.seatMeta && opts.seatMeta[seat]) ? opts.seatMeta[seat] : undefined;
      writeLine(res, {
        type: 'event',
        kind: 'rob-eval',
        seat,
        score: value?.rob ? 1 : 0,   // 伪分数；如需真实可由引擎侧输出
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
      try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined); } catch {}

      const winner = landlord >= 0 ? landlord : 0;
      const dsRel = (winner === landlord) ? [+2, -1, -1] : [-2, +1, +1]; // 相对地主顺序
      const rot = rotateByLandlord(dsRel, Math.max(0, landlord));
      rotatedDelta = rot;

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
  const writeLineKA = (obj:any) => { try{ (res as any).write(JSON.stringify(obj)+'\n'); __lastWrite = Date.now(); }catch{} };
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

    // 构建 bot 列表与元信息
    const seatBots = (body.seats || []).slice(0,3).map((s) => asBot(s.choice, s));
    const seatMeta = (body.seats || []).slice(0,3);

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    // 服务端累计总分：仅用于“<0 停赛”；初始为 startScore
    let scores: [number,number,number] = [startScore, startScore, startScore];

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      // 包裹 seats：每家延时 + bot-call/done 埋点（含 reason）
      const delayedSeats = seatBots.map((bot, idx) => {
        const meta = seatMeta[idx];
        return async (ctx:any) => {
          const ms = delays[idx] || 0;
          if (ms) await new Promise(r => setTimeout(r, ms));

          const by = providerOf(meta?.choice);
          const model = meta?.model || '';
          const phase = ctx?.phase || (ctx?.require ? 'play' : undefined) || 'unknown';
          const need  = (ctx?.require && (ctx?.require.type || ctx?.require.kind)) || null;

          writeLine(res, { type:'event', kind:'bot-call', seat: idx, by, model, phase, need });
          const t0 = Date.now();
          const out = await bot(ctx);
          const tookMs = Date.now() - t0;

          const reason = extractReason(out);
          writeLine(res, { type:'event', kind:'bot-done', seat: idx, by, model, tookMs, ...(reason ? { reason } : {}) });

          return out;
        };
      });

      const { rotatedDelta } = await runOneRoundWithGuard({ seats: delayedSeats, four2, delayMs: 0, seatMeta }, res, round);

      // 服务端累计并判停
      if (rotatedDelta) {
        scores = [
          scores[0] + rotatedDelta[0],
          scores[1] + rotatedDelta[1],
          scores[2] + rotatedDelta[2],
        ];
      }

      if (stopBelowZero && (scores[0] < 0 || scores[1] < 0 || scores[2] < 0)) {
        writeLine(res, { type:'log', message:`某方积分 < 0，提前终止。当前总分（座位顺序）：${scores.join(' / ')}` });
        break;
      }

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try{ clearInterval(__ka as any);}catch{}; try{ (res as any).end(); }catch{}
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
    try{ clearInterval(__ka as any);}catch{}; try{ (res as any).end(); }catch{}
  }
}
