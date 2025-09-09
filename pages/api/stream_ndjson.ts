// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';

// NDJSON 按行写
function writeLine(res: NextApiResponse, obj: any) {
  try {
    const line = JSON.stringify(obj) + '\n';
    (res as any).write(line);
  } catch {}
}

// 统一选择 Bot（AI 名称未接入时回退到内置）
type BotFunc = (ctx: any) => Promise<any> | any;
function chooseBot(kind: string | undefined, _model?: string, _keys?: any): BotFunc {
  switch ((kind || '').toLowerCase()) {
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
    // AI 选择统一回退（若已接入可替换为真实 Bot）
    case 'ai:openai':
    case 'ai:gemini':
    case 'ai:grok':
    case 'ai:kimi':
    case 'ai:qwen': return GreedyMax as unknown as BotFunc;
    default: return GreedyMax as unknown as BotFunc;
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
  const rounds = singleGameSwitch ? 1 : reqRounds;

  const rob = !!body.rob;
  const four2 = !!body.four2;

  const seats = Array.isArray(body.seats) ? body.seats : [null, null, null];
  const seatModels = body.seatModels || {};
  const seatKeys = body.seatKeys || {};

  // Keep-Alive：心跳
  const __ka = setInterval(() => {
    writeLine(res, { type: 'ping', t: Date.now() });
    try { (res as any).flush?.(); } catch {}
  }, 15000);
  res.on?.('close', () => { try { clearInterval(__ka as any); } catch {} });

  // 组装三个席位的 Bot
  const bots: BotFunc[] = [0, 1, 2].map((i) => {
    const key = (['A', 'B', 'C', 'D'][i] || i) as any;
    const kind: string | undefined =
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

      // 只传必要参数给引擎，避免触发“分片/步进”模式
      const options: any = { seats: bots as any, rob, four2 };

      // 运行整局：直到出现 win 事件才视为本局完成
      let winSeen = false;
      let iter: any;

      // 兼容不同签名
      try {
        iter = (runOneGame as any)(options);
        if (!iter || (typeof iter !== 'object')) {
          iter = (runOneGame as any)(options, undefined);
        }
      } catch {
        iter = (runOneGame as any)(options, undefined);
      }

      try {
        for await (const ev of (iter as any)) {
          writeLine(res, ev);
          if (ev && ev.type === 'event' && ev.kind === 'win') {
            winSeen = true;
          }
        }
      } catch {
        // 回退可迭代对象
        try {
          if (Array.isArray(iter)) {
            for (const ev of iter) {
              writeLine(res, ev);
              if (ev && ev.type === 'event' && ev.kind === 'win') winSeen = true;
            }
          }
        } catch {}
      }

      // 若未见 win，提示一下（极少数异常），但仍结束本请求以免挂起
      if (!winSeen) {
        writeLine(res, { type: 'log', message: '⚠ 引擎本次输出未出现 win 事件，已提前结束本局。' });
      } else {
        writeLine(res, { type: 'log', message: `—— 第 ${gameIndex} 局结束（已出现 win）——` });
      }

      // 单局/请求开关：只跑 1 局（完整到 win）
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
