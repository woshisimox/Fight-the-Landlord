import fs from "fs";
import path from "path";

type Level = "debug" | "info" | "warn" | "error";

export interface ServerLogEntry {
  ts: string;
  level: Level;
  src: string;
  msg: string;
  data?: any;
  reqId?: string;
}

const cap = parseInt(process.env.DEBUG_LOG_CAP || "5000", 10);
const ring: ServerLogEntry[] = [];

function push(e: ServerLogEntry) {
  ring.push(e);
  if (ring.length > cap) ring.splice(0, ring.length - cap);
  // Optional file append (works on platforms that allow writing to /tmp)
  if (process.env.WRITE_LOG_FILE === "1") {
    try {
      const p = process.env.LOG_FILE_PATH || path.join("/tmp", "app.log");
      fs.appendFile(p, JSON.stringify(e) + "\n", () => {});
    } catch {}
  }
}

export function sLog(level: Level, src: string, msg: string, data?: any, reqId?: string) {
  push({ ts: new Date().toISOString(), level, src, msg, data, reqId });
}

export function sInfo(src: string, msg: string, data?: any, reqId?: string) { sLog("info", src, msg, data, reqId); }
export function sWarn(src: string, msg: string, data?: any, reqId?: string) { sLog("warn", src, msg, data, reqId); }
export function sError(src: string, msg: string, data?: any, reqId?: string) { sLog("error", src, msg, data, reqId); }
export function sDebug(src: string, msg: string, data?: any, reqId?: string) { sLog("debug", src, msg, data, reqId); }

export function sGetAll(): ServerLogEntry[] { return [...ring]; }
export function sClear() { ring.length = 0; }
