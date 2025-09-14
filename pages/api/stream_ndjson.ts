// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Four2Policy = 'both' | '2singles' | '2pairs';

// ============ 工具：输出一行 NDJSON ============
function writeLine(res: NextApiResponse, obj: any) {
  res.write(JSON.stringify(obj) + '\n');
}

// ============ 关键修复：座位键名归一化 ============
function normalizeSeatChoice(x: string): string {
  const s = String(x || '').trim().toLowerCase();

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

  if (s.startsWith('ai:openai')) return 'ai.openai';
  if (s.startsWith('ai:gemini')) return 'ai.gemini';
  if (s.startsWith('ai:grok'))   return 'ai.grok';
  if (s.startsWith('ai:kimi'))   return 'ai.kimi';
  if (s.startsWith('ai:qwen'))   return 'ai.qwen';
  if (s === 'http')              return 'http';
  return x;
}
function normalizeSeats(rawSeats: any[]): any[] {
  return (rawSeats || []).slice(0, 3).map((s: any) => {
    const choice = normalizeSeatChoice(s?.choice ?? s);
    if (typeof s === 'string') return { choice };
    return { ...s, choice };
  });
}

// ============ 动态加载引擎（避免编译期无法解析路径） ============
type RunRoundFn = (opts: any) => Promise<void>;

function loadRunRound(): RunRoundFn {
  const tryPaths = [
    process.env.ARENA_PATH || '',               // 允许用环境变量显式指定
    '@/lib/arena', '@/server/arena', '@/lib/doudizhu',
    '../../lib/arena', '../../server/arena', '../../lib/doudizhu',
    '../../../lib/arena', '../../../server/arena', '../../../lib/doudizhu',
  ].filter(Boolean);

  for (const p of tryPaths) {
    try {
      // @ts-ignore
      const mod = require(p);
      if (mod?.runRound && typeof mod.runRound === 'function') return mod.runRound as RunRoundFn;
    } catch (_) { /* ignore and try next */ }
  }
  throw new Error(
    '未能找到引擎的 runRound 导出。请在 pages/api/stream_ndjson.ts 里把导入路径改为你项目里实际的引擎模块，' +
    '或设置环境变量 ARENA_PATH 指向正确的模块路径（例如 "@/lib/arena" 或 "../../lib/arena"）。'
  );
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
    writeLine(res, { type:'debug', phase:'pre-run', seatsNorm: seatsNorm.map((s:any)=>s.choice) });
    writeLine(res, { type:'ts', round: 0, seats: [
      { mu: 1000, sigma: 1000/3, rc: 0 },
      { mu: 1000, sigma: 1000/3, rc: 0 },
      { mu: 1000, sigma: 1000/3, rc: 0 },
    ]});
    writeLine(res, { type:'debug', phase:'rules', four2 });

    const runRound = loadRunRound();

    const runWith = async (rule: Four2Policy) => {
      await runRound({
        rounds,
        startScore,
        seatDelayMs,
        enabled,
        rob,
        four2: rule,
        seats: seatsNorm,           // ★ 使用归一化后的 seats
        clientTraceId,
        stopBelowZero,
        farmerCoop,
        onEvent: (obj: any) => writeLine(res, obj),
      });
    };

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
