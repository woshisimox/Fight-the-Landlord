type BotMove = { move: 'play'|'pass'; cards?: string[]; reason?: string };
type BotCtx = { hands: string[]; require: any; canPass: boolean; policy: any };
type BotFunc = (ctx: BotCtx) => Promise<BotMove>;

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
          temperature: 0.2,
        }),
      });
      if (!r.ok) throw new Error(`Kimi HTTP ${r.status}`);
      const j = await r.json();
      const txt = j?.choices?.[0]?.message?.content || '{}';
      let parsed: any = {};
      parsed = normalizeAndExtractJson(txt) || {};
      let move: 'play'|'pass' = parsed.move === 'pass' ? 'pass' : 'play';
      let cards: string[] = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = parsed.reason || '';
      if (move === 'pass' && !ctx.canPass) {
        const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
        const force = (legal && legal[0]) || [ctx.hands[0]];
        move = 'play'; cards = force;
      }
      return move === 'pass' ? { move: 'pass', reason } : { move: 'play', cards, reason };
    } catch (e) {
      if (ctx.canPass) return { move: 'pass', reason: 'Kimi 调用/解析异常，已兜底过牌' };
      const force = [ctx.hands[0]];
      return { move: 'play', cards: force, reason: 'Kimi 调用/解析异常，使用兜底出牌' };
    }
  };
};
