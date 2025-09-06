import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';

type KimiOpts = { apiKey: string; model?: string };

function buildPrompt(ctx: BotCtx): string {
  const hand = ctx.hands.join('');
  const req = ctx.require ? JSON.stringify(ctx.require) : 'null';
  const canPass = ctx.canPass ? 'true' : 'false';
  const policy = ctx.policy;
  return [
    '你是斗地主出牌助手。',
    '请根据我的手牌、是否必须跟牌、以及出牌规则，给出最优出牌。',
    '必须严格输出 JSON，形如：',
    '{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }',
    '',
    `手牌：${hand}`,
    `需跟：${req}`,
    `可过：${canPass}`,
    `四带二规则：${policy}`,
  ].join('\n');
}

export const KimiBot = (opts: KimiOpts): BotFunc => {
  const apiKey = opts.apiKey;
  const model = opts.model || 'moonshot-v1-8k';
  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!apiKey) throw new Error('Missing Kimi API Key');
      const prompt = buildPrompt(ctx);
      const r = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是斗地主出牌助手。严格只输出一个JSON对象，形如：{ "move":"play|pass", "cards":["A","A"], "reason":"..." }。不要输出其他内容。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        }),
      });
      if (!r.ok) throw new Error(`Kimi HTTP ${r.status}`);
      const j = await r.json();
      const txt = j?.choices?.[0]?.message?.content || '{}';
      let parsed: any = {};
      try { parsed = JSON.parse(txt); } catch {}
      const move = parsed.move === 'pass' ? 'pass' : 'play';
      const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = parsed.reason && String(parsed.reason).trim()
        ? String(parsed.reason).trim()
        : 'Kimi 给出的建议';
      return move === 'pass'
        ? { move: 'pass', reason }
        : { move: 'play', cards, reason };
    } catch (e: any) {
      const reason = `Kimi 调用失败：${e?.message || e}，已回退`;
      if (ctx.canPass) return { move: 'pass', reason };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
      const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force, reason };
    }
  };
};
