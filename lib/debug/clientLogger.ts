// Optional standalone client logger (if you want to import without the Dock)
export type Level = "debug" | "info" | "warn" | "error";
export interface ClientLog {
  ts: string;
  level: Level;
  src: string;
  msg: string;
  data?: any;
}

const logs: ClientLog[] = [];
const CAP = 5000;

export function log(level: Level, src: string, msg: string, data?: any) {
  logs.push({ ts: new Date().toISOString(), level, src, msg, data });
  if (logs.length > CAP) logs.splice(0, logs.length - CAP);
}

export function getLogs() { return [...logs]; }
export function clearLogs() { logs.length = 0; }
