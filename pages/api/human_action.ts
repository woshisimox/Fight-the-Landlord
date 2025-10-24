import type { NextApiRequest, NextApiResponse } from 'next';
import { fulfillHumanRequest } from '../../lib/humanStore';

function normalizePayload(body: any) {
  if (body && typeof body.payload === 'object' && body.payload) {
    return body.payload;
  }
  const out: any = {};
  if (typeof body?.phase === 'string') out.phase = body.phase;
  if (typeof body?.move === 'string') out.move = body.move;
  if (Array.isArray(body?.cards)) out.cards = body.cards;
  if (typeof body?.bid === 'boolean') out.bid = body.bid;
  if (typeof body?.double === 'boolean') out.double = body.double;
  if (typeof body?.reason === 'string') out.reason = body.reason;
  if (!out.phase && typeof out.move === 'string') {
    if (out.move === 'play' || out.move === 'pass') out.phase = 'play';
  }
  if (out.phase === 'play' && !out.move) {
    out.move = Array.isArray(out.cards) && out.cards.length ? 'play' : 'pass';
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const sessionIdRaw = body?.clientTraceId ?? body?.sessionId;
    const requestIdRaw = body?.requestId;

    const sessionId = typeof sessionIdRaw === 'string' && sessionIdRaw.trim()
      ? sessionIdRaw.trim()
      : '';
    const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim()
      ? requestIdRaw.trim()
      : '';

    if (!sessionId || !requestId) {
      res.status(400).json({ error: 'Missing clientTraceId or requestId' });
      return;
    }

    const payload = normalizePayload(body);
    const ok = fulfillHumanRequest(sessionId, requestId, payload);
    if (!ok) {
      res.status(409).json({ error: 'Request expired or not found' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Internal error' });
  }
}
