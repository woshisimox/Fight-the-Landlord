// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';
// 如无 DeepseekBot，可删除本行与 asBot 内对应分支
import { DeepseekBot } from '../../lib/bots/deepseek_bot';

/* =============== 小工具 =============== */
const clamp = (v:number, lo=0, hi=5)=> Math.max(lo, Math.min(hi, v));

function writeLine(res: NextApiResponse, obj: any) {
  (res as any).write(JSON.stringify(obj) + '\n');
}

/** 解析每座位思考超时（毫秒）
 * 支持：
 *  - body.turnTimeoutSecs / turnTimeoutSec  number | number[]
 *  - query: __tt / tt  'a,b,c' | number
 */
function parseTurnTimeoutMsArr(req: NextApiRequest): [number,number,number] {
  const fromQuery = (k:string) => {
    const v = (req.query as any)?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const body:any = (req as any).body || {};
  const secs = body.turnTimeoutSecs ?? body.turnTimeoutSec ?? body.__tt ?? body.tt;
  const clampMs = (x:number)=> Math.max(1000, Math.floor(Number(x||0)*1000));

  if (Array.isArray(secs) && secs.length) {
    const a = clampMs(secs[0] ?? 30);
    const b = clampMs(secs[1] ?? secs[0] ?? 30);
    const c = clampMs(secs[2] ?? secs[1] ?? secs[0] ?? 30);
    return [a,b,c];
  }
  if (typeof secs === 'number') {
    const ms = clampMs(secs);
    return [ms,ms,ms];
  }
  const raw = fromQuery('__tt') ?? fromQuery('tt') ?? fromQuery('turnTimeoutSec') ?? fromQuery('turnTimeoutSecs');
  if (typeof raw === 'string' && raw.trim()) {
    const parts = raw.split(/[\s,\/]+/).filter(Boolean).map(x=>clampMs(Number(x)));
    const a = parts[0] ?? 30000;
    const b = parts[1] ?? a;
    const c = parts[2] ?? b;
    return [a,b,c];
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = clampMs(raw as any);
    return [ms,ms,ms];
  }
  return [30000,30000,30000];
}

/* =============== 类型 =============== */
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

type SeatSpec = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  token?: string;
};

type RunBody = {
  rounds: number;
  four2?: 'both'|'2singles'|'2pairs';
  seats: SeatSpec[];
  seatDelayMs?: number[];
  startScore?: number;
  turnTimeoutSecs?: number[];  // [s0,s1,s2]
  turnTimeoutSec?: number | number[];
  debug?: any;
};

/* =============== Bot 工厂 =============== */
function providerLabel(choice: BotChoice) {
  switch (choice) {
    case 'built-in:greedy-max': return 'GreedyMax';
    case 'built-in:greedy-min': return 'GreedyMin';
    case 'built-in:random-legal': return 'RandomLegal';
    case 'ai:openai': return 'OpenAI';
    case 'ai:gemini': return 'Gemini';
    case 'ai:grok': return 'Grok';
    case 'ai:kimi': return 'Kimi';
    case 'ai:qwen': return 'Qwen';
    case 'ai:deepseek': return 'DeepSeek';
    case 'http': return 'HTTP';
  }
}

function asBot(choice: BotChoice, spec?: SeatSpec) {
  switch (choice) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai':  return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini':  return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-pro' });
    case 'ai:grok':    return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':    return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':    return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'ai:deepseek':return DeepseekBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'deepseek-chat' });
    case 'http':       return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:           return GreedyMax;
  }
}

function stringifyMove(m:any){
  if (!m || m.move==='pass') return 'pass';
  const type = m.type ? `${m.type} ` : '';
  const cards = Array.isArray(m.cards) ? m.cards.join('') : String(m.cards||'');
  return `${type}${cards}`;
}

/* =============== 包装：带超时与理由跟踪 =============== */
function traceWrap(
  choice: BotChoice,
  spec: SeatSpec|undefined,
  bot: (ctx:any)=>any,
  res: NextApiResponse,
  onReason: (seat:number, reason?:string)=>void,
  turnTimeoutMs: number,
  startDelayMs: number,
  seatIndex: number
){
  const label = providerLabel(choice);
  return async (ctx:any) => {
    // 可选起手延迟（节流）
    if (startDelayMs && startDelayMs>0) {
      await new Promise(r => setTimeout(r, Math.min(60_000, startDelayMs)));
    }

    // 调用事件（便于前端调试）
    try { writeLine(res, { type:'event', kind:'bot-call', seat: seatIndex, provider: label, phase: ctx?.phase || 'play' }); } catch {}

    const timeout = new Promise((resolve)=> {
      setTimeout(()=> resolve({ move:'pass', reason:`timeout@${Math.round(turnTimeoutMs/1000)}s` }), Math.max(1000, turnTimeoutMs));
    });

    let result:any;
    try {
      result = await Promise.race([ Promise.resolve(bot(ctx)), timeout ]);
    } catch (e:any) {
      result = { move:'pass', reason:`error:${e?.message||String(e)}` };
    }

    if (result && typeof result.reason === 'string') {
      onReason(seatIndex, result.reason);
    } else {
      onReason(seatIndex, undefined);
    }

    try { writeLine(res, { type:'event', kind:'bot-ret', seat: seatIndex, ok: true }); } catch {}

    return result;
  };
}

/* =============== 单局执行（NDJSON 输出 + 画像统计） =============== */
async function runOneRoundWithGuard(
  { seats, four2, lastReason }:
  { seats: ((ctx:any)=>Promise<any>)[]; four2: 'both'|'2singles'|'2pairs'; lastReason: (string|null)[] },
  res: NextApiResponse,
  round: number
){
  const iter = runOneGame({ seats, four2 } as any);
  let sentInit = false;

  // 画像统计
  let landlordIdx: number = -1;
  const stats = [0,1,2].map(()=>({
    plays: 0,
    passes: 0,
    cardsPlayed: 0,
    bombs: 0,
    rockets: 0
  }));

  for await (const ev of (iter as any)) {
    // 初始发牌/底牌/地主
    if (!sentInit && ev?.type==='init') {
      sentInit = true;
      landlordIdx = (ev.landlordIdx ?? ev.landlord ?? -1);
      writeLine(res, { type:'init', landlordIdx, bottom: ev.bottom, hands: ev.hands });
      continue;
    }

    // 每回合
    if (ev?.type==='turn') {
      const { seat, move, cards, hand, totals } = ev;

      // 画像累计
      const cc: string[] = Array.isArray(cards) ? cards : [];
      if (move === 'play') {
        stats[seat].plays++;
        stats[seat].cardsPlayed += cc.length;

        const isRocket = cc.length === 2 && cc.includes('x') && cc.includes('X');  // 王炸
        const isBomb   = !isRocket && cc.length === 4 && (new Set(cc)).size === 1; // 炸弹（粗判）
        if (isBomb)   stats[seat].bombs++;
        if (isRocket) stats[seat].rockets++;
      } else {
        stats[seat].passes++;
      }

      const moveStr = stringifyMove({ move, cards });
      const reason = lastReason[seat] || null;
      writeLine(res, { type:'turn', seat, move, cards, hand, moveStr, reason, totals });
      continue;
    }

    // 结果
    if (ev?.type==='result') {
      // —— 在 result 之前产出画像（同时两种形态，确保前端命中）——
      const perSeat = [0,1,2].map((i)=>{
        const s = stats[i];
        const total = Math.max(1, s.plays + s.passes);
        const passRate = s.passes / total;
        const avgCards = s.plays ? (s.cardsPlayed / s.plays) : 0;

        const agg   = clamp(1.5*s.bombs + 2.0*s.rockets + (1-passRate)*3 + Math.min(4, avgCards)*0.25);
        const cons  = clamp(3 + passRate*2 - (s.bombs + s.rockets)*0.6);
        let   eff   = clamp(2 + avgCards*0.6 - passRate*1.5);
        if ((ev as any).winner === i) eff = clamp(eff + 0.8);
        const coop  = clamp((i===landlordIdx ? 2.0 : 2.5) + passRate*2.5 - (s.bombs + s.rockets)*0.4);
        const rob   = clamp((i===landlordIdx ? 3.5 : 2.0) + 0.3*s.bombs + 0.6*s.rockets - passRate);

        return { seat: i, scaled: {
          coop: +coop.toFixed(2),
          agg : +agg.toFixed(2),
          cons: +cons.toFixed(2),
          eff : +eff.toFixed(2),
          rob : +rob.toFixed(2),
        }};
      });

      // 1) 顶层 stats（最稳）
      writeLine(res, { type:'stats', perSeat });

      // 2) event/ kind=stats（兼容另一分支）
      writeLine(res, { type:'event', kind:'stats', perSeat });

      // 再写 result（携带 lastReason）
      writeLine(res, { type:'result', ...(ev || {}), lastReason: [...lastReason] });
      break;
    }

    // 其它事件透传
    if (ev && ev.type && (ev.kind || ev.type!=='result')) {
      writeLine(res, ev);
    }
  }
}

/* =============== HTTP 处理 =============== */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // NDJSON headers
  try {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
  } catch {}

  // keep-alive，避免长连被中断
  const keepAlive = setInterval(() => { try { (res as any).write('\n'); } catch {} }, 15000);

  try {
    const body: RunBody = (req.method === 'POST' ? (req as any).body : {}) as any;
    const rounds = Math.max(1, Math.floor(Number(body.rounds || (req.query as any)?.rounds || 1)));
    const four2  = (body.four2 || (req.query as any)?.four2 || 'both') as 'both'|'2singles'|'2pairs';

    const turnTimeoutMsArr = parseTurnTimeoutMsArr(req);
    const seatSpecs = (body.seats || []).slice(0,3) as SeatSpec[];
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));
    const delays = ((body.seatDelayMs || []) as number[]);

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });

      const lastReason: (string|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };

      const wrapped = baseBots.map((bot, i) =>
        traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot as any, res, onReason,
                  turnTimeoutMsArr[i] ?? turnTimeoutMsArr[0],
                  Math.max(0, Math.floor(delays[i] ?? 0)),
                  i)
      );

      await runOneRoundWithGuard({ seats: wrapped as any, four2, lastReason }, res, round);

      writeLine(res, { type:'event', kind:'round-end', round });
      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{};
    try{ (res as any).end(); }catch{}
  }
}
