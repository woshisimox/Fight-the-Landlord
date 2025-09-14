// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
// ⬇️ ⬇️ 关键：静态导入你的引擎（需存在：/lib/engine.ts）
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/engine';

export const config = {
  api: {
    responseLimit: false,
    bodyParser: { sizeLimit: '1mb' },
    externalResolver: true,
  },
};

// ---------- NDJSON helpers ----------
function writeHead(res: NextApiResponse) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');      // 禁用反向代理缓冲
  res.setHeader('Content-Encoding', 'identity'); // 禁止压缩，避免合并
  (res as any).flushHeaders?.();
}
function writeLine(res: NextApiResponse, obj: any) {
  try { res.write(JSON.stringify(obj) + '\n'); (res as any).flush?.(); } catch {}
}

// ---------- 轻量 TrueSkill（两队胜负） ----------
type Rating = { mu:number; sigma:number };
const TS = {
  cfg: { mu:25, sigma:25/3, beta:25/6, tau:25/300 },
  defaultRating(mu=25, sigma=25/3): Rating { return { mu, sigma }; },
  phi(x:number){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); },
  Phi(x:number){
    const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
    const sign = x<0?-1:1, ax = Math.abs(x)/Math.sqrt(2), t = 1/(1+p*ax);
    const y = 1 - (((((a5*t + a4)*t)+a3)*t + a2)*t + a1)*t*Math.exp(-ax*ax);
    return 0.5*(1 + sign*y);
  },
  V(z:number){ const d=TS.Phi(z); if (d<1e-12) return z<0 ? -z : 0; return TS.phi(z)/d; },
  W(z:number){ const v=TS.V(z); return v*(v+z); },
  conservative(r:Rating,k=3){ return r.mu - k*r.sigma; },
  rate2Teams(win:Rating[], lose:Rating[]){
    const { beta, tau } = TS.cfg;
    const priorW = win.map(r=>({ mu:r.mu, s2:r.sigma*r.sigma + tau*tau }));
    const priorL = lose.map(r=>({ mu:r.mu, s2:r.sigma*r.sigma + tau*tau }));
    const muW = priorW.reduce((s,x)=>s+x.mu,0);
    const muL = priorL.reduce((s,x)=>s+x.mu,0);
    const teamVar = priorW.reduce((s,x)=>s+x.s2,0) + priorL.reduce((s,x)=>s+x.s2,0) + 2*beta*beta;
    const c = Math.sqrt(teamVar), z = (muW - muL)/c, v = TS.V(z), w = TS.W(z);
    const up = (mu:number,s2:number)=>{ const mu2=mu + (s2/c)*v; const s22 = s2*(1 - (s2/(c*c))*w); return { mu:mu2, sigma: Math.sqrt(Math.max(1e-9,s22)) }; };
    const dn = (mu:number,s2:number)=>{ const mu2=mu - (s2/c)*v; const s22 = s2*(1 - (s2/(c*c))*w); return { mu:mu2, sigma: Math.sqrt(Math.max(1e-9,s22)) }; };
    return { winners: priorW.map(x=>up(x.mu,x.s2)), losers: priorL.map(x=>dn(x.mu,x.s2)) };
  },
};

// ---------- 外部 AI 适配器（可选，用不到就自动回退） ----------
function loadBots() {
  const out:any = {};
  try { out.OpenAIBot = require('../../lib/bots/openai_bot').OpenAIBot; } catch {}
  try { out.GeminiBot  = require('../../lib/bots/gemini_bot').GeminiBot; } catch {}
  try { out.GrokBot    = require('../../lib/bots/grok_bot').GrokBot; } catch {}
  try { out.KimiBot    = require('../../lib/bots/kimi_bot').KimiBot; } catch {}
  try { out.QwenBot    = require('../../lib/bots/qwen_bot').QwenBot; } catch {}
  try { out.HttpBot    = require('../../lib/bots/http_bot').HttpBot; } catch {}
  return out;
}
type SeatSpec = { choice:string; model?:string; apiKey?:string; baseUrl?:string; token?:string };

function chooseBot(bots:any, spec:SeatSpec): any {
  const fallback = GreedyMax || RandomLegal || (async ()=>({ move:'pass', reason:'fallback' }));
  if (!spec || !spec.choice) return fallback;
  const c = spec.choice;
  if (c === 'built-in:greedy-max') return GreedyMax || fallback;
  if (c === 'built-in:greedy-min') return GreedyMin || fallback;
  if (c === 'built-in:random-legal') return RandomLegal || fallback;

  const wrap = (impl:any, label:string) => {
    if (impl) return impl({ apiKey: spec.apiKey, base: spec.baseUrl, url: spec.baseUrl, token: spec.token, model: spec.model });
    return async () => ({ move:'pass', reason:`外部AI(${label})未接入后端，已回退内置（GreedyMax）` });
  };
  if (c === 'ai:openai') return wrap(bots?.OpenAIBot, 'openai');
  if (c === 'ai:gemini') return wrap(bots?.GeminiBot, 'gemini');
  if (c === 'ai:grok')   return wrap(bots?.GrokBot,   'grok');
  if (c === 'ai:kimi')   return wrap(bots?.KimiBot,   'kimi');
  if (c === 'ai:qwen')   return wrap(bots?.QwenBot,   'qwen');
  if (c === 'http')      return wrap(bots?.HttpBot,   'http');
  return fallback;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const {
    rounds = 1,
    startScore = 0,
    seatDelayMs = [0,0,0],
    enabled = true,
    rob = true,
    four2 = 'both',
    seats = [],
    clientTraceId = '',
    farmerCoop = true,
  } = (req.body || {});

  if (!enabled) { res.status(200).json({ ok:true, message:'disabled' }); return; }

  writeHead(res);
  const hb = setInterval(() => writeLine(res, { type:'ping', t: Date.now() }), 15000);
  res.on('close', () => { clearInterval(hb); try{res.end();}catch{}; });

  writeLine(res, { type:'log', message:`[server] stream open | trace=${clientTraceId || '-'}` });

  // 静态导入已经保证存在 runOneGame；再兜底打印一次
  if (typeof runOneGame !== 'function') {
    writeLine(res, { type:'log', message:'[server] engine_missing_export: 需要导出 runOneGame()' });
    try { res.end(); } catch {}
    return;
  }
  const botsLib = loadBots();

  // TrueSkill 状态
  let ts: Rating[] = [TS.defaultRating(), TS.defaultRating(), TS.defaultRating()];
  const tsSnapshot = () => ts.map(r => ({ mu:+r.mu.toFixed(2), sigma:+r.sigma.toFixed(2), cr:+TS.conservative(r).toFixed(2) }));
  const sendTS = (where:'before-round'|'after-round', round:number) => writeLine(res, { type:'ts', where, round, ratings: tsSnapshot() });

  for (let round = 1; round <= Number(rounds)||1; round++) {
    let landlordIdx = 0;
    let landlordWon: boolean | null = null;

    const seatSpecs:SeatSpec[] = (Array.isArray(seats)?seats:[]).slice(0,3);
    const botFuncs:any[] = [0,1,2].map(i => chooseBot(botsLib, seatSpecs[i] || { choice:'built-in:greedy-max' }));

    sendTS('before-round', round);
    writeLine(res, { type:'event', kind:'round-start', round });

    const iter = runOneGame({
      seats: botFuncs,
      rob, four2, farmerCoop,
      seatDelayMs, startScore,
    });

    try {
      for await (const ev of iter as any) {
        if ((ev?.type === 'landlord' || ev?.type === 'rob:done') && typeof ev.landlordIdx === 'number') landlordIdx = ev.landlordIdx;
        if ((ev?.type === 'settle' || ev?.type === 'end' || ev?.type === 'result') && typeof ev.landlordWin === 'boolean') landlordWon = !!ev.landlordWin;

        if (ev?.type === 'event' && ev?.kind === 'win' && Array.isArray(ev.deltaScores)) {
          const ds = ev.deltaScores as number[];
          const a = landlordIdx, farmers = [(a+1)%3,(a+2)%3];
          const ld = ds[a]||0, fm = (ds[farmers[0]]||0) + (ds[farmers[1]]||0);
          landlordWon = ld > fm;
        }
        writeLine(res, ev);
      }
    } catch (e:any) {
      writeLine(res, { type:'log', message:`[server] iterator error: ${e?.message || e}` });
    }

    // TS 更新
    try {
      const a = landlordIdx, b=(a+1)%3, c=(a+2)%3;
      const L = [ts[a]], F = [ts[b], ts[c]];
      if (landlordWon === true) {
        const { winners, losers } = TS.rate2Teams(L, F);
        ts[a]=winners[0]; ts[b]=losers[0]; ts[c]=losers[1];
      } else if (landlordWon === false) {
        const { winners, losers } = TS.rate2Teams(F, L);
        ts[a]=losers[0]; ts[b]=winners[0]; ts[c]=winners[1];
      }
    } catch (e:any) {
      writeLine(res, { type:'log', message:`[server] TS update error: ${e?.message || e}` });
    }

    writeLine(res, { type:'event', kind:'round-end', round, seenWin: landlordWon!=null, seenStats:false });
    sendTS('after-round', round);
  }

  try { clearInterval(hb); res.end(); } catch {}
}
