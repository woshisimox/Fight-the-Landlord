// lib/bots/gemini_bot.ts
import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';
import { extractFirstJsonObject, nonEmptyReason } from './util';

type GeminiOpts = { apiKey: string; model?: string };

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

export const GeminiBot = (opts: GeminiOpts): BotFunc => {
  const apiKey = opts.apiKey;
  const model = opts.model || 'gemini-1.5-flash';
  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!apiKey) throw new Error('Missing Gemini API Key');
      const prompt = buildPrompt(ctx);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          generationConfig: { temperature: 0.2 },
          contents: [{ role: 'user', parts: [{ text: prompt }]}],
        }),
      });
      if (!r.ok) {
        const errTxt = await r.text().catch(()=>'') as string;
        throw new Error(`HTTP ${r.status} ${errTxt.slice(0,200)}`);
      }
      const j: any = await r.json();
      const txt: string =
        j?.candidates?.[0]?.content?.parts?.[0]?.text ??
        j?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text).join('') ?? '';
      const parsed: any = extractFirstJsonObject(txt) ?? {};
      const move = parsed.move === 'pass' ? 'pass' : 'play';
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = nonEmptyReason(parsed.reason, 'Gemini');
      return move === 'pass' ? { move: 'pass', reason } : { move: 'play', cards, reason };
    } catch (e: any) {
      const reason = `Gemini 调用失败：${e?.message || e}，已回退`;
      if (ctx.canPass) return { move: 'pass', reason };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
      const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force, reason };
    }
  };
};
