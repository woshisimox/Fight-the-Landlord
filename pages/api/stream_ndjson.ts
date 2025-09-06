import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

export const config = { api: { bodyParser: false, responseLimit: false } };

// ---- Dynamic engine import with fallback paths ----
// We avoid static import so the build won't fail if the engine lives in a different folder.
declare const require: any;
const engineA: any = (() => { try { return require('../../lib/doudizhu/engine'); } catch { return null; } })();
const engineB: any = engineA || (() => { try { return require('../../lib/engine'); } catch { return null; } })();
const runOneGame: any     = engineB?.runOneGame;
const GreedyMax: any      = engineB?.GreedyMax;
const GreedyMin: any      = engineB?.GreedyMin;
const RandomLegal: any    = engineB?.RandomLegal;

function readBody(req: NextApiRequest): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // If engine is missing at runtime, fail gracefully with a hint
  if (!runOneGame) {
    res.status(500).json({ error: 'Engine module not found. Please ensure lib/doudizhu/engine.ts or lib/engine.ts exists.' });
    return;
  }

  const body = req.method === 'POST' ? await readBody(req) : (req.query || {});

  const rounds  = Number((body as any).rounds ?? 1);
  const seed    = Number((body as any).seed ?? 0);
  const delayMs = Number((body as any).delayMs ?? 200);
  const four2   = ((body as any).four2 ?? 'both') as any;
  const playersStr = String((body as any).players ?? 'builtin,builtin,builtin');

  const seatProviders: string[] = Array.isArray((body as any).seatProviders)
    ? (body as any).seatProviders
    : String(playersStr).split(',').map((s:string)=>s.trim());
  const seatKeys: any[] = Array.isArray((body as any).seatKeys) ? (body as any).seatKeys : [];
  const apiKeys: any = (body as any).apiKeys || {};

  const toBot = (name: string, idx: number) => {
    const n = (name || '').trim().toLowerCase();
    if (n==='openai') return OpenAIBot({ apiKey: (seatKeys[idx]?.openai)||apiKeys.openai||'' });
    if (n==='gemini') return GeminiBot({ apiKey: (seatKeys[idx]?.gemini)||apiKeys.gemini||'' });
    if (n==='grok')   return GrokBot({ apiKey: (seatKeys[idx]?.grok)||apiKeys.grok||'' });
    if (n==='http')   return HttpBot({ base: (seatKeys[idx]?.httpBase)||apiKeys.httpBase||'', token: (seatKeys[idx]?.httpToken)||apiKeys.httpToken||'' });
    if (n==='kimi')   return KimiBot({ apiKey: (seatKeys[idx]?.kimi)||apiKeys.kimi||'' });
    if (n==='qwen' || n==='qianwen') return QwenBot({ apiKey: (seatKeys[idx]?.qwen)||apiKeys.qwen||'' });
    if (n==='greedymin' || n==='min') return GreedyMin;
    if (n==='random' || n==='randomlegal') return RandomLegal;
    return GreedyMax; // builtin
  };

  const picked = [seatProviders[0]||'builtin', seatProviders[1]||'builtin', seatProviders[2]||'builtin'];
  const rawBots = [ toBot(picked[0], 0), toBot(picked[1], 1), toBot(picked[2], 2) ] as any;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no',
  });
  const write = (obj: any) => res.write(JSON.stringify(obj) + '\n');

  // Meta
  write({ type: 'event', kind: 'meta', seatProviders: picked.map(p=>String(p||'builtin')) });

  const CALL_TIMEOUT_MS = Number((body as any)?.timeoutMs ?? 15000);
  function wrapBot(name: string, i: number, bot: any) {
    return async (ctx: any) => {
      write({ type: 'event', kind: 'ai-call', seat: i, provider: name, canPass: ctx.canPass, require: ctx.require });
      const start = Date.now();
      let mv: any;
      try {
        mv = await Promise.race([
          bot(ctx),
          new Promise((resolve) => setTimeout(() => resolve({ move: ctx.canPass ? 'pass' : 'play', cards: [], reason: '超时兜底' }), CALL_TIMEOUT_MS)),
        ]);
      } catch (e: any) {
        mv = ctx.canPass ? { move: 'pass', reason: String(e) } : { move: 'play', cards: [ctx.hands[0]], reason: '异常兜底:'+String(e) };
      }
      const dur = Date.now()-start;
      const reason = (mv as any)?.reason || '（上游未给出理由）';
      write({ type: 'event', kind: 'ai-result', seat: i, provider: name, move: mv.move, cards: (mv as any).cards || [], reason, ms: dur });
      return mv;
    };
  }
  const bots = [ wrapBot(picked[0],0,rawBots[0]), wrapBot(picked[1],1,rawBots[1]), wrapBot(picked[2],2,rawBots[2]) ] as any;

  for (let r=0; r<rounds; r++) {
    const game = runOneGame({ seed: seed + r, players: bots, four2, delayMs });
    for await (const ev of game) {
      if (ev && ev.type==='event' && ev.kind==='play' && typeof (ev as any).seat === 'number') {
        const seat = (ev as any).seat as number;
        const provider = (picked[seat] || 'builtin') + '';
        const rawReason = ((ev as any).reason ?? (ev as any).aiReason ?? (ev as any).explain ?? '').toString().trim();
        const noReason = !rawReason || rawReason.length === 0;
        const providerFallbackMsg = (
          provider==='builtin' || provider==='greedymax' || provider==='greedymin' || provider==='random' || provider==='randomlegal'
            ? `内建算法（${provider}）`
            : `${provider} 已调用但未返回理由（请检查上游是否严格输出 JSON）`
        );
        const enhanced = { ...(ev as any), provider, reason: noReason ? providerFallbackMsg : rawReason };
        write(enhanced); continue;
      }
      write(ev);
    }
  }
  res.end();
}
