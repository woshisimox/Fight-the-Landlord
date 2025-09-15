// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
// ⬇️ 按需修改成你项目里引擎的真实路径与导出名（需要是 AsyncGenerator / AsyncIterable）
import { myEngineRound } from '../../lib/engine.ts';

type NDJSONLine = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function writeLine(res: NextApiResponse, obj: NDJSONLine) {
  res.write(JSON.stringify(obj) + '\n');
}

/**
 * 运行单局，并确保：
 *  - 局首：发 { type:'event', kind:'round-start', round }
 *  - 过程：透传引擎的消息（发牌/出牌/统计等）
 *  - 局尾：**一定**会发一条 result（即使你的引擎没发 win/result）
 *      {
 *        type: 'result',
 *        round: <number>,
 *        landlord: <0|1|2>,
 *        winner?: <0|1|2>,
 *        deltaScores: [L, L+1, L+2], // 注意顺序：以地主为第 0 位顺时针
 *        multiplier: <number>        // 缺省为 1
 *      }
 *  - 最后：发 { type:'event', kind:'round-end', round, seenWin, seenStats:true }
 */
async function runOneRoundWithGuard(res: NextApiResponse, roundNo: number, body: any) {
  let seenWin = false;
  let seenStats = false;

  // 用于汇总“最终结果”
  let finalWinner = -1;
  let finalMultiplier = 1;
  let finalDelta: number[] | null = null;

  // 过程中提取到的关键状态
  let landlord = -1;
  let rem: number[] | null = null; // 若你的事件里带“剩余牌数”，可用于推断 winner

  // 如果你想在局尾发送后端算好的 TrueSkill，可在这里封装：
  const emitFinalIfNeeded = () => {
    // 例如：
    // writeLine(res, { type:'ts', where:'after-round', ratings:[ {mu,sigma}, {mu,sigma}, {mu,sigma} ] });
  };

  // —— 局尾“统一输出 result”（本补丁核心）
  const emitResultIfNeeded = () => {
    if (finalWinner < 0 && Array.isArray(rem)) {
      const z = rem.findIndex((v) => v === 0);
      if (z >= 0) finalWinner = z;
    }
    if (!finalDelta && landlord >= 0) {
      finalDelta = finalWinner === landlord ? [2, -1, -1] : [-2, 1, 1];
    }
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

  // —— 发一个 round-start（方便前端 UI 对齐局号）
  writeLine(res, { type: 'event', kind: 'round-start', round: roundNo });

  // —— 使用“你的”引擎（AsyncGenerator/AsyncIterable）
  //     可按需增加/修改参数；这里把常见配置从 body 透传过去
  const iter: AsyncIterable<any> = myEngineRound({
    round: roundNo,
    seats: Array.isArray(body?.seats) ? body.seats.slice(0, 3) : [],
    farmerCoop: !!body?.farmerCoop,
    four2: body?.four2,
    rob: !!body?.rob,
    seatDelayMs: body?.seatDelayMs,
    startScore: body?.startScore,
    clientTraceId: body?.clientTraceId,
    stopBelowZero: body?.stopBelowZero,
  } as any);

  try {
    for await (const msg of iter as any) {
      // 1) 先透传给前端
      writeLine(res, msg);

      // 2) 抽取关键字段（名字尽量宽容）
      if (typeof msg?.landlord === 'number') landlord = msg.landlord;
      const maybeHands = msg?.hands ?? msg?.init?.hands ?? msg?.state?.hands ?? msg?.payload?.hands;
      if (Array.isArray(maybeHands) && typeof msg?.landlord === 'number') {
        landlord = msg.landlord;
      }
      if (Array.isArray(msg?.rem)) rem = msg.rem;

      // 3) 识别“胜负”并抓取 winner / 分差 / 倍数（若你的引擎有给）
      const isWin =
        (msg?.type === 'event' && msg?.kind === 'win') ||
        String(msg?.type || '').toLowerCase() === 'win' ||
        String(msg?.kind || '').toLowerCase() === 'win';

      if (isWin) {
        seenWin = true;
        if (typeof msg?.winner === 'number') finalWinner = msg.winner;
        if (typeof msg?.multiplier === 'number') finalMultiplier = msg.multiplier;
        const ds = msg?.deltaScores || msg?.delta || msg?.scoresDelta;
        if (Array.isArray(ds) && ds.length === 3) finalDelta = ds.slice(0, 3);
        emitFinalIfNeeded(); // 有些引擎到这就停流了，先补一次统计
      }

      // 4) 统计类（雷达图用），你可以直接发 {type:'stats', agg:[...] }
      if (String(msg?.type || '').toLowerCase() === 'stats') {
        seenStats = true;
      }
    }
  } catch (err) {
    // 异常情况下也把尾声补齐，保持协议稳定
    emitFinalIfNeeded();
    emitResultIfNeeded();
    writeLine(res, { type: 'event', kind: 'round-end', round: roundNo, seenWin: false, seenStats });
    return;
  }

  // 正常结尾：确保“有 result”，再发 round-end
  emitFinalIfNeeded();
  emitResultIfNeeded();
  writeLine(res, { type: 'event', kind: 'round-end', round: roundNo, seenWin, seenStats: true });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const body = req.body || {};
  const rounds = Math.max(1, Math.floor(Number(body?.rounds) || 1));

  try {
    for (let i = 0; i < rounds; i++) {
      await runOneRoundWithGuard(res, i + 1, body);
      await sleep(10); // 小间隔，避免相邻两局拼在同一个 TCP 包里
    }
  } catch (e: any) {
    writeLine(res, { type: 'error', message: e?.message || String(e) });
  } finally {
    res.end();
  }
}
