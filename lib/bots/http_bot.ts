// lib/bots/http_bot.ts
// 通用 HTTP 代理 bot：把 ctx 以 JSON POST 给你的服务，由服务返回 {move, cards?, reason}
type BotMove =
  | { phase?: 'play'; move: 'pass'; reason?: string }
  | { phase?: 'play'; move: 'play'; cards: string[]; reason?: string }
  | { phase: 'bid'; bid: boolean; reason?: string }
  | { phase: 'double'; double: boolean; reason?: string };
type BotCtx = any;
type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

export const HttpBot = (o: {
  base?: string;            // 建议使用 base（或 url）
  url?: string;
  apiKey?: string;
  token?: string;
  headers?: Record<string, string>;
}): BotFunc =>
  async (ctx: BotCtx) => {
    const endpoint = (o.url || o.base || '').replace(/\/$/, '');
    if (!endpoint) throw new Error('Missing HTTP endpoint (base/url)');

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(o.apiKey ? { 'x-api-key': o.apiKey } : {}),
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.headers || {}),
      },
      body: JSON.stringify({ ctx, seen: (Array.isArray((ctx as any)?.seen)?(ctx as any).seen:[]), seenBySeat: (Array.isArray((ctx as any)?.seenBySeat)?(ctx as any).seenBySeat:[[],[],[]]), seatInfo: { seat:(ctx as any).seat, landlord:(ctx as any).landlord, leader:(ctx as any).leader, trick:(ctx as any).trick } }),
    });

    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} ${txt.slice(0, 200)}`);
    let obj: any = {};
    try { obj = JSON.parse(txt); } catch {}
    if (obj?.phase === 'bid' || typeof obj?.bid === 'boolean') {
      const decision = typeof obj?.bid === 'boolean' ? !!obj.bid : (obj?.move === 'pass' ? false : true);
      const reason: string | undefined = typeof obj?.reason === 'string' ? obj.reason : undefined;
      return { phase: 'bid', bid: decision, reason };
    }
    if (obj?.phase === 'double' || typeof obj?.double === 'boolean') {
      const decision = typeof obj?.double === 'boolean' ? !!obj.double : (typeof obj?.bid === 'boolean' ? !!obj.bid : (obj?.move === 'pass' ? false : true));
      const reason: string | undefined = typeof obj?.reason === 'string' ? obj.reason : undefined;
      return { phase: 'double', double: decision, reason };
    }
    const move = obj?.move === 'pass' ? 'pass' : 'play';
    const cards: string[] = Array.isArray(obj?.cards) ? obj.cards : [];
    const reason: string | undefined = typeof obj?.reason === 'string' ? obj.reason : undefined;
    return move === 'pass' ? { phase:'play', move: 'pass', reason } : { phase:'play', move: 'play', cards, reason };
  };
