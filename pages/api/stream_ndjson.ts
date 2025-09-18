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
    case 'ai:grok':  return 'Grok';
    case 'ai:kimi':  return 'Kimi';
    case 'ai:qwen':  return 'Qwen';
    case 'ai:deepseek': return 'DeepSeek';
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

/** bot 包装：发 bot-call/bot-done，并缓存 reason 以贴到 play/pass */


/** 选择最小的一步合法出牌：优先最少张数；再按牌点从小到大 */
function pickMinimalPlay(ctx:any): any {
  try {
    const list = ctx?.candidates ?? ctx?.legalMoves ?? ctx?.legal ?? ctx?.moves;
    const hand = Array.isArray(ctx?.hand) ? ctx.hand : [];
    const normalize = (x:any) => {
      if (!x) return null;
      if (Array.isArray(x)) return { cards: x };
      if (Array.isArray(x.cards)) return { cards: x.cards, comboType: x.combo?.type || x.type || x.comboType };
      if (Array.isArray(x.move)) return { cards: x.move };
      return null;
    };
    const toKey = (cards:any[]) => {
      try {
        const rankOrder:any = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14,'2':16,'x':17,'X':18 };
        const vals = cards.map((c:any)=> typeof c==='number'? c : (rankOrder[String(c)] ?? 999));
        return [cards.length, Math.min(...vals), ...vals].join(',');
      } catch { return `${cards.length},999`; }
    };
    let candidates:any[] = Array.isArray(list) ? list.map(normalize).filter(Boolean) : [];
    if (!candidates.length && hand.length) {
      // 兜底：出手里最小的单牌
      const sorted = [...hand].sort((a:any,b:any)=> (a<b?-1:a>b?1:0));
      return { move:'play', cards:[sorted[0]] };
    }
    candidates.sort((a:any,b:any)=> (toKey(a.cards) < toKey(b.cards) ? -1 : 1));
    const pick = candidates[0];
    return { move:'play', cards: pick.cards, comboType: pick.comboType };
  } catch {
    return { move:'pass' };
  }
}
function traceWrap(choice: BotChoice, spec: SeatSpec|undefined, bot: (ctx:any)=>any, res: NextApiResponse,
  onReason: (seat:number, text?:string)=>void,
  timeoutMs?: number
) {
  const by = providerLabel(choice);
  const model = (spec?.model || '').trim();
  return async function traced(ctx:any) {
    try { writeLine(res, { type:'event', kind:'bot-call', seat: ctx?.seat ?? -1, by, model, phase: ctx?.phase || 'play', need: ctx?.require?.type || null }); } catch {}
    const t0 = Date.now();
    let out: any; let err: any = null;
    try {
      if (timeoutMs && timeoutMs > 0) {
        let timed = false as boolean;
        out = await Promise.race([
          Promise.resolve().then(()=>bot(ctx)),
          new Promise((resolve)=>setTimeout(()=>{ timed = true; resolve('__TIMEOUT__'); }, timeoutMs))
        ]);
        if (out === '__TIMEOUT__') {
          const mustPlay = !ctx?.require?.type; // 没有压制要求 => 首攻，必须出
          if (mustPlay) {
            out = pickMinimalPlay(ctx);
            try { (out as any).reason = '超时自动出最小牌'; } catch {}
          } else {
            out = { move:'pass', reason:'超时让牌' };
          }
        }
      } else {
        out = await bot(ctx);
      }
    } catch (e) { err = e; }
    const tookMs = Date.now() - t0;

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

    if (evCount > MAX_EVENTS || repeated > MAX_REPEATED_HEARTBEAT) {
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

  // track last action timestamp per seat for 'min interval between two moves'
  const lastActAt = [0,0,0];

    
  const turnTimeoutMs = Math.max(1000, Number((body as any).turnTimeoutSec) * 1000 || 30000);

  // Per-seat think-timeout (ms)
  const turnTimeoutMsArr = parseTurnTimeoutMsArr(req);
const seatSpecs = (body.seats || []).slice(0,3);
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });

      const lastReason: (string|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };

      const roundBots = baseBots.map((bot, i) => traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot, res, onReason, turnTimeoutMsArr[i]));

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