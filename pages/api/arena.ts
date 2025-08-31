import type { NextApiRequest, NextApiResponse } from 'next';
import { runArenaInMemory } from '../../lib/arenaWeb';
import { RuleConfig } from '../../lib/rules';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { rounds='10', seed='42', rob='false', four2='both' } = req.method==='GET' ? req.query : req.body || {};
    const r = Number(rounds);
    const s = Number(seed);
    const rules: Partial<RuleConfig> = {};
    rules.bidding = (rob === 'true' || rob === true) ? 'rob' : 'call-score';
    if (four2==='2singles' || four2==='2pairs' || four2==='both') rules.fourWithTwo = four2;
    const data = runArenaInMemory({ rounds: r, seed: s, rules });
    res.status(200).json(data);
  } catch (e:any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
