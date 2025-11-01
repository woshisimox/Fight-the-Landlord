
// lib/bots/grok_bot.ts
import { buildDouPrompts, extractFirstJsonObject, nonEmptyReason, PromptMode } from './util';

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
    return { phase: 'bid', bid: rec, reason: nonEmptyReason(reason, 'Grok') };
  }
  if ((ctx as any)?.phase === 'double') {
    const info: any = (ctx as any)?.double || {};
    const rec = (typeof info.recommended === 'boolean') ? !!info.recommended : !!info.default;
    return { phase: 'double', double: rec, reason: nonEmptyReason(reason, 'Grok') };
  }
  if (ctx && ctx.canPass) return { move: 'pass', reason };
  const first = Array.isArray(ctx?.hands) && ctx.hands.length ? ctx.hands[0] : '3';
  return { phase: 'play', move: 'play', cards: [first], reason };
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export const GrokBot = (o: { apiKey: string; model?: string }): BotFunc =>
  async (ctx: BotCtx) => {
    try {
      if (!o.apiKey) throw new Error('Missing xAI API Key');
      const url = 'https://api.x.ai/v1/chat/completions';
      const phase = ((ctx as any)?.phase || 'play') as 'bid' | 'double' | 'play';
      const attempts: PromptMode[] = ['normal', 'safe', 'minimal'];
      let lastErr: any;
      for (const mode of attempts) {
        try {
          const { system, user } = buildDouPrompts(ctx, phase, mode);
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
            body: JSON.stringify({
              model: o.model || 'grok-2-latest',
              temperature: 0.2,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ]
            })
          });
          if (!resp.ok) {
            const text = await resp.text();
            const err: any = new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
            err.status = resp.status;
            err.body = text;
            throw err;
          }
          const j: any = await resp.json();
          const t = j?.choices?.[0]?.message?.content || '';
          const p: any = extractFirstJsonObject(String(t)) || {};
          if (phase === 'bid') {
            if (typeof p.bid === 'boolean') {
              return { phase: 'bid', bid: !!p.bid, reason: nonEmptyReason(p.reason, 'Grok') };
            }
            if (p.move === 'pass') return { phase: 'bid', bid: false, reason: nonEmptyReason(p.reason, 'Grok') };
            if (p.move === 'play') return { phase: 'bid', bid: true, reason: nonEmptyReason(p.reason, 'Grok') };
            throw new Error('invalid bid response');
          }
          if (phase === 'double') {
            if (typeof p.double === 'boolean') {
              return { phase: 'double', double: !!p.double, reason: nonEmptyReason(p.reason, 'Grok') };
            }
            if (typeof p.bid === 'boolean') {
              return { phase: 'double', double: !!p.bid, reason: nonEmptyReason(p.reason, 'Grok') };
            }
            if (p.move === 'pass') return { phase: 'double', double: false, reason: nonEmptyReason(p.reason, 'Grok') };
            if (p.move === 'play') return { phase: 'double', double: true, reason: nonEmptyReason(p.reason, 'Grok') };
            throw new Error('invalid double response');
          }
          const mv = p.move === 'pass' ? 'pass' : 'play';
          const cards: string[] = Array.isArray(p.cards) ? p.cards : [];
          const reason = nonEmptyReason(p.reason, 'Grok');
          return mv === 'pass'
            ? { phase: 'play', move: 'pass', reason }
            : { phase: 'play', move: 'play', cards, reason };
        } catch (err: any) {
          lastErr = err;
          const msg = String(err?.message || '').toLowerCase();
          const body = String(err?.body || '').toLowerCase();
          const status = Number(err?.status) || 0;
          const isRate = status === 429 || /rate limit|too many requests/.test(msg) || /rate limit|too many requests/.test(body);
          const isSafety = /safety|blocked|filter/.test(msg) || /safety|blocked|filter/.test(body);
          if ((isRate || isSafety) && mode !== 'minimal') {
            await sleep(isRate ? 2500 : 1800);
            continue;
          }
          throw err;
        }
      }
      throw lastErr || new Error('Grok 请求失败');
    } catch (e: any) {
      const reason = `Grok 调用失败：${e?.message || e}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
