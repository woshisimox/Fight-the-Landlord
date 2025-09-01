import { Engine, IBot } from './engine';
import { DefaultRules, RuleConfig } from './rules';
import type { RoundLog } from './types';
import { BotGreedyMin } from './bots/bot_greedy_min';
import { BotGreedyMax } from './bots/bot_greedy_max';
import { BotRandom } from './bots/bot_random';
import { ProviderSpec, BotHTTP, BotOpenAI, BotGemini } from './providers';

export interface ArenaReq {
  rounds:number; seed:number; rules?:Partial<RuleConfig>;
  delayMs?: number;
  players?: [ProviderSpec, ProviderSpec, ProviderSpec];
}
export interface ArenaResp { rounds:number; logs:RoundLog[]; totals:[number,number,number]; }

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

export async function runArenaInMemory(req: ArenaReq): Promise<ArenaResp> {
  const rounds = Math.max(1, Math.floor((req.rounds as number) ?? 10));
  const seed = Math.floor((req.seed as number) ?? 42);
  const rules: RuleConfig = { ...DefaultRules, ...(req.rules ?? {}) };
  const delayMs = Math.max(0, Math.min(30000, Math.floor((req.delayMs as number) ?? 0)));

  const defaultBots: IBot[] = [ new BotGreedyMin('甲(内置:GreedyMin)'), new BotGreedyMax('乙(内置:GreedyMax)'), new BotRandom('丙(内置:Random)') ];
  const bots: IBot[] = req.players ? [ makeBot(req.players[0],0), makeBot(req.players[1],1), makeBot(req.players[2],2) ] : defaultBots;

  const logs: RoundLog[] = [];
  const totals:[number,number,number] = [0,0,0];

  for (let i=0; i<rounds; ) {
    const rot = (idx:number)=> bots[(i+idx)%3];
    const trio = [rot(0), rot(1), rot(2)];
    const events: any[] = [];
    const eng = new Engine({ seed: seed + i, rules, moveDelayMs: delayMs, events });
    const log = await eng.playRound(trio, i);
    if (!log) continue;
    logs.push(log);
    totals[0]+=log.scores[0]; totals[1]+=log.scores[1]; totals[2]+=log.scores[2];
    i++;
  }
  return { rounds, logs, totals };
}
