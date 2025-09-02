// lib/arenaWeb.ts
import type { RuleConfig, RoundLog } from './types';
import { Engine } from './engine';
import type { IBot, ProviderSpec } from './bots';
import { BotRandom, BotGreedyMax, BotGreedyMin, BotHTTP, BotOpenAI, BotGemini, BotKimi, BotGrok } from './bots';

export type PlayerSpec = ProviderSpec;

export function makeBot(spec: PlayerSpec, seatIdx: number): IBot {
  const label = '甲乙丙'[seatIdx];
  if (spec.kind==='builtin'){
    if (spec.name==='GreedyMin') return new BotGreedyMin(`${label}(内置:GreedyMin)`);
    if (spec.name==='GreedyMax') return new BotGreedyMax(`${label}(内置:GreedyMax)`);
    return new BotRandom(`${label}(内置:Random)`);
  }
  switch(spec.kind){
    case 'http': return new BotHTTP(`${label}(HTTP)`, spec);
    case 'openai': return new BotOpenAI(`${label}(OpenAI)`, spec);
    case 'gemini': return new BotGemini(`${label}(Gemini)`, spec);
    case 'kimi': return new BotKimi(`${label}(Kimi)`, spec);
    case 'grok': return new BotGrok(`${label}(Grok)`, spec);
    default: return new BotRandom(`${label}(内置:Random)`);
  }
}

export async function runArenaInMemory(
  rules: RuleConfig,
  players: [PlayerSpec, PlayerSpec, PlayerSpec],
  rounds: number,
  delayMs: number,
  onEmit: (line: string)=>void
): Promise<{ logs: RoundLog[], totals: [number,number,number] }> {

  const totals: [number,number,number] = [0,0,0];
  const logs: RoundLog[] = [];
  onEmit(JSON.stringify({ type:'event', stage:'ready' })+'\n');

  for (let i=0;i<rounds;i++){
    onEmit(JSON.stringify({ type:'event', stage:'round', action:'start', index:i })+'\n');

    const engine = new Engine(rules, (ev: any)=> onEmit(JSON.stringify({ type:'event', round:i, ...ev })+'\n'));
    const bots = [makeBot(players[0],0), makeBot(players[1],1), makeBot(players[2],2)];
    const log = await engine.playRound(bots, i);
    logs.push(log);
    totals[0]+=log.scores[0]; totals[1]+=log.scores[1]; totals[2]+=log.scores[2];

    onEmit(JSON.stringify({ type:'event', stage:'round', action:'end', index:i, log })+'\n');
    onEmit(JSON.stringify({ type:'event', kind:'score', totals })+'\n');

    if (delayMs>0) await new Promise(r=>setTimeout(r, Math.min(1000, delayMs)));
  }

  onEmit(JSON.stringify({ type:'event', stage:'ready' })+'\n');
  return { logs, totals };
}
