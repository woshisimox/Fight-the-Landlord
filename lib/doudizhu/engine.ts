

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

export function __decideRobByThreshold(bot: any, hand: any[]): { rob: boolean; score: number } {
  const score = __sharedBidScore(hand);            // 统一口径的 bidScore（不含底牌）
  const th = __botBidThreshold(bot);
  const rob = Number.isFinite(score) ? (score >= th) : false;
  return { rob, score };
}

// lib/engine.ts
// 统一导出入口：从 ./doudizhu/engine 转发，并提供 IBot 类型别名。
// ⚠️ 不再导入/导出 EventObj，以兼容精简/占位引擎。

import {

// === Shared bid score (self-contained, no deps) ===
function __sharedBidScore(hand: any[]): number {
  try {
    const cnt = new Map<string, number>();
    for (const c of (hand || [])) {
      const s = String(c ?? '');
      const r = s.slice(-1); // rank char: 3..9,T,J,Q,K,A,2,x,X
      cnt.set(r, (cnt.get(r) || 0) + 1);
    }
    const hasRocket = (cnt.get('x') || 0) > 0 && (cnt.get('X') || 0) > 0;
    let bombs = 0;
    for (const [, n] of cnt) if (n === 4) bombs++;
    const twos = cnt.get('2') || 0;
    const As   = cnt.get('A') || 0;
    let score = 0;
    if (hasRocket) score += 4;
    score += bombs * 2;
    if (twos >= 2) score += 1 + Math.max(0, twos - 2) * 0.5;
    if (As >= 3)   score += (As - 2) * 0.4;
    return score;
  } catch { return 0; }
}
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
