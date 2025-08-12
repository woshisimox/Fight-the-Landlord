import { AiResult, Provider, ProviderConfig, Snapshot } from './ddz-types';
import type { Combo } from './ddz-types';
import { detectCombo, canBeat } from './ddz-engine';

export async function callProviderViaProxy(provider: Provider, cfg: ProviderConfig, snapshot: Snapshot): Promise<AiResult> {
  try {
    const resp = await fetch('/api/ai', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ provider, snapshot, keys: cfg }) });
    if (!resp.ok) throw new Error('proxy error '+resp.status);
    return await resp.json();
  } catch (e:any) {
    return { tileCodes: [], reason: 'proxy error → pass', meta:{ usedApi:true, provider, detail:e?.message||'error' } };
  }
}

export function fallbackAI(snapshot: Snapshot): AiResult {
  const hand = snapshot.hand.map((id)=> ({ id, rank: 3 as any, suit: '♣' as any })); // placeholder ranks; engine only uses ids later
  const last = null;
  const { allLegalResponses } = require('./ddz-engine');
  const options: Combo[] = allLegalResponses(hand, last) as Combo[];
  if (options.length===0) return { tileCodes: [], reason: 'no legal beat → pass', meta:{ usedApi:false, provider:'fallback' } };
  options.sort((a: Combo, b: Combo)=> a.cards.length===b.cards.length ? a.main-b.main : a.cards.length-b.cards.length);
  return { tileCodes: options[0].cards.map(c=>c.id), reason:'min-cards greedy', meta:{ usedApi:false, provider:'fallback' } };
}
