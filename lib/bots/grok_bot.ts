import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';

type GrokOpts = { apiKey: string; model?: string };

function buildPrompt(ctx: BotCtx): string {
  const hand = ctx.hands.join('');
  const req = ctx.require ? JSON.stringify(ctx.require) : 'null';
  const canPass = ctx.canPass ? 'true' : 'false';
  const policy = ctx.policy;
  return [
    '你是斗地主出牌助手。必须只输出一个 JSON 对象，格式如下：',
    '{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }',
    '',
    `手牌：${hand}`,
    `需跟：${req}`,
    `可过：${canPass}`,
    `四带二规则：${policy}`,
  ].join('\n');
}

export const GrokBot = (opts: GrokOpts): BotFunc => {
  const apiKey = opts.apiKey;
  const model = opts.model || 'grok-2-mini';
  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!apiKey) throw new Error('Missing Grok API Key');
      const prompt = buildPrompt(ctx);
      const r = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '严格仅输出一个JSON对象，包含 move/cards/reason。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        }),
      });
      if (!r.ok) throw new Error(`Grok HTTP ${r.status}`);
      const j = await r.json();
      const txt = j?.choices?.[0]?.message?.content || '{}';
      let parsed: any = {};
      try { parsed = JSON.parse(txt); } catch {}
      const move = parsed.move === 'pass' ? 'pass' : 'play';
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = parsed.reason || '';
      return move === 'pass' ? { move: 'pass' } : { move: 'play', cards, reason };
    } catch (e) {
      if (ctx.canPass) return { move: 'pass' };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
      const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force, reason: 'Grok调用失败，回退' };
    }
  };
};
