// pages/api/stream_ndjson.ts  — jitter keep-alive & safe seat delay
import type { NextApiRequest, NextApiResponse } from 'next';

// 请替换为你工程中的实现/导入
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

interface SeatSpec {
  choice: BotChoice; model?: string; apiKey?: string;
  httpBase?: string; httpToken?: string;
}

function asBot(choice: BotChoice, spec?: SeatSpec): (ctx:any)=>Promise<any>|any {
  switch (choice) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai': return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-flash' });
    case 'ai:grok':   return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':   return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'moonshot-v1-8k' });
    case 'ai:qwen':   return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-turbo' });
    case 'http':      return HttpBot({ base: spec?.httpBase || '', token: spec?.httpToken });
    default:          return GreedyMax;
  }
}

function writeLine(res: NextApiResponse, obj: any) {
  try { res.write(JSON.stringify(obj) + '\n'); } catch {}
}

function jitteredKA(){ return 997 + Math.floor(Math.random()*63); } // 997..1059ms

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.status(405).end('Method Not Allowed'); return; }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

  // 归一化 seats（兼容老格式）
  const rawSeats: any[] = Array.isArray(body.seats) ? body.seats : [];
  const seatSpecs: SeatSpec[] = [0,1,2].map(i => {
    const s = rawSeats[i];
    if (!s || typeof s === 'string') {
      return {
        choice: (s as BotChoice) || 'built-in:greedy-max',
        model: (body.seatModels || [])[i],
        apiKey: (body.seatKeys || [])[i]?.openai || (body.seatKeys || [])[i]?.gemini || (body.seatKeys || [])[i]?.grok || (body.seatKeys || [])[i]?.kimi || (body.seatKeys || [])[i]?.qwen,
        httpBase: (body.seatKeys || [])[i]?.httpBase,
        httpToken:(body.seatKeys || [])[i]?.httpToken,
      };
    }
    return s as SeatSpec;
  });

  const MAX_ROUNDS = Math.min(Number(process.env.MAX_ROUNDS||'200'), 200);
  const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds)||1));
  const four2 = body.four2 || 'both';
  const delaysRaw: number[] = Array.isArray(body.seatDelayMs) && body.seatDelayMs.length===3 ? body.seatDelayMs : [0,0,0];
  const delays = delaysRaw.map(ms => (ms>0 && ms%1000===0) ? (ms+1) : ms); // +1ms 容差，避开整秒

  // 保持 seq 单调增长（跨局）
  let seq = 0; const nextSeq = () => (++seq);

  // keep alive（随机抖动，避开 1000ms 锁相）
  let kaTimer: any = null;
  const armKA = () => {
    clearInterval(kaTimer);
    kaTimer = setInterval(()=> writeLine(res, { ts: new Date().toISOString(), seq: nextSeq(), type:'ka' }), jitteredKA());
  };
  armKA();

  try {
    writeLine(res, { ts: new Date().toISOString(), seq: nextSeq(), type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    let scores: [number,number,number] = [0,0,0];

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { ts: new Date().toISOString(), seq: nextSeq(), type:'log', message:`—— 第 ${round} 局开始 ——` });

      const seatBots = seatSpecs.map(s => asBot(s.choice, s));

      // 每家最小间隔（含 +1ms 容差）
      const lastAt = [0,0,0];
      const wrapSeat = (bot:(ctx:any)=>any, idx:number) => async (ctx:any) => {
        const now = Date.now();
        const minGap = delays[idx]||0;
        const due = lastAt[idx] + minGap;
        const wait = Math.max(0, due - now);
        if (wait>0) await new Promise(r=>setTimeout(r, wait + 1)); // +1ms 容差
        const result = await bot(ctx);
        lastAt[idx] = Date.now();
        return result;
      };

      const bots = seatBots.map((b,i)=> wrapSeat(b as any, i));

      // 运行一局（runOneGame 内部 yield 事件）
      const iter = runOneGame({
        four2,
        seats: bots,
        onEmit: (obj:any) => {
          // 统一打补丁：附上 ts/seq
          if (obj && typeof obj === 'object') {
            (obj as any).ts = new Date().toISOString();
            (obj as any).seq = nextSeq();
          }
          writeLine(res, obj);
        }
      });

      // 也允许 pull 形式（如果你的 runOneGame 返回 async iterator）
      if (iter && typeof (iter as any)[Symbol.asyncIterator] === 'function') {
        for await (const ev of iter as any) {
          const obj = (ev && typeof ev==='object') ? ev : { type:'log', message:String(ev) };
          (obj as any).ts = new Date().toISOString();
          (obj as any).seq = nextSeq();
          writeLine(res, obj);
          if ((obj as any).type==='event' && (obj as any).kind==='win') {
            const win = obj as any;
            scores = [ scores[0] + win.deltaScores[0], scores[1] + win.deltaScores[1], scores[2] + win.deltaScores[2] ] as any;
          }
        }
      }

      writeLine(res, { ts: new Date().toISOString(), seq: nextSeq(), type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    clearInterval(kaTimer); res.end();
  } catch (e:any) {
    writeLine(res, { ts: new Date().toISOString(), seq: nextSeq(), type:'log', message:`后端错误：${e?.message || String(e)}` });
    try { clearInterval(kaTimer); res.end(); } catch {}
  }
}
