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
  | 'http'
  | string;

// NDJSON 按行输出
function writeLine(res: NextApiResponse, obj: any) {
  try {
    const line = JSON.stringify(obj) + '\n';
    (res as any).write(line);
  } catch {}
}

type BotFunc = (ctx: any) => Promise<any> | any;

// 如需启用外部 AI，请在此替换为真实 Bot；当前统一安全回退到内置，避免编译/运行异常
function chooseBot(kind?: BotChoice, model?: string, keys?: any): BotFunc {
  const k = (kind || '').toLowerCase();
  switch (k) {
    case 'built-in:greedy-max':
    case 'builtin:greedy-max':
    case 'greedy-max': return GreedyMax as unknown as BotFunc;
    case 'built-in:greedy-min':
    case 'builtin:greedy-min':
    case 'greedy-min': return GreedyMin as unknown as BotFunc;
    case 'built-in:random-legal':
    case 'builtin:random-legal':
    case 'random-legal':
    case 'random': return RandomLegal as unknown as BotFunc;

    // 占位：需要时可替换为 OpenAIBot/GeminiBot/GrokBot/HttpBot/KimiBot/QwenBot
    case 'http':
    case 'ai:openai':
    case 'ai:gemini':
    case 'ai:grok':
    case 'ai:kimi':
    case 'ai:qwen':
      return GreedyMax as unknown as BotFunc;

    default:
      return GreedyMax as unknown as BotFunc;
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '512kb' } },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
    return;
  }

  // —— 流式与缓存控制 —— //
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  // —— 解析 Body —— //
  const body = (() => {
    try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
    catch { return {}; }
  })();

  // —— 参数 —— //
  const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
  const reqRounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
  const singleGameSwitch = process.env.SINGLE_GAME_PER_REQUEST === '1';
  // 开关：开启时每次请求仅打 1 局；否则照传入 rounds 连打
  const rounds = singleGameSwitch ? 1 : reqRounds;

  const rob = !!body.rob;
  const four2 = !!body.four2;

  const seats = Array.isArray(body.seats) ? body.seats : [null, null, null];
  const seatModels = body.seatModels || {};
  const seatKeys = body.seatKeys || {};

  // —— Keep-Alive 心跳 —— //
  const __ka = setInterval(() => {
    writeLine(res, { type: 'ping', t: Date.now() });
    try { (res as any).flush?.(); } catch {}
  }, 15000);
  (res as any).on?.('close', () => { try { clearInterval(__ka as any); } catch {} });

  // 组装三个席位的 Bot（外部 AI 未接入时统一回退）
  const bots: BotFunc[] = [0, 1, 2].map((i) => {
    const key = (['A','B','C','D'][i] || i) as any; // 兼容老写法
    const kind: BotChoice | undefined =
      seats?.[i]?.kind || seats?.[i] || seatModels?.[i] || seatModels?.[key] || seatModels?.[['E','S','W','N'][i]];
    const model: string | undefined =
      seats?.[i]?.model || seatModels?.[i]?.model || seatModels?.[key]?.model;
    const keysForSeat =
      seatKeys?.[i] || seatKeys?.[key] || seatKeys?.[['E','S','W','N'][i]];
    return chooseBot(kind, model, keysForSeat);
  });

  // 首行日志
  writeLine(res, {
    type: 'log',
    message: singleGameSwitch
      ? `单局模式已启用：本请求仅运行 1 局（four2=${four2}，原始请求 rounds=${reqRounds}）…`
      : `开始连打 ${rounds} 局（four2=${four2}）…`,
  });

  let okEnded = false;

  try {
    for (let gameIndex = 1; gameIndex <= rounds; gameIndex++) {
      writeLine(res, { type: 'log', message: `—— 第 ${gameIndex} 局开始 ——` });

      // 关键：只把引擎真正需要的参数传入，避免触发“按轮/步进”模式
      const options: any = { seats: bots as any, rob, four2 };

      // 运行一整局：直到收到 win 事件才视为本局完成
      let iter: any;
      try {
        iter = (runOneGame as any)(options);
        if (!iter || (typeof iter !== 'object')) {
          iter = (runOneGame as any)(options, undefined);
        }
      } catch {
        iter = (runOneGame as any)(options, undefined);
      }

      let winSeen = false;

      const consumeEvent = (ev: any) => {
        // 把所有事件（包括 play / trick-reset / win / log 等）原样转发给前端
        writeLine(res, ev);
        // 以“整局胜负”作为结束条件（算分用的 deltaScores 等随 win 一起到达）
        if (ev && ev.type === 'event' && ev.kind === 'win') {
          winSeen = true;
          return true; // 只在 win 才结束本局
        }
        return false;
      };

      try {
        for await (const ev of (iter as any)) {
          if (consumeEvent(ev)) break;
        }
      } catch {
        // 如果不是 async generator，则容错为数组/同步迭代
        try {
          if (Array.isArray(iter)) {
            for (const ev of iter) {
              if (consumeEvent(ev)) break;
            }
          }
        } catch {}
      }

      if (!winSeen) {
        writeLine(res, { type: 'log', message: '⚠ 本局未出现 win 事件，疑似引擎异常，已提前结束本局。' });
      } else {
        writeLine(res, { type: 'log', message: `—— 第 ${gameIndex} 局结束（win 已到达，已计算分数）——` });
      }

      // 单局/请求开关：开关开启只打 1 局
      if (singleGameSwitch) break;
    }

    okEnded = true;
    try { (res as any).flush?.(); } catch {}
    try { clearInterval(__ka as any); } catch {}
    res.end();
  } catch (e: any) {
    writeLine(res, { type: 'log', message: `后端错误：${e?.message || String(e)}` });
    try { (res as any).flush?.(); } catch {}
    try { clearInterval(__ka as any); } catch {}
    res.end();
  } finally {
    if (!okEnded) {
      try { clearInterval(__ka as any); } catch {}
    }
  }
}
