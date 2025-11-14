// lib/humanStore.ts
// Lightweight in-memory registry that coordinates pending human decisions
// across streaming NDJSON requests and the auxiliary `/api/human_action`
// endpoint. The store is keyed by a client-provided trace/session id.

export type HumanDecision = any;

type PendingEntry = {
  seat: number;
  requestId: string;
  resolve: (value: HumanDecision) => void;
  reject: (reason?: any) => void;
  expired: boolean;
};

type SessionBucket = Map<string, PendingEntry>;

type StoreShape = Map<string, SessionBucket>;

declare global {
  // eslint-disable-next-line no-var
  var __DDZ_HUMAN_STORE__: StoreShape | undefined;
}

function getStore(): StoreShape {
  if (!(globalThis as any).__DDZ_HUMAN_STORE__) {
    (globalThis as any).__DDZ_HUMAN_STORE__ = new Map();
  }
  return (globalThis as any).__DDZ_HUMAN_STORE__ as StoreShape;
}

function ensureBucket(sessionId: string): SessionBucket {
  const store = getStore();
  if (!store.has(sessionId)) {
    store.set(sessionId, new Map());
  }
  return store.get(sessionId)!;
}

export function resetSession(sessionId: string) {
  const store = getStore();
  store.delete(sessionId);
}

export function registerHumanRequest(
  sessionId: string,
  requestId: string,
  seat: number,
  resolve: (value: HumanDecision) => void,
  reject: (reason?: any) => void,
) {
  const bucket = ensureBucket(sessionId);
  const prev = bucket.get(requestId);
  if (prev && !prev.expired) {
    try { prev.reject(new Error('replaced')); } catch {}
  }
  bucket.set(requestId, { seat, requestId, resolve, reject, expired: false });
}

export function fulfillHumanRequest(
  sessionId: string,
  requestId: string,
  payload: HumanDecision,
): boolean {
  const store = getStore();
  const bucket = store.get(sessionId);
  if (!bucket) return false;
  const entry = bucket.get(requestId);
  if (!entry || entry.expired) return false;
  entry.expired = true;
  bucket.delete(requestId);
  try { entry.resolve(payload); } catch (err) { try { entry.reject(err); } catch {} }
  return true;
}

export function expireHumanRequest(sessionId: string, requestId: string, reason?: any) {
  const store = getStore();
  const bucket = store.get(sessionId);
  if (!bucket) return;
  const entry = bucket.get(requestId);
  if (!entry || entry.expired) return;
  entry.expired = true;
  bucket.delete(requestId);
  try { entry.reject(reason); } catch {}
}

export function releaseHumanRequest(sessionId: string, requestId: string) {
  const store = getStore();
  const bucket = store.get(sessionId);
  if (!bucket) return;
  const entry = bucket.get(requestId);
  if (!entry || entry.expired) return;
  entry.expired = true;
  bucket.delete(requestId);
}

export function hasPendingHumanRequest(sessionId: string, requestId: string): boolean {
  const store = getStore();
  const bucket = store.get(sessionId);
  if (!bucket) return false;
  const entry = bucket.get(requestId);
  if (!entry || entry.expired) return false;
  return true;
}

