
// lib/arenaStream.ts
import {
  Engine,
  IBot,
  BotGreedyMin,
  BotGreedyMax,
  BotRandomLegal,
  type EventObj,
  type Four2Policy,
} from './engine';

type BuiltinName = 'GreedyMin' | 'GreedyMax' | 'Random' | 'builtin';

export type BotSpec =
  | { kind: 'builtin'; name?: BuiltinName }
  | { kind: 'http'; base: string; token?: string }
  | { kind: 'openai'; apiKey: string; model?: string }
  | { kind: 'gemini'; apiKey: string; model?: string }
  | { kind: 'grok'; apiKey: string; model?: string };

const seatLabel = (i: number) => '甲乙丙'.charAt(i) || `Seat${i + 1}`;

const asBot = (fn: IBot, _name?: string): IBot => (ctx) => fn(ctx);

export function getBot(spec: BotSpec, seatIdx: number): IBot {
  const label = seatLabel(seatIdx);
  if (spec.kind === 'builtin') {
    const n = (spec.name || 'builtin').toLowerCase();
    if (n === 'greedymin' || n === 'min')   return asBot(BotGreedyMin,  `${label}(内置:GreedyMin)`);
    if (n === 'greedymax' || n === 'max' || n === 'builtin')
                                           return asBot(BotGreedyMax,  `${label}(内置:GreedyMax)`);
    return asBot(BotRandomLegal,            `${label}(内置:Random)`);
  }
  return asBot(BotRandomLegal, `${label}(内置:RandomFallback)`);
}

export async function* arenaStream(
  specs: [BotSpec, BotSpec, BotSpec],
  seed = 0,
  opts?: { four2?: Four2Policy; delayMs?: number }
): AsyncGenerator<EventObj> {
  const engine = new Engine({ four2: opts?.four2 ?? 'both', delayMs: opts?.delayMs ?? 0 });
  const bots: [IBot, IBot, IBot] = [
    getBot(specs[0], 0),
    getBot(specs[1], 1),
    getBot(specs[2], 2),
  ];
  yield* engine.run(bots, seed);
}
