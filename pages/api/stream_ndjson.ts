// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http'
  | string;

type BotFunc = (ctx: any) => Promise<any> | any;

// —— 工具：按行写 NDJSON —— //
function writeLine(res: NextApiResponse, obj: any) {
  try {
    const line = JSON.stringify(obj) + '\n';
    (res as any).write(line);
  } catch {}
}

// —— 统一选择 Bot（外部 AI 未接入时安全回退） —— //
function chooseBot(kind?: BotChoice, _model?: string, _keys?: any): BotFunc {
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
    // 这些占位：若未接入外部 AI，统一回退到 GreedyMax，避免报错
    case 'http':
    case 'ai:openai':
    case 'ai:gemini':
    case 'ai:grok':
    case 'ai:kimi':
    case 'ai:qwen': return GreedyMax as unknown as BotFunc;
    default: return GreedyMax as unknown as BotFunc;
  }
}

// —— Next API 配置 —— //
export const config = {
  api: { bodyParser: { sizeLimit: '512kb' } },
};

// —— 辅助：从事件里“尽最大可能”提取下一步上下文 —— //
function extractNextCtx(ev: any): any {
  // 常见命名：next / ctx / state / payload.state / init / snapshot 等
  return ev?.next ?? ev?.ctx ?? ev?.state ?? ev?.payload?.state ?? ev?.init ?? ev?.snapshot ?? null;
}
function isWinEvent(ev: any): boolean {
  if (!ev) return false;
  if (ev.type === 'event' && ev.kind === 'win') return true;
  // 兼容：有些实现可能直接输出 {win:true, deltaScores,...}
  if (ev.win === true) return true;
  return false;
}

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
  const rounds = singleGameSwitch ? 1 : reqRounds;

  const rob = !!body.rob;
  const four2 = !!body.four2;

  const seats = Array.isArray(body.seats) ? body.seats : [null, null, null];
  const seatModels = body.seatModels || {};
  const seatKeys = body.seatKeys || {};

  // —— 心跳：防止中间层断开 —— //
  const __ka = setInterval(() => {
    writeLine(res, { type: 'ping', t: Date.now() });
    try { (res as any).flush?.(); } catch {}
  }, 15000);
  (res as any).on?.('close', () => { try { clearInterval(__ka as any); } catch {} });

  // —— 组装三个席位的 Bot —— //
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

  // —— 首行日志 —— //
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

      // 只传必要参数，避免触发“按轮/步进配置”
      const baseOptions: any = { seats: bots as any, rob, four2 };

      // —— 关键：整局循环，直到捕获 win —— //
      let ctx: any = null;               // 引擎上下文（用于步进续跑）
      let stepSafeguard = 0;             // 安全阈值，防无限循环
      const STEP_MAX = 10000;            // 单局最多步数（可按需调整）
      let winSeen = false;

      while (!winSeen) {
        if (stepSafeguard++ > STEP_MAX) {
          writeLine(res, { type: 'log', message: '⚠ 保护：步数超过阈值，强制结束本局。' });
          break;
        }

        // 兼容两种签名：runOneGame(options) 或 runOneGame(options, ctx)
        let iter: any;
        try {
          iter = (runOneGame as any)(baseOptions, ctx);
        } catch {
          // 有些实现第一步可能不接受 ctx=null，这里回退为单参
          try { iter = (runOneGame as any)(baseOptions); } catch { iter = null; }
        }

        if (!iter) {
          writeLine(res, { type: 'log', message: '⚠ 引擎未返回可迭代对象，已结束本局。' });
          break;
        }

        // 消费一次迭代产物；如果是“按轮输出”，本次迭代结束后没有 win，就继续 while 循环续跑
        let anyEvent = false;
        try {
          for await (const ev of (iter as any)) {
            anyEvent = true;
            writeLine(res, ev);
            // 尝试从事件里提取下一步 ctx，以便续跑同一局
            const next = extractNextCtx(ev);
            if (next != null) ctx = next;
            if (isWinEvent(ev)) { winSeen = true; }
          }
        } catch {
          // 非 async generator：回退为数组/同步迭代
          try {
            if (Array.isArray(iter)) {
              for (const ev of iter) {
                anyEvent = true;
                writeLine(res, ev);
                const next = extractNextCtx(ev);
                if (next != null) ctx = next;
                if (isWinEvent(ev)) { winSeen = true; }
              }
            }
          } catch {}
        }

        // 如果这一轮没有任何事件，避免忙等
        if (!anyEvent && !winSeen) {
          writeLine(res, { type: 'log', message: '⚠ 引擎未产生事件，继续尝试续跑…' });
        }

        // 若已见 win，则跳出 while，整局结束
        if (winSeen) break;
        // 否则 while 回到顶部，以最新 ctx 继续 runOneGame（同一局）
      }

      if (!winSeen) {
        writeLine(res, { type: 'log', message: '⚠ 本局未出现 win 事件，疑似引擎异常，提前收束。' });
      } else {
        writeLine(res, { type: 'log', message: `—— 第 ${gameIndex} 局结束（win 已到达，已计算分数）——` });
      }

      // 单局/请求开关：开关开启 → 只打一整局（直到 win），然后结束流
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
