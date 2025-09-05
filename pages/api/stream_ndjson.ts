import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';

export const config = { api: { bodyParser: false, responseLimit: false } };

function readBody(req: NextApiRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
    return;
  }

  const body = await readBody(req).catch(()=>({}));
  const rounds  = Number(body.rounds ?? 1);
  const seed    = Number(body.seed ?? 0);
  const delayMs = Number(body.delayMs ?? 200);
  const four2   = (body.four2 ?? 'both') as 'both'|'2singles'|'2pairs';
  const playersStr = String(body.players ?? 'builtin,builtin,builtin');

  // NEW: per-seat provider & keys (keys不记录日志/不回显)
  const seatProviders: string[] = Array.isArray(body.seatProviders) ? body.seatProviders : String(playersStr).split(',').map((s:string)=>s.trim());
  const seatKeys: any[] = Array.isArray(body.seatKeys) ? body.seatKeys : [];

  const toBot = (name: string) => {
    const n = (name || '').trim().toLowerCase();
    if (n==='greedymax' || n==='max') return GreedyMax;
    if (n==='greedymin' || n==='min') return GreedyMin;
    if (n==='random'   || n==='randomlegal') return RandomLegal;
    if (n==='builtin') return GreedyMax;
    // 未接入外部AI时，全部回退到 GreedyMax
    return GreedyMax;
  };
  const labelOf = (name: string) => {
    const n = (name || '').trim().toLowerCase();
    if (n==='greedymax' || n==='max') return 'GreedyMax';
    if (n==='greedymin' || n==='min') return 'GreedyMin';
    if (n==='random'   || n==='randomlegal') return 'Random';
    if (n==='builtin') return 'GreedyMax';
    return 'GreedyMax';
  }

  const botNames = playersStr.split(',').map((s:string)=>s.trim());
  const bots = [ toBot(botNames[0]||'builtin'), toBot(botNames[1]||'builtin'), toBot(botNames[2]||'builtin') ] as any;
  const botLabels = [ labelOf(botNames[0]||'builtin'), labelOf(botNames[1]||'builtin'), labelOf(botNames[2]||'builtin') ];

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no',
  });
  const write = (obj: any) => res.write(JSON.stringify(obj) + '\n');

  // 先发一条 meta，便于前端诊断（不含敏感 key）
  write({ type: 'event', kind: 'meta', seatProviders: seatProviders.map(p => String(p||'builtin')) });

  for (let r=0; r<rounds; r++) {
    const game = runOneGame({ seed: seed + r, players: bots, four2, delayMs });
    for await (const ev of game) {
      // NEW: 在 play 事件上补充 provider / reason（内建给出简要理由提示）
      if (ev && ev.type==='event' && ev.kind==='play' && typeof ev.seat === 'number') {
        const seat = ev.seat as number;
        const provider = seatProviders?.[seat] || botLabels[seat] || 'builtin';
        const fallbackReason = provider==='builtin' || provider==='GreedyMax' || provider==='GreedyMin' || provider==='Random'
          ? `内建算法（${botLabels[seat]}）`
          : `外部AI(${provider})未接入后端，已回退内建（${botLabels[seat]}）`;
        ev.provider = ev.provider || provider;
        ev.reason = ev.reason || ev.aiReason || ev.explain || fallbackReason;
      }
      write(ev);
    }
  }
  res.end();
}
