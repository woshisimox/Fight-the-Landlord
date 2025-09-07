// lib/engine.ts
// 统一导出入口：从 ./doudizhu/engine 转发，并提供 IBot 类型别名。
// 本文件不再依赖 EventObj 类型，以兼容精简引擎实现。

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
