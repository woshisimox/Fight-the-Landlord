import type { NextApiRequest, NextApiResponse } from 'next';
import { runArenaInMemory } from '../../lib/arenaWeb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method!=='POST') { res.status(405).json({ error:'Method not allowed' }); return; }
  const { rules, players, rounds, delayMs } = req.body||{};
  let buffer = '';
  const chunks: string[] = [];
  await runArenaInMemory(rules, players, rounds||1, delayMs||0, (line)=>{ buffer+=line; chunks.push(line); });
  res.status(200).json({ ndjson: buffer, lines: chunks.length });
}
