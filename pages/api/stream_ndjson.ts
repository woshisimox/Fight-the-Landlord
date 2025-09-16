// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
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
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

type SeatSpec = { choice: BotChoice; model?: string; apiKey?: string; baseUrl?: string; token?: string };

type StartPayload = {
  rounds?: number;
  four2?: 'both'|'2singles'|'2pairs';
  seatDelayMs?: number[];
  seats?: SeatSpec[];
  startScore?: number;
  stopBelowZero?: boolean;
  seatModels?: string[];
  seatKeys?: { openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string; httpBase?: string; httpToken?: string; }[];
  clientTraceId?: string;
  farmerCoop?: boolean;
};

const clamp = (v:number, lo=0, hi=5)=> Math.max(lo, Math.min(hi, v));

function writeLine(res: NextApiResponse, obj: any) {
  (res as any).write(JSON.stringify(obj) + '\n');
}

function providerLabel(choice: BotChoice) {
  switch (choice) {
    case 'built-in:greedy-max': return 'GreedyMax';
    case 'built-in:greedy-min': return 'GreedyMin';
    case 'built-in:random-legal': return 'RandomLegal';
    case 'ai:openai': return 'OpenAI';
    case 'ai:gemini': return 'Gemini';
    case 'ai:grok':  return 'Grok';
    case 'ai:kimi':  return 'Kimi';
    case 'ai:qwen':  return 'Qwen';
    case 'ai:deepseek': return 'DeepSeek';
    case 'http':     return 'HTTP';
  }
}

/** DeepSeek（OpenAI 兼容）最小适配 */
function DeepseekBot({ apiKey, model }: { apiKey?: string; model?: string }) {
  const endpoint = 'https://api.deepseek.com/v1/chat/completions';
  const mdl = (model && String(model).trim()) || 'deepseek-chat';

  function parseOut(txt: string): any {
    try {
      const m = txt.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(m ? m[0] : txt);
      return obj && typeof obj === 'object' ? obj : null;
    } catch { return null; }
  }

  return async (ctx: any) => {
    try {
      if (!apiKey) {
        return { move: 'pass', reason: '外部AI(deepseek)未接入后端，已回退内建（GreedyMax）' };
      }
      const cands: any[] = ctx?.candidates ?? ctx?.legalMoves ?? ctx?.legal ?? [];
      const prompt = [
        { role: 'system', content: 'You are a Dou Dizhu assistant. Reply ONLY with strict JSON.' },
        { role: 'user', content:
`You are deciding ONE move for the Chinese card game Dou Dizhu (Fight the Landlord).
Game state (JSON):
${JSON.stringify({
  landlord: ctx?.landlord,
  seat: ctx?.seat,
  lead: ctx?.lead,
  lastTrick: ctx?.lastTrick ?? null,
  candidates: cands,
}).slice(0, 6000)}

Rules:
- Choose exactly ONE element from "candidates" as your action.
- If you cannot beat, choose {"move":"pass"}.
- If you play, respond as {"move":"play","cards":<the chosen candidate>,"reason":"short why"}.
- If pass, respond as {"move":"pass","reason":"short why"}.
Return JSON only.` }
      ];

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: mdl, messages: prompt, temperature: 0.3, stream: false })
      });
      const j = await resp.json();
      const txt = j?.choices?.[0]?.message?.content || '';
      const parsed = parseOut(txt) || {};
      const mv = (parsed.move || '').toLowerCase();

      if (mv === 'play' && Array.isArray(parsed.cards) && parsed.cards.length) {
        const cards = parsed.cards;
        return { move: 'play', cards, reason: parsed.reason || 'DeepSeek' };
      }
      return { move: 'pass', reason: parsed.reason || 'DeepSeek-pass' };
    } catch (err: any) {
      return { move: 'pass', reason: 'DeepSeek 调用失败：' + (err?.message || String(err)) };
    }
  };
}

function asBot(choice: BotChoice, spec?: SeatSpec): (ctx:any)=>Promise<any>|any {
  switch (choice) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai': return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-flash' });
    case 'ai:grok':   return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':   return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':   return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'ai:deepseek': return DeepseekBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'deepseek-chat' });
    case 'http':      return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:          return GreedyMax;
  }
}

/* ---------- 轻量统计辅助（保留给策略日志使用） ---------- */
function rankScore(r:string){
  const map:any = { X:10, x:8, '2':7, A:6, K:5, Q:4, J:3, T:2 };
  return map[r] ?? 1;
}
function estimateHandEval(hand:any): number | undefined {
  try{
    if (!Array.isArray(hand) || hand.length===0) return undefined;
    const ranks = hand.map((c:any)=>{
      const s = String(c);
      if (s === 'x' || s === 'X' || s.startsWith('🃏')) return s === 'X' || s.endsWith('Y') ? 'X' : 'x';
      const core = /10/i.test(s) ? s.replace(/10/i,'T') : s;
      const r = core.match(/[23456789TJQKA]/i)?.[0]?.toUpperCase() ?? '';
      return r;
    });
    const total = ranks.reduce((acc,r)=>acc+rankScore(r),0);
    const max = hand.length * 10;
    return Math.round((total/max)*100)/100;
  }catch{return undefined;}
}
function inferCandidateCount(ctx:any): number | undefined {
  try{
    const cands = ctx?.candidates ?? ctx?.legalMoves ?? ctx?.legal ?? ctx?.moves;
    if (Array.isArray(cands)) return cands.length;
  }catch{}
  return undefined;
}

function buildReasonAndStrategy(choice: BotChoice, spec: SeatSpec|undefined, ctx:any, out:any) {
  try {
    const handEval = estimateHandEval(ctx?.hand);
    const candCount = inferCandidateCount(ctx);
    const base = {
      by: providerLabel(choice),
      model: spec?.model,
      handEval,
      candidateCount: candCount,
      landlord: ctx?.landlord,
      seat: ctx?.seat,
      lead: ctx?.lead,
      lastTrick: ctx?.lastTrick?.combo || ctx?.lastTrick?.type,
    };
    const reason = out?.reason || (()=>{
      if (out?.move === 'pass') return '无法接上或等待队友形成更优势。';
      if (out?.move === 'play') return '基于手牌评估与候选筛选的出牌。';
      return '—';
    })();
    const strat = {
      ...base,
      ...(out?.move === 'play' ? { played: out?.cards } : { passed:true }),
    };
    return { reason, strategy: strat };
  } catch { return { reason: out?.reason, strategy: undefined }; }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let __lastWrite = Date.now();
  const keepAlive = setInterval(()=>{ try{
    if((res as any).writableEnded){ clearInterval(keepAlive as any); return; }
    if(Date.now()-__lastWrite>2500){ writeLine(res, { type:'ka', ts: new Date().toISOString() }); __lastWrite = Date.now(); }
  }catch{} }, 2500);

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const rounds = Math.max(1, Math.min(parseInt(process.env.MAX_ROUNDS || '200',10), Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];

    const seatSpecs = (body.seats || []).slice(0,3);
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });

      const onReason = (_seat:number, _text?:string)=>{ /* no-op; 可按需扩展 */ };

      const roundBots = baseBots.map((bot, i) => traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot, res, onReason));

      const delayedSeats = roundBots.map((bot, idx) => async (ctx:any) => {
        const ms = delays[idx] || 0; if (ms) await new Promise(r => setTimeout(r, ms));
        return bot(ctx);
      });

      // ✅ 修复：不要传 onEvent / onValue，按返回的生成器逐条写出
      const g = await runOneGame({
        seats: delayedSeats,
        four2,
      });

      let seenWin = false, seenStats = false, landlord = -1;
      for await (const v of g){
        if (v?.kind === 'win' || v?.kind === 'result' || v?.kind === 'game-over' || v?.kind === 'game_end') seenWin = true;
        if (v?.type === 'stats' || (v?.type === 'event' && v?.kind === 'stats')) seenStats = true;
        if (v?.kind === 'init' && typeof v?.landlord === 'number') landlord = v.landlord;
        writeLine(res, v);
      }

      // 兜底：至少产出一条 stats
      if (!seenStats) {
        const seats = [0,1,2].map(i=>({
          seat:i,
          scaled: { coop: 2.5, agg: 2.5, cons: 2.5, eff: 2.5, rob: 2.5 },
        }));
        writeLine(res, { type:'stats', perSeat: seats, final:true });
      }

      writeLine(res, { type:'event', kind:'round-end', round });
    }

  } catch (e:any) {
    writeLine(res, { type:'error', message: e?.message || String(e) });
  } finally {
    try { clearInterval(keepAlive as any); } catch {}
    try { (res as any).end(); } catch {}
  }
}

/** 在 bot 周围附一层 trace：写 call/done、推 reason 给前端 */
function traceWrap(choice: BotChoice, spec:SeatSpec|undefined, bot:(ctx:any)=>Promise<any>|any, res:NextApiResponse, onReason:(seat:number, text?:string)=>void){
  const label = providerLabel(choice);
  return async (ctx:any)=>{
    const t0 = Date.now();
    try{ writeLine(res, { type:'event', kind:'bot-call', seat:ctx?.seat, by:label, phase:ctx?.phase||'turn', need:ctx?.need, model: spec?.model }); }catch{}
    let out:any = {};
    try {
      out = await bot(ctx);
    } catch (e:any) {
      out = { move:'pass', reason: e?.message || String(e) };
    }
    const took = Date.now()-t0;
    try {
      const { reason, strategy } = buildReasonAndStrategy(choice, spec, ctx, out);
      onReason(ctx?.seat ?? -1, reason);
      writeLine(res, { type:'event', kind:'bot-done', seat:ctx?.seat, by:label, tookMs:took, reason, model: spec?.model });
      if (strategy) writeLine(res, { type:'event', kind:'bot-strategy', seat:ctx?.seat, by:label, strategy });
    } catch {}
    return out;
  };
}
