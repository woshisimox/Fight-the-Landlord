// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ！！把这行替换成你项目真实的引擎导入路径（保持你原来的）
// 常见：'@/lib/arena' / '@/server/arena' / '@/lib/doudizhu'
import { runRound } from '@/lib/arena'; // ⬅️ 示例

type Four2Policy = 'both' | '2singles' | '2pairs';

function writeLine(res: NextApiResponse, obj: any) {
  res.write(JSON.stringify(obj) + '\n');
}

/** 把任意别名统一成引擎认可的驼峰键名 */
function normalizeSeatChoice(x: string): string {
  const s = String(x || '').trim().toLowerCase();

  // 内置 bots
  if ([
    'built-in:greedy-max','builtin:greedy-max','builtin.greedy-max','builtin.greedy.max',
    'greedy-max','greedymax','builtin.greedymax'
  ].includes(s)) return 'builtin.greedyMax';

  if ([
    'built-in:greedy-min','builtin:greedy-min','builtin.greedy-min','builtin.greedy.min',
    'greedy-min','greedymin','builtin.greedymin'
  ].includes(s)) return 'builtin.greedyMin';

  if ([
    'built-in:random-legal','builtin:random-legal','builtin.random-legal','random-legal',
    'random','builtin.random','builtin.randomlegal','randomlegal'
  ].includes(s)) return 'builtin.randomLegal';

  // AI / HTTP
  if (s.startsWith('ai:openai')) return 'ai.openai';
  if (s.startsWith('ai:gemini')) return 'ai.gemini';
  if (s.startsWith('ai:grok'))   return 'ai.grok';
  if (s.startsWith('ai:kimi'))   return 'ai.kimi';
  if (s.startsWith('ai:qwen'))   return 'ai.qwen';
  if (s === 'http')              return 'http';

  // 已经是驼峰或其它：原样返回
  return x;
}

/** 规整 seats：把 choice 收敛，保留其余参数（model、apiKey 等） */
function normalizeSeats(rawSeats: any[]): any[] {
  return (rawSeats || []).slice(0, 3).map((s: any) => {
    const choice = normalizeSeatChoice(s?.choice ?? s);
    if (typeof s === 'string') return { choice };
    return { ...s, choice };
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  try {
    const {
      rounds = 1,
      startScore = 100,
      seatDelayMs = [0,0,0],
      enabled = true,
      rob = true,
      four2 = 'both',
      seats = [],
      clientTraceId = '',
      stopBelowZero = false,
      farmerCoop = true,
    } = (req.body || {});

    const seatsNorm = normalizeSeats(seats);

    writeLine(res, { type:'debug', phase:'pre-run', seatsNorm: seatsNorm.map(s=>s.choice) });
    writeLine(res, { type:'ts', round: 0, seats: [
      { mu: 1000, sigma: 1000/3, rc: 0 },
      { mu: 1000, sigma: 1000/3, rc: 0 },
      { mu: 1000, sigma: 1000/3, rc: 0 },
    ]});
    writeLine(res, { type:'debug', phase:'rules', four2 });

    const runWith = async (rule: Four2Policy) => {
      await runRound({
        rounds,
        startScore,
        seatDelayMs,
        enabled,
        rob,
        four2: rule,
        seats: seatsNorm,
        clientTraceId,
        stopBelowZero,
        farmerCoop,
        onEvent: (obj: any) => writeLine(res, obj),
      });
    };

    // 先试用户配置的规则；若实现表出错则尝试回退
    try {
      await runWith(four2 as Four2Policy);
    } catch (e) {
      writeLine(res, { type:'warn', message:'检测到规则实现表调用异常，尝试回退 four2=2singles' });
      writeLine(res, { type:'debug', phase:'rules', four2:'2singles' });
      try {
        await runWith('2singles');
      } catch (e2) {
        writeLine(res, { type:'error', message:'回退 2singles 仍异常：' + (e2 as any)?.message });
        writeLine(res, { type:'warn', message:'继续回退 four2=2pairs' });
        writeLine(res, { type:'debug', phase:'rules', four2:'2pairs' });
        try {
          await runWith('2pairs');
        } catch (e3) {
          writeLine(res, { type:'error', message:'回退 2pairs 仍异常：' + (e3 as any)?.message });
        }
      }
    }

    res.end();
  } catch (err: any) {
    writeLine(res, { type:'error', message:`事件循环异常：${err?.message || err}`, stack: err?.stack });
    try { res.end(); } catch {}
  }
}
