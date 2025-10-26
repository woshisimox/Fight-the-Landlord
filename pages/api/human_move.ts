// pages/api/human_move.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type HumanRequestEntry = {
  resolve: (move: any) => void;
  reject: (error?: any) => void;
  sessionId: string;
  seat: number;
  createdAt: number;
};

const HUMAN_REQUESTS: Map<string, HumanRequestEntry> = (globalThis as any).__DDZ_HUMAN_REQUESTS ?? new Map();
(globalThis as any).__DDZ_HUMAN_REQUESTS = HUMAN_REQUESTS;

function normalizeHumanMove(raw: any) {
  if (!raw || typeof raw !== 'object') {
    return { move: 'pass', reason: 'manual:empty' };
  }
  const phase = typeof raw.phase === 'string' ? raw.phase : undefined;
  const reason = typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : undefined;
  const base: any = { phase, reason };
  if (typeof raw.bid === 'boolean') base.bid = !!raw.bid;
  if (typeof raw.double === 'boolean') base.double = !!raw.double;
  if (raw.move === 'play') {
    const cards = Array.isArray(raw.cards) ? raw.cards.map((c: any) => String(c)) : [];
    return { ...base, move: 'play', cards };
  }
  if (raw.move === 'pass') {
    return { ...base, move: 'pass' };
  }
  if (phase === 'bid') {
    return { ...base, move: raw.bid ? 'play' : 'pass', bid: !!raw.bid };
  }
  if (phase === 'double') {
    return { ...base, move: raw.double ? 'play' : 'pass', double: !!raw.double };
  }
  if (Array.isArray(raw.cards) && raw.cards.length) {
    return { ...base, move: 'play', cards: raw.cards.map((c: any) => String(c)) };
  }
  return { ...base, move: 'pass' };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const requestId = typeof (body as any).requestId === 'string' ? (body as any).requestId : '';
    if (!requestId) {
      res.status(400).json({ error: 'missing-request-id' });
      return;
    }
    const entry = HUMAN_REQUESTS.get(requestId);
    if (!entry) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const move = normalizeHumanMove((body as any).move);
    try {
      entry.resolve(move);
    } catch (err) {
      try { entry.reject?.(err); } catch {}
    }
    HUMAN_REQUESTS.delete(requestId);
    res.status(200).json({ ok: true });
  } catch (e:any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}
