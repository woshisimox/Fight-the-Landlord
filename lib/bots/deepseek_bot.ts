// lib/bots/deepseek_bot.ts
import { extractFirstJsonObject, nonEmptyReason, sanitizeCredential } from './util';

type BotMove =
  | { move: 'pass'; reason?: string }
  | { move: 'play'; cards: string[]; reason?: string };
type BotCtx = { hands: string[]; require?: any; canPass: boolean; policy?: any };
type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

// 简易兜底（当上游 API 出错时）：
// - 若允许过牌：直接过牌
// - 否则：打出第一张手牌（可能不是最优，但可让引擎继续运行）
function fallbackMove(ctx: BotCtx, reason: string): BotMove {
  if (ctx && ctx.canPass) return { move: 'pass', reason };
  const first = Array.isArray(ctx?.hands) && ctx.hands.length ? ctx.hands[0] : '3';
  return { move: 'play', cards: [first], reason };
}

export function DeepseekBot({ apiKey, model }: { apiKey?: string; model?: string }) {
  const endpoint = 'https://api.deepseek.com/v1/chat/completions';
  const mdl = (model && String(model).trim()) || 'deepseek-chat';

  return async function bot(ctx: BotCtx): Promise<BotMove> {
    try {
      const cleaned = sanitizeCredential(apiKey);
      if (!cleaned) throw new Error('DeepSeek API key 未配置');

      const prompt = [
        { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
        { role: 'user', content:
          `你是斗地主出牌助手。必须只输出一个 JSON 对象：\n`+
          `{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }\n\n`+
          `手牌：${ctx.hands.join('')}\n`+
          `需跟：${ctx.require?JSON.stringify(ctx.require):'null'}\n`+
          `可过：${ctx.canPass?'true':'false'}\n`+
          `策略：${ctx.policy}\n`+
          `只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。请仅返回严格的 JSON：{"move":"play"|"pass","cards":string[],"reason":string}。`
        }
      ] as any[];

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${cleaned}`,
        },
        body: JSON.stringify({ model: mdl, temperature: 0.2, messages: prompt, stream: false })
      });
      if (!resp.ok) throw new Error('HTTP '+resp.status+' '+(await resp.text()).slice(0,200));
      const j: any = await resp.json();
      const txt = j?.choices?.[0]?.message?.content || '';
      const parsed: any = extractFirstJsonObject(String(txt)) || {};
      const mv = parsed.move === 'pass' ? 'pass' : 'play';
      const cards: string[] = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = nonEmptyReason(parsed.reason, 'DeepSeek');

      if (mv === 'pass') return { move:'pass', reason };
      if (cards.length) return { move:'play', cards, reason };
      return fallbackMove(ctx, 'DeepSeek 返回不含有效 cards，已回退');
    } catch (e: any) {
      const reason = `DeepSeek 调用失败：${e?.message || e}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
}
