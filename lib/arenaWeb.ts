import type { RuleConfig, RoundLog } from './types';
import type { IBot } from './bots';
import { BotRandom, BotGreedyMin, BotGreedyMax } from './bots';
import { BotHTTP, BotOpenAI, BotGemini, BotKimi, BotGrok, ProviderSpec } from './providers';
import { Engine } from './engine';
export type PlayerSpec = ProviderSpec;
export function makeBot(spec: PlayerSpec, seatIdx: number): IBot {
  const label = '甲乙丙'[seatIdx];
  if (spec.kind==='builtin'){ if (spec.name==='GreedyMin') return new BotGreedyMin(`${label}(内置:GreedyMin)`);
    if (spec.name==='GreedyMax') return new BotGreedyMax(`${label}(内置:GreedyMax)`); return new BotRandom(`${label}(内置:Random)`); }
  switch (spec.kind){ case 'http': return new BotHTTP(`${label}(HTTP)`, spec); case 'openai': return new BotOpenAI(`${label}(OpenAI)`, spec);
    case 'gemini': return new BotGemini(`${label}(Gemini)`, spec); case 'kimi': return new BotKimi(`${label}(Kimi)`, spec); case 'grok': return new BotGrok(`${label}(Grok)`, spec);
    default: return new BotRandom(`${label}(内置:Random)`); }
}
export async function runArenaInMemory(rounds: number, rules: RuleConfig, players: [PlayerSpec,PlayerSpec,PlayerSpec], emit: (line: any)=>void
): Promise<{ rounds: RoundLog[], totals: [number,number,number], endedEarly: boolean }>{ const results: RoundLog[] = []; const totals: [number,number,number] = [0,0,0]; let endedEarly = false as any
  ; for (let i=0;i<rounds;i++){ const engine = new Engine(rules, (ev:any)=>emit({ type:'event', round:i, ...ev })); const bots: IBot[] = [ makeBot(players[0],0), makeBot(players[1],1), makeBot(players[2],2) ];
    emit({ type:'event', stage:'round', action:'start', index:i }); const log = await engine.playRound(bots, i); results.push(log);
    emit({ type:'event', stage:'round', action:'end', index:i, log }); totals[0]+=log.scores[0]; totals[1]+=log.scores[1]; totals[2]+=log.scores[2];
    emit({ type:'event', kind:'score', totals: totals.slice() }); if (totals[0] < 0 || totals[1] < 0 || totals[2] < 0){ endedEarly = true; break; } }
  return { rounds: results, totals, endedEarly }; }