// pages/api/stream_ndjson.ts — single-round NDJSON (auto-end) + stall guards
import type { NextApiRequest, NextApiResponse } from 'next';
// ⚠️ 只依赖 engine 与内置 bot，避免第三方 AI 模块导致编译报错
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type Four2Policy = 'both' | '2singles' | '2pairs';

type Body = {
  rounds?: number;
  startScore?: number;
  seatDelayMs?: number[];
  enabled?: boolean;
  rob?: boolean;
  four2?: Four2Policy;
  seats?: BotChoice[];
  seatModels?: string[];
  seatKeys?: any[];
  debug?: any;
};

function writeLine(res: NextApiResponse, obj: any) {
  // 为了兼容前端 TextDecoder 累积解析，这里确保每行以 \n 结尾
  res.write(JSON.stringify(obj) + '\n');
}

// 将选择映射为“函数型 bot”。为保证稳定性，所有返回 Promise。
function asBot(choice: BotChoice, seatIndex: number) {
  const label = ['甲','乙','丙'][seatIndex] || `Seat${seatIndex}`;
  switch (choice) {
    case 'built-in:greedy-max':
      return async (ctx: any) => {
        const m = await Promise.resolve((GreedyMax as any)(ctx));
        if (m && !m.reason) m.reason = '内置 GreedyMax';
        return m;
      };
    case 'built-in:greedy-min':
      return async (ctx: any) => {
        const m = await Promise.resolve((GreedyMin as any)(ctx));
        if (m && !m.reason) m.reason = '内置 GreedyMin';
        return m;
      };
    case 'built-in:random-legal':
      return async (ctx: any) => {
        const m = await Promise.resolve((RandomLegal as any)(ctx));
        if (m && !m.reason) m.reason = '内置 RandomLegal';
        return m;
      };
    // 外部 AI/HTTP 在本后端统一兜底到 GreedyMax，保证后端可编译、可运行
    case 'ai:openai':
    case 'ai:gemini':
    case 'ai:grok':
    case 'ai:kimi':
    case 'ai:qwen':
    case 'http':
    default:
      return async (ctx: any) => {
        const m = await Promise.resolve((GreedyMax as any)(ctx));
        if (m) {
          const human = choice.startsWith('ai:') ? choice.slice(3) : choice;
          m.reason = `外部AI(${human})未接入后端，已回退内建（GreedyMax）`;
        }
        return m;
      };
  }
}

// 兼容不同 engine 签名：有的需要两个参数，有的一个
function invokeEngine(opts: any): AsyncIterable<any> | AsyncIterator<any> {
  try {
    const anyRun = runOneGame as any;
    if (typeof anyRun === 'function') {
      // 如果声明参数个数 >= 2，则补一个空调试参数
      if ((anyRun.length || 0) >= 2) return anyRun(opts, { });
      return anyRun(opts);
    }
  } catch {}
  throw new Error('runOneGame not available');
}

// 单局执行（带超时、心跳、防卡死）
async function playSingleRound(
  res: NextApiResponse,
  {
    seats,
    rob,
    four2,
    seatDelayMs,
    debug,
    heartbeatSec = 5,
    maxEvents = 4000
  }: {
    seats: ((ctx:any)=>Promise<any>)[];
    rob?: boolean;
    four2?: Four2Policy;
    seatDelayMs?: number[];
    debug?: any;
    heartbeatSec?: number;
    maxEvents?: number;
  }
) {
  // 立即发一个开场心跳，避免浏览器等待
  writeLine(res, { type:'log', message:'—— 单局开始 ——' });

  // 心跳保活
  const ka = setInterval(() => writeLine(res, { type:'ka', t: Date.now() }), Math.max(1, heartbeatSec) * 1000);

  let evCount = 0;
  try {
    const iter: any = invokeEngine({ seats, rob, four2, seatDelayMs, debug });
    // 逐条转发给前端；不改动字段，保持最大兼容
    for await (const ev of (iter as any)) {
      evCount++;
      writeLine(res, ev);
      // 防御：极端情况下限制事件总量，自动判胜以收尾
      if (evCount > maxEvents) {
        writeLine(res, { type:'log', message:`[防卡死] 事件过多(${evCount})，强制收尾。` });
        // 判地主胜（如无法识别 landlord 则默认 0）
        writeLine(res, { type:'event', kind:'win', winner: 0, multiplier: 1, deltaScores: [+2,-1,-1] });
        break;
      }
      // 若事件自身已宣告胜负，许多 engine 会自动结束迭代，这里无需额外 break
    }
  } finally {
    try { clearInterval(ka); } catch {}
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // NDJSON 头
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const body = (req.body || {}) as Body;

  // ★ 强制单局友好：无论前端传 rounds 多大，本接口都只跑 1 局，然后 end()
  const _rounds = 1;

  try {
    const rob = !!body.rob;
    const four2 = (body.four2 || 'both') as Four2Policy;
    const seatKinds: BotChoice[] = (Array.isArray(body.seats) && body.seats.length===3
      ? body.seats
      : ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal']);
    const seatDelayMs = (Array.isArray(body.seatDelayMs) && body.seatDelayMs.length===3
      ? body.seatDelayMs
      : [0,0,0]);

    const bots = seatKinds.map((c, i) => asBot(c, i));

    // 立即一行说明（可选）
    writeLine(res, { type:'log', message:`[server] 单次请求仅进行 1 局；收到 seats=${JSON.stringify(seatKinds)}` });

    // 跑“恰好一局”
    await playSingleRound(res, { seats: bots as any, rob, four2, seatDelayMs, debug: body.debug });

    // 收尾
    writeLine(res, { type:'log', message:'—— 单局结束 ——' });
    res.end();
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端异常：${e?.message || String(e)}` });
    try { res.end(); } catch {}
  }
}
