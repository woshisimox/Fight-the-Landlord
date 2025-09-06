import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';

type HttpBotOpts = { url: string; apiKey?: string };

export const HttpBot = (opts: HttpBotOpts): BotFunc => {
  const url = opts.url;
  const key = opts.apiKey || '';
  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!url) throw new Error('Missing HTTP endpoint');
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(ctx),
      });
      if (!r.ok) {
        const err = await r.text().catch(()=>'') as string;
        throw new Error(`HTTP ${r.status} ${err.slice(0,200)}`);
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