
// lib/engine.ts
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

export type IBot = BotFunc;

export class Engine {
  [k: string]: any;
  constructor(public opts?: { four2?: Four2Policy; delayMs?: number }) {}
  async *run(players: [IBot, IBot, IBot], seed = 0): AsyncGenerator<EventObj> {
    yield* runOneGame({
      seed,
      players,
      four2: this.opts?.four2 ?? 'both',
      delayMs: this.opts?.delayMs ?? 0,
    });
  }
}

export const BotGreedyMax = GreedyMax;
export const BotGreedyMin = GreedyMin;
export const BotRandomLegal = RandomLegal;

export type { Four2Policy, Label, EventObj };
