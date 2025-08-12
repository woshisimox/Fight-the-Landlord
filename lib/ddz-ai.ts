import { AiResult, Provider, ProviderConfig, Snapshot } from './ddz-types';
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
  const hand = snapshot.hand;
  if (!hand || hand.length===0) return { tileCodes: [], reason:'empty hand', meta:{ usedApi:false, provider:'fallback' } };
  return { tileCodes: [hand[0]], reason:'free-lead single', meta:{ usedApi:false, provider:'fallback' } };
}
