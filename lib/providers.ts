
// Providers for external AIs + HTTP; includes configurable timeout and error-to-reason plumbing.
import type { Combo } from './types';
import type { IBot } from './engine';
import type { PlayerView } from './types';
import { enumerateAllCombos, enumerateResponses } from './combos';

export type BuiltinName = 'GreedyMin'|'GreedyMax'|'RandomLegal';

export type ProviderSpec =
  | { kind:'builtin', name: BuiltinName }
  | { kind:'http', url:string, apiKey?:string, headers?:Record<string,string>, timeoutMs?:number }
  | { kind:'openai', apiKey:string, model:string, baseURL?:string, timeoutMs?:number }
  | { kind:'gemini', apiKey:string, model:string, timeoutMs?:number }
  | { kind:'kimi', apiKey:string, model:string, baseURL?:string, timeoutMs?:number }
  | { kind:'grok', apiKey:string, model:string, baseURL?:string, timeoutMs?:number }
  ;

function getDefaultTimeoutMs(): number {
  try {
    // @ts-ignore
    const v = (typeof process!=='undefined' && (process as any)?.env?.AI_TIMEOUT_MS)
      ? Number((process as any).env.AI_TIMEOUT_MS) : 10000;
    return Number.isFinite(v) && v>=1000 ? v : 10000;
  } catch { return 10000; }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs?: number): Promise<{data:any, error?:string}> {
  const ac = new AbortController();
  const to = Math.max(1000, Number(timeoutMs ?? getDefaultTimeoutMs()));
  const id = setTimeout(()=> ac.abort(), to);
  try {
    const resp = await fetch(url, { ...init, signal: ac.signal });
    const txt = await resp.text();
    try { return { data: JSON.parse(txt) }; } catch { return { data: {}, error: '非JSON响应' }; }
  } catch (e:any) {
    let msg = String(e?.message || e || 'unknown');
    // sanitize tokens
    msg = msg.replace(/(sk-[A-Za-z0-9_\-]{8,})/g, '***');
    msg = msg.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer ***');
    return { data: {}, error: msg };
  } finally {
    clearTimeout(id);
  }
}

function comboFromLabels(j:any): Combo | null {
  if (!j) return null;
  // direct shape
  if (j.type==='pass') return { type:'pass', cards:[] } as any;
  if (j.type && Array.isArray(j.cards)) {
    const type = j.type as string;
    if (type==='single') return { type:'single', cards: j.cards.map((x:string)=>({label:x})) } as any;
    if (type==='pair')   return { type:'pair',   cards: j.cards.map((x:string)=>({label:x})) } as any;
  }
  // nested {combo:{...}}
  if (j.combo) return comboFromLabels(j.combo);
  return null;
}

// -------------------------- HTTP JSON Bot --------------------------
export class BotHTTP implements IBot {
  private cfg: Extract<ProviderSpec, {kind:'http'}>;
  private _name: string;
  private timeoutMs: number;
  constructor(cfg: Extract<ProviderSpec,{kind:'http'}>, name='HTTP', timeoutMs?: number) {
    this.cfg = cfg; this._name = name;
    this.timeoutMs = Number(cfg.timeoutMs ?? timeoutMs ?? getDefaultTimeoutMs());
  }
  name(): string { return this._name; }

  private viewPayload(view: PlayerView, mode:'bid'|'play') {
    return {
      seat: view.seat, landlord: view.landlord, hand: view.hand.map(x=>x.label),
      bottom: view.bottom.map(x=>x.label), history: view.history,
      lead: view.lead, require: view.require, mode
    };
  }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const payload = this.viewPayload(view, 'bid');
    const {data:j, error:_err} = await fetchJson(this.cfg.url, {
      method:'POST',
      headers: { 'content-type':'application/json', ...(this.cfg.apiKey? {'authorization':`Bearer ${this.cfg.apiKey}`} : {}), ...(this.cfg.headers||{}) },
      body: JSON.stringify(payload),
    }, this.timeoutMs);
    // allow plain {bid:...}
    return (j?.bid ?? 'pass');
  }

  async play(view: PlayerView): Promise<Combo | {combo: Combo, reason?: string}> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    const payload = { ...this.viewPayload(view, 'play'), legal: legal.map(c=>({ type:c.type, length:c.length, mainRank:c.mainRank, cards:c.cards.map(x=>x.label) })) };
    const {data:j, error:_err} = await fetchJson(this.cfg.url, {
      method:'POST',
      headers: { 'content-type':'application/json', ...(this.cfg.apiKey? {'authorization':`Bearer ${this.cfg.apiKey}`} : {}), ...(this.cfg.headers||{}) },
      body: JSON.stringify(payload),
    }, this.timeoutMs);
    const res = comboFromLabels(j);
    if (!res) return { combo: ({ type:'pass', cards: [] } as any), reason: (j?.reason || (_err?('LLM错误:'+_err):'')) };
    return { combo: res, reason: (j?.reason || '') };
  }
}

// -------------------------- OpenAI-compatible Bot --------------------------
export class BotOpenAI implements IBot {
  private apiKey: string;
  private model: string;
  private baseURL?: string;
  private _name: string;
  private timeoutMs: number;
  constructor(cfg: {apiKey:string; model:string; baseURL?:string; timeoutMs?:number}, name='OpenAI') {
    this.apiKey = cfg.apiKey; this.model = cfg.model; this.baseURL = cfg.baseURL;
    this._name = name; this.timeoutMs = Number(cfg.timeoutMs ?? getDefaultTimeoutMs());
  }
  name(): string { return this._name; }

  private viewPayload(view: PlayerView, mode:'bid'|'play') {
    return {
      seat: view.seat, landlord: view.landlord, hand: view.hand.map(x=>x.label),
      bottom: view.bottom.map(x=>x.label), history: view.history,
      lead: view.lead, require: view.require, mode
    };
  }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const sys = 'You are bidding in Dou Dizhu. Reply ONLY JSON: {"bid":0|1|2|3|"pass"}';
    const user = JSON.stringify(this.viewPayload(view,'bid'));
    const {data:j} = await this.chat(sys, user);
    const v = j?.bid;
    if (v===0 || v===1 || v===2 || v===3 || v==='pass' || v==='rob' || v==='norob') return v;
    return 'pass';
  }

  async play(view: PlayerView): Promise<Combo | {combo: Combo, reason?: string}> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    const legalPayload = legal.map(c=>({ type:c.type, length:c.length, mainRank:c.mainRank, cards:c.cards.map(x=>x.label) }));
    const sys = 'You play Dou Dizhu. If "legal" is non-empty, you MUST select exactly one option from "legal". Reply ONLY pure JSON: {"type":"pass"} OR {"type":"single|pair","cards":["..."],"reason":"..."}';
    const payloadObj = { ...this.viewPayload(view, 'play'), legal: legalPayload };
    const user = JSON.stringify(payloadObj);
    const {data:j, error:_cerr} = await this.chat(sys, user);
    const res = comboFromLabels(j);
    if (!res) return { combo: ({ type:'pass', cards: [] } as any), reason: (j?.reason || (_cerr?('LLM错误:'+_cerr):'LLM无效/超时，默认过')) };
    return { combo: res, reason: (j?.reason || '') };
  }

  private async chat(system: string, user: string): Promise<{data:any, error?:string}> {
    const url = (this.baseURL || 'https://api.openai.com/v1') + '/chat/completions';
    const {data:j, error:_err} = await fetchJson(url, {
      method:'POST',
      headers: { 'content-type':'application/json', 'authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [ { role:'system', content: system }, { role:'user', content: user } ],
        temperature: 0,
        response_format: { type:'json_object' }
      }),
    }, this.timeoutMs);
    try {
      const text = j?.choices?.[0]?.message?.content || '{}';
      return { data: JSON.parse(text) };
    } catch {
      return { data: {}, error: (_err || '解析失败') };
    }
  }
}

// -------------------------- Gemini Bot --------------------------
export class BotGemini implements IBot {
  private apiKey: string;
  private model: string;
  private _name: string;
  private timeoutMs: number;
  constructor(cfg: Extract<ProviderSpec,{kind:'gemini'}>, name='Gemini') {
    this.apiKey = cfg.apiKey; this.model = cfg.model; this._name = name;
    this.timeoutMs = Number(cfg.timeoutMs ?? getDefaultTimeoutMs());
  }
  name(): string { return this._name; }

  private viewPayload(view: PlayerView, mode:'bid'|'play') {
    return {
      seat: view.seat, landlord: view.landlord, hand: view.hand.map(x=>x.label),
      bottom: view.bottom.map(x=>x.label), history: view.history,
      lead: view.lead, require: view.require, mode
    };
  }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const instruction = 'Return ONLY JSON: {"bid":0|1|2|3|"pass"}';
    const {data:j} = await this.gen(JSON.stringify(this.viewPayload(view,'bid')), instruction);
    const v = j?.bid;
    if (v===0 || v===1 || v===2 || v===3 || v==='pass' || v==='rob' || v==='norob') return v;
    return 'pass';
  }

  async play(view: PlayerView): Promise<Combo | {combo: Combo, reason?: string}> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    const legalPayload = legal.map(c=>({ type:c.type, length:c.length, mainRank:c.mainRank, cards:c.cards.map(x=>x.label) }));
    const payloadObj = { ...this.viewPayload(view, 'play'), legal: legalPayload };
    const {data:j, error:_gerr} = await this.gen(JSON.stringify(payloadObj), 'Return ONLY pure JSON. If "legal" is non-empty, you MUST choose exactly one from it.');
    const res = comboFromLabels(j);
    if (!res) return { combo: ({ type:'pass', cards: [] } as any), reason: (j?.reason || (_gerr?('LLM错误:'+_gerr):'LLM无效/超时，默认过')) };
    return { combo: res, reason: (j?.reason || '') };
  }

  private async gen(userJSON: string, instruction: string): Promise<{data:any, error?:string}> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const {data:j, error:_err} = await fetchJson(endpoint, {
      method:'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({
        contents: [ { role:'user', parts:[ { text: instruction + "\n" + userJSON } ] } ],
        generationConfig: { temperature: 0 }
      })
    }, this.timeoutMs);
    try {
      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      return { data: JSON.parse(text) };
    } catch {
      return { data: {}, error: (_err || '解析失败') };
    }
  }
}
