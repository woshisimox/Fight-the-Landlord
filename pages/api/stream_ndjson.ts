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
  seatKeys?: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string;
    httpBase?: string; httpToken?: string;
  }[];
  clientTraceId?: string;
  farmerCoop?: boolean;
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

/** 给 bot 加“调用/完成”追踪与理由生成 */
function traceWrap(choice: BotChoice, spec: SeatSpec|undefined, bot: (ctx:any)=>any) {
  const by = providerLabel(choice);
  const model = (spec?.model || '').trim();
  return async function traced(ctx:any) {
    try {
      ctx?.emit?.({ type:'event', kind:'bot-call', seat: ctx.seat, by, model, phase: ctx.phase || 'play', need: ctx.require?.type || null });
    } catch {}
    const t0 = Date.now();
    let res: any;
    let err: any = null;
    try {
      res = await bot(ctx);
    } catch (e) {
      err = e;
    }
    const tookMs = Date.now() - t0;

    // 合成简明理由（若 bot 没给 reason）
    let reason = res?.reason as (string|undefined);
    if (!reason) {
      const mv = res?.move;
      const need = ctx?.require?.type;
      const cards = Array.isArray(res?.cards) ? res.cards.join(' ') : '';
      if (mv === 'pass') {
        reason = need ? '无更优压牌，选择过' : '让牌/过牌';
      } else if (mv === 'play') {
        reason = need ? `跟出同型以压住（${need}）：${cards}` : `首攻选择：${cards}`;
      }
    }

    try {
      ctx?.emit?.({
        type:'event', kind:'bot-done', seat: ctx.seat, by, model,
        tookMs, reason, error: err ? String(err) : undefined
      });
    } catch {}
    if (err) throw err;
    return res;
  };
}

/** 单局执行 + 防卡死 + stats-lite（含协作度 v2）兜底 + bot 追踪 */
async function runOneRoundWithGuard(
  opts: { seats: any[], four2?: 'both'|'2singles'|'2pairs', delayMs?: number },
  res: NextApiResponse,
  roundNo: number
): Promise<{ seenWin:boolean; seenStats:boolean; landlord:number; eventCount:number }> {
  const MAX_EVENTS = 4000;
  const MAX_REPEATED_HEARTBEAT = 200;

  // —— 回放统计（含协作信号） ——
  type SeatRec = {
    pass:number; play:number; cards:number; bombs:number; rob:null|boolean;
    helpKeepLeadByPass:number;   // 队友领先且地主已过 -> 我过（让队友领）
    harmOvertakeMate:number;     // 队友领先且地主已过 -> 我还出（抢队友面）
    saveMateVsLandlord:number;   // 队友少牌而地主领先 -> 我压住地主
    saveWithBomb:number;         // 上一条用炸弹/火箭完成
  };
  const rec: SeatRec[] = [
    { pass:0, play:0, cards:0, bombs:0, rob:null, helpKeepLeadByPass:0, harmOvertakeMate:0, saveMateVsLandlord:0, saveWithBomb:0 },
    { pass:0, play:0, cards:0, bombs:0, rob:null, helpKeepLeadByPass:0, harmOvertakeMate:0, saveMateVsLandlord:0, saveWithBomb:0 },
    { pass:0, play:0, cards:0, bombs:0, rob:null, helpKeepLeadByPass:0, harmOvertakeMate:0, saveMateVsLandlord:0, saveWithBomb:0 },
  ];

  let evCount = 0;
  let trickNo = 0;
  let landlord = -1;
  let leaderSeat = -1;
  let currentWinnerSeat = -1;
  let passed = [false,false,false];

  // 近似剩余张数
  let rem = [17,17,17];
  const teammateOf = (s:number) => (landlord<0 || s===landlord) ? -1 : [0,1,2].filter(x=>x!==landlord && x!==s)[0];

  let lastSignature = '';
  let repeated = 0;
  let seenWin = false;
  let seenStats = false;

  const iter: AsyncIterator<any> = (runOneGame as any)({ seats: opts.seats, four2: opts.four2, delayMs: opts.delayMs });

  const emitStatsLite = (tag='stats-lite/coop-v2') => {
    const perSeatBasic = [0,1,2].map(i=>{
      const r = rec[i];
      const totalActs = r.pass + r.play || 1;
      const passRate  = r.pass / totalActs;
      const avgCards  = r.play ? (r.cards / r.play) : 0;
      const bombRate  = r.play ? (r.bombs / r.play) : 0;

      const cons = clamp(+((passRate) * 5).toFixed(2));
      const eff  = clamp(+((avgCards / 4) * 5).toFixed(2));
      const agg  = clamp(+(((0.6*bombRate) + 0.4*(avgCards/5)) * 5).toFixed(2));
      return { cons, eff, agg };
    });

    const coopPerSeat = [0,1,2].map(i=>{
      if (i === landlord) return 2.5; // 地主位中性
      const r = rec[i];
      const raw = (1.0 * r.helpKeepLeadByPass)
                + (2.0 * r.saveMateVsLandlord)
                + (0.5 * r.saveWithBomb)
                - (1.5 * r.harmOvertakeMate);
      const scale = 3 + trickNo * 0.30;
      const score = clamp(2.5 + (raw / scale) * 2.5);
      return +score.toFixed(2);
    });

    const perSeat = [0,1,2].map(i=>({
      seat:i,
      scaled: {
        coop: coopPerSeat[i],
        agg : perSeatBasic[i].agg,
        cons: perSeatBasic[i].cons,
        eff : perSeatBasic[i].eff,
        rob : (i===landlord) ? (rec[i].rob===false ? 1.5 : 5) : 2.5
      }
    }));

    writeLine(res, { type:'event', kind:'stats', source: tag, perSeat });
    seenStats = true;
  };

  while (true) {
    const { value, done } = await (iter.next() as any);
    if (done) break;
    evCount++;
    writeLine(res, value);

    const kind = value?.kind || value?.type;

    // —— 初始化/抢地主 —— //
    if (value?.kind === 'init' && typeof value?.landlord === 'number') {
      landlord = value.landlord;
      rem = [17,17,17]; if (landlord>=0) rem[landlord] = 20;
    }
    if (value?.kind === 'rob' && typeof value?.seat === 'number') {
      rec[value.seat].rob = !!value.rob;
    }

    // —— 轮次控制 —— //
    if (value?.kind === 'trick-reset') {
      trickNo++;
      leaderSeat = -1;
      currentWinnerSeat = -1;
      passed = [false,false,false];
    }

    // —— 出牌/过牌 —— //
    if (value?.kind === 'play' && typeof value?.seat === 'number') {
      const seat = value.seat as number;
      const move = value.move as ('play'|'pass');
      const ctype = value.comboType || value.combo?.type || value.require?.type || '';

      if (move === 'pass') {
        rec[seat].pass++;
        passed[seat] = true;

        // 协作：队友领先且地主已过 -> 我过（让队友领）
        if (landlord>=0 && seat!==landlord) {
          const mate = teammateOf(seat);
          if (mate>=0 && currentWinnerSeat === mate && passed[landlord]) {
            rec[seat].helpKeepLeadByPass++;
          }
        }
      } else {
        const n = Array.isArray(value.cards) ? value.cards.length : 1;
        rec[seat].play++;
        rec[seat].cards += n;
        if (ctype === 'bomb' || ctype === 'rocket') rec[seat].bombs++;

        if (landlord>=0 && seat!==landlord) {
          const mate = teammateOf(seat);
          const mateLow = (mate>=0) ? (rem[mate] <= 3) : false;

          // 队友领先且地主已过 -> 我还出（抢队友面）
          if (mate>=0 && currentWinnerSeat === mate && passed[landlord]) {
            rec[seat].harmOvertakeMate++;
          }

          // 地主领先且队友少牌 -> 我压住（保队友）
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

    if (kind === 'win')   seenWin   = true;
    if (kind === 'stats') seenStats = true;

    // —— 防卡死 —— //
    const sig = JSON.stringify({
      kind: value?.kind, seat: value?.seat, move: value?.move,
      require: value?.require?.type || value?.comboType || null,
      leader: value?.leader, trick: trickNo
    });
    if (sig === lastSignature) repeated++; else repeated = 0;
    lastSignature = sig;

    if (evCount > MAX_EVENTS || repeated > MAX_REPEATED_HEARTBEAT) {
      writeLine(res, { type:'log', message:`[防卡死] 触发安全阈值：${evCount} events, repeated=${repeated}。本局强制结束。`});
      if (!seenStats) emitStatsLite('stats-lite/coop-v2(safety)');
      try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined); } catch {}
      writeLine(res, { type:'event', kind:'round-end', round: roundNo, seenWin:false, seenStats:true });
      return { seenWin:false, seenStats:true, landlord, eventCount: evCount };
    }
  }

  if (!seenStats) emitStatsLite('stats-lite/coop-v2');
  writeLine(res, { type:'event', kind:'round-end', round: roundNo, seenWin, seenStats:true });

  return { seenWin, seenStats:true, landlord, eventCount: evCount };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // keep-alive
  let __lastWrite = Date.now();
  const writeKA = (obj:any)=>{ (res as any).write(JSON.stringify(obj)+'\n'); __lastWrite = Date.now(); };
  const __ka = setInterval(()=>{ try{
    if((res as any).writableEnded){ clearInterval(__ka as any); return; }
    if(Date.now()-__lastWrite>2500){ writeKA({ type:'ka', ts: new Date().toISOString() }); }
  }catch{} }, 2500);

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    // 原始 bot
    const baseBots = (body.seats || []).slice(0,3).map((s, i) => asBot(s.choice, s));
    // 包上 trace（保证 bot-call / bot-done）
    const seatBots = baseBots.map((bot, i) => traceWrap(body.seats[i]?.choice as BotChoice, body.seats[i], bot));

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });

      // per-seat 延迟（避免阻塞）
      const delayedSeats = seatBots.map((bot, idx) => async (ctx:any) => {
        const ms = delays[idx] || 0;
        if (ms) await new Promise(r => setTimeout(r, ms));
        return bot(ctx);
      });

      await runOneRoundWithGuard({ seats: delayedSeats, four2, delayMs: 0 }, res, round);

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try{ clearInterval(__ka as any);}catch{}; res.end();
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
    try { try{ clearInterval(__ka as any);}catch{}; res.end(); } catch {}
  }
}
