// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// ---------- NDJSON helpers ----------
function writeHead(res: NextApiResponse) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
    Connection: 'keep-alive',
    'Transfer-Encoding': 'chunked',
  });
}
function writeLine(res: NextApiResponse, obj: any) {
  try { res.write(JSON.stringify(obj) + '\n'); } catch {}
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

// ---------- Dynamic engine / bots loader (runtime require to avoid build errors) ----------
function loadEngine() {
  try { return require('../../lib/engine'); } catch {}
  try { return require('../../lib/doudizhu/engine'); } catch {}
  return null;
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

// ---------- Bot factory ----------
function chooseBot(engine:any, bots:any, spec:SeatSpec): any /* BotFunc */ {
  const fallback = engine?.GreedyMax || engine?.RandomLegal || (async ()=>({ move:'pass' }));
  if (!spec || !spec.choice) return fallback;
  const c = spec.choice as string;
  if (c === 'built-in:greedy-max') return engine?.GreedyMax || fallback;
  if (c === 'built-in:greedy-min') return engine?.GreedyMin || fallback;
  if (c === 'built-in:random-legal') return engine?.RandomLegal || fallback;

  // External AI (if adapters exist), else fallback but仍输出理由方便前端日志
  const wrap = (impl:any, label:string) => {
    if (impl) return impl({ apiKey: spec.apiKey, base: spec.baseUrl, url: spec.baseUrl, token: spec.token, model: spec.model });
    const name = label;
    return async (ctx:any) => {
      return { move:'pass', reason:`外部AI(${name})未接入后端，已回退内置（GreedyMax）` };
    };
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
    stopBelowZero = false,
    farmerCoop = true,
  } = (req.body || {});

  if (!enabled) { res.status(200).json({ ok:true, message:'disabled' }); return; }

  const engine = loadEngine();
  if (!engine || !engine.runOneGame) {
    res.status(500).json({ error:'engine_not_found', detail:'lib/engine or lib/doudizhu/engine with runOneGame() required' });
    return;
  }
  const botsLib = loadBots();

  writeHead(res);

  // ----- TrueSkill ratings across (server lifetime of this request) -----
  let ts: Rating[] = [TS.defaultRating(), TS.defaultRating(), TS.defaultRating()];
  const tsSnapshot = () => ts.map(r => ({ mu:+r.mu.toFixed(2), sigma:+r.sigma.toFixed(2), cr:+TS.conservative(r).toFixed(2) }));
  const sendTS = (where:'before-round'|'after-round', round:number) => writeLine(res, { type:'ts', where, round, ratings: tsSnapshot() });

  for (let round = 1; round <= Number(rounds)||1; round++) {
    // Build bots per seat
    const seatSpecs:SeatSpec[] = (Array.isArray(seats)?seats:[]).slice(0,3);
    const botFuncs:any[] = [0,1,2].map(i => chooseBot(engine, botsLib, seatSpecs[i] || { choice:'built-in:greedy-max' }));

    // Per-round state we need for TS
    let landlordIdx = 0;
    let landlordWon: boolean | null = null;

    // Inform client to reset per-round score panel
    sendTS('before-round', round);

    // Run single game
    const iter = engine.runOneGame({
      seats: botFuncs,
      rob, four2, farmerCoop,
      seatDelayMs, startScore,
    });

    writeLine(res, { type:'event', kind:'round-start', round });

    try {
      for await (const ev of iter as any) {
        // Observe landlord index and outcome
        if ((ev?.type === 'landlord' || ev?.type === 'rob:done') && typeof ev.landlordIdx === 'number') {
          landlordIdx = ev.landlordIdx;
        }
        if ((ev?.type === 'settle' || ev?.type === 'end' || ev?.type === 'result') && typeof ev.landlordWin === 'boolean') {
          landlordWon = !!ev.landlordWin;
        }

        // If engine emits win with deltaScores, infer landlordWon as fallback
        if (ev?.type === 'event' && ev?.kind === 'win' && Array.isArray(ev.deltaScores)) {
          const ds = ev.deltaScores as number[];
          const a = landlordIdx;
          const farmers = [(a+1)%3,(a+2)%3];
          const ld = ds[a]||0; const fm = (ds[farmers[0]]||0)+(ds[farmers[1]]||0);
          landlordWon = ld > fm;
        }

        // Proxy event as-is (hands, play, bot-call/done, stats, log, etc.)
        writeLine(res, ev);
      }
    } catch (e:any) {
      writeLine(res, { type:'log', message:`[server] error: ${e?.message||e}` });
    }

    // Update TrueSkill after round
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
    } catch {}
    writeLine(res, { type:'event', kind:'round-end', round, seenWin: landlordWon!=null, seenStats:false });
    sendTS('after-round', round);
  }

  try { res.end(); } catch {}
}
