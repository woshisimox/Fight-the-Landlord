import { Engine, makeBot } from './engine';
import { ProviderSpec, RuleConfig, RoundLog } from './types';
import { DefaultRules } from './rules';

export interface ArenaSpec {
  players: ProviderSpec[];  // 3 entries
  rounds: number;
  startScore: number;
  delayMs: number;
}

export async function runArenaInBrowser(spec: ArenaSpec, onEvent:(e:any)=>void): Promise<void> {
  const rules: RuleConfig = DefaultRules;
  const engine = new Engine(rules, onEvent);
  const bots = [0,1,2].map(i=> makeBot(spec.players[i], i));
  let totals: [number,number,number] = [spec.startScore, spec.startScore, spec.startScore];
  onEvent({ type:'event', stage:'ready' });

  for (let r=0; r<spec.rounds; r++) {
    onEvent({ type:'event', stage:'round', action:'start', index:r });
    const log = await engine.playRound(bots, r);
    totals[0]+=log.scores[0]; totals[1]+=log.scores[1]; totals[2]+=log.scores[2];
    onEvent({ type:'event', stage:'round', action:'end', index:r, log });
    onEvent({ type:'event', kind:'score', totals });
    if (spec.delayMs>0) await new Promise(res=>setTimeout(res, spec.delayMs));
    if (totals.some(x=>x<0)) break;
  }
  onEvent({ type:'event', stage:'ready' });
}
