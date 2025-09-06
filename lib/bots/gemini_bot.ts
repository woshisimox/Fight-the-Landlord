import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';
type GeminiOpts = { apiKey: string; model?: string };
function buildPrompt(ctx: BotCtx): string {
  const hand = ctx.hands.join(''); const req = ctx.require ? JSON.stringify(ctx.require) : 'null';
  const canPass = ctx.canPass ? 'true' : 'false'; const policy = ctx.policy;
  return ['你是斗地主出牌助手。必须只输出一个 JSON 对象，格式如下：','{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }','',`手牌：${hand}`,`需跟：${req}`,`可过：${canPass}`,`四带二规则：${policy}`].join('\n');
}
export const GeminiBot = (opts: GeminiOpts): BotFunc => {
  const apiKey = opts.apiKey; const model = opts.model || 'gemini-1.5-pro';
  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!apiKey) throw new Error('Missing Gemini API Key'); const prompt = buildPrompt(ctx);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }]}], generationConfig: { temperature: 0.2 } })
      });
      if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
      const j = await r.json(); const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      let parsed: any = {}; try { parsed = JSON.parse(txt); } catch {}
      const move = parsed.move === 'pass' ? 'pass' : 'play'; const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = (parsed.reason ?? '').toString().trim() || 'Gemini 给出的建议';
      return move === 'pass' ? { move: 'pass', reason } : { move: 'play', cards, reason };
    } catch (e: any) {
      const reason = `Gemini 调用失败：${e?.message || e}，已回退`;
      if (ctx.canPass) return { move: 'pass', reason };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy); const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force, reason };
    }
  };
};
