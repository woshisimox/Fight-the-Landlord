// lib/bots/grok_bot.ts
import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';
import { extractFirstJsonObject, nonEmptyReason } from './util';

type GrokOpts = { apiKey: string; model?: string; baseUrl?: string };

function buildPrompt(ctx: BotCtx): string {
  const hand = ctx.hands.join('');
  const req = ctx.require ? JSON.stringify(ctx.require) : 'null';
  const canPass = ctx.canPass ? 'true' : 'false';
  const policy = ctx.policy;
  return [
    '你是斗地主出牌助手。必须只输出一个 JSON 对象：',
    '{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }',
    '',
    `手牌：${hand}`,
    `需跟：${req}`,
    `可过：${canPass}`,
    `策略：${policy}`,
    '只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。',
  ].join('\n');
}

export const GrokBot = (opts: GrokOpts): BotFunc => {
  const apiKey = opts.apiKey;
  const model = opts.model || 'grok-2-latest';
  const baseUrl = (opts.baseUrl || 'https://api.x.ai').replace(/\/$/, '');
  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!apiKey) throw new Error('Missing xAI (Grok) API Key');
      const prompt = buildPrompt(ctx);
      const r = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        }),
      });
      if (!r.ok) {
        const errTxt = await r.text().catch(()=>'') as string;
        throw new Error(`HTTP ${r.status} ${errTxt.slice(0,200)}`);
      }
      const j: any = await r.json();
      const txt: string = j?.choices?.[0]?.message?.content ?? '';
      const parsed: any = extractFirstJsonObject(txt) ?? {};
      const move = parsed.move === 'pass' ? 'pass' : 'play';
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = nonEmptyReason(parsed.reason, 'Grok');
      return move === 'pass' ? { move: 'pass', reason } : { move: 'play', cards, reason };
    } catch (e: any) {
      const reason = `Grok 调用失败：${e?.message || e}，已回退`;
      if (ctx.canPass) return { move: 'pass', reason };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
      const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force, reason };
    }
  };
};
