// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// 你工程里已有的引擎与内置Bot（路径按你的工程结构保持不变）
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';

// ========== 小工具：写一行 NDJSON ==========
function writeLine(res: NextApiResponse, obj: any) {
  try {
    const line = JSON.stringify(obj) + '\n';
    (res as any).write(line);
  } catch {}
}

// ========== 选择 Bot（保持向后兼容：AI 名称回退到内置，以免未接入时报错） ==========
type BotFunc = (ctx: any) => Promise<any> | any;

function chooseBot(kind: string | undefined, _model?: string, _keys?: any): BotFunc {
  switch ((kind || '').toLowerCase()) {
    case 'built-in:greedy-max':
    case 'builtin:greedy-max':
    case 'greedy-max':
      return GreedyMax as unknown as BotFunc;
    case 'built-in:greedy-min':
    case 'builtin:greedy-min':
    case 'greedy-min':
      return GreedyMin as unknown as BotFunc;
    case 'built-in:random-legal':
    case 'builtin:random-legal':
    case 'random-legal':
    case 'random':
      return RandomLegal as unknown as BotFunc;

    // 以下 AI 统一回退到 GreedyMax（若你后续已接入，可在这里替换为真实 Bot）
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

// 关闭 Next 的默认缓存等（可选；有利于流式返回）
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '512kb',
    },
  },
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

  // 参数读取（保持向后兼容你现有前端）
  const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
  const reqRounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
  const singleGameSwitch = process.env.SINGLE_GAME_PER_REQUEST === '1';
  // ★ 开关：为适配 Vercel 时长限制，开启时每次请求只跑 1 局
  const rounds = singleGameSwitch ? 1 : reqRounds;

  const startScore = Number(body.startScore ?? 0);
  const seatDelayMs = Number(body.seatDelayMs ?? 0);
  const enabled = !!body.enabled;
  const rob = !!body.rob;
  const four2 = !!body.four2;

  // 前端可能会传 seat 选择/模型/keys；这里统一选择 Bot（未接 AI 时回退内置，避免报错）
  const seats = Array.isArray(body.seats) ? body.seats : [null, null, null];
  const seatModels = body.seatModels || {};
  const seatKeys = body.seatKeys || {};
  const debug = body.debug ?? {};

  // Keep-Alive：防止中间层过早断开（15s 一次心跳）
  const __ka = setInterval(() => {
    writeLine(res, { type: 'ping', t: Date.now() });
    try { (res as any).flush?.(); } catch {}
  }, 15000);

  // 连接关闭时，清理心跳
  res.on?.('close', () => { try { clearInterval(__ka as any); } catch {} });

  // 组装三个席位的 Bot
  const bots: BotFunc[] = [0, 1, 2].map((i) => {
    const key = (['A', 'B', 'C', 'D'][i] || i) as any; // 兼容历史写法
    const kind: string | undefined =
      seats?.[i]?.kind || seats?.[i] || seatModels?.[i] || seatModels?.[key] || seatModels?.[['E','S','W','N'][i]];
    const model: string | undefined =
      seats?.[i]?.model || seatModels?.[i]?.model || seatModels?.[key]?.model;
    const keysForSeat =
      seatKeys?.[i] || seatKeys?.[key] || seatKeys?.[['E','S','W','N'][i]];
    return chooseBot(kind, model, keysForSeat);
  });

  // 运行日志：首行提示当前是否单局模式
  writeLine(res, {
    type: 'log',
    message: singleGameSwitch
      ? `单局模式已启用：本请求仅运行 1 局（four2=${four2}，原始请求 rounds=${reqRounds}）…`
      : `开始连打 ${rounds} 局（four2=${four2}）…`,
  });

  let okEnded = false;

  try {
    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局开始 ——` });

      // 兼容不同版本的 runOneGame 签名（有的 1 个参数，有的 2 个参数）
      const options: any = {
        seats: bots as any,
        rob,
        four2,
        // 以下若引擎不识别会被忽略；若识别则生效
        startScore,
        seatDelayMs,
        enabled,
        debug,
      };

      let iter: any;
      try {
        // 优先尝试单参
        iter = (runOneGame as any)(options);
        if (!iter || (typeof iter !== 'object')) {
          // 兜底双参
          iter = (runOneGame as any)(options, undefined);
        }
      } catch {
        // 再兜底双参
        iter = (runOneGame as any)(options, undefined);
      }

      // 无论引擎返回 async generator 还是可迭代对象，都尽量 for-await
      // 如果不支持 async iterator，这里会抛，再回退为数组消费
      let consumed = false;
      try {
        for await (const ev of (iter as any)) {
          consumed = true;
          writeLine(res, ev);
        }
      } catch {
        try {
          if (Array.isArray(iter)) {
            consumed = true;
            for (const ev of iter) writeLine(res, ev);
          }
        } catch {}
      }

      // 单局结束标记（方便前端观察续跑）
      writeLine(res, { type: 'log', message: `—— 第 ${round} 局结束 ——` });

      // 若开启“单局/请求”开关，则第一局结束后直接收尾
      if (singleGameSwitch) break;
    }

    okEnded = true;
    // 结束前尽量 flush，随后关闭 keep-alive 并正常结束流
    try { (res as any).flush?.(); } catch {}
    try { clearInterval(__ka as any); } catch {}
    res.end();
  } catch (e: any) {
    writeLine(res, { type: 'log', message: `后端错误：${e?.message || String(e)}` });
    // 异常路径同样确保 flush → 清理 → end
    try { (res as any).flush?.(); } catch {}
    try { clearInterval(__ka as any); } catch {}
    res.end();
  } finally {
    if (!okEnded) {
      try { clearInterval(__ka as any); } catch {}
    }
  }
}
