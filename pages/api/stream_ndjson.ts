import type { NextApiRequest, NextApiResponse } from 'next';
import { RuleConfig } from '../../lib/rules';
import { ProviderSpec } from '../../lib/providers';
import { runArenaStream } from '../../lib/arenaStream';

export const config = { api: { bodyParser: { sizeLimit: '2mb' }, responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }
  try {
    // streaming flush hints
    // @ts-ignore
    res.flushHeaders?.();
    // @ts-ignore
    res.socket?.setNoDelay(true);

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const body = req.body || {};
    const rounds = Number(body.rounds ?? 1);
    const seed = Number(body.seed ?? 42);
    const rob = String(body.rob ?? 'false');
    const four2 = String(body.four2 ?? 'both');
    const delayMs = Number(body.delayMs ?? 0);
    const startScore = Number(body.startScore ?? 0);
    let players = body.players as [ProviderSpec,ProviderSpec,ProviderSpec] | undefined;

    const rules: Partial<RuleConfig> = {};
    rules.bidding = (rob === 'true') ? 'rob' : 'call-score';
    if (four2==='2singles' || four2==='2pairs' || four2==='both') rules.fourWithTwo = four2 as any;

    const writer = (obj:any) => { res.write(JSON.stringify(obj) + '\n'); };
    writer({ type:'event', stage:'ready' });
    await runArenaStream({ rounds, seed, rules, delayMs, players, startScore }, writer);
    res.end();
  } catch (e:any) {
    try { res.write(JSON.stringify({ type:'error', error: String(e?.message || e) }) + '\n'); } catch {}
    res.end();
  }
}
