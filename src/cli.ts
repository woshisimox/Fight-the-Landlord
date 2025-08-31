#!/usr/bin/env node
import { DefaultRules, RuleConfig } from './game/rules';
import { runArena } from './match/arena';
import { BotGreedyMin } from './bots/bot_greedy_min';
import { BotGreedyMax } from './bots/bot_greedy_max';
import { BotRandom } from './bots/bot_random';

function parseArgs(argv: string[]): Record<string, string|number|boolean> {
  const args: Record<string, string|number|boolean> = {};
  for (let i=2;i<argv.length;i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k,v] = a.slice(2).split('=');
      if (v===undefined) args[k] = true;
      else if (v==='true' || v==='false') args[k] = (v==='true');
      else if (!isNaN(Number(v))) args[k] = Number(v);
      else args[k] = v;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const rounds = (args.rounds as number) ?? 10;
const seed = (args.seed as number) ?? 42;
const outDir = (args.log as string) ?? './logs';

const rules: RuleConfig = { ...DefaultRules };
if (typeof args.rob==='boolean') rules.bidding = args.rob ? 'rob' : 'call-score';
if (typeof args.four2==='string') {
  const m = args.four2 as '2singles'|'2pairs'|'both';
  rules.fourWithTwo = m;
}

const bots = [
  new BotGreedyMin('甲(A)-GreedyMin'),
  new BotGreedyMax('乙(B)-GreedyMax'),
  new BotRandom('丙(C)-RandomLegal'),
];

runArena({ rounds, seed, rules, outDir, bots });
console.log(`Done. Results saved to ${outDir}`);
