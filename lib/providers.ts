import type { Combo } from './types';
import { detectCombo, enumerateAllCombos, enumerateResponses } from './combos';
import type { IBot } from './engine';
import type { PlayerView } from './types';

export type BuiltinName = 'GreedyMin'|'GreedyMax'|'RandomLegal';

export type ProviderSpec =
  | { kind:'builtin', name:BuiltinName }
  | { kind:'http', url:string, apiKey?:string, headers?:Record<string,string> }
  | { kind:'openai', apiKey:string, model:string, baseURL?:string }
  | { kind:'gemini', apiKey:string, model:string }
  | { kind:'kimi', apiKey:string, model:string, baseURL?:string }
  | { kind:'grok', apiKey:string, model:string, baseURL?:string }
  ;

const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 10000);

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const ac = new AbortController();
  const id = setTimeout(()=> ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: ac.signal });
    const txt = await resp.text();
    try { return JSON.parse(txt); } catch { return {}; }
  } catch (e) {
    return {};
  } finally {
    clearTimeout(id);
  }
}

// -------------------------- HTTP JSON Bot --------------------------
export class BotHTTP implements IBot {
  private cfg: Extract<ProviderSpec, {kind:'http'}>;
  private _name: string;
  constructor(cfg: Extract<ProviderSpec,{kind:'http'}>, name='HTTP') { this.cfg = cfg; this._name=name; }
  name(): string { return this._name; }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const payload = this.viewPayload(view, 'bid');
    const j = await fetchJson(this.cfg.url, {
      method:'POST',
      headers: { 'content-type':'application/json', ...(this.cfg.apiKey? {'authorization':`Bearer ${this.cfg.apiKey}`} : {}), ...(this.cfg.headers||{}) },
      body: JSON.stringify(payload),
    });
    return (j?.bid ?? 'pass');
  }

  async play(view: PlayerView): Promise<Combo> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    const payload = { ...this.viewPayload(view, 'play'), legal: legal.map(c=>({ type:c.type, length:c.length, mainRank:c.mainRank, cards:c.cards.map(x=>x.label) })) };
    const j = await fetchJson(this.cfg.url, {
      method:'POST',
      headers: { 'content-type':'application/json', ...(this.cfg.apiKey? {'authorization':`Bearer ${this.cfg.apiKey}`} : {}), ...(this.cfg.headers||{}) },
      body: JSON.stringify(payload),
    });
    const res = comboFromLabels(j);
    if (!res) return { type:'pass', cards: [] } as any;
    return res;
  }

  private viewPayload(view: PlayerView, phase: 'bid'|'play') {
    return viewPayload(view, phase);
  }
}

// --------------- OpenAI-like (OpenAI / Kimi / Grok) ----------------
export class BotOpenAI implements IBot {
  private apiKey: string;
  private model: string;
  private baseURL?: string;
  private _name: string;
  constructor(cfg: {apiKey:string; model:string; baseURL?:string}, name='OpenAI') {
    this.apiKey = cfg.apiKey; this.model = cfg.model; this.baseURL = cfg.baseURL; this._name=name;
  }
  name(): string { return this._name; }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const sys = 'You play Dou Dizhu. Reply with pure JSON like {"bid": 0|1|2|3|"pass"|"rob"|"norob"}.';
    const user = JSON.stringify({ phase:'bid', seat:view.seat, hand:view.hand.map(c=>c.label) });
    const j = await this.chat(sys, user);
    return (j?.bid ?? 'pass');
  }
  async play(view: PlayerView): Promise<Combo> {
    const sys = 'You play Dou Dizhu. Reply with pure JSON like {"type":"pass"} or {"type":"single","cards":["A"]}.';
    const payload = viewPayload(view, 'play');
    const user = JSON.stringify(payload);
    const j = await this.chat(sys, user);
    const res = comboFromLabels(j);
    if (!res) return { type:'pass', cards: [] } as any;
    return res;
  }

  private async chat(system: string, user: string): Promise<any> {
    const url = (this.baseURL || 'https://api.openai.com/v1') + '/chat/completions';
    const j = await fetchJson(url, {
      method:'POST',
      headers: { 'content-type':'application/json', 'authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [ { role:'system', content: system }, { role:'user', content: user } ],
        temperature: 0,
        response_format: { type:'json_object' }
      }),
    });
    const text = j?.choices?.[0]?.message?.content || '{}';
    try { return JSON.parse(text); } catch { return {}; }
  }
}

// ------------------------------ Gemini ------------------------------
export class BotGemini implements IBot {
  private apiKey: string;
  private model: string;
  private _name: string;
  constructor(cfg: Extract<ProviderSpec,{kind:'gemini'}>, name='Gemini') {
    this.apiKey = cfg.apiKey; this.model = cfg.model; this._name=name;
  }
  name(): string { return this._name; }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const user = JSON.stringify({ phase:'bid', seat:view.seat, hand:view.hand.map(c=>c.label) });
    const j = await this.gen(user, 'Return ONLY JSON like {"bid": 0|1|2|3|"pass"|"rob"|"norob"}.');
    return (j?.bid ?? 'pass');
  }

  async play(view: PlayerView): Promise<Combo> {
    const payload = JSON.stringify(viewPayload(view, 'play'));
    const j = await this.gen(payload, 'Return ONLY JSON like {"type":"pass"} or {"type":"single","cards":["A"]}.');
    const res = comboFromLabels(j);
    if (!res) return { type:'pass', cards: [] } as any;
    return res;
  }

  private async gen(userJSON: string, instruction: string): Promise<any> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const j = await fetchJson(endpoint, {
      method:'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({
        contents: [ { role:'user', parts:[ { text: instruction + "\n" + userJSON } ] } ],
        generationConfig: { temperature: 0 }
      })
    });
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    try { return JSON.parse(text); } catch { return {}; }
  }
}

// ---------------------------- helpers -------------------------------
function viewPayload(view: PlayerView, phase:'bid'|'play') {
  return {
    phase,
    seat: view.seat,
    landlord: view.landlord,
    lead: view.lead,
    hand: view.hand.map(c=>c.label),
    bottom: view.bottom.map(c=>c.label),
    history: view.history.map(h=>({ seat: h.seat, type: h.combo.type, cards: h.combo.cards.map(c=>c.label) })),
    require: view.require ? { type: view.require.type, length: view.require.length, mainRank: view.require.mainRank } : null,
  };
}

function comboFromLabels(j: any): Combo | null {
  if (!j || !j.type) return null;
  if (j.type==='pass') return { type:'pass', cards: [] } as any;
  const labels: string[] = j.cards ?? [];
  const fake = labels.map((lab, idx)=> ({ id: idx, label: lab, rank: 3 as any }));
  const combo = detectCombo(fake as any);
  if (!combo) return null;
  combo.cards = fake as any;
  return combo;
}
