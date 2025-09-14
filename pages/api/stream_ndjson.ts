// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame } from '../../lib/doudizhu/engine';

// ===== TrueSkill 轻实现 =====
type TS = { mu:number; sigma:number };
const TS = { MU0:1000, SIG0:1000/3, BETA:1000/6, TAU:1000/300 };
const SQRT2PI = Math.sqrt(2*Math.PI);
const phi = (x:number)=>Math.exp(-0.5*x*x)/SQRT2PI;
const erf = (x:number)=>{const s=Math.sign(x);x=Math.abs(x);const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;const t=1/(1+p*x);const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x);return s*y;};
const Phi = (x:number)=>0.5*(1+erf(x/Math.SQRT2));
const v = (t:number)=>phi(t)/Math.max(Phi(t),1e-12);
const w = (t:number)=>{const _v=v(t);return _v*(_v+t);};
function updTwo(A:TS[], B:TS[]) {
  const beta2 = TS.BETA*TS.BETA, tau2 = TS.TAU*TS.TAU;
  const eff = (x:TS)=>({mu:x.mu, s2:x.sigma*x.sigma+tau2});
  const eA=A.map(eff), eB=B.map(eff);
  const muA=eA.reduce((s,x)=>s+x.mu,0), muB=eB.reduce((s,x)=>s+x.mu,0);
  const s2A=eA.reduce((s,x)=>s+x.s2,0), s2B=eB.reduce((s,x)=>s+x.s2,0);
  const c2=s2A+s2B+2*beta2, c=Math.sqrt(c2), t=(muA-muB)/c, _v=v(t), _w=w(t);
  const upd = (src:TS[], eff:{mu:number;s2:number}[], sgn:number)=>eff.map((x,i)=>{
    const mu = src[i].mu + sgn*(x.s2/c)*_v;
    const s2 = x.s2*(1 - (x.s2/c2)*_w);
    return {mu, sigma:Math.sqrt(Math.max(s2,1e-9))};
  });
  return { A:upd(A,eA,+1), B:upd(B,eB,-1) };
}
function ddzUpdateTS(seats:TS[], landlordIdx:number, landlordWon:boolean):TS[]{
  const L = seats[landlordIdx]; const farmers=[0,1,2].filter(i=>i!==landlordIdx).map(i=>seats[i]);
  if (landlordWon) {
    const {A,B}=updTwo([L], farmers); const out=seats.slice();
    out[landlordIdx]=A[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[0]]=B[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[1]]=B[1]; return out;
  } else {
    const {A,B}=updTwo(farmers, [L]); const out=seats.slice();
    out[landlordIdx]=B[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[0]]=A[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[1]]=A[1]; return out;
  }
}
const rc = (mu:number,sigma:number,k=3)=>mu-k*sigma;

// ===== NDJSON 工具 =====
const writeLine = (res:NextApiResponse, obj:any)=>{ try{res.write(JSON.stringify(obj)+'\n');}catch{} };

// ===== 关键补丁：座位 choice 兼容映射 =====
function normalizeSeatChoice(x: string): string {
  const s = (x||'').toLowerCase();
  // 内置
  if (s === 'built-in:greedy-max' || s === 'builtin:greedy-max' || s === 'builtin.greedy-max' || s === 'greedy-max' || s === 'greedymax')
    return 'builtin.greedyMax';
  if (s === 'built-in:greedy-min' || s === 'builtin:greedy-min' || s === 'builtin.greedy-min' || s === 'greedy-min' || s === 'greedymin')
    return 'builtin.greedyMin';
  if (s === 'built-in:random-legal' || s === 'builtin:random-legal' || s === 'builtin.random-legal' || s === 'random-legal' || s === 'random')
    return 'builtin.randomLegal';
  // AI 提供商
  if (s.startsWith('ai:openai')) return 'ai.openai';
  if (s.startsWith('ai:gemini')) return 'ai.gemini';
  if (s.startsWith('ai:grok'))   return 'ai.grok';
  if (s.startsWith('ai:kimi'))   return 'ai.kimi';
  if (s.startsWith('ai:qwen'))   return 'ai.qwen';
  // HTTP 代理
  if (s === 'http') return 'http';
  // 兜底：原样返回
  return x;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const rounds: number = Number(body.rounds || 1);

  // TrueSkill 初始化（允许前端传入延续）
  let tsSeats: TS[] = Array.isArray(body?.tsSeats)
    ? (body.tsSeats as any[]).map((x:any)=>({ mu:Number(x?.mu)||TS.MU0, sigma:Number(x?.sigma)||TS.SIG0 }))
    : [{mu:TS.MU0,sigma:TS.SIG0},{mu:TS.MU0,sigma:TS.SIG0},{mu:TS.MU0,sigma:TS.SIG0}];

  // 兼容映射：把 seats 统一成引擎更可能识别的写法
  const seatsRaw: string[] = Array.isArray(body?.seats) ? body.seats : [];
  const seatsNorm: string[] = seatsRaw.map(normalizeSeatChoice);

  // 在开局之前打一个调试帧，便于确认映射结果
  writeLine(res, { type:'debug', phase:'pre-run', seatsNorm });

  // 广播 TS 起点
  writeLine(res, { type:'ts', round:0, seats: tsSeats.map(s=>({ mu:s.mu, sigma:s.sigma, rc: rc(s.mu,s.sigma) })) });

  for (let r = 1; r <= rounds; r++) {
    let landlordIdx = -1;
    let landlordWin: boolean | null = null;
    let lastDelta: [number,number,number] = [0,0,0];

    // 组装引擎配置（替换 seats 为 seatsNorm）
    const cfg = { ...body, seats: seatsNorm };

    let iter: any;
    try { iter = (runOneGame as any)(cfg); }
    catch { iter = (runOneGame as any)(undefined, cfg); }

    try {
      for await (const ev of (iter as any)) {
        writeLine(res, ev);

        // 抓地主索引
        if (landlordIdx < 0) {
          const e:any = ev as any;
          if (typeof e.landlordIdx === 'number') landlordIdx = e.landlordIdx;
          else if (typeof e.landlord === 'number') landlordIdx = e.landlord;
          else if (e.init && typeof e.init.landlordIdx === 'number') landlordIdx = e.init.landlordIdx;
          else if (e.state && typeof e.state.landlord === 'number') landlordIdx = e.state.landlord;
        }

        if (Array.isArray((ev as any).deltaScores)) {
          const d:any[] = (ev as any).deltaScores;
          lastDelta = [Number(d[0])|0, Number(d[1])|0, Number(d[2])|0];
        }

        if ((ev as any).type === 'end' || (ev as any).kind === 'end') {
          const e:any = ev as any;
          if (landlordIdx < 0 && typeof e.landlordIdx === 'number') landlordIdx = e.landlordIdx;

          if (typeof e.landlordWin === 'boolean') landlordWin = e.landlordWin;
          else if (e.winnerRole === 'landlord') landlordWin = true;
          else if (e.winnerRole === 'farmers') landlordWin = false;
          else if (landlordIdx >= 0) {
            const ld = lastDelta[landlordIdx] || 0;
            if (ld !== 0) landlordWin = ld > 0;
          }

          if (landlordIdx < 0 || landlordWin == null) {
            writeLine(res, { type:'warn', message:`第 ${r} 局无法判定地主/胜负，跳过 TrueSkill 更新` });
          } else {
            tsSeats = ddzUpdateTS(tsSeats, landlordIdx, landlordWin);
            writeLine(res, { type:'ts', round:r, landlordIdx, landlordWin, seats: tsSeats.map(s=>({mu:s.mu, sigma:s.sigma, rc: rc(s.mu,s.sigma)})) });
          }
        }
      }
    } catch (e:any) {
      writeLine(res, {
        type:'error',
        message:`事件循环异常：${e?.message || e}`,
        stack:String(e?.stack||'').split('\n').slice(0,6).join(' ⏎ ')
      });
    }
  }

  try { res.end(); } catch {}
}
