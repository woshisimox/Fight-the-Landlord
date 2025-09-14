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

type RobStrategy = 'hand' | 'ev-risk';

type SeatSpec = { choice: BotChoice; model?: string; apiKey?: string; baseUrl?: string; token?: string };

type PolicyHints = {
  lambda: number[]; // 每座位的风险权重
  mode: ('aggressive'|'neutral'|'conservative')[];
  roundsLeft: number;
  totals: [number,number,number];
};
type ScoreContext = {
  totals: [number,number,number];
  roundsLeft: number;
};

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
  robStrategy?: RobStrategy;
  policyHints?: PolicyHints;   // 前端可选传入
  scoreContext?: ScoreContext; // 前端可选传入
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

/* ---------- 轻量手牌/候选估算，丰富 strategy ---------- */
function rankScore(r:string){
  const map:any = { X:10, x:8, '2':7, A:6, K:5, Q:4, J:3, T:2 };
  return map[r] ?? 1;
}
function estimateHandEval(hand:any): number | undefined {
  try{
    if (!Array.isArray(hand) || hand.length===0) return undefined;
    const ranks = hand.map((c:any)=>{
      const s = String(c);
      if (s === 'x' || s === 'X' || s.startsWith('🃏')) return s === 'X' || s.endsWith('Y') ? 'X' : 'x';
      const core = /10/i.test(s) ? s.replace(/10/i,'T') : s;
      const r = core.match(/[23456789TJQKA]/i)?.[0]?.toUpperCase() ?? '';
      return r;
    });
    const total = ranks.reduce((acc,r)=>acc+rankScore(r),0);
    const max = hand.length * 10;
    return Math.round((total/max)*100)/100;
  }catch{return undefined;}
}
function inferCandidateCount(ctx:any): number | undefined {
  try{
    const cands = ctx?.candidates ?? ctx?.legalMoves ?? ctx?.legal ?? ctx?.moves;
    if (Array.isArray(cands)) return cands.length;
  }catch{}
  return undefined;
}

/* ====== 风险感知 & EV ====== */
function toWinProbFromEval(ev?: number) {
  // 把 handEval(0~1附近)平滑映射到胜率；没有评估时给个中性先验
  if (ev == null || Number.isNaN(ev)) return 0.52;
  const z = (ev - 0.5) / 0.18;
  const p = 0.55 + 0.10 * Math.tanh(z);
  return Math.min(0.85, Math.max(0.35, p));
}
function backendComputeRisk(myIdx:number, totals:[number,number,number], roundsLeft:number) {
  const me = totals[myIdx], leader = Math.max(...totals);
  const gap = leader - me;                               // >0 我落后
  const perRound = Math.max(1, Math.abs(gap)/Math.max(1,roundsLeft));
  const lambda0 = 0.30;
  const scale = Math.tanh(perRound / 3);
  const lambda = gap>0 ? lambda0*(1-0.7*scale) : lambda0*(1+0.7*scale);
  return { lambda, gap, perRound };
}
function shouldRobEV(args:{ stake:number; pLandlord:number; pOppLandlord:number; lambda:number }) {
  const { stake, pLandlord:pL, pOppLandlord:pLo, lambda } = args;
  const EV_L  = 2*stake*(2*pL - 1);
  const Var_L = (2*stake)**2 * pL*(1-pL);
  const EV_F  = stake*(1 - 2*pLo);
  const Var_F = (stake)**2 * pLo*(1-pLo);
  const U_L = EV_L - lambda*Var_L;
  const U_F = EV_F - lambda*Var_F;
  return U_L >= U_F;
}
function riskAwareRobOverride(
  seatIdx:number, ctx:any, out:any, hints?:PolicyHints, score?:ScoreContext
){
  try{
    // 避免覆盖“叫分制”的数值叫分
    if (out && (typeof out.score==='number' || typeof (out as any).bid === 'number' || typeof (out as any).call === 'number')) {
      return { out, applied:false, note:'' };
    }
    const totals = (score?.totals as [number,number,number]) ?? [0,0,0];
    const roundsLeft = score?.roundsLeft ?? 1;
    const lambda = hints?.lambda?.[seatIdx] ?? backendComputeRisk(seatIdx, totals, roundsLeft).lambda;
    const handEval = (typeof out?.handEval === 'number' ? out.handEval : estimateHandEval(ctx?.hand));
    const pL = toWinProbFromEval(handEval);
    const pOpp = 0.55;   // 基线：别人当地主的胜率
    const stake = 1;     // 抢地主阶段倍数未知，先用 1
    const rob2 = shouldRobEV({ stake, pLandlord:pL, pOppLandlord:pOpp, lambda });
    const prev = typeof out?.rob === 'boolean' ? out.rob : undefined;
    const changed = (prev === undefined) || (prev !== rob2);
    const reasonPatch = `[risk] pL=${pL.toFixed(2)} λ=${lambda.toFixed(2)} ⇒ ${rob2?'抢':'不抢'}`;
    const patched = { ...(out||{}), rob: rob2, reason: out?.reason ? `${out.reason}｜${reasonPatch}` : reasonPatch, policy: (out?.policy||'risk-aware'), risk: lambda };
    return { out: patched, applied: changed, note: reasonPatch };
  }catch{ return { out, applied:false, note:'' }; }
}

/** 统一“理由 & 策略”构造（bot 若不给 reason，这里合成） */
function buildReasonAndStrategy(choice: BotChoice, spec: SeatSpec|undefined, ctx:any, out:any) {
  const by = providerLabel(choice);
  const model = (spec?.model || '').trim();
  const role = (ctx?.seat != null && ctx?.landlord != null) ? (ctx.seat === ctx.landlord ? '地主' : '农民') : '';
  const requireType = ctx?.require?.type || null;
  const lead = !requireType;
  const cards = Array.isArray(out?.cards) ? out.cards : [];
  const combo = out?.comboType || out?.combo?.type || (lead ? out?.require?.type : ctx?.require?.type) || null;
  const usedBomb = combo === 'bomb' || combo === 'rocket';
  const handSize = Array.isArray(ctx?.hand) ? ctx.hand.length : undefined;

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
      reason = `${parts.join('，')}：${cards.join(' ')}`;
    }
  }

  const strategy:any = {
    provider: by, model, choice,
    role, lead, require: requireType, combo,
    cards, handSize, usedBomb,
    rule: out?.rule || out?.policy || undefined,
    heuristics: out?.heuristics || out?.weights || undefined,
    risk: typeof out?.risk === 'number' ? out.risk : undefined,
    candidateCount: (typeof out?.candidateCount === 'number' ? out.candidateCount : inferCandidateCount(ctx)),
    handEval: (typeof out?.handEval === 'number' ? out.handEval : estimateHandEval(ctx?.hand)),
    search: out?.search || out?.trace?.search || undefined,
    coopSignals: out?.coopSignals || undefined,
  };

  return { reason, strategy };
}

/** bot 包装：发 bot-call/bot-done，并在抢地主阶段按策略可选覆盖 */
function traceWrap(
  choice: BotChoice, spec: SeatSpec|undefined, bot: (ctx:any)=>any, res: NextApiResponse,
  onReason: (seat:number, text?:string)=>void,
  seatIndex: number,
  hints?: PolicyHints,
  score?: ScoreContext,
  robStrategy: RobStrategy = 'hand'
) {
  const by = providerLabel(choice);
  const model = (spec?.model || '').trim();
  return async function traced(ctx:any) {
    try { writeLine(res, { type:'event', kind:'bot-call', seat: ctx?.seat ?? -1, by, model, phase: ctx?.phase || 'play', need: ctx?.require?.type || null }); } catch {}
    const t0 = Date.now();
    let out: any; let err: any = null;
    try { out = await bot(ctx); } catch (e) { err = e; }
    const tookMs = Date.now() - t0;

    // —— 仅在“抢地主/叫地主”阶段，根据 robStrategy 进行覆盖 —— //
    try {
      if ((ctx?.phase === 'rob' || ctx?.phase === 'call' || ctx?.phase === 'bid') && robStrategy === 'ev-risk') {
        const patched = riskAwareRobOverride(seatIndex, ctx, out, hints, score);
        out = patched.out;
      }
    } catch {}

    const { reason, strategy } = buildReasonAndStrategy(choice, spec, ctx, out);
    onReason(ctx?.seat ?? -1, reason);

    try {
      writeLine(res, {
        type:'event', kind:'bot-done', seat: ctx?.seat ?? -1, by, model,
        tookMs, reason, strategy, error: err ? String(err) : undefined
      });
    } catch {}
    if (err) throw err;
    try { if (out && !out.reason) out.reason = reason; } catch {}
    return out;
  };
}

/** 单局执行：在 play/pass 上贴 reason；每局必产出 stats（含兜底 + final） */
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
  let emittedFinal = false;

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

  const emitFinalIfNeeded = () => {
    if (!emittedFinal) {
      emitStatsLite('stats-lite/coop-v3(final)');
      emittedFinal = true;
    }
  };

  while (true) {
    const { value, done } = await (iter.next() as any);
    if (done) break;
    evCount++;

    const kind = value?.kind || value?.type;

    // 在“转发”前，若是 play，则贴上最近一次 bot-done 的 reason
    if (kind === 'play' && typeof value?.seat === 'number' && Array.isArray(opts.lastReason)) {
      const s = value.seat as number;
      const reason = value?.reason || opts.lastReason[s];
      writeLine(res, reason ? { ...value, reason } : value);
      opts.lastReason[s] = null;
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

    // 收到 win 时，总是补一条 final 统计（避免漏发）
    if (kind === 'win') {
      seenWin = true;
      emitFinalIfNeeded();
    }

    // 防卡死
    const sig = JSON.stringify({
      kind: value?.kind, seat: value?.seat, move: value?.move,
      require: value?.require?.type || value?.comboType || null,
      leader: value?.leader, trick: trickNo
    });
    if (sig === lastSignature) repeated++; else repeated = 0;
    lastSignature = sig;

    if (evCount > 4000 || repeated > 200) {
      writeLine(res, { type:'log', message:`[防卡死] 触发安全阈值：${evCount} events, repeated=${repeated}。本局强制结束。`});
      emitFinalIfNeeded();
      try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined); } catch {}
      writeLine(res, { type:'event', kind:'round-end', round: roundNo, seenWin:false, seenStats:true });
      return { seenWin:false, seenStats:true, landlord, eventCount: evCount };
    }
  }

  emitFinalIfNeeded(); // 局尾兜底
  writeLine(res, { type:'event', kind:'round-end', round: roundNo, seenWin, seenStats:true });
  return { seenWin, seenStats:true, landlord, eventCount: 0 };
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

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const rounds = Math.max(1, Math.min(parseInt(process.env.MAX_ROUNDS || '200',10), Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    const seatSpecs = (body.seats || []).slice(0,3);
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));
    const policyHints = body.policyHints;
    const scoreContext = body.scoreContext;
    const robStrategy: RobStrategy = body.robStrategy || 'hand';

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}，rob=${body.rob?'on':'off'}，robStrategy=${robStrategy}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });

      const lastReason: (string|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };

      const roundBots = baseBots.map((bot, i) =>
        traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot, res, onReason, i, policyHints, scoreContext, robStrategy)
      );

      const delayedSeats = roundBots.map((bot, idx) => async (ctx:any) => {
        const ms = delays[idx] || 0; if (ms) await new Promise(r => setTimeout(r, ms));
        return bot(ctx);
      });

      await runOneRoundWithGuard({ seats: delayedSeats, four2, delayMs: 0, lastReason }, res, round);

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{};
    try{ (res as any).end(); }catch{}
  }
}
