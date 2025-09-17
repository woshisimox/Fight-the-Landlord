// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ====== 引擎（已固定为 doudizhu 路径）======
import * as ddz from '../../lib/doudizhu/engine';
const runOneGame: any  = (ddz as any).runOneGame;
const GreedyMax: any   = (ddz as any).GreedyMax;
const GreedyMin: any   = (ddz as any).GreedyMin;
const RandomLegal: any = (ddz as any).RandomLegal;

// ====== AI 适配器（统一 any，兼容类/工厂/默认导出）======
import * as openaiMod from '../../lib/bots/openai_bot';
import * as geminiMod from '../../lib/bots/gemini_bot';
import * as grokMod   from '../../lib/bots/grok_bot';
import * as httpMod   from '../../lib/bots/http_bot';
import * as kimiMod   from '../../lib/bots/kimi_bot';
import * as qwenMod   from '../../lib/bots/qwen_bot';

const OpenAIBot: any = (openaiMod as any).OpenAIBot ?? (openaiMod as any).default ?? openaiMod;
const GeminiBot: any = (geminiMod as any).GeminiBot ?? (geminiMod as any).default ?? geminiMod;
const GrokBot: any   = (grokMod   as any).GrokBot   ?? (grokMod   as any).default ?? grokMod;
const HttpBot: any   = (httpMod   as any).HttpBot   ?? (httpMod   as any).default ?? httpMod;
const KimiBot: any   = (kimiMod   as any).KimiBot   ?? (kimiMod   as any).default ?? kimiMod;
const QwenBot: any   = (qwenMod   as any).QwenBot   ?? (qwenMod   as any).default ?? qwenMod;

/* ==================== 类型（与前端对齐） ==================== */
type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type SeatKeys = {
  openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string;
  httpBase?: string; httpToken?: string;
};

type SeatSpec = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  token?: string;
  seatLabel?: string; // 甲/乙/丙
};

type StartBody = {
  rounds: number;
  startScore?: number;
  seatDelayMs?: number[];
  enabled?: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels?: string[];
  seatKeys?: SeatKeys[];
  farmerCoop?: boolean;
  debug?: boolean;
};

/* ==================== 工具 ==================== */
const LABELS = ['甲', '乙', '丙'];

function defaultModelFor(choice: BotChoice): string {
  switch (choice) {
    case 'ai:openai': return 'gpt-4o-mini';
    case 'ai:gemini': return 'gemini-1.5-pro';
    case 'ai:grok':   return 'grok-2-mini';
    case 'ai:kimi':   return 'moonshot-v1-8k';
    case 'ai:qwen':   return 'qwen-long';
    default:          return '';
  }
}

function writeLine(res: NextApiResponse, obj: any) {
  try { res.write(JSON.stringify(obj) + '\n'); } catch {}
}

/** 统一工厂：尽量拿到一个带 bid/play 的“IBot 对象” */
function makeImplWithBidPlay(F: any, arg?: any): any {
  // 1) 当作 class（优先带参，再无参）
  try { const o = new F(arg); if (o && (o.bid || o.play)) return o; } catch {}
  try { const o0 = new F();   if (o0 && (o0.bid || o0.play)) return o0; } catch {}

  // 2) 当作工厂函数（先带参，再无参）
  try { const r = F(arg);  if (r && (r.bid || r.play)) return r; } catch {}
  try { const r0 = F();    if (r0 && (r0.bid || r0.play)) return r0; } catch {}

  // 3) 若是直接函数，把它当作 play；bid 用 GreedyMax 兜底
  if (typeof F === 'function') {
    const bidder = makeImplWithBidPlay(GreedyMax, 'Bidder');
    return {
      bid: async (ctx: any) => bidder?.bid ? bidder.bid(ctx) : 'pass',
      play: async (ctx: any) => F(ctx),
    };
  }

  // 4) 兜底：全部 pass（不建议，但避免崩）
  return {
    bid: async () => 'pass',
    play: async () => ({ move: 'pass', reason: 'invalid bot factory' }),
  };
}

/** AI 适配：AI 只实现 play 时，用内置 GreedyMax 代理 bid，避免“一手结束” */
function makeAIBot(Factory: any, opts: any, label: string) {
  const ai = makeImplWithBidPlay(Factory, opts);
  // 若没有 bid，用 GreedyMax 做叫/抢地主（能输出 1/2/3 或 rob/pass，具体取决于引擎）
  if (typeof ai.bid !== 'function') {
    const bidder = makeImplWithBidPlay(GreedyMax, label + ':Bidder');
    ai.bid = async (ctx: any) => bidder?.bid ? bidder.bid(ctx) : 'pass';
  }
  // 强化 play 的 reason，便于前端日志
  const origPlay = ai.play;
  ai.play = async (ctx: any) => {
    try {
      const mv = await origPlay(ctx);
      if (mv && mv.move === 'pass' && !mv.reason) mv.reason = `${label}: pass`;
      return mv ?? { move: 'pass', reason: `${label}: empty move` };
    } catch (e: any) {
      return { move: 'pass', reason: `${label}: error ${e?.message || e}` };
    }
  };
  return ai;
}

/* ==================== Bot 选择（返回“对象”，不是函数） ==================== */
function makeSeat(choice: BotChoice, spec?: SeatSpec) {
  const label =
    spec?.seatLabel ||
    (choice === 'built-in:greedy-max' ? '内置:GreedyMax'
    : choice === 'built-in:greedy-min' ? '内置:GreedyMin'
    : choice === 'built-in:random-legal' ? '内置:RandomLegal'
    : 'Bot');

  if (choice === 'built-in:greedy-max')   return makeImplWithBidPlay(GreedyMax, label);
  if (choice === 'built-in:greedy-min')   return makeImplWithBidPlay(GreedyMin, label);
  if (choice === 'built-in:random-legal') return makeImplWithBidPlay(RandomLegal, label);

  if (choice === 'ai:openai') return makeAIBot(OpenAIBot, { model: spec?.model, apiKey: spec?.apiKey, label }, label);
  if (choice === 'ai:gemini') return makeAIBot(GeminiBot,  { model: spec?.model, apiKey: spec?.apiKey, label }, label);
  if (choice === 'ai:grok')   return makeAIBot(GrokBot,    { model: spec?.model, apiKey: spec?.apiKey, label }, label);
  if (choice === 'ai:kimi')   return makeAIBot(KimiBot,    { model: spec?.model, apiKey: spec?.apiKey, label }, label);
  if (choice === 'ai:qwen')   return makeAIBot(QwenBot,    { model: spec?.model, apiKey: spec?.apiKey, label }, label);

  // HTTP 外部（一般只实现 play，这里同样用 GreedyMax 代理 bid）
  if (choice === 'http' || spec?.baseUrl || spec?.token) {
    return makeAIBot(HttpBot, { base: spec?.baseUrl, token: spec?.token, label }, label);
  }

  // 兜底
  return makeImplWithBidPlay(RandomLegal, '内置:RandomLegal');
}

/* ==================== 请求处理 ==================== */
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Connection', 'keep-alive');

  const body = (req.body || {}) as StartBody;
  const {
    rounds = 1,
    startScore = 100,
    seatDelayMs = [0, 0, 0],
    enabled = true,
    rob = true,
    four2 = 'both',
    seats = ['built-in:greedy-max', 'built-in:greedy-min', 'built-in:random-legal'],
    seatModels = [],
    seatKeys = [],
    farmerCoop = false,
    debug = false,
  } = body;

  try {
    writeLine(res, { type: 'init', rounds, startScore, rob, four2, farmerCoop, seatDelayMs, seats, seatModels, enabled, debug });

    // 构建 IBot 对象数组（每个都有 bid + play）
    const seatObjs = Array.from({ length: 3 }).map((_, i) => {
      const choice = seats[i] || 'built-in:random-legal';
      const model  = seatModels[i] || defaultModelFor(choice);
      const keys   = seatKeys[i] || {};

      let apiKey: string | undefined;
      switch (choice) {
        case 'ai:openai': apiKey = keys.openai; break;
        case 'ai:gemini': apiKey = keys.gemini; break;
        case 'ai:grok':   apiKey = keys.grok;   break;
        case 'ai:kimi':   apiKey = keys.kimi;   break;
        case 'ai:qwen':   apiKey = keys.qwen;   break;
        default:          apiKey = undefined;   break;
      }

      const spec: SeatSpec = {
        choice, model, apiKey,
        baseUrl: keys.httpBase, token: keys.httpToken,
        seatLabel: LABELS[i],
      };
      return makeSeat(choice, spec);
    });

    // 兼容不同签名：有的 runOneGame(config, hooks)，有的 runOneGame(config)
    const cfg = { seats: seatObjs, rob, four2, seatDelayMs, farmerCoop, debug } as any;
    const iter = (runOneGame.length >= 2) ? runOneGame(cfg, {} as any) : runOneGame(cfg);

    let totals: [number, number, number] = [startScore, startScore, startScore];
    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局开始 ——`, round });

      let roundDelta: [number, number, number] = [0, 0, 0];

      for await (const ev of iter as any) {
        writeLine(res, ev);
        if (ev?.type === 'scores' && Array.isArray(ev?.delta)) {
          const d = ev.delta as [number, number, number];
          roundDelta = [roundDelta[0] + d[0], roundDelta[1] + d[1], roundDelta[2] + d[2]];
        }
        if (ev?.type === 'result') break; // 一局完成标志（若引擎按局产出）
      }

      totals = [totals[0] + roundDelta[0], totals[1] + roundDelta[1], totals[2] + roundDelta[2]];
      writeLine(res, { type: 'scores', totals, round, delta: roundDelta });
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局结束 ——`, round });
      writeLine(res, { type: 'progress', finished: round, left: rounds - round, totals });
    }

    writeLine(res, { type: 'end', totals });
    res.end();
  } catch (err: any) {
    writeLine(res, { type: 'error', message: String(err?.message || err || 'unknown error') });
    try { res.end(); } catch {}
  }
}
