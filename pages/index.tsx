import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal, type IBot as EngineIBot } from '../../lib/doudizhu/engine';

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
  delayMs?: number;
  startScore?: number;
  seatDelayMs?: number[];  // 每家最小间隔
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
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function makeBot(name: BotChoice, _idx: number, model: string | undefined, keybag: any): EngineIBot {
  const m = (model || '').trim();
  const k = keybag || {};
  switch (name) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai': return OpenAIBot({ apiKey: k.openai || '', model: m || 'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: k.gemini || '', model: m || 'gemini-1.5-flash' });
    case 'ai:grok':   return GrokBot({ apiKey: k.grok || '', model: m || 'grok-2-latest' });
    case 'ai:kimi':   return KimiBot({ apiKey: k.kimi || '', model: m || 'moonshot-v1-8k' });
    case 'ai:qwen':   return QwenBot({ apiKey: k.qwen || '', model: m || 'qwen-plus' });
    case 'http':      return HttpBot({ baseUrl: (k.httpBase || '').replace(/\/$/, ''), token: k.httpToken || '' });
    default:          return GreedyMax;
  }
}

// 识别并抽取 hands/landlord（兼容多种结构）
function pickHands(ev: any): { hands: string[][], landlord: number|null } | null {
  const hands =
    ev?.hands ??
    ev?.payload?.hands ??
    ev?.state?.hands ??
    ev?.init?.hands;

  if (Array.isArray(hands) && hands.length === 3 && Array.isArray(hands[0])) {
    const landlord =
      ev?.landlord ??
      ev?.payload?.landlord ??
      ev?.state?.landlord ??
      ev?.init?.landlord ?? null;
    return { hands, landlord };
  }
  return null;
}

function writeInit(res: NextApiResponse, hands: string[][], landlord: number|null) {
  res.write(JSON.stringify({ type: 'state', kind: 'init', landlord, hands }) + '\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const body: Body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const {
    delayMs = 0,
    seatDelayMs = [0,0,0],
    enabled = true,
    rob = true,
    four2 = 'both',
    seats = ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'],
    seatModels = [],
    seatKeys = [],
  } = body;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
  });

  if (!enabled) {
    res.write(JSON.stringify({ type:'log', message:'对局未启用（enabled=false）' }) + '\n');
    res.end();
    return;
  }

  try {
    const bots: EngineIBot[] = [0,1,2].map(i =>
      makeBot(seats[i] || 'built-in:greedy-max', i, seatModels[i], seatKeys[i])
    );

    const iter = runOneGame({
      seats: bots,
      delayMs,   // 引擎自己的节流（若有）
      rob,
      four2,
    } as any);

    let sentInit = false;

    for await (const ev of iter as any) {
      // 发现包含 hands 的事件：立刻发一条标准化 init
      if (!sentInit) {
        const got = pickHands(ev);
        if (got) {
          writeInit(res, got.hands, got.landlord);
          sentInit = true;
          // 如果 ev 就是 init，那这条就不再转发，避免重复
          if (ev?.kind === 'init') continue;
        }
      }

      // 每家延迟：仅在出牌事件上应用
      if (ev?.type === 'event' && ev?.kind === 'play') {
        const s = Number(seatDelayMs?.[ev.seat] ?? 0);
        if (s > 0) await sleep(s);
      } else if (delayMs > 0) {
        await sleep(delayMs);
      }

      res.write(JSON.stringify(ev) + '\n');
    }

    res.end();
  } catch (e: any) {
    res.write(JSON.stringify({ type:'log', message:`后端错误：${e?.message || String(e)}` }) + '\n');
    try { res.end(); } catch {}
  }
}
