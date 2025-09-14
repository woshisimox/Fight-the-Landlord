// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame } from '../../lib/doudizhu/engine';

// ===== TrueSkill 轻实现 =====
type TSSeat = { mu:number; sigma:number };
const TS0 = { MU:1000, SIG:1000/3, BETA:1000/6, TAU:1000/300 };
const SQRT2PI = Math.sqrt(2*Math.PI);
const phi = (x:number)=>Math.exp(-0.5*x*x)/SQRT2PI;
const erf = (x:number)=>{const s=Math.sign(x);x=Math.abs(x);const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;const t=1/(1+p*x);const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x);return s*y;};
const Phi = (x:number)=>0.5*(1+erf(x/Math.SQRT2));
const v = (t:number)=>phi(t)/Math.max(Phi(t),1e-12);
const w = (t:number)=>{const _v=v(t);return _v*(_v+t);};
const rc = (mu:number,sigma:number,k=3)=>mu-k*sigma;

function updTwo(A:TSSeat[], B:TSSeat[]) {
  const beta2 = TS0.BETA*TS0.BETA, tau2 = TS0.TAU*TS0.TAU;
  const eff = (x:TSSeat)=>({mu:x.mu, s2:x.sigma*x.sigma+tau2});
  const eA=A.map(eff), eB=B.map(eff);
  const muA=eA.reduce((s,x)=>s+x.mu,0), muB=eB.reduce((s,x)=>s+x.mu,0);
  const s2A=eA.reduce((s,x)=>s+x.s2,0), s2B=eB.reduce((s,x)=>s+x.s2,0);
  const c2=s2A+s2B+2*beta2, c=Math.sqrt(c2), t=(muA-muB)/c, _v=v(t), _w=w(t);
  const upd = (src:TSSeat[], eff:{mu:number;s2:number}[], sgn:number)=>eff.map((x,i)=>{
    const mu = src[i].mu + sgn*(x.s2/c)*_v;
    const s2 = x.s2*(1 - (x.s2/c2)*_w);
    return {mu, sigma:Math.sqrt(Math.max(s2,1e-9))};
  });
  return { A:upd(A,eA,+1), B:upd(B,eB,-1) };
}
function ddzUpdateTS(seats:TSSeat[], landlordIdx:number, landlordWon:boolean):TSSeat[]{
  const L = seats[landlordIdx]; const fs = [0,1,2].filter(i=>i!==landlordIdx).map(i=>seats[i]);
  if (landlordWon) {
    const {A,B}=updTwo([L], fs); const out=seats.slice();
    out[landlordIdx]=A[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[0]]=B[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[1]]=B[1]; return out;
  } else {
    const {A,B}=updTwo(fs, [L]); const out=seats.slice();
    out[landlordIdx]=B[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[0]]=A[0]; out[[0,1,2].filter(i=>i!==landlordIdx)[1]]=A[1]; return out;
  }
}

// ===== NDJSON 工具 =====
const writeLine = (res:NextApiResponse, obj:any)=>{ try{res.write(JSON.stringify(obj)+'\n');}catch{} };

// ===== 兼容：座位 choice & four2 别名 =====
function normalizeSeatChoice(x: string): string {
  const s = (x||'').toLowerCase();

  // greedy-max
  if (['built-in:greedy-max','builtin:greedy-max','builtin.greedy-max','builtin.greedy.max','greedy-max','greedymax','builtin.greedymax'].includes(s))
    return 'builtin.greedy-max';
  // greedy-min
  if (['built-in:greedy-min','builtin:greedy-min','builtin.greedy-min','builtin.greedy.min','greedy-min','greedymin','builtin.greedymin'].includes(s))
    return 'builtin.greedy-min';
  // random-legal
  if (['built-in:random-legal','builtin:random-legal','builtin.random-legal','random-legal','random','builtin.random','builtin.randomlegal','randomlegal'].includes(s))
    return 'builtin.random-legal';

  if (s.startsWith('ai:openai')) return 'ai.openai';
  if (s.startsWith('ai:gemini')) return 'ai.gemini';
  if (s.startsWith('ai:grok'))   return 'ai.grok';
  if (s.startsWith('ai:kimi'))   return 'ai.kimi';
  if (s.startsWith('ai:qwen'))   return 'ai.qwen';
  if (s === 'http') return 'http';
  return x;
}
function normalizeFour2(x: any): 'both'|'2singles'|'2pairs' {
  const s = String(x||'both').toLowerCase();
  if (['both','all','any','b'].includes(s)) return 'both';
  if (['2singles','singles','single','s','two-singles','two_single'].includes(s)) return '2singles';
  if (['2pairs','pairs','pair','p','two-pairs','two_pairs'].includes(s)) return '2pairs';
  return 'both';
}

// ===== 兼容：把任意可迭代统一成 async 迭代器 =====
function toAsyncIterator<T>(it:any): AsyncIterable<T> {
  if (it && typeof it[Symbol.asyncIterator] === 'function') return it;
  if (it && typeof it[Symbol.iterator] === 'function') {
    return (async function* () { for (const v of it as Iterable<T>) yield v; })();
  }
  throw new Error('engine did not return an iterator');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const rounds: number = Number(body.rounds || 1);

  // TrueSkill 初始化（允许从前端延续）
  let tsSeats: TSSeat[] = Array.isArray(body?.tsSeats)
    ? (body.tsSeats as any[]).map((x:any)=>({ mu:Number(x?.mu)||TS0.MU, sigma:Number(x?.sigma)||TS0.SIG }))
    : [{mu:TS0.MU,sigma:TS0.SIG},{mu:TS0.MU,sigma:TS0.SIG},{mu:TS0.MU,sigma:TS0.SIG}];

  // 兼容映射：座位 & 四带二
  const seatsNorm: string[] = (Array.isArray(body?.seats) ? body.seats : []).map(normalizeSeatChoice);
  const four2Pref = normalizeFour2(body?.four2);

  // 开局前 debug
  writeLine(res, { type:'debug', phase:'pre-run', seatsNorm });

  // 广播 TS 起点
  writeLine(res, { type:'ts', round:0, seats: tsSeats.map(s=>({ mu:s.mu, sigma:s.sigma, rc: rc(s.mu,s.sigma) })) });

  // 单轮执行函数（带四带二策略）
  const runRound = async (roundNo:number, four2Policy:'both'|'2singles'|'2pairs')=>{
    writeLine(res, { type:'debug', phase:'rules', four2: four2Policy });

    let landlordIdx = -1;
    let landlordWin: boolean | null = null;
    let lastDelta: [number,number,number] = [0,0,0];

    const cfg = {
      ...body,
      seats: seatsNorm,   // 用归一化 seats
      four2: four2Policy, // 当前尝试的四带二策略
    };

    // 兼容 runOneGame 的不同签名
    let iter: any;
    try { iter = (runOneGame as any)(cfg); }
    catch { iter = (runOneGame as any)(undefined, cfg); }

    for await (const ev of toAsyncIterator<any>(iter)) {
      writeLine(res, ev);

      // 侦测地主索引
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
          writeLine(res, { type:'warn', message:`第 ${roundNo} 局无法判定地主/胜负，跳过 TrueSkill 更新` });
        } else {
          tsSeats = ddzUpdateTS(tsSeats, landlordIdx, landlordWin);
          writeLine(res, { type:'ts', round:roundNo, landlordIdx, landlordWin, seats: tsSeats.map(s=>({mu:s.mu, sigma:s.sigma, rc: rc(s.mu,s.sigma)})) });
        }
      }
    }
  };

  // 主循环（带回退）
  for (let r = 1; r <= rounds; r++) {
    try {
      await runRound(r, four2Pref);
    } catch (e:any) {
      const msg = String(e?.message||e||'');
      const isFuncErr = /is not a function/i.test(msg) || /t\[.*\] /.test(msg);
      writeLine(res, { type:'error', message:`事件循环异常：${msg}`, stack:String(e?.stack||'').split('\n').slice(0,6).join(' ⏎ ') });

      if (isFuncErr) {
        // 回退一：2singles
        if (four2Pref !== '2singles') {
          writeLine(res, { type:'warn', message:`检测到规则实现表调用异常，尝试回退 four2=2singles` });
          try { await runRound(r, '2singles'); continue; } catch (_e:any) {
            writeLine(res, { type:'error', message:`回退 2singles 仍异常：${_e?.message||_e}` });
          }
        }
        // 回退二：2pairs
        if (four2Pref !== '2pairs') {
          writeLine(res, { type:'warn', message:`继续回退 four2=2pairs` });
          try { await runRound(r, '2pairs'); continue; } catch (_e2:any) {
            writeLine(res, { type:'error', message:`回退 2pairs 仍异常：${_e2?.message||_e2}` });
          }
        }
      }
      // 仍失败则继续下一局
    }
  }

  try { res.end(); } catch {}
}
