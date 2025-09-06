// lib/bots/kimi_bot.ts
import { BotFunc, BotMove, BotCtx, generateMoves } from '../doudizhu/engine';
import { extractFirstJsonObject, nonEmptyReason } from './util';

type KimiOpts = { apiKey: string; model?: string; baseUrl?: string };

let _kimiNextAllowedAt = 0;
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function parseRetryAfter(h: Headers, bodyText: string): number {
  const ra = h.get('retry-after');
  if (ra) {
    const n = Number(ra);
    if (!Number.isNaN(n) && n > 0) return n * 1000;
    const t = Date.parse(ra);
    if (!Number.isNaN(t)) return Math.max(0, t - Date.now());
  }
  const m = /after\s+(\d+(?:\.\d+)?)\s*seconds?/i.exec(bodyText || '');
  if (m) {
    const s = Number(m[1]);
    if (!Number.isNaN(s) && s >= 0) return Math.round(s * 1000);
  }
  return 2000;
}

async function respectOrgRateLimit(minGapMs = 22000) {
  const now = Date.now();
  const wait = _kimiNextAllowedAt - now;
  if (wait > 0) await sleep(wait);
  _kimiNextAllowedAt = Date.now() + minGapMs;
}

function buildPrompt(ctx: BotCtx): string {
  const hand = ctx.hands.join('');
  const req = ctx.require ? JSON.stringify(ctx.require) : 'null';
  const canPass = ctx.canPass ? 'true' : 'false';
  const policy = ctx.policy;
  return [
    '你是斗地主出牌助手。必须只输出一个 JSON 对象：',
    '{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }',
    '',
    `手牌：${hand}`,
    `需跟：${req}`,
    `可过：${canPass}`,
    `策略：${policy}`,
    '只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。',
  ].join('\n');
}

export const KimiBot = (opts: KimiOpts): BotFunc => {
  const apiKey = opts.apiKey;
  const model = opts.model || 'moonshot-v1-8k';
  const baseUrl = (opts.baseUrl || 'https://api.moonshot.cn').replace(/\/$/, '');

  return async (ctx: BotCtx): Promise<BotMove> => {
    try {
      if (!apiKey) throw new Error('Missing Kimi API Key');
      await respectOrgRateLimit(22000);
      const prompt = buildPrompt(ctx);

      let lastErrText = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const r = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
          }),
        });

        const bodyText = await r.text().catch(()=>'') as string;
        if (!r.ok) {
          lastErrText = `HTTP ${r.status} ${bodyText.slice(0,200)}`;
          if ((r.status === 429 || (r.status >= 500 && r.status <= 599)) && attempt < 3) {
            const waitMs = parseRetryAfter(r.headers, bodyText);
            await sleep(waitMs + (attempt - 1) * 1000);
            continue;
          }
          throw new Error(lastErrText);
        }

        let j: any = {};
        try { j = JSON.parse(bodyText); } catch { j = {}; }
        const txt: string = j?.choices?.[0]?.message?.content ?? '';
        const parsed: any = extractFirstJsonObject(txt) ?? {};
        const move = parsed.move === 'pass' ? 'pass' : 'play';
        const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
        const reason = nonEmptyReason(parsed.reason, 'Kimi');
        return move === 'pass' ? { move: 'pass', reason } : { move: 'play', cards, reason };
      }

      throw new Error(lastErrText || 'unknown error');
    } catch (e: any) {
      const reason = `Kimi 调用失败：${e?.message || e}，已回退`;
      if (ctx.canPass) return { move: 'pass', reason };
      const legal = generateMoves(ctx.hands, ctx.require, ctx.policy);
      const force = (legal && legal[0]) || [ctx.hands[0]];
      return { move: 'play', cards: force, reason };
    }
  };
};
