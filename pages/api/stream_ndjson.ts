// pages/api/stream_ndjson.ts
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

function makeBot(name: BotChoice, idx: number, model: string | undefined, keybag: any): EngineIBot {
  const m = (model || '').trim();
  const keys = keybag || {};
  switch (name) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai': return OpenAIBot({ apiKey: keys.openai || '', model: m || 'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: keys.gemini || '', model: m || 'gemini-1.5-flash' });
    case 'ai:grok':   return GrokBot({ apiKey: keys.grok || '', model: m || 'grok-2-latest' });
    case 'ai:kimi':   return KimiBot({ apiKey: keys.kimi || '', model: m || 'moonshot-v1-8k' });
    case 'ai:qwen':   return QwenBot({ apiKey: keys.qwen || '', model: m || 'qwen-plus' });
    case 'http':      return HttpBot({ baseUrl: (keys.httpBase || '').replace(/\/$/, ''), token: keys.httpToken || '' });
    default:          return GreedyMax;
  }
}

// 标准化输出一条“初始化”事件（只要带 hands 就发）
function writeInit(res: NextApiResponse, ev: any) {
  const landlord = ev.landlord ?? 0;
  const hands = ev.hands;
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

  // 立即返回一个可读的 NDJSON 流
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

    // 从引擎跑一局；这里假设 runOneGame 返回 AsyncIterable 事件
    const iter = runOneGame({
      seats: bots,
      delayMs,                 // 建议引擎内部设为 0；外层按 seatDelayMs 控速
      rob,
      four2,
    } as any);

    for await (const ev of iter as any) {
      // 若事件里自带 hands（无论它叫 init、deal、state...），先发一条标准化初始化
      if (ev && Array.isArray(ev.hands) && ev.hands.length === 3) {
        writeInit(res, ev);
        continue;
      }

      // 每家延时（最小间隔）：在出牌事件时应用
      if (ev?.type === 'event' && ev?.kind === 'play') {
        const s = Number(seatDelayMs?.[ev.seat] ?? 0);
        if (s > 0) await sleep(s);
      } else if (delayMs > 0) {
        // 其它事件的全局节流（可选）
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
