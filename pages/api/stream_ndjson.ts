import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';

export const config = {
  api: { bodyParser: false, responseLimit: false },
};

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
  const rounds = Number(body.rounds ?? 1);
  const seed   = Number(body.seed ?? 0);
  const delayMs= Number(body.delayMs ?? 200);
  const four2  = (body.four2 ?? 'both') as 'both'|'2singles'|'2pairs';
  const playersStr = String(body.players ?? 'builtin,builtin,builtin');

  // 仅实现“内建”算法（示例），三家都使用内建
  const toBot = (name: string) => {
    const n = name.trim().toLowerCase();
    if (n==='greedymax' || n==='max') return GreedyMax;
    if (n==='greedymin' || n==='min') return GreedyMin;
    if (n==='random' || n==='randomlegal') return RandomLegal;
    if (n==='builtin') return GreedyMax;
    return GreedyMax;
  };
  const botNames = playersStr.split(',').map((s:string)=>s.trim());
  const bots = [ toBot(botNames[0]||'builtin'), toBot(botNames[1]||'builtin'), toBot(botNames[2]||'builtin') ];

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no',
  });

  const write = (obj: any) => res.write(JSON.stringify(obj) + '\n');

  for (let r=0; r<rounds; r++) {
    const game = runOneGame({ seed: seed + r, players: bots as any, four2, delayMs });
    for await (const ev of game) {
      write(ev);
    }
  }
  res.end();
}
