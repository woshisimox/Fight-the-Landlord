import { Engine } from './engine';
import { DefaultRules, RuleConfig } from './rules';
import type { RoundLog } from './types';
import type { IBot } from './engine';
import { BotGreedyMin } from './bots/bot_greedy_min';
import { BotGreedyMax } from './bots/bot_greedy_max';
import { BotRandom } from './bots/bot_random';

export interface ArenaReq { rounds:number; seed:number; rules?:Partial<RuleConfig>; }
export interface ArenaResp { rounds:number; logs:RoundLog[]; totals:[number,number,number]; }

export function runArenaInMemory(req: ArenaReq): ArenaResp {
  const rounds = Math.max(1, Math.floor((req.rounds as number) ?? 10));
  const seed = Math.floor((req.seed as number) ?? 42);
  const rules: RuleConfig = { ...DefaultRules, ...(req.rules ?? {}) };

  const bots: IBot[] = [ new BotGreedyMin('甲(A)-GreedyMin'), new BotGreedyMax('乙(B)-GreedyMax'), new BotRandom('丙(C)-RandomLegal') ];
  const eng = new Engine({ seed, rules });
  const logs: RoundLog[] = [];
  const totals:[number,number,number] = [0,0,0];

  let i=0; while (i<rounds) {
    const rot = (idx:number)=> bots[(i+idx)%3];
    const trio = [rot(0), rot(1), rot(2)];
    const log = eng.playRound(trio as any, i);
    if (!log) continue;
    logs.push(log);
    totals[0]+=log.scores[0]; totals[1]+=log.scores[1]; totals[2]+=log.scores[2];
    i++;
  }
  return { rounds, logs, totals };
}
