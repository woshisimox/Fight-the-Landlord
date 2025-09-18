// @ts-nocheck
// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';
// 如有 DeepSeek，请解除下一行注释并确保存在对应文件
// import { DeepSeekBot } from '../../lib/bots/deepseek_bot';

type BotFunc = (ctx:any)=>Promise<any>|any;
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

type SeatKeys = {
  openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string;
  httpBase?: string; httpToken?: string;
};

function writeLine(res: NextApiResponse, obj: any) {
  try {
    res.write(JSON.stringify(obj) + '\n');
  } catch (e) {
    // 尽量避免因某帧异常导致整个流中断
    try { res.write(JSON.stringify({ type:'error', message: String(e) }) + '\n'); } catch {}
  }
}

function ok(v:any){ return v!==undefined && v!==null; }

function chooseBot(kind: BotChoice, model?: string, keys?: SeatKeys): BotFunc {
  try {
    switch (kind) {
      case 'built-in:greedy-max': return async (ctx:any)=> await GreedyMax(ctx);
      case 'built-in:greedy-min': return async (ctx:any)=> await GreedyMin(ctx);
      case 'built-in:random-legal': return async (ctx:any)=> await RandomLegal(ctx);

      case 'ai:openai': {
        if (OpenAIBot && keys?.openai) return OpenAIBot({ model, apiKey: keys.openai }) as unknown as BotFunc;
        return async (ctx:any)=> {
          const m = await GreedyMax(ctx);
          m.reason = `外部AI(openai)未接入后端，已回退内建（GreedyMax）`;
          return m;
        };
      }
      case 'ai:gemini': {
        if (GeminiBot && keys?.gemini) return GeminiBot({ model, apiKey: keys.gemini }) as unknown as BotFunc;
        return async (ctx:any)=> {
          const m = await GreedyMax(ctx);
          m.reason = `外部AI(gemini)未接入后端，已回退内建（GreedyMax）`;
          return m;
        };
      }
      case 'ai:grok': {
        if (GrokBot && keys?.grok) return GrokBot({ model, apiKey: keys.grok }) as unknown as BotFunc;
        return async (ctx:any)=> {
          const m = await GreedyMax(ctx);
          m.reason = `外部AI(grok)未接入后端，已回退内建（GreedyMax）`;
          return m;
        };
      }
      case 'ai:kimi': {
        if (KimiBot && keys?.kimi) return KimiBot({ model, apiKey: keys.kimi }) as unknown as BotFunc;
        return async (ctx:any)=> {
          const m = await GreedyMax(ctx);
          m.reason = `外部AI(kimi)未接入后端，已回退内建（GreedyMax）`;
          return m;
        };
      }
      case 'ai:qwen': {
        if (QwenBot && keys?.qwen) return QwenBot({ model, apiKey: keys.qwen }) as unknown as BotFunc;
        return async (ctx:any)=> {
          const m = await GreedyMax(ctx);
          m.reason = `外部AI(qwen)未接入后端，已回退内建（GreedyMax）`;
          return m;
        };
      }
      case 'ai:deepseek': {
        // if (DeepSeekBot && keys?.deepseek) return DeepSeekBot({ model, apiKey: keys.deepseek }) as unknown as BotFunc;
        return async (ctx:any)=> {
          const m = await GreedyMax(ctx);
          m.reason = `外部AI(deepseek)未接入后端，已回退内建（GreedyMax）`;
          return m;
        };
      }
      case 'http': {
        if (HttpBot) {
          return HttpBot({
            base: keys?.httpBase,
            token: keys?.httpToken,
            apiKey: keys?.httpToken,
            url: keys?.httpBase,
            model,
            headers: {}
          }) as unknown as BotFunc;
        }
        return async (ctx:any)=> {
          const m = await GreedyMax(ctx);
          m.reason = `外部AI(http)未接入后端，已回退内建（GreedyMax）`;
          return m;
        };
      }
      default:
        return async (ctx:any)=> await GreedyMax(ctx);
    }
  } catch (e) {
    return async (ctx:any)=> {
      try {
        const m = await GreedyMax(ctx);
        m.reason = `bot构建失败(${String(e)}), fallback GreedyMax`;
        return m;
      } catch {
        return { move: 'pass', reason: 'bot构建失败且fallback失败' };
      }
    };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // Streaming headers
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    // 'Transfer-Encoding': 'chunked' // 平台通常自动设置
  });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

  const rounds:number = Number(body.rounds ?? 1) || 1;
  const startScore:number = Number(body.startScore ?? 0) || 0;
  const seatDelayMs:number[] = Array.isArray(body.seatDelayMs) ? body.seatDelayMs : [0,0,0];
  const enabled:boolean = !!(ok(body.enabled) ? body.enabled : true);
  const rob:boolean = !!(ok(body.rob) ? body.rob : true);
  const four2:any = body.four2 ?? 'both';
  const seats:BotChoice[] = Array.isArray(body.seats) ? body.seats : ['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'];
  const seatModels:string[] = Array.isArray(body.seatModels) ? body.seatModels : ['','',''];
  const seatKeys:SeatKeys[] = Array.isArray(body.seatKeys) ? body.seatKeys : [{},{},{}];
  const farmerCoop:boolean = !!(ok(body.farmerCoop) ? body.farmerCoop : true);
  const turnTimeoutSecs:number[] = Array.isArray(body.turnTimeoutSecs) ? body.turnTimeoutSecs
    : (ok(body.turnTimeoutSec) ? [Number(body.turnTimeoutSec)||30, Number(body.turnTimeoutSec)||30, Number(body.turnTimeoutSec)||30] : [30,30,30]);

  // Bot 构建
  const bots: BotFunc[] = seats.slice(0,3).map((kind, i)=> chooseBot(kind as BotChoice, seatModels[i] || '', seatKeys[i] || {}));

  writeLine(res, { type:'event', kind:'server-ready', ts: Date.now() });

  try {
    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'event', kind:'round-start', round });

      let seenResult = false;
      let lastWinner: number | null = null;
      let lastDelta: number[] | null = null;
      let lastMultiplier: number | null = null;
      let landlord: number | null = null;

      const config:any = {
        seats: bots as any,
        rob,
        four2,
        farmerCoop,
        seatDelayMs,
        enabled,
        startScore,
        turnTimeoutSecs,
      };

      const iter:any = runOneGame(config, {} as any);

      for await (const ev of iter) {
        // 透传所有事件
        writeLine(res, ev);

        // 抓取常用字段以便兜底
        try {
          if (typeof ev.landlord === 'number') landlord = ev.landlord;
          if (ev.type === 'result' || (ev.type==='event' && (ev.kind==='result'||ev.kind==='win'||ev.kind==='game-over'))) {
            seenResult = true;
            if (ok(ev.winner)) lastWinner = ev.winner;
            if (Array.isArray(ev.deltaScores)) lastDelta = ev.deltaScores;
            if (Array.isArray(ev.delta)) lastDelta = ev.delta;
            if (ok(ev.multiplier)) lastMultiplier = ev.multiplier;
          }
        } catch {}
      }

      // 若引擎未显式发 result，给一个兜底（尽量保守）
      if (!seenResult) {
        writeLine(res, {
          type: 'result',
          winner: ok(lastWinner) ? lastWinner : null,
          deltaScores: Array.isArray(lastDelta) ? lastDelta : [0,0,0],
          multiplier: ok(lastMultiplier) ? lastMultiplier : 1,
          landlord: ok(landlord) ? landlord : null,
        });
      }

      // 明确边界：回合结束
      writeLine(res, { type:'event', kind:'round-end', round });
    }

    // 结束
    try { res.end(); } catch {}
  } catch (e:any) {
    writeLine(res, { type:'error', message: String(e?.message || e) });
    try { res.end(); } catch {}
  }
}