export type RunLogRecord = {
  id: string;
  createdAt: string;
  mode: 'regular' | 'knockout';
  metadata: Record<string, any>;
  lines: string[];
};

declare global {
  // eslint-disable-next-line no-var
  var __DDZ_RUN_LOG_STORE__: Map<string, RunLogRecord> | undefined;
}

function getStore(): Map<string, RunLogRecord> {
  if (!(globalThis as any).__DDZ_RUN_LOG_STORE__) {
    (globalThis as any).__DDZ_RUN_LOG_STORE__ = new Map();
  }
  return (globalThis as any).__DDZ_RUN_LOG_STORE__ as Map<string, RunLogRecord>;
}

export function storeRunLog(record: RunLogRecord): RunLogRecord {
  const store = getStore();
  store.set(record.id, record);
  return record;
}

export function getRunLog(id: string): RunLogRecord | null {
  const store = getStore();
  return store.get(id) ?? null;
}

export function clearRunLog(id?: string) {
  const store = getStore();
  if (id) {
    store.delete(id);
  } else {
    store.clear();
  }
}

export function listRunLogs(): RunLogRecord[] {
  return Array.from(getStore().values());
}
