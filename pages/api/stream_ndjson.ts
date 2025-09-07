// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runSeries, type RunOptions, type Emit } from '../../lib/doudizhu/engine';

// 小工具：安全写一行 NDJSON
function writeLine(res: NextApiResponse, obj: unknown) {
  res.write(JSON.stringify(obj) + '\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // 读取前端传参（保持与现有 index.tsx 对齐）
  const {
    rounds = 10,
    startScore = 100,
    seatDelayMs = [0, 0, 0],
    enabled = true,
    rob = true,
    four2 = 'both',
    seats = ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'],
    seatModels = [],
    seatKeys = [],
    debug = true, // 开启调试日志，方便定位
  } = (req.body || {}) as Partial<RunOptions & any>;

  // 如果未启用对局，直接返回
  if (!enabled) {
    res.status(200).json({ ok: true, message: 'disabled' });
    return;
  }

  // NDJSON 头
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
  res.setHeader('Connection', 'keep-alive');

  let closed = false;
  const onClose = () => { closed = true; };
  res.on('close', onClose);
  res.on('finish', onClose);
  res.on('error', onClose);

  // 事件回调：把引擎事件逐条写出
  const emit: Emit = async (ev) => {
    if (closed) return;
    writeLine(res, ev);
  };

  try {
    // 先写一条开场日志（可选）
    writeLine(res, { type: 'log', message: `准备开始，共 ${rounds} 局` });

    // 运行多局（引擎内部会在每局开始时发 {type:'state',kind:'init',...}）
    await runSeries(
      {
        rounds,
        startScore,
        seatDelayMs,
        enabled: true,
        rob,
        four2,
        seats,
        // seatModels/seatKeys 目前引擎未用，透传即可
        // @ts-expect-error - 兼容透传
        seatModels,
        // @ts-expect-error - 兼容透传
        seatKeys,
        debug,
      },
      emit
    );

    // 结束
    if (!closed) {
      writeLine(res, { type: 'log', message: '全部对局结束' });
      res.end();
    }
  } catch (err: any) {
    if (!closed) {
      writeLine(res, { type: 'log', message: `错误：${err?.message || String(err)}` });
      res.end();
    }
  }
}
