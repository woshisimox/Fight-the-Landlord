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

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

type SeatSpec = { choice: BotChoice; model?: string; apiKey?: string; baseUrl?: string; token?: string };

/** 客户端请求体（支持按座位数组或单值） */
type StartPayload = {
  seats: SeatSpec[];
  /** 每家最小间隔（ms），可为单值或三元素数组 */
  seatDelayMs?: number | number[];
  /** 每家“思考上限/弃牌时间”（秒），可为单值或三元素数组 */
  turnTimeoutSec?: number | number[];
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

/** 简单的 provider 标签 */
function providerLabel(choice: BotChoice): string {
  if (choice.startsWith('built-in')) return 'built-in';
  if (choice === 'http') return 'http';
  return choice.replace('ai:', '');
}

/** NDJSON 输出 */
function writeLine(res: NextApiResponse, obj: any) {
  try {
    res.write(`${JSON.stringify(obj)}\n`);
  } catch {}
}

/** 生成简单的 reason/strategy（可按需丰富） */
function buildReasonAndStrategy(choice: BotChoice, spec: SeatSpec | undefined, ctx: any, out: any) {
  let reason = '';
  let strategy = '';
  if (out?.reason) reason = String(out.reason);
  if (!reason) {
    if (out?.move === 'pass') reason = '让牌/过';
    else if (Array.isArray(out?.cards)) reason = `出牌${out.cards.length}张`;
    else reason = '出牌';
  }
  strategy = `${providerLabel(choice)}:${(spec?.model || '').trim() || 'default'}`;
  return { reason, strategy };
}
/** 选择最小的一步合法出牌：优先最少张数；再按牌点从小到大；拿不到候选则出最小单张 */
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

/** 将 SeatSpec 转换为可调用的 bot 函数 (ctx)=>Promise<Move> */
function asBot(choice: BotChoice, spec?: SeatSpec) {
  if (choice === 'built-in:greedy-max') {
    const impl = new GreedyMax();
    return async (ctx:any)=> impl.play(ctx);
  }
  if (choice === 'built-in:greedy-min') {
    const impl = new GreedyMin();
    return async (ctx:any)=> impl.play(ctx);
  }
  if (choice === 'built-in:random-legal') {
    const impl = new RandomLegal();
    return async (ctx:any)=> impl.play(ctx);
  }

  if (choice === 'ai:openai') {
    const bot = new OpenAIBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx:any)=> bot.play(ctx);
  }
  if (choice === 'ai:gemini') {
    const bot = new GeminiBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx:any)=> bot.play(ctx);
  }
  if (choice === 'ai:grok') {
    const bot = new GrokBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx:any)=> bot.play(ctx);
  }
  if (choice === 'ai:kimi') {
    const bot = new KimiBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx:any)=> bot.play(ctx);
  }
  if (choice === 'ai:qwen') {
    const bot = new QwenBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx:any)=> bot.play(ctx);
  }
  if (choice === 'ai:deepseek') {
    const bot = new DeepseekBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx:any)=> bot.play(ctx);
  }
  if (choice === 'http') {
    const bot = new HttpBot({ baseUrl: spec?.baseUrl, token: spec?.token, model: spec?.model });
    return async (ctx:any)=> bot.play(ctx);
  }
  // 兜底
  const impl = new RandomLegal();
  return async (ctx:any)=> impl.play(ctx);
}
/** bot 包装：发 bot-call/bot-done；调用前先等待“最小间隔”（期间发 hb），调用后用“思考上限”做兜底（过/最小牌） */
function traceWrap(
  choice: BotChoice, spec: SeatSpec|undefined, bot: (ctx:any)=>any, res: NextApiResponse,
  onReason: (seat:number, text?:string)=>void,
  timeoutMs?: number,           // 每家的思考超时（ms）
  minIntervalMs?: number        // 每家的最小间隔（ms）
) {
  const by = providerLabel(choice);
  const model = (spec?.model || '').trim();

  // 记录“上次真正调用该家 bot 的时间”，用于最小间隔
  let __lastCallAt = 0;
  const __sleep = (ms:number)=> new Promise(r=>setTimeout(r, ms));

  return async function traced(ctx:any) {
    try {
      writeLine(res, { type:'event', kind:'bot-call', seat: ctx?.seat ?? -1, by, model, phase: ctx?.phase || 'play', need: ctx?.require?.type || null });
    } catch {}

    // 1) 先等待达到“最小间隔”（这段时间内持续发 hb，避免前端误判卡住）
    if (minIntervalMs && minIntervalMs > 0) {
      const now = Date.now();
      const since = now - __lastCallAt;
      const need = Math.max(0, minIntervalMs - since);
      if (need > 0) {
        let remain = need;
        while (remain > 0) {
          const tick = Math.min(1000, remain);
          try { writeLine(res, { type:'hb', seat: ctx?.seat, reason:'min-interval', remainMs: remain }); } catch {}
          await __sleep(tick);
          remain -= tick;
        }
      }
    }

    // 2) 真正开始“思考上限”计时（只覆盖 bot 的思考，不包含上面的等待）
    const t0 = Date.now();
    let out: any; let err: any = null;
    try {
      if (timeoutMs && timeoutMs > 0) {
        let timed = false;
        out = await Promise.race([
          Promise.resolve().then(()=>bot(ctx)),
          new Promise((resolve)=>setTimeout(()=>{ timed = true; resolve('__TIMEOUT__'); }, timeoutMs))
        ]);
        if (out === '__TIMEOUT__') {
          // 跟牌可“过”；必须首攻（无 require.type）则出最小合法牌
          const mustPlay = !ctx?.require?.type;
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
    } catch (e) {
      err = e;
    }
    const tookMs = Date.now() - t0;

    // 3) 生成 reason/strategy，并发 bot-done
    const { reason, strategy } = buildReasonAndStrategy(choice, spec, ctx, out);
    onReason(ctx?.seat ?? -1, reason);

    try {
      writeLine(res, {
        type:'event', kind:'bot-done', seat: ctx?.seat ?? -1, by, model,
        tookMs, reason, strategy, error: err ? String(err) : undefined
      });
    } catch {}

    // 4) 记录“本次真正调用时间”，作为下次最小间隔的起点
    __lastCallAt = Date.now();

    if (err) throw err;
    try { if (out && !out.reason) out.reason = reason; } catch {}
    return out;
  };
}
/** 一局对战的护栏封装：把 engine 的事件转成 NDJSON 写出（根据你现有 engine 适配即可） */
async function runOneRoundWithGuard(
  opts: { seats: Array<(ctx:any)=>Promise<any>>; four2?: 'both'|'2singles'|'2pairs'; delayMs?: number; lastReason: any[]; rob?: boolean; },
  res: NextApiResponse,
  round: number
) {
  // 这里根据你的 engine，适配事件钩子（以下是通用写法示意）
  await runOneGame({
    seats: opts.seats,
    four2: opts.four2 || 'both',
    rob: opts.rob ?? false,
    onEvent: (ev: any) => {
      // 将引擎事件直接透传/加工
      if (ev?.kind) {
        writeLine(res, { type:'event', ...ev });
      } else {
        writeLine(res, { type:'event', value: ev });
      }
    },
    onInit: (info: any) => {
      writeLine(res, { type:'event', kind:'init', ...info });
    },
    onStats: (stats: any) => {
      writeLine(res, { type:'stats', ...stats });
    }
  });
}
/** 统一 keys 注入（如果你原文件里是别的注入方式，保留原样即可） */
function patchSpecWithKeys(spec: SeatSpec | undefined, keys?: StartPayload['seatKeys'], idx?: number): SeatSpec | undefined {
  if (!spec) return spec;
  const k = Array.isArray(keys) ? keys[idx ?? 0] : undefined;
  if (!k) return spec;
  const s: SeatSpec = { ...spec };
  if (k.openai) s.apiKey = k.openai;
  if (k.gemini) s.apiKey = k.gemini;
  if (k.kimi) s.apiKey = k.kimi;
  if (k.qwen) s.apiKey = k.qwen;
  if (k.grok) s.apiKey = k.grok;
  if (k.httpBase) s.baseUrl = k.httpBase;
  if (k.httpToken) s.token = k.httpToken;
  return s;
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' }); return;
  }

  // NDJSON headers
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  try { (res as any).flushHeaders?.(); } catch {}

  const body = (req.body || {}) as StartPayload;

  const rounds = Math.max(1, Math.min(9999, Number(body.rounds || 1)));
  const four2 = body.four2 || 'both';
  const rob = !!body.rob;

  const seatSpecs = (body.seats || []).slice(0,3).map((s, i) => patchSpecWithKeys(s, body.seatKeys, i));

  // 计算每家思考超时（ms）：支持单值或数组
  const __tt = body.turnTimeoutSec;
  let turnTimeoutMsArr = [30000,30000,30000];
  if (Array.isArray(__tt)) {
    const a = [Number(__tt[0]||30), Number(__tt[1]||30), Number(__tt[2]||30)];
    turnTimeoutMsArr = a.map(x => Math.max(1000, (Number.isFinite(x) ? x : 30) * 1000));
  } else {
    const ms = Math.max(1000, (Number(__tt)||30) * 1000);
    turnTimeoutMsArr = [ms, ms, ms];
  }

  // 计算每家最小间隔（ms）：支持单值或数组（从 seatDelayMs 派生）
  const delaysRaw = body.seatDelayMs;
  const minIntervalMsArr = Array.isArray(delaysRaw)
    ? [Number(delaysRaw[0]||0)||0, Number(delaysRaw[1]||0)||0, Number(delaysRaw[2]||0)||0]
    : [Number(delaysRaw||0)||0, Number(delaysRaw||0)||0, Number(delaysRaw||0)||0];

  // 原始 bot
  const baseBots = seatSpecs.map((s) => asBot(s?.choice as BotChoice, s));
  // 包装：加最小间隔等待 + 思考超时兜底
  const lastReason = [null, null, null] as any[];
  const onReason = (seat:number, text?:string)=> {
    if (typeof seat === 'number') lastReason[seat] = text || null;
  };

  const roundBots = baseBots.map((bot, i) =>
    traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot, res, onReason, turnTimeoutMsArr[i], minIntervalMsArr[i])
  );

  // keep-alive（避免代理断开）
  const keepAlive = setInterval(()=> {
    try { writeLine(res, { type: 'hb', server: true, t: Date.now() }); } catch {}
  }, 15000);
  (res as any).on?.('close', ()=> { try{ clearInterval(keepAlive as any);}catch{} });

  try {
    for (let round = 1; round <= rounds; round++) {
      if (round === 1) writeLine(res, { type:'log', message:`—— 开始第 ${round} 局 ——` });
      else writeLine(res, { type:'log', message:`—— 开始第 ${round} 局 ——` });

      await runOneRoundWithGuard({ seats: roundBots, four2, delayMs: 0, lastReason, rob }, res, round);

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{};
    try{ (res as any).end(); }catch{}
  }
}
// 兼容 Next.js 默认导出（已在上面导出）
