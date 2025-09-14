// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ---- Next API config：务必使用 Node（默认），并允许长连接/大响应 ----
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
  res.setHeader('X-Accel-Buffering', 'no');          // nginx/proxy: 禁用缓冲
  res.setHeader('Content-Encoding', 'identity');     // 禁用 gzip 等，避免合并
  // 一些平台需要先 flush headers 才真正进入流式模式
  (res as any).flushHeaders?.();
}

function writeLine(res: NextApiResponse, obj: any) {
  try {
    res.write(JSON.stringify(obj) + '\n');
    // 有些运行时提供 res.flush()（spdy/express），可尽量调用
    (res as any).flush?.();
  } catch {}
}

// ---------- Lightweight TrueSkill (2-team, win/lose) ----------
type Rating = { mu:number; sigma:number };
const TS = {
  cfg: { mu:25, sigma:25/3, beta:25/6, tau:25/300, draw:0 },
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
  conservative(r:Rating, k=3){ return r.mu - k*r.sigma; },
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

// ---------- 动态加载引擎/外部 AI 适配器（避免路径差异编译失败） ----------
function tryLoad(path: string) {
  try { const m = require(path); (m as any).__path = path; return m; } catch {}
  return null;
}
function loadEngine() {
  return tryLoad('../../lib/engine') || tryLoad('../../lib/doudizhu/engine');
}
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

function chooseBot(engine:any, bots:any, spec:SeatSpec): any {
  const fallback = engine?.GreedyMax || engine?.RandomLegal || (async ()=>({ move:'pass', reason:'fallback' }));
  if (!spec || !spec.choice) return fallback;
  const c = spec.choice as string;
  if (c === 'built-in:greedy-max') return engine?.GreedyMax || fallback;
  if (c === 'built-in:greedy-min') return engine?.GreedyMin || fallback;
  if (c === 'built-in:random-legal') return engine?.RandomLegal || fallback;

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
  // 心跳：防止中间层因静默关闭连接
  const hb = setInterval(() => writeLine(res, { type:'ping', t: Date.now() }), 15000);
  res.on('close', () => { clearInterval(hb); try{res.end();}catch{}; });

  // 立刻吐出一条 server 日志，验证流已建立
  writeLine(res, { type:'log', message:`[server] stream open | trace=${clientTraceId || '-'} ` });

  const engine = loadEngine();
  if (!engine || typeof engine.runOneGame !== 'function') {
    writeLine(res, { type:'log', message:'[server] engine_not_found: 需要 lib/engine 或 lib/doudizhu/engine 提供 runOneGame()' });
    try { res.end(); } catch {}
    return;
  }
  writeLine(res, { type:'log', message:`[server] engine loaded from ${(engine as any).__path || 'unknown-path'}` });

  const botsLib = loadBots();

  // TrueSkill ratings across this API session
  let ts: Rating[] = [TS.defaultRating(), TS.defaultRating(), TS.defaultRating()];
  const tsSnapshot = () => ts.map(r => ({ mu:+r.mu.toFixed(2), sigma:+r.sigma.toFixed(2), cr:+TS.conservative(r).toFixed(2) }));
  const sendTS = (where:'before-round'|'after-round', round:number) => writeLine(res, { type:'ts', where, round, ratings: tsSnapshot() });

  for (let round = 1; round <= Number(rounds)||1; round++) {
    let landlordIdx = 0;
    let landlordWon: boolean | null = null;

    // 构建 seat bots
    const seatSpecs:SeatSpec[] = (Array.isArray(seats)?seats:[]).slice(0,3);
    const botFuncs:any[] = [0,1,2].map(i => chooseBot(engine, botsLib, seatSpecs[i] || { choice:'built-in:greedy-max' }));

    // 先把“开局”相关的两条吐出去，前端应立即看到
    sendTS('before-round', round);
    writeLine(res, { type:'event', kind:'round-start', round });

    // 运行单局
    let iter:any;
    try {
      iter = engine.runOneGame({
        seats: botFuncs,
        rob, four2, farmerCoop,
        seatDelayMs, startScore,
      });
    } catch (e:any) {
      writeLine(res, { type:'log', message:`[server] runOneGame() 抛错：${e?.message || e}` });
      continue; // 进入下一局
    }

    try {
      for await (const ev of iter as any) {
        // 监听地主索引/胜负
        if ((ev?.type === 'landlord' || ev?.type === 'rob:done') && typeof ev.landlordIdx === 'number') {
          landlordIdx = ev.landlordIdx;
        }
        if ((ev?.type === 'settle' || ev?.type === 'end' || ev?.type === 'result') && typeof ev.landlordWin === 'boolean') {
          landlordWon = !!ev.landlordWin;
        }
        if (ev?.type === 'event' && ev?.kind === 'win' && Array.isArray(ev.deltaScores)) {
          const ds = ev.deltaScores as number[];
          const a = landlordIdx;
          const farmers = [(a+1)%3,(a+2)%3];
          const ld = ds[a]||0; const fm = (ds[farmers[0]]||0)+(ds[farmers[1]]||0);
          landlordWon = ld > fm;
        }
        // 事件透传
        writeLine(res, ev);
      }
    } catch (e:any) {
      writeLine(res, { type:'log', message:`[server] iterator error: ${e?.message || e}` });
    }

    // TrueSkill 更新
    try {
      const a = landlordIdx, b=(a+1)%3, c=(a+2)%3;
      const L = [ts[a]]; const F = [ts[b], ts[c]];
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
