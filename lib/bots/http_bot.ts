// lib/bots/http_bot.ts
import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';

type HttpBotOpts = {
  /** 完整 URL（优先使用） */
  url?: string;
  /** 向后兼容：旧写法，用作完整 URL */
  base?: string;
  /** Bearer 令牌 */
  apiKey?: string;
  /** 向后兼容：旧写法，等价于 apiKey */
  token?: string;
  /** 额外请求头（可选） */
  headers?: Record<string, string>;
};

export const HttpBot = (opts: HttpBotOpts): BotFunc => {
  const endpoint = ((opts.url || opts.base || '') as string).replace(/\/$/, '');
  const auth = (opts.apiKey || opts.token || '').trim();
  const extraHeaders = opts.headers || {};

  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!endpoint) throw new Error('Missing HTTP endpoint');
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(auth ? { authorization: `Bearer ${auth}` } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify(ctx),
      });
      if (!r.ok) {
        const err = await r.text().catch(() => '') as string;
        throw new Error(`HTTP ${r.status} ${err.slice(0, 200)}`);
      }
      const j: any = await r.json();
      const move = j.move === 'pass' ? 'pass' : 'play';
      const cards = Array.isArray(j.cards) ? j.cards : [];
      const reason = (j.reason ?? '').toString().trim() || 'HTTP 端返回';
      return move === 'pass' ? { move: 'pass', reason } : { move: 'play', cards, reason };
    } catch (e: any) {
      const reason = `HTTP 端调用失败：${e?.message || e}，已回退`;
      if (ctx.canPass) return { move: 'pass', reason };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
      const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force, reason };
    }
  };
};
