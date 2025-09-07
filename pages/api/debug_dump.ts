import type { NextApiRequest, NextApiResponse } from "next";
import { sGetAll } from "../../lib/debug/serverLog";
export default async function handler(req: NextApiRequest, res: NextApiResponse){
  const format = (req.query.format||"").toString().toLowerCase();
  const payload = { ok:true, now:new Date().toISOString(), env:{ node:process.version, vercel:!!process.env.VERCEL, region:process.env.VERCEL_REGION||null }, serverLogs: sGetAll() };
  if (format==="ndjson"){ res.setHeader("Content-Type","application/x-ndjson; charset=utf-8"); for (const e of payload.serverLogs){ res.write(JSON.stringify(e)+"\n"); } res.end(); return; }
  res.status(200).json(payload);
}
