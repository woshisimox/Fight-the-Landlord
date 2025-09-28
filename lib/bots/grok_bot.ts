// lib/bots/grok_bot.ts
import { extractFirstJsonObject, nonEmptyReason } from './util';

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


export const GrokBot = (o: { apiKey: string; model?: string }): BotFunc =>
  async (ctx: BotCtx) => {
    try {
      if (!o.apiKey) throw new Error('Missing xAI API Key');
      const url = 'https://api.x.ai/v1/chat/completions';
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model || 'grok-2-latest',
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
            { role: 'user', content:
              `你是斗地主出牌助手。必须只输出一个 JSON 对象：\n`+
              `{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }\n\n`+
              `手牌：${ctx.hands.join('')}\n`+
              `需跟：${ctx.require?JSON.stringify(ctx.require):'null'}\n`+
              `可过：${ctx.canPass?'true':'false'}\n`+
              `策略：${ctx.policy}\n`+
              `已出牌：${(Array.isArray((ctx as any).seen) && (ctx as any).seen.length) ? (ctx as any).seen.join('') : '无'}\n`+
              
              `只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。`
            }
          ]
        })
      });
      if (!r.ok) throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,200));
      const j:any = await r.json();
      const t = j?.choices?.[0]?.message?.content || '';
      const p:any = extractFirstJsonObject(String(t)) || {};
      const m = p.move==='pass' ? 'pass' : 'play';
      const cds:string[] = Array.isArray(p.cards)?p.cards:[];
      const reason = nonEmptyReason(p.reason,'Grok');
      return m==='pass'?{move:'pass',reason}:{move:'play',cards:cds,reason};
    } catch(e:any) {
      const reason=`Grok 调用失败：${e?.message||e}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
