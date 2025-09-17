// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ========= 引擎导入（按你的项目结构调整路径） =========
import * as ddz from '../../lib/engine';
const runOneGame: any   = (ddz as any).runOneGame;
const GreedyMax: any    = (ddz as any).GreedyMax;
const GreedyMin: any    = (ddz as any).GreedyMin;
const RandomLegal: any  = (ddz as any).RandomLegal;

// ========= 各 AI 适配器（统一成 any，兼容默认导出/具名导出/工厂） =========
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

/* ==================== 类型（与前端 LiveProps 对齐） ==================== */

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

/* ==================== 小工具 ==================== */

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

/** 写一行 NDJSON，并确保换行 */
function writeLine(res: NextApiResponse, obj: any) {
  try { res.write(JSON.stringify(obj) + '\n'); } catch {}
}

/** 通用工厂：最大兼容 “class / 工厂函数 / 直接函数(play)” */
function makeAnyBot(F: any, arg?: any) {
  // 1) 当作 class 构造（优先用有参，再试无参）
  try { const inst = new F(arg); if (inst && typeof inst.play === 'function') return inst; } catch {}
  try { const inst0 = new F();   if (inst0 && typeof inst0.play === 'function') return inst0; } catch {}

  // 2) 当作工厂函数调用（先有参，再无参）
  try {
    const ret = F(arg);
    if (ret && typeof ret.play === 'function') return ret;
    if (typeof ret === 'function') return { play: ret }; // 工厂返回函数
    if (ret && typeof ret === 'object' && typeof ret.play === 'function') return ret;
  } catch {}
  try {
    const ret0 = F();
    if (ret0 && typeof ret0.play === 'function') return ret0;
    if (typeof ret0 === 'function') return { play: ret0 };
    if (ret0 && typeof ret0 === 'object' && typeof ret0.play === 'function') return ret0;
  } catch {}

  // 3) 若 F 本身是“直接函数(play)”，直接包成 { play: F }
  if (typeof F === 'function') return { play: F };

  // 4) 兜底
  return { play: async () => ({ move: 'pass', reason: `invalid bot factory` }) };
}

/** 统一转为异步可调用 (ctx)=>Promise<Move> */
function asCallable(impl: any, label: string) {
  // 连续 pass 计数器（用于帮助定位“只出一轮就结束”的情况）
  let passCount = 0;
  return async (ctx: any) => {
    try {
      let mv: any;
      if (!impl) {
        mv = { move: 'pass', reason: `${label}: bot impl missing` };
      } else if (typeof impl.play === 'function') {
        mv = await impl.play(ctx);
      } else if (typeof impl === 'function') {
        mv = await impl(ctx);
      } else {
        mv = { move: 'pass', reason: `${label}: bot impl not callable` };
      }
      // 简单的 pass 连续计数（帮助发现“全程 pass”的问题）
      if (mv?.move === 'pass') passCount++; else passCount = 0;
      // 强化 reason，便于前端日志显示
      if (mv?.move === 'pass' && !mv?.reason) {
        mv.reason = `${label}: pass`;
      }
      // 当连续 pass 很多次，发出一个 debug 事件（由上层调用时写入）
      (mv as any).__passCount = passCount;
      return mv;
    } catch (e: any) {
      return { move: 'pass', reason: `${label}: bot error: ${e?.message || e}` };
    }
  };
}

/* ==================== Bot 选择器（内置 + 各 AI + HTTP） ==================== */

function asBot(choice: BotChoice, spec?: SeatSpec) {
  const label =
    spec?.seatLabel ||
    (choice === 'built-in:greedy-max' ? '内置:GreedyMax'
    : choice === 'built-in:greedy-min' ? '内置:GreedyMin'
    : choice === 'built-in:random-legal' ? '内置:RandomLegal'
    : 'Bot');

  if (choice === 'built-in:greedy-max') {
    const impl = makeAnyBot(GreedyMax, label);
    return asCallable(impl, label);
  }
  if (choice === 'built-in:greedy-min') {
    const impl = makeAnyBot(GreedyMin, label);
    return asCallable(impl, label);
  }
  if (choice === 'built-in:random-legal') {
    const impl = makeAnyBot(RandomLegal, label);
    return asCallable(impl, label);
  }

  if (choice === 'ai:openai') {
    const impl = makeAnyBot(OpenAIBot, { model: spec?.model, apiKey: spec?.apiKey, label });
    return asCallable(impl, label);
  }
  if (choice === 'ai:gemini') {
    const impl = makeAnyBot(GeminiBot, { model: spec?.model, apiKey: spec?.apiKey, label });
    return asCallable(impl, label);
  }
  if (choice === 'ai:grok') {
    const impl = makeAnyBot(GrokBot, { model: spec?.model, apiKey: spec?.apiKey, label });
    return asCallable(impl, label);
  }
  if (choice === 'ai:kimi') {
    const impl = makeAnyBot(KimiBot, { model: spec?.model, apiKey: spec?.apiKey, label });
    return asCallable(impl, label);
  }
  if (choice === 'ai:qwen') {
    const impl = makeAnyBot(QwenBot, { model: spec?.model, apiKey: spec?.apiKey, label });
    return asCallable(impl, label);
  }

  // HTTP 自定义外部 AI（常见实现只用 base/token；若你实现需要 model，可自行补上）
  if (choice === 'http' || spec?.baseUrl || spec?.token) {
    const impl = makeAnyBot(HttpBot, { base: spec?.baseUrl, token: spec?.token, label });
    return asCallable(impl, label);
  }

  // 兜底
  const fallback = makeAnyBot(RandomLegal, '内置:RandomLegal');
  return asCallable(fallback, '内置:RandomLegal');
}

/* ==================== 请求处理 ==================== */

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // NDJSON 头
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

    // 构建三个座位
    const bots = Array.from({ length: 3 }).map((_, i) => {
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
        choice,
        model,
        apiKey,
        baseUrl: keys.httpBase,
        token:   keys.httpToken,
        seatLabel: LABELS[i],
      };

      return asBot(choice, spec);
    });

    // 多局循环
    let totals: [number, number, number] = [startScore, startScore, startScore];

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局开始 ——`, round });

      // 兼容 1/2 参签名
      const iter = runOneGame(
        {
          seats: bots as any,
          rob,
          four2,
          seatDelayMs,
          farmerCoop,
          debug,
        } as any,
        {} as any
      );

      let roundDelta: [number, number, number] = [0, 0, 0];

      for await (const ev of iter as any) {
        // 如果是“出牌/过牌”事件，并且该动作带有 __passCount，且累计很多，则抛一个 debug 事件方便定位
        if ((ev?.type === 'play' || ev?.type === 'pass') && typeof ev?.move?.__passCount === 'number') {
          const pc = ev.move.__passCount as number;
          if (pc > 0 && pc % 10 === 0) {
            writeLine(res, { type: 'debug', message: `连续 pass 次数 ${pc}，可能 bot 实现无效`, seat: ev?.seat });
          }
          // 去掉内部字段，避免前端渲染问题
          try { delete ev.move.__passCount; } catch {}
        }

        writeLine(res, ev);

        // 增量计分（如果引擎发 scores 事件）
        if (ev?.type === 'scores' && Array.isArray(ev?.delta)) {
          const d = ev.delta as [number, number, number];
          roundDelta = [roundDelta[0] + d[0], roundDelta[1] + d[1], roundDelta[2] + d[2]];
        }
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
