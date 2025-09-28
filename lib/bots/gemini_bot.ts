// lib/bots/gemini_bot.ts
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

export const GeminiBot = (o: { apiKey: string; model?: string }): BotFunc =>
  async (ctx: BotCtx) => {
    try {
      if (!o.apiKey) throw new Error('Missing Gemini API Key');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${o.model||'gemini-1.5-flash'}:generateContent?key=${encodeURIComponent(o.apiKey)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          generationConfig: { temperature: 0.2 },
          contents: [{
            role: 'user',
            parts: [{ text:
              `你是斗地主出牌助手。必须只输出一个 JSON 对象：\n`+
              `{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }\n\n`+
              `手牌：${ctx.hands.join('')}\n`+
              `需跟：${ctx.require?JSON.stringify(ctx.require):'null'}\n`+
              `可过：${ctx.canPass?'true':'false'}\n`+
              `策略：${ctx.policy}\n`+
              `已出牌：${(Array.isArray((ctx as any).seen) && (ctx as any).seen.length) ? (ctx as any).seen.join('') : '无'}\n`+
              
              `只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。`
            }]
          }]
        })
      });
      if (!r.ok) throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,200));
      const j:any = await r.json();
      const t = j?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text).join('') || '';
      const p:any = extractFirstJsonObject(t) || {};
      const m = p.move==='pass' ? 'pass' : 'play';
      const cds:string[] = Array.isArray(p.cards)?p.cards:[];
      const reason = nonEmptyReason(p.reason,'Gemini');
      return m==='pass'?{move:'pass',reason}:{move:'play',cards:cds,reason};
    } catch(e:any) {
      const reason=`Gemini 调用失败：${e?.message||e}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
