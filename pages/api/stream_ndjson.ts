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
    // 未接入外部 AI 时统一回退，避免报错
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

// —— 从事件里尽可能提取“续跑上下文” —— //
function extractResumeCtx(ev: any): any {
  if (!ev) return null;
  return (
    ev.next ??
    ev.ctx ??
    ev.state ??
    ev.table ??
    ev.payload?.state ??
    ev.payload?.ctx ??
    ev.init ??
    ev.snapshot ??
    ev.payload?.snapshot ??
    null
  );
}
function isWinEvent(ev: any): boolean {
  return !!(ev && ((ev.type === 'event' && ev.kind === 'win') || ev.win === true));
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
  // 注意：单局/请求开关只在捕获到 win 后才会结束本次请求
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

  // 首行日志
  writeLine(res, {
    type: 'log',
    message: singleGameSwitch
      ? `单局模式开启：本请求必须跑到 win 才结束（four2=${four2}，原始 rounds=${reqRounds}）…`
      : `开始连打 ${rounds} 局（four2=${four2}），每局必须到 win 才结束…`,
  });

  let okEnded = false;

  try {
    for (let gameIndex = 1; gameIndex <= rounds; gameIndex++) {
      writeLine(res, { type: 'log', message: `—— 第 ${gameIndex} 局开始 ——` });

      // 只传必要参数，避免误入“按轮/步进”模式
      const baseOptions: any = { seats: bots as any, rob, four2 };

      // —— 关键：整局循环，直到捕获 win —— //
      let ctx: any = null;          // 续跑上下文
      let winSeen = false;
      let stepCount = 0;
      const STEP_MAX = 20000;       // 单局最多步数（保护阈值）

      while (!winSeen && stepCount < STEP_MAX) {
        stepCount++;

        // 1) 尝试 runOneGame(options, ctx)
        let iter: any = null;
        try { iter = (runOneGame as any)(baseOptions, ctx); }
        catch { iter = null; }

        // 2) 若不行，再试把 ctx 塞进 options（兼容某些实现）
        if (!iter) {
          try { iter = (runOneGame as any)({ ...baseOptions, resume: ctx }); } catch {}
        }
        if (!iter) {
          try { iter = (runOneGame as any)({ ...baseOptions, state: ctx }); } catch {}
        }
        if (!iter) {
          // 最后再退回单参
          try { iter = (runOneGame as any)(baseOptions); } catch {}
        }
        if (!iter) {
          writeLine(res, { type: 'log', message: '⚠ 引擎未返回可迭代对象，结束本局。' });
          break;
        }

        let produced = false;

        // —— 消费一次“步进”产物 —— //
        try {
          for await (const ev of (iter as any)) {
            produced = true;
            writeLine(res, ev);
            const next = extractResumeCtx(ev);
            if (next != null) ctx = next;
            if (isWinEvent(ev)) { winSeen = true; }
          }
        } catch {
          try {
            if (Array.isArray(iter)) {
              for (const ev of iter) {
                produced = true;
                writeLine(res, ev);
                const next = extractResumeCtx(ev);
                if (next != null) ctx = next;
                if (isWinEvent(ev)) { winSeen = true; }
              }
            }
          } catch {}
        }

        // 步进没有产生任何事件，避免忙等：写日志并小憩 1ms 再续跑
        if (!produced && !winSeen) {
          writeLine(res, { type: 'log', message: '⚠ 引擎未产生事件，继续尝试续跑同一局…' });
          await new Promise(r => setTimeout(r, 1));
        }
      }

      if (!winSeen) {
        writeLine(res, { type: 'log', message: `⚠ 第 ${gameIndex} 局未出现 win（步数=${stepCount}），疑似引擎步进配置，已收束本局。` });
      } else {
        writeLine(res, { type: 'log', message: `—— 第 ${gameIndex} 局结束（win 已到达，已计算分数）——` });
      }

      // 只有当“单局/请求开关”为 1 且本局确实出现 win，才结束本次请求
      if (singleGameSwitch && winSeen) break;
      // 若 singleGameSwitch=1 但没见 win，则继续 while 续跑直到 win 或到保护阈值
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
