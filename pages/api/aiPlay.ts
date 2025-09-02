import type { NextApiRequest, NextApiResponse } from "next";
import { Configuration, OpenAIApi } from "openai";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { apiKey, hand, lastPlay } = req.body;
  if (!apiKey) return res.status(400).json({ error: "API key required" });

  const client = new OpenAIApi(new Configuration({ apiKey }));
  const prompt = `斗地主出牌决策: 手牌=${hand}, 上家出=${lastPlay||"无"}, 给出你要出的牌(数组形式)。`;

  const response = await client.createChatCompletion({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const move = response.data.choices[0].message?.content || "[]";
  res.json({ move });
}
