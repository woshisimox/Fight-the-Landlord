

// === Bid-by-threshold (Plan B): shared bidScore + per-bot thresholds ===
// 统一用 evalRobScore(hand) 评估（不含底牌），不同算法用不同阈值决定是否抢
const BID_THRESHOLDS: Record<string, number> = {
  'built-in:greedy-max':   1.6,
  'built-in:ally-support': 1.8,
  'built-in:random-legal': 2.0,
  'built-in:endgame-rush': 2.1,
  'built-in:mininet':      2.2,
  'built-in:greedy-min':   2.4,
};

function __bidThresholdFor(botOrChoice: any): number {
  try {
    // 优先从 choice 字符串判断
    const choice = typeof botOrChoice === 'string'
      ? botOrChoice
      : (botOrChoice?.choice || botOrChoice?.name || '');
    if (choice && BID_THRESHOLDS[choice] != null) return BID_THRESHOLDS[choice] as number;

    // 回退：通过引用判断（兼容老代码路径）
    if (typeof GreedyMax     !== 'undefined' && botOrChoice === GreedyMax)     return 1.6;
    if (typeof AllySupport   !== 'undefined' && botOrChoice === AllySupport)   return 1.8;
    if (typeof RandomLegal   !== 'undefined' && botOrChoice === RandomLegal)   return 2.0;
    if (typeof EndgameRush   !== 'undefined' && botOrChoice === EndgameRush)   return 2.1;
    if (typeof MiniNet       !== 'undefined' && botOrChoice === MiniNet)       return 2.2;
    if (typeof GreedyMin     !== 'undefined' && botOrChoice === GreedyMin)     return 2.4;
  } catch {}
  return 1.8; // 默认兜底
}

export function __decideRobByThreshold(bot: any, hand: Label[]): { rob: boolean; score: number } {
  const score = evalRobScore(hand);
  const th = __bidThresholdFor(bot);
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
