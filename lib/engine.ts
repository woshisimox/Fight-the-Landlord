// lib/engine.ts
import {
  runOneGame,
  GreedyMax,
  GreedyMin,
  RandomLegal,
  type EventObj,
  type Four2Policy,
  type BotFunc,
  type BotMove,
  type BotCtx,
  type Label,
} from './doudizhu/engine';

// In this project, an "IBot" is just a function matching the BotFunc signature.
export type IBot = BotFunc;

export class Engine {
  private opts?: { four2?: Four2Policy; delayMs?: number };
  constructor(opts?: { four2?: Four2Policy; delayMs?: number }) {
    this.opts = opts;
  }
  async *run(players: [IBot, IBot, IBot], seed = 0): AsyncGenerator<EventObj> {
    yield* runOneGame({
      seed,
      players,
      four2: this.opts?.four2 ?? 'both',
      // Default interval to 1000ms unless explicitly provided
      delayMs: this.opts?.delayMs ?? 1000,
    });
  }
}

export const BotGreedyMin = GreedyMin;
export const BotGreedyMax = GreedyMax;
export const BotRandomLegal = RandomLegal;

export type { Four2Policy, Label, EventObj, BotMove, BotCtx };
