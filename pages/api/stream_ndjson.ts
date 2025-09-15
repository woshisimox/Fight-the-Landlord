// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * 这个 API 以 NDJSON 形式把每局过程流式写给前端。
 * 关键点（前端依赖）：
 *  - 局首：可发 { type:'event', kind:'round-start', round }
 *  - 发牌：发一个携带 hands 与 landlord 的对象（字段名你自由，这里示例用 { hands, landlord }）
 *  - 过程：随便发 event（如 bot-call / bot-done / play / pass / rob / trick-reset 等）
 *  - 结果（很关键！）：无论引擎是否发，这个版本都会在局尾输出：
 *      {
 *        type: 'result',
 *        round: <number>,
 *        landlord: <0|1|2>,
 *        winner: <0|1|2> | undefined,
 *        deltaScores: [L, L+1, L+2],  // 注意：此处 *永远* 以地主为第 0 位的顺时针顺序
 *        multiplier: <number>         // 缺省则为 1
 *      }
 *    前端会根据 landlord 把 deltaScores 旋转成“甲/乙/丙”的口径，并据此更新 TrueSkill/总分/剩余局数。
 *  - 局尾：{ type:'event', kind:'round-end', round, seenWin:<boolean>, seenStats:<boolean> }
 *
 * 如果你已经有真实引擎，请替换 getEngineIterator() 里 MOCK 的实现；其余逻辑保持不变即可。
 */

// ——————————————————————————————————————————— 工具
type NDJSONLine = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function writeLine(res: NextApiResponse, obj: NDJSONLine) {
  res.write(JSON.stringify(obj) + '\n');
}

// 将 body 中的 seats 描述轻量标准化（供 mock 用；真实引擎可忽略）
function summarizeSeat(s: any) {
  if (!s || typeof s !== 'object') return 'unknown';
  if ((s.choice || '').startsWith('built-in')) return s.choice;
  if (s.choice === 'http') return `http:${s.baseUrl ? 'custom' : 'default'}`;
  if ((s.choice || '').startsWith('ai:')) return `${s.choice}:${s.model || 'default'}`;
  return String(s.choice || 'unknown');
}

// ——————————————————————————————————————————— MOCK 引擎
/**
 * 如果你已经有真实引擎，这个函数可以直接改成：
 *    return yourRealEngineIterator({ ...opts });
 * 其余函数不动即可。
 */
async function* getEngineIterator(opts: {
  round: number;
  farmerCoop?: boolean;
  seats: any[];
}) {
  const round = opts.round;
  // 随机指定地主与赢家
  const landlord = Math.floor(Math.random() * 3);
  const winner = Math.random() < 0.5 ? landlord : ([0, 1, 2].find((x) => x !== landlord) as number);
  // 简化的分差（以地主为第 0 位口径）
  const deltaScores = winner === landlord ? [2, -1, -1] : [-2, 1, 1];
  const multiplier = 1;

  // —— round-start
  yield { type: 'event', kind: 'round-start', round };

  // —— 发牌（字段名你可以替换成你的引擎已有字段；前端会宽容匹配）
  yield {
    hands: [
      // 仅演示；真实可以填 17/17/20 张经过装饰的字符串
      ['♠A', '♥A', '♦K'],
      ['♣Q', '♠J', '♥9'],
      ['♦8', '♣7', '♠6'],
    ],
    landlord,
    init: { landlord, seats: opts.seats.map(summarizeSeat) },
  };

  // —— 随便模拟两三条调用/出牌事件
  yield { type: 'event', kind: 'bot-call', seat: (landlord + 1) % 3, by: 'engine', phase: 'play' };
  await sleep(50);
  yield {
    type: 'event',
    kind: 'play',
    seat: (landlord + 1) % 3,
    move: 'play',
    cards: ['♠6'],
    reason: '随机打出 6',
  };
  await sleep(50);
  yield { type: 'event', kind: 'bot-done', seat: (landlord + 1) % 3, by: 'engine', tookMs: 42 };

  // —— 你也可以在此发更丰富的统计类消息（前端会用于雷达图）
  yield {
    type: 'stats',
    agg: [
      { coop: 2.6, agg: 2.3, cons: 2.4, eff: 2.7, rob: 2.5 },
      { coop: 2.4, agg: 2.5, cons: 2.3, eff: 2.6, rob: 2.4 },
      { coop: 2.5, agg: 2.4, cons: 2.5, eff: 2.5, rob: 2.5 },
    ],
  };

  // —— 在这里我们也发一条“win”（如果你的真实引擎不会发，这条就当示例；主逻辑会兜底生成 result）
  yield {
    type: 'event',
    kind: 'win',
    winner,
    landlord,
    deltaScores, // 注意：这里按“以地主为第 0 位”的顺序
    multiplier,
  };

  // 模拟流结束
  return;
}

// ——————————————————————————————————————————— 每局执行（带安全兜底）
async function runOneRoundWithGuard(res: NextApiResponse, roundNo: number, body: any) {
  // 标识位
  let seenWin = false;
  let seenStats = false;

  // 这几个字段用于“结果兜底/统一输出”
  let finalWinner = -1;
  let finalMultiplier = 1;
  let finalDelta: number[] | null = null;

  // 从事件中提取的关键信息
  let landlord = -1;
  let rem: number[] | null = null; // 你若在事件里带了剩余手牌张数，可赋值给它，用于推断 winner

  // 统一的“统计兜底”（可按需扩展，如你要在这里做一次后端 TrueSkill 也行）
  const emitFinalIfNeeded = () => {
    // 如果希望在局尾推送一个 “ts/after-round”，可在这里计算并 writeLine：
    // writeLine(res, { type:'ts', where:'after-round', ratings:[ {mu,sigma}, {mu,sigma}, {mu,sigma} ] });
  };

  // ★★★ 本补丁的核心：总是输出一条 result ★★★
  const emitResultIfNeeded = () => {
    // winner 未定就尝试用 rem 推断（谁先到 0 张）
    if (finalWinner < 0 && Array.isArray(rem)) {
      const z = rem.findIndex((v) => v === 0);
      if (z >= 0) finalWinner = z;
    }
    // 构造一个最小可用的 deltaScores（以 L 开头顺时针）
    if (!finalDelta && landlord >= 0) {
      finalDelta = finalWinner === landlord ? [2, -1, -1] : [-2, 1, 1];
    }
    // 统一输出（需要知道 landlord）
    if (landlord >= 0) {
      writeLine(res, {
        type: 'result',
        round: roundNo,
        landlord,
        winner: finalWinner >= 0 ? finalWinner : undefined,
        deltaScores: finalDelta,
        multiplier: finalMultiplier,
      });
    }
  };

  // 运行一局（用真实引擎替换 getEngineIterator 即可）
  const iter = getEngineIterator({
    round: roundNo,
    farmerCoop: !!body?.farmerCoop,
    seats: Array.isArray(body?.seats) ? body.seats.slice(0, 3) : [],
  });

  // round-start
  writeLine(res, { type: 'event', kind: 'round-start', round: roundNo });

  try {
    for await (const msg of iter as any) {
      // 透传
      writeLine(res, msg);

      // —— 抽取 landlord / rem 等关键信息（字段名尽量宽容）
      if (typeof (msg?.landlord) === 'number') landlord = msg.landlord;
      const maybeHands = msg?.hands ?? msg?.init?.hands ?? msg?.state?.hands ?? msg?.payload?.hands;
      if (Array.isArray(maybeHands) && typeof msg?.landlord === 'number') {
        landlord = msg.landlord;
      }
      if (Array.isArray(msg?.rem)) rem = msg.rem;

      // —— 识别 win，并尽量抓 winner / 倍数 / 分差
      if ((msg?.type === 'event' && msg?.kind === 'win') || String(msg?.type).toLowerCase() === 'win') {
        seenWin = true;

        if (typeof msg?.winner === 'number') finalWinner = msg.winner;
        if (typeof msg?.multiplier === 'number') finalMultiplier = msg.multiplier;

        const ds = msg?.deltaScores || msg?.delta || msg?.scoresDelta;
        if (Array.isArray(ds) && ds.length === 3) finalDelta = ds.slice(0, 3);

        // 有些引擎不会再发任何“局尾”，我们提前记一次统计
        emitFinalIfNeeded();
      }

      // —— 统计类（用于雷达图）
      if (String(msg?.type).toLowerCase() === 'stats') {
        seenStats = true;
      }
    }
  } catch (err) {
    // 捕获异常也要把局尾补齐
    emitFinalIfNeeded();
    emitResultIfNeeded();
    writeLine(res, { type: 'event', kind: 'round-end', round: roundNo, seenWin: false, seenStats });
    return;
  }

  // 正常局尾：先补统计，再统一输出 result，再发 round-end
  emitFinalIfNeeded();
  emitResultIfNeeded();
  writeLine(res, { type: 'event', kind: 'round-end', round: roundNo, seenWin, seenStats: true });
}

// ——————————————————————————————————————————— 主处理函数
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 建议禁用默认的压缩中间件以便更顺畅地 streaming
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 一些 Node 环境需要明确 chunked（Next 一般会自动）
  // res.setHeader('Transfer-Encoding', 'chunked');

  const body = req.body || {};
  const rounds = Math.max(1, Math.floor(Number(body?.rounds) || 1));

  try {
    for (let i = 0; i < rounds; i++) {
      await runOneRoundWithGuard(res, i + 1, body);
      // 小间隔，避免连续局粘在一起
      await sleep(10);
    }
  } catch (e: any) {
    writeLine(res, { type: 'error', message: e?.message || String(e) });
  } finally {
    // 结束响应
    res.end();
  }
}
