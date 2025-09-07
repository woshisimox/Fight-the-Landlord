// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type Body = {
  startScore?: number;
  seatDelayMs?: number[];  // 每家延迟
  enabled?: boolean;
  rob?: boolean;
  four2?: 'both'|'2singles'|'2pairs';
  seats: BotChoice[];
  seatModels?: string[];
  seatKeys?: {
    openai?: string;
    gemini?: string;
    grok?: string;
    kimi?: string;
    qwen?: string;
    httpBase?: string;
    httpToken?: string;
  }[];
  rounds?: number;         // ✅ 多局数
};

type EngineBot = (ctx:any)=>Promise<any>|any;

const asBot = (fn: EngineBot) => (ctx:any)=> fn(ctx);

function makeBot(name: BotChoice, model: string|undefined, keybag: any): EngineBot {
  const m = (model||'').trim();
  const k = keybag||{};
  switch (name) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai': return OpenAIBot({ apiKey: k.openai||'', model: m||'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: k.gemini||'', model: m||'gemini-1.5-flash' });
    case 'ai:grok':   return GrokBot({ apiKey: k.grok||'', model: m||'grok-2-latest' });
    case 'ai:kimi':   return KimiBot({ apiKey: k.kimi||'', model: m||'moonshot-v1-8k' });
    case 'ai:qwen':   return QwenBot({ apiKey: k.qwen||'', model: m||'qwen-plus' });
    case 'http': {
      const base = (k.httpBase||'').replace(/\/$/, '');
      return HttpBot({ base, token: k.httpToken||'' });
    }
    default: return GreedyMax;
  }
}

// 识别 init
function pickHands(ev:any): { hands:string[][], landlord:number|null } | null {
  const hands =
    ev?.hands ?? ev?.payload?.hands ?? ev?.state?.hands ?? ev?.init?.hands;
  if (Array.isArray(hands) && hands.length===3 && Array.isArray(hands[0])) {
    const landlord =
      ev?.landlord ?? ev?.payload?.landlord ?? ev?.state?.landlord ?? ev?.init?.landlord ?? null;
    return { hands, landlord };
  }
  return null;
}

function writeInit(res: NextApiResponse, hands:string[][], landlord:number|null) {
  res.write(JSON.stringify({ type:'state', kind:'init', landlord, hands }) + '\\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); res.status(405).json({ error:'Method Not Allowed' }); return; }

  const body: Body = typeof req.body==='string' ? JSON.parse(req.body||'{}') : (req.body||{});
  const {
    enabled = true,
    rob = true,
    four2 = 'both',
    seats = ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'],
    seatModels = [],
    seatKeys = [],
    seatDelayMs = [0,0,0],
    rounds = 1,                                  // ✅ 多局数
  } = body;

  res.writeHead(200, {
    'Content-Type':'application/x-ndjson; charset=utf-8',
    'Cache-Control':'no-cache, no-transform',
    'Connection':'keep-alive',
  });

  if (!enabled) { res.write(JSON.stringify({ type:'log', message:'对局未启用（enabled=false）' })+'\\n'); res.end(); return; }

  try {
    // bots
    const bots: EngineBot[] = [0,1,2].map(i => makeBot(seats[i]||'built-in:greedy-max', seatModels[i], seatKeys[i]));

    for (let round = 1; round <= Math.max(1, rounds|0); round++) {
      const iter = runOneGame({ seats: bots, rob, four2 } as any);

      let sentInit = false;
      for await (const ev of iter as any) {
        if (!sentInit) {
          const got = pickHands(ev);
          if (got) { writeInit(res, got.hands, got.landlord); sentInit = true; if (ev?.kind==='init') continue; }
        }

        // 按每家延迟（仅在出牌事件生效）
        if (ev?.type==='event' && ev?.kind==='play') {
          const s = Number(seatDelayMs?.[ev.seat] ?? 0);
          if (s>0) await new Promise(r=>setTimeout(r,s));
        }
        res.write(JSON.stringify(ev) + '\\n');
      }

      if (round < rounds) {
        // 插入一条日志分隔
        res.write(JSON.stringify({ type:'log', message:`—— 第 ${round} 局结束 ——` }) + '\\n');
      }
    }

    res.end();
  } catch (e:any) {
    res.write(JSON.stringify({ type:'log', message:`后端错误：${e?.message||String(e)}` }) + '\\n');
    try { res.end(); } catch {}
  }
}
