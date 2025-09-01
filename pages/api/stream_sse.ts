import type { NextApiRequest, NextApiResponse } from 'next';
import { RuleConfig } from '../../lib/rules';
import { ProviderSpec } from '../../lib/providers';
import { runArenaStream } from '../../lib/arenaStream';

export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Parse config from base64 query ?q=
    const q = (req.query.q || '') as string | string[];
    const b64 = Array.isArray(q) ? q[0] : q;
    const txt = b64 ? Buffer.from(b64, 'base64').toString('utf8') : '{}';
    const body = JSON.parse(txt || '{}');

    const rounds = Number(body.rounds ?? 1);
    const seed = Number(body.seed ?? 42);
    const rob = String(body.rob ?? 'false');
    const four2 = String(body.four2 ?? 'both');
    const delayMs = Number(body.delayMs ?? 0);
    let players = body.players as [ProviderSpec,ProviderSpec,ProviderSpec] | undefined;

    const rules: Partial<RuleConfig> = {};
    rules.bidding = (rob === 'true') ? 'rob' : 'call-score';
    if (four2==='2singles' || four2==='2pairs' || four2==='both') rules.fourWithTwo = four2 as any;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    // @ts-ignore
    res.flushHeaders?.();
    // @ts-ignore
    res.socket?.setNoDelay(true);

    const send = (obj:any) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    send({ type:'event', stage:'ready' });

    await runArenaStream({ rounds, seed, rules, delayMs, players }, send);
    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (e:any) {
    try {
      res.write(`event: error\ndata: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`);
    } catch {}
    res.end();
  }
}
