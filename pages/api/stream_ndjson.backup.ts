// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
// 依据你的工程结构，直接从 doudizhu 引擎导入：
import { runOneGame, GreedyMax, GreedyMin, RandomLegal, AdvancedHybrid } from '../../lib/doudizhu/engine';
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
  | 'built-in:advanced-hybrid'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type Body = {
  startScore?: number;                  // 初始分（各家相同）
  seatDelayMs?: number[];               // 每家延迟（毫秒）
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
  rounds?: number;                      // 多局数
  stopBelowZero?: boolean;              // 是否启用“低于0分提前终止”（默认 true）
};

type EngineBot = (ctx:any)=>Promise<any>|any;

function makeBot(name: BotChoice, model: string|undefined, keybag: any): EngineBot {
  const m = (model||'').trim();
  const k = keybag||{};
  switch (name) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'built-in:advanced-hybrid': return AdvancedHybrid;
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

// 从一条 event 里识别是否包含初始化的 hands / landlord
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

function writeLine(res: NextApiResponse, obj:any) {
  res.write(JSON.stringify(obj) + '\n');
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
    rounds = 1,
    startScore = 0,
    stopBelowZero = true,
  } = body;

  res.writeHead(200, {
    'Content-Type':'application/x-ndjson; charset=utf-8',
    'Cache-Control':'no-cache, no-transform',
    'Connection':'keep-alive',
  });

  if (!enabled) { writeLine(res, { type:'log', message:'对局未启用（enabled=false）' }); res.end(); return; }

  try {
    // 准备 Bot
    const bots: EngineBot[] = [0,1,2].map(i => makeBot(seats[i]||'built-in:greedy-max', seatModels[i], seatKeys[i]));

    // 维护总分（仅用于早停 & 旁路可视化日志；前端仍可自己统计）
    let totals:[number,number,number] = [startScore, startScore, startScore];

    for (let round = 1; round <= Math.max(1, rounds|0); round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      const iter = runOneGame({ seats: bots as any, rob, four2 } as any);
      let sentInit = false;

      for await (const ev of iter as any) {
        if (!sentInit) {
          const got = pickHands(ev);
          if (got) {
            writeLine(res, { type:'state', kind:'init', landlord: got.landlord, hands: got.hands });
            sentInit = true;
            if (ev?.kind==='init') continue; // 已手动发了 init，不重复写
          }
        }

        // 每家延迟：只对出牌事件生效
        if (ev?.type==='event' && ev?.kind==='play') {
          const s = Number(seatDelayMs?.[ev.seat] ?? 0);
          if (s>0) await new Promise(r=>setTimeout(r,s));
        }

        writeLine(res, ev);

        // 统计并检查早停
        if (ev?.type==='event' && ev?.kind==='win') {
          const ds = ev?.deltaScores as [number,number,number] | undefined;
          if (ds) {
            totals = [ totals[0]+ds[0], totals[1]+ds[1], totals[2]+ds[2] ];
            writeLine(res, { type:'log', message:`当前总分：${totals.join(' / ')}` });
            if (stopBelowZero && Math.min(...totals) < 0) {
              writeLine(res, { type:'log', message:`有选手积分 < 0，提前终止多轮。` });
              res.end(); 
              return;
            }
          }
        }
      }

      if (round < rounds) {
        writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
      }
    }

    res.end();
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message||String(e)}` });
    try { res.end(); } catch {}
  }
}
