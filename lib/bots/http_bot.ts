import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';

type HTTPOpts = { base: string; token?: string; providerName?: string };

export const HttpBot = (opts: HTTPOpts): BotFunc => {
  const base = (opts.base || '').replace(/\/$/, '');
  const token = opts.token;
  const providerName = opts.providerName || 'http';
  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!base) throw new Error('Missing HTTP base');
      const r = await fetch(`${base}/play`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ state: ctx }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const move = j.move === 'pass' ? 'pass' : 'play';
      const cards = Array.isArray(j.cards) ? j.cards : [];
      return move === 'pass' ? { move: 'pass' } : { move: 'play', cards };
    } catch (e) {
      if (ctx.canPass) return { move: 'pass' };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
      const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force };
    }
  };
};
