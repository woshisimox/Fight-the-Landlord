import type { BidView, Combo, PlayerView } from './types';
import { enumerateAllCombos, enumerateResponses } from './combos';

export interface IBot {
  label: string;
  bid(view: BidView): Promise<1|2|3|'pass'>;
  play(view: PlayerView): Promise<{ move:'pass', reason: string } | { move:'play', combo: Combo, reason?: string }>;
}

function pickSmallest(legal: Combo[]): Combo {
  return legal.slice().sort((a,b)=> a.mainRank - b.mainRank)[0];
}
function pickLargest(legal: Combo[]): Combo {
  return legal.slice().sort((a,b)=> b.mainRank - a.mainRank)[0];
}

export class BotRandom implements IBot {
  label: string;
  constructor(label: string){ this.label = label; }
  async bid(view: BidView){ 
    const acts: Array<1|2|3|'pass'> = ['pass',1,2,3];
    return acts[Math.floor(Math.random()*acts.length)];
  }
  async play(view: PlayerView){
    const legal = view.require? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (!legal.length) return { move:'pass', reason:'无法跟上，选择过' };
    const c = legal[Math.floor(Math.random()*legal.length)];
    return { move:'play', combo:c, reason: view.lead? '随机领出' : '随机跟牌' };
  }
}

export class BotGreedyMin implements IBot {
  label: string;
  constructor(label: string){ this.label = label; }
  async bid(view: BidView){ return Math.random()<0.3? 1 : 'pass'; }
  async play(view: PlayerView){
    const legal = view.require? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (!legal.length) return { move:'pass', reason:'无法跟上，选择过' };
    const c = pickSmallest(legal);
    const reason = view.lead? '首家最小领出' : '能压就打最小';
    return { move:'play', combo:c, reason };
  }
}

export class BotGreedyMax implements IBot {
  label: string;
  constructor(label: string){ this.label = label; }
  async bid(view: BidView){ return Math.random()<0.5? 2 : 'pass'; }
  async play(view: PlayerView){
    const legal = view.require? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (!legal.length) return { move:'pass', reason:'无法跟上，选择过' };
    const c = pickLargest(legal);
    const reason = view.lead? '首家最大领出' : '能压就打最大';
    return { move:'play', combo:c, reason };
  }
}

// HTTP & LLM bots
export type ProviderKind = 'builtin'|'http'|'openai'|'gemini'|'kimi'|'grok';
export type ProviderSpec = {
  kind: ProviderKind;
  name?: 'Random'|'GreedyMin'|'GreedyMax';
  url?: string;
  apiKey?: string;
  headers?: Record<string,string>;
  temperature?: number;
  timeoutMs?: number;
};

async function safeFetchJson(url: string, payload: any, timeoutMs = 15000): Promise<any>{
  const ac = new AbortController();
  const id = setTimeout(()=>ac.abort(), Math.max(1000, timeoutMs));
  try{
    const r = await fetch(url, {
      method:'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return { error: 'BAD_JSON', raw: txt.slice(0,4000) }; }
  }catch(e:any){
    return { error: String(e?.message||e) };
  }finally{
    clearTimeout(id);
  }
}

abstract class BotLLMBase implements IBot {
  label: string;
  spec: ProviderSpec;
  provider: ProviderKind;
  constructor(label: string, spec: ProviderSpec, provider: ProviderKind){
    this.label = label; this.spec = spec; this.provider = provider;
  }
  async bid(view: BidView){
    const res = await safeFetchJson('/api/llm-proxy', {
      provider: this.provider, mode:'bid', spec: { ...this.spec, apiKey: undefined },
      payload: { hand: view.hand.map(c=>c.face), ranks: view.hand.map(c=>c.label), history: view.history }
    }, this.spec.timeoutMs||15000);
    const action = res?.action;
    if (action===1 || action===2 || action===3 || action==='pass') return action;
    return 'pass';
  }
  async play(view: PlayerView){
    const legal = view.require? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    const payload = {
      hand: view.hand.map(c=>c.face),
      ranks: view.hand.map(c=>c.label),
      landlord: view.landlord,
      seat: view.seat,
      bottom: view.bottom.map(c=>c.face),
      require: view.require? { type:view.require.type, mainRank:view.require.mainRank, length:view.require.length } : null,
      legal: legal.map(c=>({ type:c.type, length:c.length, mainRank:c.mainRank, cards:c.cards.map(x=>x.face) })),
      history: view.history.map(h=> h.move==='pass'? {seat:h.seat, move:'pass'} : { seat:h.seat, move:'play', combo:{ type:h.combo!.type, mainRank:h.combo!.mainRank, cards:h.combo!.cards.map(x=>x.face) }})
    };
    const res = await safeFetchJson('/api/llm-proxy', { provider: this.provider, mode:'play', spec:{...this.spec, apiKey: undefined}, payload }, this.spec.timeoutMs||15000);
    if (res?.move==='play' && res.combo) {
      const found = legal.find(c=> c.type===res.combo.type && c.mainRank===res.combo.mainRank && c.cards.length===res.combo.cards.length);
      if (found) return { move:'play', combo: found, reason: res.reason||'LLM决策' };
    }
    if (res?.move==='pass') return { move:'pass', reason: res.reason || (res?.error? `LLM错误: ${res.error}` : 'LLM建议过') };
    if (!legal.length) return { move:'pass', reason:'LLM无效/超时，默认过' };
    return { move:'play', combo: legal[0], reason:'LLM无效/超时，默认随机' };
  }
}

export class BotHTTP extends BotLLMBase { constructor(label: string, spec: ProviderSpec){ super(label,spec,'http'); } }
export class BotOpenAI extends BotLLMBase { constructor(label: string, spec: ProviderSpec){ super(label,spec,'openai'); } }
export class BotGemini extends BotLLMBase { constructor(label: string, spec: ProviderSpec){ super(label,spec,'gemini'); } }
export class BotKimi extends BotLLMBase { constructor(label: string, spec: ProviderSpec){ super(label,spec,'kimi'); } }
export class BotGrok extends BotLLMBase { constructor(label: string, spec: ProviderSpec){ super(label,spec,'grok'); } }
