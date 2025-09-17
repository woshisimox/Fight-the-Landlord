// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ⬇️ 按你的项目结构选择正确的 engine 路径：
// - 如果是 lib/doudizhu/engine.ts：把 '../../lib/engine' 改成 '../../lib/doudizhu/engine'
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/engine';

import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

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
  startScore?: number;           // 供前端展示/累计，后端不强约束
  seatDelayMs?: number[];        // 可透传给引擎（如支持）
  enabled?: boolean;             // 前端开关
  rob: boolean;                  // 是否抢地主
  four2: Four2Policy;            // 4 个 2 的策略
  seats: BotChoice[];            // 三个座位
  seatModels?: string[];         // 三个座位各自模型
  seatKeys?: SeatKeys[];         // 三个座位各自 key / http
  farmerCoop?: boolean;          // 农民协作（若引擎支持）
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
    // 不强制 flush，让 Node 自己 flush；Vercel 上这样更稳
  } catch (err) {
    // 忽略流关闭后的写入错误
  }
}

/* ==================== Bot 适配（关键修复点） ==================== */

function asBot(choice: BotChoice, spec?: SeatSpec) {
  if (choice === 'built-in:greedy-max') {
    // ✅ 关键修复：构造函数改为带 1 个参数（label/name）
    const impl = new GreedyMax(spec?.seatLabel || '内置:GreedyMax');
    return async (ctx: any) => impl.play(ctx);
  }
  if (choice === 'built-in:greedy-min') {
    const impl = new GreedyMin(spec?.seatLabel || '内置:GreedyMin');
    return async (ctx: any) => impl.play(ctx);
  }
  if (choice === 'built-in:random-legal') {
    const impl = new RandomLegal(spec?.seatLabel || '内置:RandomLegal');
    return async (ctx: any) => impl.play(ctx);
  }

  if (choice === 'ai:openai') {
    const bot = new OpenAIBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx: any) => bot.play(ctx);
  }
  if (choice === 'ai:gemini') {
    const bot = new GeminiBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx: any) => bot.play(ctx);
  }
  if (choice === 'ai:grok') {
    const bot = new GrokBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx: any) => bot.play(ctx);
  }
  if (choice === 'ai:kimi') {
    const bot = new KimiBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx: any) => bot.play(ctx);
  }
  if (choice === 'ai:qwen') {
    const bot = new QwenBot({ model: spec?.model, apiKey: spec?.apiKey });
    return async (ctx: any) => bot.play(ctx);
  }

  // HTTP 自定义外部 AI
  if (choice === 'http' || spec?.baseUrl || spec?.token) {
    const bot = new HttpBot({ base: spec?.baseUrl, token: spec?.token, model: spec?.model });
    return async (ctx: any) => bot.play(ctx);
  }

  // 兜底：随机合法
  const fallback = new RandomLegal(spec?.seatLabel || '内置:RandomLegal');
  return async (ctx: any) => fallback.play(ctx);
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

  // NDJSON 响应头
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
    // 初始化事件
    writeLine(res, { type: 'init', rounds, startScore, rob, four2, farmerCoop, seatDelayMs, seats, seatModels, enabled, debug });

    // 构建 3 个座位的 bot
    const bots = Array.from({ length: 3 }).map((_, i) => {
      const choice = seats[i] || 'built-in:random-legal';
      const model = seatModels[i] || defaultModelFor(choice);
      const keys = seatKeys[i] || {};

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
        token: keys.httpToken,
        seatLabel: LABELS[i],
      };

      return asBot(choice, spec);
    });

    // 多局循环（若你的部署希望“一局一请求”，可把 rounds 固定为 1，这里保持通用）
    let totals: [number, number, number] = [startScore, startScore, startScore];

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局开始 ——`, round });

      // runOneGame 的签名在你的工程里可能是 1 个或 2 个参数。
      // 之前有同学遇到 “Expected 2 arguments” 的编译报错，这里传入一个空对象当第二参并用 any 规避类型冲突。
      const iter = runOneGame(
        {
          seats: bots as any,  // 传入 3 个异步 bot 函数
          rob,
          four2,
          seatDelayMs,
          farmerCoop,
          debug,
        } as any,
        {} as any
      );

      // 事件流转发
      // 你的 engine 通常会产出：deal / bid / play / pass / trick / log / result / scores 等事件
      // 这里做直通，并在局末累加 totals（若事件里携带 deltaScores）
      let roundDelta: [number, number, number] = [0, 0, 0];

      for await (const ev of iter as any) {
        // 直通所有事件
        writeLine(res, ev);

        // 增量计分（如果有的话）
        if (ev?.type === 'scores' && Array.isArray(ev?.delta)) {
          const d = ev.delta as [number, number, number];
          roundDelta = [roundDelta[0] + d[0], roundDelta[1] + d[1], roundDelta[2] + d[2]];
        }
      }

      totals = [totals[0] + roundDelta[0], totals[1] + roundDelta[1], totals[2] + roundDelta[2]];
      writeLine(res, { type: 'scores', totals, round, delta: roundDelta });
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局结束 ——`, round });

      // 进度
      const left = rounds - round;
      writeLine(res, { type: 'progress', finished: round, left, totals });
    }

    // 全部完成
    writeLine(res, { type: 'end', totals });
    res.end();

  } catch (err: any) {
    writeLine(res, { type: 'error', message: String(err?.message || err || 'unknown error') });
    try { res.end(); } catch {}
  }
}
