// lib/bots/openai_bot.ts
import { buildDouPrompts, extractFirstJsonObject, nonEmptyReason } from './util';

type BotMove =
  | { phase?: 'play'; move: 'pass'; reason?: string }
  | { phase?: 'play'; move: 'play'; cards: string[]; reason?: string }
  | { phase: 'bid'; bid: boolean; reason?: string }
  | { phase: 'double'; double: boolean; reason?: string };
type BotCtx = { hands: string[]; require?: any; canPass: boolean; policy?: any; phase?: 'play'|'bid'|'double'; bid?: any; double?: any };
type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

// 简易兜底（当上游 API 出错时）：
// - 若允许过牌：直接过牌
// - 否则：打出第一张手牌（可能不是最优，但可让引擎继续运行）
function fallbackMove(ctx: BotCtx, reason: string): BotMove {
  if ((ctx as any)?.phase === 'bid') {
    const info: any = (ctx as any)?.bid || {};
    const rec = (typeof info.recommended === 'boolean') ? !!info.recommended : !!info.default;
    return { phase: 'bid', bid: rec, reason: nonEmptyReason(reason, 'OpenAI') };
  }
  if ((ctx as any)?.phase === 'double') {
    const info: any = (ctx as any)?.double || {};
    const rec = (typeof info.recommended === 'boolean') ? !!info.recommended : !!info.default;
    return { phase: 'double', double: rec, reason: nonEmptyReason(reason, 'OpenAI') };
  }
  if (ctx && ctx.canPass) return { move: 'pass', reason };
  const first = Array.isArray(ctx?.hands) && ctx.hands.length ? ctx.hands[0] : '3';
  return { phase: 'play', move: 'play', cards: [first], reason };
}


export const OpenAIBot = (o: { apiKey: string; model?: string }): BotFunc =>
  async (ctx: BotCtx) => {
    try {
      if (!o.apiKey) throw new Error('Missing OpenAI API Key');
      const url = 'https://api.openai.com/v1/chat/completions';
      const phase = ((ctx as any)?.phase || 'play') as 'bid' | 'double' | 'play';
      const { system, user } = buildDouPrompts(ctx, phase, 'normal');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ];
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model || 'gpt-4o-mini',
          temperature: 0.2,
          messages
        })
      });
      if (!r.ok) throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,200));
      const j:any = await r.json();
      const t = j?.choices?.[0]?.message?.content ?? '';
      const p:any = extractFirstJsonObject(String(t)) || {};
      if (phase === 'bid') {
        if (typeof p.bid === 'boolean') {
          return { phase: 'bid', bid: !!p.bid, reason: nonEmptyReason(p.reason, 'OpenAI') };
        }
        if (p.move === 'pass') return { phase: 'bid', bid: false, reason: nonEmptyReason(p.reason, 'OpenAI') };
        if (p.move === 'play') return { phase: 'bid', bid: true, reason: nonEmptyReason(p.reason, 'OpenAI') };
        throw new Error('invalid bid response');
      }
      if (phase === 'double') {
        if (typeof p.double === 'boolean') {
          return { phase: 'double', double: !!p.double, reason: nonEmptyReason(p.reason, 'OpenAI') };
        }
        if (typeof p.bid === 'boolean') {
          return { phase: 'double', double: !!p.bid, reason: nonEmptyReason(p.reason, 'OpenAI') };
        }
        if (p.move === 'pass') return { phase: 'double', double: false, reason: nonEmptyReason(p.reason, 'OpenAI') };
        if (p.move === 'play') return { phase: 'double', double: true, reason: nonEmptyReason(p.reason, 'OpenAI') };
        throw new Error('invalid double response');
      }
      const m = p.move==='pass' ? 'pass' : 'play';
      const cds:string[] = Array.isArray(p.cards)?p.cards:[];
      const reason = nonEmptyReason(p.reason,'OpenAI');
      return m==='pass'?{phase:'play',move:'pass',reason}:{phase:'play',move:'play',cards:cds,reason};
    } catch(e:any) {
      const reason=`OpenAI 调用失败：${e?.message||e}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
