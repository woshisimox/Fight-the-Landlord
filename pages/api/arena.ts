import type { NextApiRequest, NextApiResponse } from 'next';
import { Engine } from '../../lib/engine';
import { BotRandom } from '../../lib/bots/random';
import { BotGreedyMax, BotGreedyMin } from '../../lib/bots/greedy';
import { IBot } from '../../lib/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rounds = Math.max(1, Math.min(5, Number(req.query.rounds ?? 1)));
  const engine = new Engine();
  const bots: IBot[] = [new BotGreedyMin('甲(内置:GreedyMin)'), new BotGreedyMax('乙(内置:GreedyMax)'), new BotRandom('丙(内置:Random)')];
  const logs = [];
  let totals:[number,number,number] = [0,0,0];
  for (let i=0;i<rounds;i++) {
    const log = await engine.runRound(bots, i);
    logs.push(log);
    totals = [totals[0]+log.scores[0], totals[1]+log.scores[1], totals[2]+log.scores[2]];
  }
  res.status(200).json({ ok:true, totals, logs });
}
