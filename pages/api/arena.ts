import type { NextApiRequest, NextApiResponse } from 'next';
import { RuleConfig } from '../../lib/rules';
import { ProviderSpec } from '../../lib/providers';
import { runArenaInMemory } from '../../lib/arenaWeb';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  try {
    const body = req.body || {};
    const rounds = Number(body.rounds ?? 10);
    const seed = Number(body.seed ?? 42);
    const rob = String(body.rob ?? 'false');
    const four2 = String(body.four2 ?? 'both');
    const delayMs = Number(body.delayMs ?? 0);
    const startScore = Number(body.startScore ?? 0);
    let players = body.players as [ProviderSpec,ProviderSpec,ProviderSpec] | undefined;

    const rules: Partial<RuleConfig> = {};
    rules.bidding = (rob === 'true') ? 'rob' : 'call-score';
    if (four2==='2singles' || four2==='2pairs' || four2==='both') rules.fourWithTwo = four2 as any;

    const resp = await runArenaInMemory({ rounds, seed, rules, delayMs, players, startScore });
    res.status(200).json(resp);
  } catch (e:any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
