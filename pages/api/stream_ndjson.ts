// pages/api/stream_ndjson.ts （稳态修复 + 心跳 + 反缓存）
import type { NextApiRequest, NextApiResponse } from 'next';

// 这些 import 在你的仓库中应已存在；如若缺失请按需删改（或仅保留内置 bot）
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
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

type SeatSpec = { model?: string; apiKey?: string; baseUrl?: string; token?: string };

function writeLine(res: NextApiResponse, obj: any) {
  // 每行一条，\n 结尾，便于前端 NDJSON 解析
  res.write(JSON.stringify(obj) + '\n');
  // @ts-ignore - 若运行环境支持 flush
  if (typeof (res as any).flush === 'function') try { (res as any).flush(); } catch {}
}

function chooseBot(choice: BotChoice, spec?: SeatSpec): (ctx:any)=>Promise<any>|any {
  switch (choice) {
    case 'built-in:greedy-max': return (GreedyMax as any);
    case 'built-in:greedy-min': return (GreedyMin as any);
    case 'built-in:random-legal': return (RandomLegal as any);
    case 'ai:openai': return (OpenAIBot as any)({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini': return (GeminiBot as any)({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-flash' });
    case 'ai:grok':   return (GrokBot as any)({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':   return (KimiBot as any)({ apiKey: spec?.apiKey || '', model: spec?.model || 'moonshot-v1-8k' });
    case 'ai:qwen':   return (QwenBot as any)({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'http':      return (HttpBot as any)({ base: (spec?.baseUrl||'').replace(/\/$/, ''), token: spec?.token || '' });
    default:          return (GreedyMax as any);
  }
}

// 跑一局（增加防卡死日志）
async function runOneRound(opts: {
  seats: any[];
  four2?: 'both'|'2singles'|'2pairs';
  rob?: boolean;
  delayMs?: number;
}, res: NextApiResponse, roundNo: number) {
  // runOneGame 的签名因版本而异，这里统一用 any 避免 TS 编译报错
  const iter: AsyncIterator<any> = (runOneGame as any)({
    seats: opts.seats,
    four2: opts.four2,
    rob: opts.rob,
    delayMs: opts.delayMs,
  });

  let evCount = 0;
  let landlord = -1;
  let trick = 0;

  // 兼容不同事件命名：尽量透传，附带少量补充字段
  for await (const value of (iter as any)) {
    evCount++;
    if (value?.kind === 'init' || value?.type === 'state') {
      landlord = (value.landlord ?? value?.state?.landlord ?? value?.init?.landlord ?? -1) as number;
      trick = 0;
    }
    if (value?.kind === 'trick-reset') trick++;

    writeLine(res, value);
    if (evCount % 200 === 0) {
      writeLine(res, { type:'log', message:`[guard] round#${roundNo} events=${evCount}, trick=${trick}, landlord=${landlord}` });
    }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 反缓存 + 流式
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx

  const body = (req.body || {}) as any;
  const rounds = Math.max(1, Number(body.rounds || 1));
  const seatDelayMs = Number(body.seatDelayMs ?? 0);
  const rob = !!body.rob;
  const four2 = (body.four2 || 'both') as ('both'|'2singles'|'2pairs');

  // 组装 seat bots
  const seats: any[] = new Array(3).fill(0).map((_, i) => {
    const choice = (Array.isArray(body.seats) ? body.seats[i] : null) as BotChoice | null;
    const models = (Array.isArray(body.seatModels) ? body.seatModels : []);
    const apikeys = body.seatKeys || {};
    const seatKey = ['E','S','W'][i] || 'E';
    const spec: SeatSpec = {
      model: models[i],
      apiKey: apikeys[seatKey] || apikeys[i] || '',
    };
    return chooseBot((choice || 'built-in:greedy-max') as BotChoice, spec);
  });

  // 心跳：便于前端快速判断“后端是否还活着”
  const hb = setInterval(() => {
    writeLine(res, { type:'log', message:`[hb] ${new Date().toISOString()}` });
  }, 2000);

  try {
    writeLine(res, { type:'log', message:`开始：共 ${rounds} 局，seatDelayMs=${seatDelayMs}, rob=${rob}, four2=${four2}` });

    let scores: [number,number,number] = (Array.isArray(body.startScore) ? body.startScore : [0,0,0]) as [number,number,number];
    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      // 把累计分先发给前端（可选）
      writeLine(res, { type:'state', kind:'score', scores });

      await runOneRound({
        seats,
        four2,
        rob,
        delayMs: seatDelayMs,
      }, res, round);

      // 这里不“算分”，而是依赖引擎在 'win' 事件里输出 deltaScores；
      // 若你的引擎没有，则在此处收集上一局结果自己加总。

      writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try { clearInterval(hb as any); } catch {}
    try { res.end(); } catch {}
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
    try { clearInterval(hb as any); } catch {}
    try { res.end(); } catch {}
  }
}
