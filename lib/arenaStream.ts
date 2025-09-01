import { Engine, IBot } from './engine';
import { DefaultRules, RuleConfig } from './rules';
import { BotGreedyMin } from './bots/bot_greedy_min';
import { BotGreedyMax } from './bots/bot_greedy_max';
import { BotRandom } from './bots/bot_random';
import { ProviderSpec, BotHTTP, BotOpenAI, BotGemini } from './providers';

export interface ArenaReq {
  rounds:number; seed:number; rules?:Partial<RuleConfig>;
  delayMs?: number;
  players?: [ProviderSpec, ProviderSpec, ProviderSpec];
  startScore?: number;
}

function makeBot(spec: ProviderSpec, seatIdx: number): IBot {
  const label = '甲乙丙'[seatIdx];
  if (spec.kind==='builtin') {
    if (spec.name==='GreedyMin') return new BotGreedyMin(label + '(内置:GreedyMin)');
    if (spec.name==='GreedyMax') return new BotGreedyMax(label + '(内置:GreedyMax)');
    return new BotRandom(label + '(内置:Random)');
  } else if (spec.kind==='http') {
    return new BotHTTP(spec, label + '(HTTP)');
  } else if (spec.kind==='gemini') {
    return new BotGemini(spec, label + '(Gemini)');
  } else if (spec.kind==='kimi') {
    const base = spec.baseURL || 'https://api.moonshot.cn/v1';
    return new BotOpenAI({ apiKey: spec.apiKey, model: spec.model, baseURL: base }, label + '(Kimi)');
  } else if (spec.kind==='grok') {
    const base = spec.baseURL || 'https://api.x.ai/v1';
    return new BotOpenAI({ apiKey: spec.apiKey, model: spec.model, baseURL: base }, label + '(Grok)');
  } else {
    return new BotOpenAI(spec as any, label + '(OpenAI)');
  }
}

export async function runArenaStream(req: ArenaReq, write:(obj:any)=>void): Promise<void> {
  const rounds = Math.max(1, Math.floor((req.rounds as number) ?? 1));
  const seed = Math.floor((req.seed as number) ?? 42);
  const rules: RuleConfig = { ...DefaultRules, ...(req.rules ?? {}) };
  const delayMs = Math.max(0, Math.min(30000, Math.floor((req.delayMs as number) ?? 0)));
  const startScore = Math.floor((req.startScore as number) ?? 0);

  const defaultBots: IBot[] = [ new BotGreedyMin('甲(内置:GreedyMin)'), new BotGreedyMax('乙(内置:GreedyMax)'), new BotRandom('丙(内置:Random)') ];
  const bots: IBot[] = req.players ? [ makeBot(req.players[0],0), makeBot(req.players[1],1), makeBot(req.players[2],2) ] : defaultBots;

  let totals:[number,number,number] = [startScore,startScore,startScore];
  for (let i=0; i<rounds; i++) {
    write({ type:'event', stage:'ready' });
    write({ type:'event', stage:'round', action:'start', index: i });
    const events:any[] = [];
    const eng = new Engine({ seed: seed + i, rules, moveDelayMs: delayMs, events, onEvent: (ev)=> write({ type:'event', round:i, ...ev }) });
    const log = await eng.playRound([bots[(i+0)%3], bots[(i+1)%3], bots[(i+2)%3]], i);
    write({ type:'event', stage:'round', action:'end', index: i, log });
    totals[0]+=log.scores[0]; totals[1]+=log.scores[1]; totals[2]+=log.scores[2];
    write({ type:'event', kind:'score', totals });
    if (totals[0]<0 || totals[1]<0 || totals[2]<0) { const loser = (totals[0]<0?0:(totals[1]<0?1:2)); write({ type:'event', kind:'terminated', reason:'score-below-zero', totals, loser }); break; }
  }
  write({ type:'done' });
}
