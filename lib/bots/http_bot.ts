// lib/bots/http_bot.ts
// 通用 HTTP 代理 bot：把 ctx 以 JSON POST 给你的服务，由服务返回 {move, cards?, reason}
type BotMove =
  | { move: 'pass'; reason?: string }
  | { move: 'play'; cards: string[]; reason?: string };
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
    const move = obj?.move === 'pass' ? 'pass' : 'play';
    const cards: string[] = Array.isArray(obj?.cards) ? obj.cards : [];
    const reason: string | undefined = typeof obj?.reason === 'string' ? obj.reason : undefined;
    return move === 'pass' ? { move: 'pass', reason } : { move: 'play', cards, reason };
  };
