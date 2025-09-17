// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ⬇️ 按你的项目结构选择正确的 engine 路径：
// - 如果是 lib/doudizhu/engine.ts：把 '../../lib/engine' 改成 '../../lib/doudizhu/engine'
import * as ddz from '../../lib/engine';
const runOneGame: any = (ddz as any).runOneGame;
const GreedyMax: any  = (ddz as any).GreedyMax;
const GreedyMin: any  = (ddz as any).GreedyMin;
const RandomLegal: any = (ddz as any).RandomLegal;

import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot }  from '../../lib/bots/gemini_bot';
import { GrokBot }    from '../../lib/bots/grok_bot';
import { HttpBot }    from '../../lib/bots/http_bot';
import { KimiBot }    from '../../lib/bots/kimi_bot';
import { QwenBot }    from '../../lib/bots/qwen_bot';

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
  try {
    res.write(JSON.stringify(obj) + '\n');
  } catch {}
}

/** 统一适配：传入“类或工厂函数”，返回带 .play(ctx) 的对象 */
function makeImpl(ClassOrFactory: any, label: string) {
  // 优先尝试当作 class 用 new
  try {
    const inst = new ClassOrFactory(label);
    if (inst && typeof inst.play === 'function') return inst;
  } catch {}
  // 退而求其次：当作工厂函数直接调用
  try {
    const maybe = ClassOrFactory(label);
    if (maybe && typeof maybe.play === 'function') return maybe;
    if (typeof maybe === 'function') return { play: maybe }; // 工厂直接返回 (ctx)=>move
  } catch {}
  // 最后兜底：返回一个“必过牌”的实现，避免崩溃
  return { play: async () => ({ move: 'pass', reason: `invalid bot factory for ${label}` }) };
}

/** 将 SeatSpec 转为统一的异步 (ctx)=>Promise<Move> */
function asCallable(impl: any) {
  return async (ctx: any) => {
    try {
      if (impl && typeof impl.play === 'function') return await impl.play(ctx);
      if (typeof impl === 'function') return await impl(ctx);
    } catch (e: any) {
      return { move: 'pass', reason: `bot error: ${e?.message || e}` };
    }
    return { move: 'pass', reason: 'bot impl not callable' };
  };
}

/* ==================== Bot 选择器（内置 + AI + HTTP） ==================== */

function asBot(choice: BotChoice, spec?: SeatSpec) {
  const label = spec?.seatLabel || (
    choice === 'built-in:greedy-max' ? '内置:GreedyMax' :
    choice === 'built-in:greedy-min' ? '内置:GreedyMin' :
    choice === 'built-in:random-legal' ? '内置:RandomLegal' : 'Bot'
  );

  if (choice === 'built-in:greedy-max') {
    const impl = makeImpl(GreedyMax, label);
    return asCallable(impl);
  }
  if (choice === 'built-in:greedy-min') {
    const impl = makeImpl(GreedyMin, label);
    return asCallable(impl);
  }
  if (choice === 'built-in:random-legal') {
    const impl = makeImpl(RandomLegal, label);
    return asCallable(impl);
  }

  if (choice === 'ai:openai') {
    const bot = new OpenAIBot({ model: spec?.model, apiKey: spec?.apiKey });
    return asCallable(bot);
  }
  if (choice === 'ai:gemini') {
    const bot = new GeminiBot({ model: spec?.model, apiKey: spec?.apiKey });
    return asCallable(bot);
  }
  if (choice === 'ai:grok') {
    const bot = new GrokBot({ model: spec?.model, apiKey: spec?.apiKey });
    return asCallable(bot);
  }
  if (choice === 'ai:kimi') {
    const bot = new KimiBot({ model: spec?.model, apiKey: spec?.apiKey });
    return asCallable(bot);
  }
  if (choice === 'ai:qwen') {
    const bot = new QwenBot({ model: spec?.model, apiKey: spec?.apiKey });
    return asCallable(bot);
  }

  // HTTP 自定义外部 AI（⚠ 避免再次触发“model 字段不存在”的类型报错，不传 model）
  if (choice === 'http' || spec?.baseUrl || spec?.token) {
    const bot = new HttpBot({ base: spec?.baseUrl, token: spec?.token });
    return asCallable(bot);
  }

  // 兜底：随机合法
  const fallback = makeImpl(RandomLegal, '内置:RandomLegal');
  return asCallable(fallback);
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

    // 构建 3 个座位
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

      // 兼容不同签名（有的工程要求 2 个参数）
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
        writeLine(res, ev);
        if (ev?.type === 'scores' && Array.isArray(ev?.delta)) {
          const d = ev.delta as [number, number, number];
          roundDelta = [roundDelta[0] + d[0], roundDelta[1] + d[1], roundDelta[2] + d[2]];
        }
      }

      totals = [totals[0] + roundDelta[0], totals[1] + roundDelta[1], totals[2] + roundDelta[2]];
      writeLine(res, { type: 'scores', totals, round, delta: roundDelta });
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局结束 ——`, round });

      const left = rounds - round;
      writeLine(res, { type: 'progress', finished: round, left, totals });
    }

    writeLine(res, { type: 'end', totals });
    res.end();

  } catch (err: any) {
    writeLine(res, { type: 'error', message: String(err?.message || err || 'unknown error') });
    try { res.end(); } catch {}
  }
}
