// lib/humanChannel.ts
// A tiny shared channel that coordinates pending human moves between
// the streaming engine endpoint and the mutation endpoint that receives
// user interactions from the frontend.

type HumanPhase = 'play' | 'bid' | 'double' | string;

type PendingEntry = {
  id: string;
  seat: number;
  phase: HumanPhase;
  sessionId?: string;
  createdAt: number;
  defaultMove: any;
  timeout: NodeJS.Timeout;
  settle: (value: any) => void;
};

const STALE_REQUEST_MS = 5 * 60 * 1000;

function cleanupRegistry(registry: Map<string, PendingEntry>) {
  const now = Date.now();
  for (const [, entry] of Array.from(registry.entries())) {
    if (now - entry.createdAt > STALE_REQUEST_MS) {
      entry.settle(entry.defaultMove);
      continue;
    }
    if (!Number.isInteger(entry.seat) || entry.seat < 0 || entry.seat > 2) {
      entry.settle(entry.defaultMove);
    }
  }
}

function ensureRegistry(): Map<string, PendingEntry> {
  const g = globalThis as any;
  if (!g.__DDZ_HUMAN_REGISTRY) {
    g.__DDZ_HUMAN_REGISTRY = new Map<string, PendingEntry>();
  }
  return g.__DDZ_HUMAN_REGISTRY as Map<string, PendingEntry>;
}

export function registerHumanRequest(params: {
  seat: number;
  phase: HumanPhase;
  sessionId?: string;
  timeoutMs: number;
  defaultMove: any;
}): { id: string; promise: Promise<any> } {
  const { seat, phase, sessionId, timeoutMs, defaultMove } = params;
  const registry = ensureRegistry();
  cleanupRegistry(registry);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  let settled = false;
  let resolvePromise: (value: any) => void = () => {};

  const promise = new Promise<any>((resolve) => {
    resolvePromise = resolve;
  });

  const settle = (value: any) => {
    if (settled) return;
    settled = true;
    clearTimeout(entry.timeout);
    registry.delete(id);
    resolvePromise(value);
  };

  const entry: PendingEntry = {
    id,
    seat,
    phase,
    sessionId,
    createdAt: Date.now(),
    defaultMove,
    timeout: setTimeout(() => {
      settle(defaultMove);
    }, Math.max(1000, timeoutMs)),
    settle,
  };

  registry.set(id, entry);
  return { id, promise };
}

function sessionsMatch(expected?: string, incoming?: string) {
  if (!expected || !incoming) return true;
  return expected === incoming;
}

function bestCandidate(
  candidates: PendingEntry[],
  sessionId?: string,
  phaseHint?: HumanPhase,
): PendingEntry | null {
  if (!candidates.length) return null;
  const withSession = sessionId
    ? candidates.filter((entry) => sessionsMatch(entry.sessionId, sessionId))
    : candidates.slice();
  const pool = (() => {
    if (phaseHint) {
      const phaseMatches = withSession.filter((entry) => entry.phase === phaseHint);
      if (phaseMatches.length) return phaseMatches;
      const anyPhaseMatches = candidates.filter((entry) => entry.phase === phaseHint);
      if (anyPhaseMatches.length) return anyPhaseMatches;
    }
    if (withSession.length) return withSession;
    return candidates;
  })();
  let winner: PendingEntry | null = null;
  for (const entry of pool) {
    if (!winner || entry.createdAt > winner.createdAt) {
      winner = entry;
    }
  }
  return winner;
}

export function resolveHumanRequest(
  id: string,
  payload: any,
  sessionId?: string,
  seatHint?: number,
): boolean {
  const registry = ensureRegistry();
  cleanupRegistry(registry);
  const phaseHint: HumanPhase | undefined = typeof payload?.phase === 'string' ? payload.phase : undefined;
  const entry = registry.get(id);
  if (entry) {
    if (sessionsMatch(entry.sessionId, sessionId) || (typeof seatHint === 'number' && seatHint === entry.seat)) {
      entry.settle(payload);
      return true;
    }
    return false;
  }

  const seat = typeof seatHint === 'number' ? seatHint : null;
  if (seat != null) {
    const candidates = Array.from(registry.values()).filter((value) => value.seat === seat);
    const candidate = bestCandidate(candidates, sessionId, phaseHint);
    if (candidate) {
      candidate.settle(payload);
      return true;
    }
  }

  if (sessionId) {
    const candidates = Array.from(registry.values()).filter((value) => sessionsMatch(value.sessionId, sessionId));
    const candidate = bestCandidate(candidates, sessionId, phaseHint);
    if (candidate) {
      candidate.settle(payload);
      return true;
    }
  }

  if (registry.size === 1) {
    const only = Array.from(registry.values())[0];
    if (only) {
      only.settle(payload);
      return true;
    }
  } else if (registry.size > 1) {
    const candidate = bestCandidate(Array.from(registry.values()), sessionId, phaseHint);
    if (candidate) {
      candidate.settle(payload);
      return true;
    }
  }

  return false;
}

export function abortHumanSession(sessionId: string | undefined) {
  if (!sessionId) return;
  const registry = ensureRegistry();
  for (const [id, entry] of Array.from(registry.entries())) {
    if (entry.sessionId === sessionId) {
      entry.settle(entry.defaultMove);
    }
  }
}

export function clearAllHumanRequests() {
  const registry = ensureRegistry();
  for (const [id, entry] of Array.from(registry.entries())) {
    entry.settle(entry.defaultMove);
  }
}
