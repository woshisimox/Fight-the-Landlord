// pages/api/stream_ndjson.ts
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
  clientTraceId?: string;
  farmerCoop?: boolean;                  // ★ 新增：农民配合
};

function writeLine(res: NextApiResponse, obj: any) {
  try { (res as any).write(JSON.stringify(obj) + '\n'); } catch {}
}

function providerOf(choice?: BotChoice): string {
  if (!choice) return 'unknown';
  if (choice.startsWith('ai:')) return choice.split(':')[1];
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
    r = String(r).replace(/\s+/g, ' ').trim();
    const MAX = 400;
    if (r.length > MAX) r = r.slice(0, MAX) + '…';
    return r;
  } catch { return undefined; }
}

// 将 built-in 策略的动作，转成一句可读理由
function labelOf(choice: BotChoice) {
  switch (choice) {
    case 'built-in:greedy-max': return 'GreedyMax';
    case 'built-in:greedy-min': return 'GreedyMin';
    case 'built-in:random-legal': return 'RandomLegal';
    default: return 'built-in';
  }
}
function makeBuiltInReason(choice: BotChoice, ctx: any, out: any): string {
  const strat = labelOf(choice);
  const need  = ctx?.require?.type || ctx?.require?.kind || null;
  const isPass =
    out === 'pass' || out?.move === 'pass' || out?.type === 'pass';

  const cards =
    Array.isArray(out?.cards) ? out.cards :
    Array.isArray(out) ? out : null;

  const cnt = Array.isArray(cards) ? cards.length : 0;

  const seat = (typeof ctx?.seat === 'number') ? ctx.seat : undefined;
  const handSize =
    (Array.isArray(ctx?.hand) && ctx.hand.length) ||
    (Array.isArray(ctx?.hands) && typeof seat === 'number' && Array.isArray(ctx.hands[seat]) && ctx.hands[seat].length) ||
    undefined;

  const bias =
    choice === 'built-in:greedy-max' ? '倾向出大牌' :
    choice === 'built-in:greedy-min' ? '倾向出小牌' :
    '随机合法';

  if (isPass) {
    return `内置:${strat}｜${need ? `无法压牌(${need})` : '策略选择过'}｜${bias}${handSize!=null?`｜余牌${handSize}`:''}`;
  } else {
    const mode = need ? '跟牌' : '主动出牌';
    return `内置:${strat}｜${mode}｜${cnt?`${cnt}张`:''}${handSize!=null?`｜余牌${handSize}`:''}｜${bias}`;
  }
}

/* === 协作判断 & 包装 === */
function landlordFromCtx(ctx:any): number | null {
  return (typeof ctx?.landlord === 'number') ? ctx.landlord
    : (typeof ctx?.state?.landlord === 'number') ? ctx.state.landlord
    : (typeof ctx?.init?.landlord === 'number') ? ctx.init.landlord
    : null;
}
function leaderFromCtx(ctx:any): number | null {
  return (typeof ctx?.leader === 'number') ? ctx.leader
    : (typeof ctx?.require?.leader === 'number') ? ctx.require.leader
    : null;
}
function handCountsFromCtx(ctx:any): number[] | null {
  try {
    if (Array.isArray(ctx?.hands) && Array.isArray(ctx.hands[0])) {
      return ctx.hands.map((h:any)=>Array.isArray(h)?h.length:0);
    }
  } catch {}
  return null;
}
function isPassMove(out:any):boolean {
  return out === 'pass' || out?.move === 'pass' || out?.type === 'pass';
}
function coopJoin(base?:string, coopNote?:string): string | undefined {
  if (base && coopNote) return `${base}｜协作：${coopNote}`;
  if (coopNote) return `协作：${coopNote}`;
  return base;
}

/** 给任意 bot 包一层“农民配合” + 理由拼接；必要时覆盖为 pass */
function wrapWithFarmerCoop(bot:(ctx:any)=>any|Promise<any>, choice: BotChoice, enabled:boolean) {
  return async (ctx:any) => {
    const seat = (typeof ctx?.seat === 'number') ? ctx.seat : null;
    const L = landlordFromCtx(ctx);
    const counts = handCountsFromCtx(ctx);
    const leader = leaderFromCtx(ctx);
    const isFollowing = !!ctx?.require;
    const isFarmer = (seat!=null && L!=null) ? (seat !== L) : false;
    const teammate = (seat!=null && L!=null)
      ? [0,1,2].find(s => s !== seat && s !== L)!
      : null;

    // 给 LLM 传辅助上下文（不影响内置策略）
    const coopHints = {
      enabled,
      role: (seat!=null && L!=null) ? (seat === L ? 'landlord' : 'farmer') : 'unknown',
      teammateSeat: teammate,
      landlordSeat: L,
      leaderSeat: leader,
      isFollowing,
      counts, // [甲,乙,丙] 余牌
      guideline: '若为农民且队友领先，通常不过牌以保队友节奏；但地主余牌≤2时优先防止放跑。'
    };
    const ctx2 = { ...ctx, coop: coopHints };

    let out = await bot(ctx2);

    // 生成原始理由
    let baseReason = extractReason(out);
    if (!baseReason && choice.startsWith('built-in')) {
      try { baseReason = makeBuiltInReason(choice, ctx, out); } catch {}
    }

    // 协作覆盖：农民 & 跟牌 & 队友领先 → pass（除非地主≤2）
    let coopNote: string | undefined;
    if (enabled && isFarmer && isFollowing && teammate!=null && leader === teammate) {
      const landlordCount = (L!=null && counts && typeof counts[L] === 'number') ? counts[L] : undefined;
      if (landlordCount != null && landlordCount <= 2) {
        coopNote = `队友领先但地主余牌≤2，避免放跑，保持原策略`;
      } else {
        if (!isPassMove(out)) {
          out = { move:'pass' }; // 覆盖为过牌
          coopNote = `队友领先，选择“过牌”以协作保顺（覆盖原动作）`;
        } else {
          coopNote = `队友领先，选择过牌协作`;
        }
      }
    } else if (enabled && isFarmer && isFollowing && leader === L) {
      coopNote = `地主领先，优先考虑压牌（保持原策略）`;
    } else if (enabled && isFarmer && !isFollowing) {
      const tc = (teammate!=null && counts) ? counts[teammate] : undefined;
      if (tc != null && tc <= 2) {
        coopNote = `队友余牌≤2，考虑出小牌喂队友（保持原策略）`;
      }
    }

    // 将协作说明合并进 bot-done 的 reason（而不是把字段塞进 out 主体，避免引擎敏感）
    (out as any).__farmerCoopReason__ = coopJoin(baseReason, coopNote);
    return out;
  };
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

    // rob-eval 注入（用于确认 provider / model）
    if (value?.type === 'event' && value?.kind === 'rob' && typeof value?.seat === 'number') {
      const seat: number = value.seat | 0;
      const spec = (opts.seatMeta && opts.seatMeta[seat]) ? opts.seatMeta[seat] : undefined;
      writeLine(res, {
        type: 'event',
        kind: 'rob-eval',
        seat,
        score: value?.rob ? 1 : 0,
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

    // 记录 win 的 rotatedDelta
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
      const dsRel = (winner === landlord) ? [+2, -1, -1] : [-2, +1, +1];
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
    const stopBelowZero = body.stopBelowZero ?? true;
    const farmerCoop = body.farmerCoop ?? true; // ★ 默认开启

    // 构建 bot 列表与元信息
    const seatBots = (body.seats || []).slice(0,3).map((s) => asBot(s.choice, s));
    const seatMeta  = (body.seats || []).slice(0,3);

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}，coop=${farmerCoop?'on':'off'}）…` });

    // 服务端累计总分（仅用于“<0 停赛”）
    let scores: [number,number,number] = [startScore, startScore, startScore];

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      // 包裹 seats：每家延时 + 农民协作包装 + bot-call/done 埋点
      const delayedSeats = seatBots.map((rawBot, idx) => {
        const meta = seatMeta[idx];
        const bot = wrapWithFarmerCoop(rawBot, meta.choice, farmerCoop); // ★ 协作包装
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

          // 从 out 或内置推导得到“基础理由”，并合并协作说明
          let reason = extractReason(out);
          if (!reason && meta?.choice && meta.choice.startsWith('built-in')) {
            try { reason = makeBuiltInReason(meta.choice as BotChoice, ctx, out); } catch {}
          }
          if (!reason && typeof (out as any).__farmerCoopReason__ === 'string') {
            reason = (out as any).__farmerCoopReason__;
          } else if (typeof (out as any).__farmerCoopReason__ === 'string') {
            reason = (out as any).__farmerCoopReason__;
          }

          writeLine(res, { type:'event', kind:'bot-done', seat: idx, by, model, tookMs, ...(reason ? { reason } : {}) });
          return out;
        };
      });

      const { rotatedDelta } = await runOneRoundWithGuard(
        { seats: delayedSeats, four2, delayMs: 0, seatMeta },
        res,
        round
      );

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
