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

export function resolveHumanRequest(
  id: string,
  payload: any,
  sessionId?: string,
  seatHint?: number,
): boolean {
  const registry = ensureRegistry();
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
    let candidate: PendingEntry | null = null;
    for (const value of registry.values()) {
      if (value.seat !== seat) continue;
      if (!sessionsMatch(value.sessionId, sessionId)) {
        if (sessionId) continue;
      }
      if (!candidate || value.createdAt > candidate.createdAt) {
        candidate = value;
      }
    }
    if (candidate) {
      candidate.settle(payload);
      return true;
    }
  }

  if (sessionId) {
    let candidate: PendingEntry | null = null;
    for (const value of registry.values()) {
      if (!sessionsMatch(value.sessionId, sessionId)) continue;
      if (!candidate || value.createdAt > candidate.createdAt) {
        candidate = value;
      }
    }
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
