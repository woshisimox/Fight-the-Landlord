

// === Bid-by-threshold (Plan B): 统一评分口径 + 各算法阈值（按 bot 函数名判断） ===
const __BID_THRESHOLDS_BY_NAME: Record<string, number> = {
  'greedymax':   1.6,
  'allysupport': 1.8,
  'randomlegal': 2.0,
  'endgamerush': 2.1,
  'mininet':     2.2,
  'greedymin':   2.4,
};

function __botBidThreshold(bot: any): number {
  try {
    const nm = String(bot?.name || bot?.constructor?.name || '').toLowerCase();
    if (__BID_THRESHOLDS_BY_NAME[nm] != null) return __BID_THRESHOLDS_BY_NAME[nm];
  } catch {}
  return 1.8; // 默认兜底
}

export function __decideRobByThreshold(bot: any, hand: Label[]): { rob: boolean; score: number } {
  const score = evalRobScore(hand);            // 统一口径的 bidScore（不含底牌）
  const th = __botBidThreshold(bot);
  const rob = Number.isFinite(score) ? (score >= th) : false;
  return { rob, score };
}

// lib/engine.ts
// 统一导出入口：从 ./doudizhu/engine 转发，并提供 IBot 类型别名。
// ⚠️ 不再导入/导出 EventObj，以兼容精简/占位引擎。

import {
  runOneGame,
  GreedyMax,
  GreedyMin,
  RandomLegal,
  type Four2Policy,
  type Label,
  type BotMove,
  type BotCtx,
  type BotFunc,
} from './doudizhu/engine';

export type IBot = BotFunc;

export { runOneGame, GreedyMax, GreedyMin, RandomLegal };
export type { Four2Policy, Label, BotMove, BotCtx };

// 兼容别名
export const BotGreedyMax = GreedyMax;
export const BotGreedyMin = GreedyMin;
export const BotRandomLegal = RandomLegal;

type EngineOpts = {
  four2?: Four2Policy;
  delayMs?: number;
};

export class Engine {
  private opts: EngineOpts;
  constructor(opts?: EngineOpts) { this.opts = opts || {}; }
  run(seats: [IBot, IBot, IBot], extra?: Partial<EngineOpts>) {
    const four2 = extra?.four2 ?? this.opts.four2 ?? 'both';
    const delayMs = extra?.delayMs ?? this.opts.delayMs ?? 1000;
    return runOneGame({ seats, four2, delayMs } as any);
  }
}
