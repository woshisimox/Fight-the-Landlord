import type { NextApiRequest, NextApiResponse } from 'next';

type PendingDecision = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

type HumanSession = {
  id: string;
  pending: Map<string, PendingDecision>;
};

function getSessions(): Map<string, HumanSession> {
  const globalAny = globalThis as any;
  if (!globalAny.__DDZ_HUMAN_SESSIONS) {
    globalAny.__DDZ_HUMAN_SESSIONS = new Map<string, HumanSession>();
  }
  return globalAny.__DDZ_HUMAN_SESSIONS as Map<string, HumanSession>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const body =
      req.body && typeof req.body === 'object'
        ? (req.body as Record<string, unknown>)
        : null;
    const sessionId = typeof body?.sessionId === 'string' ? (body.sessionId as string) : undefined;
    const decisionId = typeof body?.decisionId === 'string' ? (body.decisionId as string) : undefined;
    const action = body?.action;

    if (!sessionId || !decisionId) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    const sessions = getSessions();
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const pending = session.pending.get(decisionId);
    if (!pending) {
      res.status(409).json({ error: 'Decision already resolved or unknown' });
      return;
    }

    pending.resolve(action);
    res.status(200).json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
