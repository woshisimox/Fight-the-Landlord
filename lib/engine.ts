// lib/engine.ts
// 兼容旧代码的适配层：导出 Engine/IBot，并把调用转到新的 doudizhu 引擎。

import {
  runOneGame,
  GreedyMax,
  GreedyMin,
  RandomLegal,
  type BotFunc,
  type Four2Policy,
  type Label,
  type EventObj,
} from './doudizhu/engine';

// 旧项目里用的类型名：IBot
export type IBot = BotFunc;

// 旧项目里用的类名：Engine
// 提供一个最小实现，带有索引签名，避免类型检查因找不到成员而报错。
// 如需在此类上扩展其它方法，可继续在这里转调到新引擎。
export class Engine {
  [k: string]: any; // 允许旧代码访问任意成员，避免 TS 报错

  constructor(public opts?: { four2?: Four2Policy; delayMs?: number }) {}

  // 旧代码常见的调用：for await (const ev of engine.run(bots, seed)) ...
  async *run(players: [IBot, IBot, IBot], seed = 0): AsyncGenerator<EventObj> {
    yield* runOneGame({
      seed,
      players,
      four2: this.opts?.four2 ?? 'both',
      delayMs: this.opts?.delayMs ?? 0,
    });
  }
}

// 方便旧代码直接拿到内建 bot（如需要）
export const BotGreedyMax = GreedyMax;
export const BotGreedyMin = GreedyMin;
export const BotRandomLegal = RandomLegal;

// 也把若干类型 re-export 出去，便于旧代码引用
export type { Four2Policy, Label, EventObj };
