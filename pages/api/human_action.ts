// pages/api/human_action.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveHumanRequest } from '../../lib/humanChannel';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = (req as any).body || {};
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
    const action = body.action;
    const seat = Number.isInteger(body.seat) ? Number(body.seat) : undefined;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;

    if (!requestId) {
      res.status(400).json({ error: 'invalid-request-id' });
      return;
    }
    if (typeof action !== 'object' || action == null) {
      res.status(400).json({ error: 'invalid-action' });
      return;
    }

    const ok = resolveHumanRequest(requestId, action, sessionId, seat);
    if (!ok) {
      res.status(404).json({ error: 'request-not-found' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'internal-error' });
  }
}
