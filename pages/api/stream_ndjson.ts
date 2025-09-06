import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

export const config = { api: { bodyParser: false, responseLimit: false } };

function readBody(req: NextApiRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
    return;
  }

  const body = await readBody(req).catch(()=>({}));
  const rounds  = Number(body.rounds ?? 1);
  const seed    = Number(body.seed ?? 0);
  const delayMs = Number(body.delayMs ?? 200);
  const four2   = (body.four2 ?? 'both') as 'both'|'2singles'|'2pairs';
  const playersStr = String(body.players ?? 'builtin,builtin,builtin');

  const seatProviders: string[] = Array.isArray(body.seatProviders)
    ? body.seatProviders
    : String(playersStr).split(',').map((s:string)=>s.trim());
const seatKeys: any[] = Array.isArray(body.seatKeys) ? body.seatKeys : [];

  const toBot = (name: string, idx: number) => {
    const n = (name || '').trim().toLowerCase();
    if (n==='openai') return OpenAIBot({ apiKey: (seatKeys[idx]?.openai)||'' });
    if (n==='gemini') return GeminiBot({ apiKey: (seatKeys[idx]?.gemini)||'' });
    if (n==='grok')   return GrokBot({ apiKey: (seatKeys[idx]?.grok)||'' });
    if (n==='http')   return HttpBot({ base: (seatKeys[idx]?.httpBase)||'', token: (seatKeys[idx]?.httpToken)||'' });
    if (n==='kimi')   return KimiBot({ apiKey: (seatKeys[idx]?.kimi)||'' });
    if (n==='qwen' || n==='qianwen') return QwenBot({ apiKey: (seatKeys[idx]?.qwen)||'' });
    if (n==='greedymax' || n==='max' || n==='builtin') return GreedyMax;
    if (n==='greedymin' || n==='min') return GreedyMin;
    if (n==='random' || n==='randomlegal') return RandomLegal;
    return GreedyMax;
  };
  const botNames = playersStr.split(',').map((s:string)=>s.trim());
  const pickedProviders = (seatProviders || botNames).map((s:any)=> String(s||'builtin').trim().toLowerCase());
  const botLabels = botNames.map((s:string)=>{
    const n = (s||'').trim().toLowerCase();
    if (['openai','gemini','grok','http','kimi','qwen','qianwen'].includes(n)) return n;
    if (n==='greedymax' || n==='max' || n==='builtin') return 'GreedyMax';
    if (n==='greedymin' || n==='min') return 'GreedyMin';
    if (n==='random' || n==='randomlegal') return 'Random';
    return 'GreedyMax';
  });
  const bots = [ toBot(pickedProviders[0]||'builtin',0), toBot(pickedProviders[1]||'builtin',1), toBot(pickedProviders[2]||'builtin',2) ] as any;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Transfer-Encoding': 'chunked',
    'X-Accel-Buffering': 'no',
  });
  const write = (obj: any) => res.write(JSON.stringify(obj) + '\n');

  // 写入 meta（不包含任何 Key）
  write({ type: 'event', kind: 'meta', seatProviders: seatProviders.map(p => String(p||'builtin')) });

  for (let r=0; r<rounds; r++) {
    const game = runOneGame({ seed: seed + r, players: bots, four2, delayMs });
    for await (const ev of game) {
      if (ev && ev.type==='event' && ev.kind==='play' && typeof (ev as any).seat === 'number') {
        const seat = (ev as any).seat as number;
        const provider = (pickedProviders[seat] || botLabels[seat] || 'builtin') + '';
        const rawReason = ((ev as any).reason ?? (ev as any).aiReason ?? (ev as any).explain ?? '').toString().trim();
        const noReason = !rawReason || rawReason.length === 0;
        const providerFallbackMsg = (
          provider==='builtin' || provider==='GreedyMax' || provider==='GreedyMin' || provider==='Random'
            ? `内建算法（${botLabels[seat]}）`
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
