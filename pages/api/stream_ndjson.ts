import type { NextApiRequest, NextApiResponse } from 'next';
import { sInfo, sError, sDebug } from '../../lib/debug/serverLog';

/**
 * A demo NDJSON stream endpoint to help you confirm "frontend freeze vs backend stop".
 * Query params:
 *  - delayMs: number (default 300)  -> per event delay
 *  - total:   number (default 40)   -> total events to stream
 *  - crashAt: number (optional)     -> if set, throws after sending this many events
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const reqId = Math.random().toString(36).slice(2, 8);
  sInfo('stream', 'request:start', { 
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    ua: req.headers['user-agent'],
    query: req.query
  }, reqId);

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const delayMs = Number(req.query.delayMs || 300);
  const total   = Math.min(2000, Number(req.query.total || 40)); // cap just in case
  const crashAt = req.query.crashAt !== undefined ? Number(req.query.crashAt) : undefined;

  function writeLine(obj: any) {
    try { sDebug('stream', 'send', obj, reqId); } catch {}
    res.write(JSON.stringify(obj) + '\n');
  }

  try {
    writeLine({ type: 'log', message: 'Stream init', ts: new Date().toISOString() });
    for (let i=1; i<=total; i++) {
      // simulate work
      await new Promise(r => setTimeout(r, delayMs));

      if (crashAt && i === crashAt) {
        throw new Error('Simulated backend crash at event #' + i);
      }
      writeLine({ type: 'tick', i, ts: new Date().toISOString() });
    }
    writeLine({ type: 'done', ts: new Date().toISOString() });
  } catch (err:any) {
    writeLine({ type: 'error', message: String(err?.message || err) });
    try { sError('stream', 'exception', { error: String(err?.stack || err) }, reqId); } catch {}
  } finally {
    try { sInfo('stream', 'request:end', {}, reqId); } catch {}
    res.end();
  }
}
