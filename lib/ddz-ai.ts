import { AiResult, Provider, ProviderConfig, Snapshot, fromCode } from './ddz-types';
import { detectCombo } from './ddz-engine';

const SYS_JSON = 'Only respond with strict JSON: {"tiles":["<codes>"], "reason":"short"}';

export async function callProviderViaProxy(provider: Provider, cfg: ProviderConfig, snapshot: Snapshot): Promise<AiResult> {
  try {
    const resp = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, snapshot, keys: cfg })
    });
    if (!resp.ok) throw new Error('proxy error '+resp.status);
    return await resp.json();
  } catch (e:any) {
    return { tileCodes: [], reason: 'proxy error → pass', meta:{ usedApi:true, provider, detail:e?.message||'error' } };
  }
}

// --- Fallback heuristic AI ---
export function fallbackAI(snapshot: Snapshot): AiResult {
  const hand = snapshot.hand.map(fromCode);
  const last = null; // simplified for now
  const { allLegalResponses } = require('./ddz-engine');
  const options = allLegalResponses(hand, last);
  if (options.length===0) return { tileCodes: [], reason: 'no legal beat → pass', meta:{ usedApi:false, provider:'fallback' } };
  options.sort((a,b)=> a.cards.length===b.cards.length ? a.main-b.main : a.cards.length-b.cards.length);
  return { tileCodes: options[0].cards.map(c=>c.id), reason: 'min-cards greedy', meta:{ usedApi:false, provider:'fallback' } };
}
