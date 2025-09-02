import { BidView, Combo, PlayerView } from './types';
import { enumerateAllCombos, enumerateResponses } from './combos';
import type { IBot } from './bots';
export type BuiltinName = 'Random'|'GreedyMin'|'GreedyMax';
export type ProviderSpec =
  | { kind:'builtin', name:BuiltinName }
  | { kind:'http', url:string, apiKey?:string, headers?:Record<string,string>, timeoutMs?:number }
  | { kind:'openai'|'gemini'|'kimi'|'grok', model?:string, apiKey?:string, timeoutMs?:number };
const DEFAULT_TIMEOUT_MS = 12000;
async function fetchJson(url: string, init: RequestInit, timeoutMs?: number): Promise<{ data:any, error?: string }>{ const ac=new AbortController(); const to=Math.max(1000, Number(timeoutMs||DEFAULT_TIMEOUT_MS)); const id=setTimeout(()=>ac.abort(),to);
  try{ const resp=await fetch(url,{...init, signal:ac.signal}); const txt=await resp.text(); try{ return { data: JSON.parse(txt) }; } catch{ return { data: {} }; } } catch(e:any){ return { data:{}, error:String(e?.message||e) }; } finally{ clearTimeout(id); } }
function viewPayload(view: PlayerView|BidView, kind: 'bid'|'play'){ if (kind==='bid'){ const v = view as BidView; return { seat:v.seat, hand:v.hand.map(c=>c.label), bottom:v.bottom.map(c=>c.label) }; }
  const v=view as PlayerView; return { seat:v.seat, role:v.role, landlord:v.landlord, hand:v.hand.map(c=>c.label), bottom:v.bottom.map(c=>c.label),
    lead:v.lead, require: v.require ? { type:v.require.type, mainRank:v.require.mainRank, length:v.require.length, cards:v.require.cards.map(c=>c.label) } : null,
    history: v.history.map(h=> h.move==='pass' ? { seat:h.seat, move:'pass' } : { seat:h.seat, move:'play', type:h.combo!.type, mainRank:h.combo!.mainRank, cards:h.combo!.cards.map(c=>c.label) }) }; }
async function callLLM(provider: ProviderSpec, payload: any, action: 'bid'|'play'): Promise<{ move:'pass', reason:string } | { move:'play', combo:Combo, reason?:string } | 'pass'|1|2|3> {
  const body = JSON.stringify({ provider, action, payload });
  const { data, error } = await fetchJson('/api/llm-proxy', { method:'POST', headers:{'content-type':'application/json'}, body }, (provider as any).timeoutMs);
  if (action==='bid'){ if (error) return 'pass'; return (data?.bid ?? 'pass'); }
  if (error) return { move:'pass', reason:`LLM错误/超时：${String(error).slice(0,120)}` };
  const mv = data?.move; if (!mv || (mv!=='pass' && mv!=='play')) return { move:'pass', reason:'LLM返回无效，默认过' };
  if (mv==='pass') return { move:'pass', reason: data?.reason || 'LLM建议过' };
  const allowed = ['single','pair','bomb','rocket']; const c = data?.combo;
  if (!c || !allowed.includes(c.type) || typeof c.mainRank!=='number' || !Array.isArray(c.cards)) return { move:'pass', reason:'LLM组合无效，默认过' };
  return { move:'play', combo: { type:c.type, length:1, mainRank:c.mainRank, cards: (c.cards as any) }, reason: data?.reason };
}
abstract class BaseLLMBot implements IBot {
  constructor(public name:string, protected cfg: ProviderSpec) {}
  async bid(view: BidView){ try{ const res = await callLLM(this.cfg, viewPayload(view,'bid'), 'bid') as any; if (res===1||res===2||res===3||res==='pass') return res; return 'pass'; } catch { return 'pass'; } }
  async play(view: PlayerView){ const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    const hint = legal.map(c=>({ type:c.type, mainRank:c.mainRank, cards:c.cards.map(x=>x.label) }));
    try{ const res = await callLLM(this.cfg, { ...viewPayload(view,'play'), legal: hint }, 'play') as any; if (res?.move==='play' || res?.move==='pass') return res;
      if (legal.length>0) return { move:'play', combo: legal[0], reason:'LLM无效/超时，使用最小可行招' }; return { move:'pass', reason:'LLM无效/超时，默认过' }; }
    catch(e:any){ if (legal.length>0) return { move:'play', combo: legal[0], reason:`LLM异常：${String(e).slice(0,120)}，使用最小可行招` }; return { move:'pass', reason:`LLM异常：${String(e).slice(0,120)}，默认过` }; } }
}
export class BotHTTP extends BaseLLMBot {} export class BotOpenAI extends BaseLLMBot {} export class BotGemini extends BaseLLMBot {} export class BotKimi extends BaseLLMBot {} export class BotGrok extends BaseLLMBot {}