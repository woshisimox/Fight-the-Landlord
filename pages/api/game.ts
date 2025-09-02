import type { NextApiRequest, NextApiResponse } from "next";
import { initGame, step } from "../../lib/gameEngine";
import { BotGreedy } from "../../lib/bots/BotGreedy";
import { BotRandom } from "../../lib/bots/BotRandom";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let state = initGame();
  const bots = {
    A: new BotGreedy("贪心A"),
    B: new BotRandom("随机B"),
    C: new BotGreedy("贪心C"),
  };
  for (let i = 0; i < 5; i++) {
    state = await step(state, bots);
  }
  res.json(state);
}
