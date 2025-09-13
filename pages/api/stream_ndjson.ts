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

type SeatSpec = { choice: BotChoice; model?: string; apiKey?: string; baseUrl?: string; token?: string };

type StartPayload = {
  seats: SeatSpec[];
  seatDelayMs?: number[];
  rounds?: number;
  rob?: boolean;
  four2?: 'both' | '2singles' | '2pairs';
  stopBelowZero?: boolean;
  seatModels?: string[];
  seatKeys?: { openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; httpBase?: string; httpToken?: string; }[];
  clientTraceId?: string;
  farmerCoop?: boolean;
};

const clamp = (v:number, lo=0, hi=5)=> Math.max(lo, Math.min(hi, v));
const seatName = (i:number)=>['甲','乙','丙'][i] || String(i);

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
    case 'ai:grok':  return 'Grok';
    case 'ai:kimi':  return 'Kimi';
    case 'ai:qwen':  return 'Qwen';
    case 'http':     return 'HTTP';
  }
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

/** 生成更完整的人类可读“理由” & 结构化“策略”，适用于内置和 AI */
function buildReasonAndStrategy(choice: BotChoice, spec: SeatSpec|undefined, ctx:any, out:any) {
  const by = providerLabel(choice);
  const model = (spec?.model || '').trim();
  const role = (ctx?.seat != null && ctx?.landlord != null) ? (ctx.seat === ctx.landlord ? '地主' : '农民') : '';
  const requireType = ctx?.require?.type || null;
  const lead = !requireType; // 没有跟牌需求 => 首攻
  const cards = Array.isArray(out?.cards) ? out.cards : [];
  const combo = out?.comboType || out?.combo?.type || (lead ? out?.require?.type : ctx?.require?.type) || null;
  const cardsStr = cards.join(' ');
  const usedBomb = combo === 'bomb' || combo === 'rocket';
  const handSize = Array.isArray(ctx?.hand) ? ctx.hand.length : undefined;

  // 基于策略名称给一个“高层策略标签”
  let policy: string;
  if (choice === 'built-in:greedy-max') policy = 'GreedyMax（优先带走更多牌/长连/大牌力）';
  else if (choice === 'built-in:greedy-min') policy = 'GreedyMin（用最小可行解应对）';
  else if (choice === 'built-in:random-legal') policy = 'RandomLegal（随机合法走法）';
  else policy = 'LLM（语言模型策略）';

  // 文本理由
  let reason = out?.reason as (string|undefined);
  if (!reason) {
    if (out?.move === 'pass') {
      reason = requireType ? '无更优压牌，选择过（让牌）' : '保守过牌';
    } else if (out?.move === 'play') {
      const parts: string[] = [];
      parts.push(lead ? '首攻' : `跟牌（${requireType}）`);
      parts.push(`出型：${combo ?? '—'}`);
      if (usedBomb) parts.push('争夺/巩固先手');
      if (choice === 'built-in:greedy-max') parts.push('带走更多牌');
      if (choice === 'built-in:greedy-min') parts.push('尽量少出牌应对');
      reason = `${parts.join('，')}：${cardsStr}`;
    }
  }

  const strategy = {
    provider: by, model, choice,
    role, lead, require: requireType, combo,
    cards, handSize,
    factors: { usedBomb }
  };

  return { reason, strategy };
}

/** bot 包装：发 bot-call / bot-done，并通过 onReason 回传“理由”，用于给 play 贴上 */
function traceWrap(
  choice: BotChoice, spec: SeatSpec|undefined, bot: (ctx:any)=>any, res: NextApiResponse,
  onReason: (seat:number, text?:string, strategy?:any)=>void
) {
  const by = providerLabel(choice);
  const model = (spec?.model || '').trim();
  return async function traced(ctx:any) {
    try {
      writeLine(res, { type:'event', kind:'bot-call', seat: ctx?.seat ?? -1, by, model, phase: ctx?.phase || 'play', need: ctx?.require?.type || null });
    } catch {}
    const t0 = Date.now();
    let out: any;
    let err: any = null;
    try {
      out = await bot(ctx);
    } catch (e) {
      err = e;
    }
    const tookMs = Date.now() - t0;

    // 生成理由 & 策略（即使 bot 没给 reason，我也给）
    const { reason, strategy } = buildReasonAndStrategy(choice, spec, ctx, out);
    onReason(ctx?.seat ?? -1, reason, strategy);

    try {
      writeLine(res, {
        type:'event', kind:'bot-done', seat: ctx?.seat ?? -1, by, model,
        tookMs, reason, strategy, error: err ? String(err) : undefined
      });
    } catch {}
    if (err) throw err;
    // 也把 reason 写回返回值，若引擎透传，我们就能直接跟随 play 事件
    try { if (out && !out.reason) out.reason = reason; } catch {}
    return out;
  };
}

/** 单局执行（含卡死保护 + Coop v3 画像兜底 + 在 play 事件上附加 reason） */
async function runOneRoundWithGuard(
  opts: { seats: any[], four2?: 'both'|'2singles'|'2pairs', delayMs?: number, lastReason?: (string|null)[] },
  res: NextApiResponse,
  roundNo: number
): Promise<{ seenWin:boolean; seenStats:boolean; landlord:number; eventCount:number }> {
  const MAX_EVENTS = 4000;
  const MAX_REPEATED_HEARTBEAT = 200;

  type SeatRec = {
    pass:number; play:number; cards:number; bombs:number; rob:null|boolean;
    helpKeepLeadByPass:number; harmOvertakeMate:number; saveMateVsLandlord:number; saveWithBomb:number;
  };
  const rec: SeatRec[] = [
    { pass:0, play:0, cards:0, bombs:0, rob:null, helpKeepLeadByPass:0, harmOvertakeMate:0, saveMateVsLandlord:0, saveWithBomb:0 },
    { pass:0, play:0, cards:0, bombs:0, rob:null, helpKeepLeadByPass:0, harmOvertakeMate:0, saveMateVsLandlord:0, saveWithBomb:0 },
    { pass:0, play:0, cards:0, bombs:0, rob:null, helpKeepLeadByPass:0, harmOvertakeMate:0, saveMateVsLandlord:0, saveWithBomb:0 },
  ];

  let evCount = 0, trickNo = 0;
  let landlord = -1;
  let leaderSeat = -1;
  let currentWinnerSeat = -1;
  let passed = [false,false,false];

  let rem = [17,17,17];
  const teammateOf = (s:number) => (landlord<0 || s===landlord) ? -1 : [0,1,2].filter(x=>x!==landlord && x!==s)[0];

  let lastSignature = '';
  let repeated = 0;
  let seenWin = false;
  let seenStats = false;

  const iter: AsyncIterator<any> = (runOneGame as any)({ seats: opts.seats, four2: opts.four2, delayMs: opts.delayMs });

  const emitStatsLite = (tag='stats-lite/coop-v3') => {
    const basic = [0,1,2].map(i=>{
      const r = rec[i];
      const total = r.pass + r.play || 1;
      const passRate  = r.pass / total;
      const avgCards  = r.play ? (r.cards / r.play) : 0;
      const bombRate  = r.play ? (r.bombs / r.play) : 0;
      const cons = clamp(+((passRate) * 5).toFixed(2));
      const eff  = clamp(+((avgCards / 4) * 5).toFixed(2));
      const agg  = clamp(+(((0.6*bombRate) + 0.4*(avgCards/5)) * 5).toFixed(2));
      return { cons, eff, agg };
    });

    const coopPerSeat = [0,1,2].map(i=>{
      if (i === landlord) return 2.5;
      const r = rec[i];
      const raw = (1.0 * r.helpKeepLeadByPass) + (2.0 * r.saveMateVsLandlord) + (0.5 * r.saveWithBomb) - (1.5 * r.harmOvertakeMate);
      const scale = 3 + trickNo * 0.30;
      return +clamp(2.5 + (raw / scale) * 2.5).toFixed(2);
    });

    const perSeat = [0,1,2].map(i=>({
      seat:i,
      scaled: { coop: coopPerSeat[i], agg: basic[i].agg, cons: basic[i].cons, eff: basic[i].eff, rob: (i===landlord) ? (rec[i].rob===false ? 1.5 : 5) : 2.5 }
    }));

    writeLine(res, { type:'event', kind:'stats', round: roundNo, landlord, source: tag, perSeat });
    seenStats = true;
  };

  while (true) {
    const { value, done } = await (iter.next() as any);
    if (done) break;
    evCount++;

    const kind = value?.kind || value?.type;

    // 在“转发”前，若是 play 事件，就把“上一条 bot-done 缓存的理由”贴上
    if (kind === 'play' && typeof value?.seat === 'number' && Array.isArray(opts.lastReason)) {
      const s = value.seat as number;
      const reason = value?.reason || opts.lastReason[s];
      if (reason) {
        writeLine(res, { ...value, reason });
        opts.lastReason[s] = null;
      } else {
        writeLine(res, value);
      }
    } else {
      writeLine(res, value);
    }

    // 统计钩子
    if (value?.kind === 'init' && typeof value?.landlord === 'number') {
      landlord = value.landlord;
      rem = [17,17,17]; if (landlord>=0) rem[landlord] = 20;
    }
    if (value?.kind === 'rob' && typeof value?.seat === 'number') rec[value.seat].rob = !!value.rob;

    if (value?.kind === 'trick-reset') {
      trickNo++; leaderSeat = -1; currentWinnerSeat = -1; passed = [false,false,false];
    }

    if (value?.kind === 'play' && typeof value?.seat === 'number') {
      const seat = value.seat as number;
      const move = value.move as ('play'|'pass');
      const ctype = value.comboType || value.combo?.type || value.require?.type || '';
      if (move === 'pass') {
        rec[seat].pass++; passed[seat] = true;
        if (landlord>=0 && seat!==landlord) {
          const mate = teammateOf(seat);
          if (mate>=0 && currentWinnerSeat === mate && passed[landlord]) rec[seat].helpKeepLeadByPass++;
        }
      } else {
        const n = Array.isArray(value.cards) ? value.cards.length : 1;
        rec[seat].play++; rec[seat].cards += n;
        if (ctype === 'bomb' || ctype === 'rocket') rec[seat].bombs++;
        if (landlord>=0 && seat!==landlord) {
          const mate = teammateOf(seat);
          const mateLow = (mate>=0) ? (rem[mate] <= 3) : false;
          if (mate>=0 && currentWinnerSeat === mate && passed[landlord]) rec[seat].harmOvertakeMate++;
          if (currentWinnerSeat === landlord && mateLow) {
            rec[seat].saveMateVsLandlord++;
            if (ctype === 'bomb' || ctype === 'rocket') rec[seat].saveWithBomb++;
          }
        }
        if (leaderSeat === -1) leaderSeat = seat;
        currentWinnerSeat = seat;
        rem[seat] = Math.max(0, rem[seat] - n);
      }
    }

    if (kind === 'stats') seenStats = true;

    if (kind === 'win' && !seenStats) emitStatsLite('stats-lite/coop-v3(before-win)');
    if (kind === 'win') seenWin = true;

    // 防卡死
    const sig = JSON.stringify({
      kind: value?.kind, seat: value?.seat, move: value?.move,
      require: value?.require?.type || value?.comboType || null,
      leader: value?.leader, trick: trickNo
    });
    if (sig === lastSignature) repeated++; else repeated = 0;
    lastSignature = sig;

    if (evCount > MAX_EVENTS || repeated > MAX_REPEATED_HEARTBEAT) {
      writeLine(res, { type:'log', message:`[防卡死] 触发安全阈值：${evCount} events, repeated=${repeated}。本局强制结束。`});
      if (!seenStats) emitStatsLite('stats-lite/coop-v3(safety)');
      try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined); } catch {}
      writeLine(res, { type:'event', kind:'round-end', round: roundNo, seenWin:false, seenStats:true });
      return { seenWin:false, seenStats:true, landlord, eventCount: evCount };
    }
  }

  if (!seenStats) emitStatsLite('stats-lite/coop-v3(end)');
  writeLine(res, { type:'event', kind:'round-end', round: roundNo, seenWin, seenStats:true });
  return { seenWin, seenStats:true, landlord, eventCount: evCount };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let __lastWrite = Date.now();
  const keepAlive = setInterval(()=>{ try{
    if((res as any).writableEnded){ clearInterval(keepAlive as any); return; }
    if(Date.now()-__lastWrite>2500){ writeLine(res, { type:'ka', ts: new Date().toISOString() }); __lastWrite = Date.now(); }
  }catch{} }, 2500);
  const _write = (o:any)=>{ writeLine(res, o); __lastWrite = Date.now(); };

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const rounds = Math.max(1, Math.min(parseInt(process.env.MAX_ROUNDS || '200',10), Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    const seatSpecs = (body.seats || []).slice(0,3);
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));

    _write({ type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      _write({ type:'log', message:`—— 第 ${round} 局开始 ——` });
      _write({ type:'event', kind:'round-start', round });

      // 每局重置“理由缓存”
      const lastReason: (string|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };

      // 为“本局”包一层 trace（带 onReason 回调）
      const roundBots = baseBots.map((bot, i) => traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot, res, onReason));

      // per-seat 延迟
      const delayedSeats = roundBots.map((bot, idx) => async (ctx:any) => {
        const ms = delays[idx] || 0; if (ms) await new Promise(r => setTimeout(r, ms));
        return bot(ctx);
      });

      await runOneRoundWithGuard({ seats: delayedSeats, four2, delayMs: 0, lastReason }, res, round);

      if (round < rounds) _write({ type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    _write({ type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{}; try{ (res as any).end(); }catch{}
  }
}
