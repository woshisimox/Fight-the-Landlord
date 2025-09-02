import { Combo, ProviderSpec } from './types';
import { enumerateAllCombos, enumerateResponses } from './combos';
import type { IBot, PlayerView } from './bots/bot_random';

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchJson(url: string, init: RequestInit, timeoutMs?: number): Promise<{data:any, error?:string}> {
  const ac = new AbortController();
  const to = Math.max(1000, Number(timeoutMs || DEFAULT_TIMEOUT_MS));
  const id = setTimeout(()=> ac.abort(), to);
  try {
    const resp = await fetch(url, { ...init, signal: ac.signal });
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { data = { raw:text }; }
    return { data };
  } catch (e:any) {
    return { data:null, error: String(e?.message || e) };
  } finally {
    clearTimeout(id);
  }
}

export class BotOpenAI implements IBot {
  label: string;
  cfg: ProviderSpec;
  provider: 'openai'|'gemini'|'kimi'|'grok';
  constructor(spec: ProviderSpec, label: string) {
    this.cfg = spec; this.label = label;
    this.provider = spec.kind as any;
  }
  async bid(): Promise<'pass'|1|2|3> { return 1; }

  async play(view: PlayerView): Promise<'pass'|Combo> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    // 基础兜底：若无牌可出，直接pass
    if (legal.length===0) return 'pass';

    // 请求服务器代理（可配置超时）
    const { data, error } = await fetchJson('/api/llm-proxy', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({
        provider: this.provider,
        apiKey: this.cfg.apiKey || null,
        timeoutMs: this.cfg.timeoutMs || DEFAULT_TIMEOUT_MS,
        prompt: {
          you: { seat:view.seat, role: view.seat===view.landlord ? 'landlord' : 'farmer' },
          hand: view.hand.map(c=>c.label),
          bottom: view.bottom.map(c=>c.label),
          require: view.require ? { type:view.require.type, length:view.require.length, mainRank:view.require.mainRank } : null,
          history: view.history,
          legal: legal.map(c=>({ type:c.type, length:c.length, mainRank:c.mainRank, cards:c.cards.map(x=>x.label) }))
        }
      })
    }, this.cfg.timeoutMs);

    // 解析
    let chosen: Combo | null = null;
    let reason = '';
    if (error) reason = `[LLM错误] ${error}`;

    try {
      const move = data?.move;
      if (move === 'pass') {
        (view as any).__reason = data?.reason || reason || 'LLM建议过';
        return 'pass';
      }
      const want = (data?.cards as string[]|undefined) || [];
      // 在legal里匹配 cards 标签集合
      const setKey = (cards:string[]) => cards.slice().sort().join('|');
      const wantKey = setKey(want);
      for (const c of legal) {
        if (setKey(c.cards.map(x=>x.label)) === wantKey) { chosen = c; break; }
        // 兼容无花色标签匹配
        if (setKey(c.cards.map(x=>short(x.label))) === setKey(want.map(short))) { chosen = c; break; }
      }
      reason = data?.reason || reason || 'LLM选择';
    } catch { /* ignore */ }

    if (!chosen) {
      // 兜底：跟随 GreedyMax
      (view as any).__reason = reason || 'LLM无效/超时，默认过';
      // 简单策略：能跟就打最大，否则过
      const legal2 = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
      if (legal2.length===0) return 'pass';
      let best = legal2[0];
      for (const c of legal2) {
        if (c.type==='rocket') { best = c; break; }
        if (c.type==='bomb' && best.type!=='rocket' && best.type!=='bomb') best = c;
        if (c.type===best.type && c.mainRank > best.mainRank) best = c;
      }
      return best;
    }
    (view as any).__reason = reason;
    return chosen;
  }
}

function short(label: string): string {
  // 去掉花色符号，保留点数或王
  if (label==='SJ' || label==='BJ') return label;
  return label.replace('♠','').replace('♥','').replace('♣','').replace('♦','');
}
