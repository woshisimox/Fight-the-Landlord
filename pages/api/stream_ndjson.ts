// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  runOneGame,
  GreedyMax, GreedyMin, RandomLegal,
  type Four2Policy
} from '../../lib/doudizhu/engine'; // ← 如果在 src/pages/api 下，改成 ../../../lib/doudizhu/engine

/* ================= 小工具：NDJSON输出 ================= */
function line(res: NextApiResponse, obj: any) {
  try { res.write(JSON.stringify(obj) + '\n'); } catch {}
}

/* =============== 前端 seats → 引擎 Bot 映射 & 归一化 =============== */
type SeatSpec = { choice: string; model?: string } | string;

function normChoice(x: string): string {
  const s = String(x || '').trim().toLowerCase();
  if ([
    'built-in:greedy-max','builtin:greedy-max','builtin.greedy-max','greedy-max','greedymax'
  ].includes(s)) return 'builtin.greedyMax';
  if ([
    'built-in:greedy-min','builtin:greedy-min','builtin.greedy-min','greedy-min','greedymin'
  ].includes(s)) return 'builtin.greedyMin';
  if ([
    'built-in:random-legal','builtin:random-legal','builtin.random-legal','random-legal','random','randomlegal'
  ].includes(s)) return 'builtin.randomLegal';
  if (s.startsWith('ai:openai')) return 'ai.openai';
  if (s.startsWith('ai:gemini')) return 'ai.gemini';
  if (s.startsWith('ai:grok'))   return 'ai.grok';
  if (s.startsWith('ai:kimi'))   return 'ai.kimi';
  if (s.startsWith('ai:qwen'))   return 'ai.qwen';
  if (s === 'http')              return 'http';
  return x;
}

function pickBot(choice: string) {
  switch (choice) {
    case 'builtin.greedyMax':  return GreedyMax;
    case 'builtin.greedyMin':  return GreedyMin;
    case 'builtin.randomLegal':return RandomLegal;
    // 其它（AI/http）先用稳妥兜底：RandomLegal（后续再接入各家API）
    default: return RandomLegal;
  }
}

function normalizeSeats(raw: SeatSpec[]): string[] {
  return (raw || []).slice(0,3).map(s => {
    const ch = typeof s === 'string' ? s : (s?.choice || '');
    return normChoice(ch);
  });
}

/* ======================= TrueSkill（两队）简实现 ======================= */
/** 将 25/25/3 的默认量纲线性缩放到 1000/333 */
const SCALE = 1000 / 25;              // 40
const MU0 = 1000;
const SIGMA0 = 1000 / 3;              // 333.333...
const BETA = (25/6) * SCALE;          // ≈ 166.6667
const TAU  = 0;                        // 漂移 0
const DRAW_PROB = 0;                   // 斗地主无平局

type Rating = { mu: number; sigma: number; rc: number };

function gaussianPdf(x: number) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function gaussianCdf(x: number) { return 0.5 * (1 + erf(x/Math.SQRT2)); }
// Abramowitz-Stegun 近似
function erf(x: number) {
  const s = Math.sign(x); const a = Math.abs(x);
  const t = 1/(1+0.3275911*a);
  const y = 1 - ((((1.061405429*t -1.453152027)*t) +1.421413741)*t -0.284496736)*t + 0.254829592;
  return s * (1 - Math.exp(-a*a) * y);
}

/** 两队 TrueSkill 更新（不考虑平局），A 对 B */
function updateTwoTeamTrueSkill(teamA: number[], teamB: number[], r: Rating[], winner: 'A'|'B') {
  const sumVar = (ids:number[]) => ids.reduce((s,i)=>s + r[i].sigma*r[i].sigma, 0);
  const muA = teamA.reduce((s,i)=>s + r[i].mu, 0);
  const muB = teamB.reduce((s,i)=>s + r[i].mu, 0);
  const c2  = sumVar(teamA) + sumVar(teamB) + 2*BETA*BETA;
  const c = Math.sqrt(c2);

  const sign = (winner === 'A') ? +1 : -1;
  const t = sign * (muA - muB) / c;

  const Phi = Math.max(1e-12, gaussianCdf(t));
  const V = gaussianPdf(t) / Phi;
  const W = V * (V + t);

  const apply = (ids:number[], outcomeSign:number) => {
    for (const i of ids) {
      const sigma2 = r[i].sigma * r[i].sigma;
      const muDelta   = (sigma2 / c) * V * outcomeSign;
      const sigmaMult = 1 - (sigma2 / c2) * W;
      r[i].mu   = r[i].mu + muDelta;
      r[i].sigma= Math.sqrt(Math.max(1e-9, sigmaMult)) * r[i].sigma;
      r[i].rc  += 1;
    }
  };

  apply(winner==='A'?teamA:teamB, +1);
  apply(winner==='A'?teamB:teamA, -1);
}

/* ======================= API 处理 ======================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST'); return res.status(405).json({ error:'Method Not Allowed' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  try {
    const {
      rounds = 1,
      startScore = 100,
      seatDelayMs = [0,0,0],
      enabled = true,
      rob = true,
      four2 = 'both',
      seats = [],
      clientTraceId = '',
      stopBelowZero = false,
      farmerCoop = true, // 保留给前端
    } = (req.body || {});

    const seatChoices = normalizeSeats(seats);
    const bots = seatChoices.map(pickBot);

    // TrueSkill 初始化（全 1000/333）
    const ratings: Rating[] = [
      { mu: MU0, sigma: SIGMA0, rc: 0 },
      { mu: MU0, sigma: SIGMA0, rc: 0 },
      { mu: MU0, sigma: SIGMA0, rc: 0 },
    ];

    // 总分
    let totals: [number,number,number] = [startScore, startScore, startScore];

    line(res, { type:'debug', phase:'pre-run', seatsNorm: seatChoices });
    line(res, { type:'ts', round: 0, seats: ratings.map(({mu,sigma,rc})=>({mu, sigma, rc})) });
    line(res, { type:'debug', phase:'rules', four2 });

    const perRoundDelay = Math.min(...(seatDelayMs as number[]).map(n=>Math.max(0, n))) || 0;

    const playOne = async (roundNo: number) => {
      const gen = runOneGame({
        seats: bots as any,
        delayMs: perRoundDelay,
        rob: !!rob,
        four2: (four2 as Four2Policy) || 'both',
      });

      let landlord = 0;

      for await (const ev of gen) {
        line(res, ev);

        if (ev?.type === 'state' && ev?.kind === 'init' && typeof ev.landlord === 'number') {
          landlord = ev.landlord;
        }

        if (ev?.type === 'event' && ev?.kind === 'win') {
          const winner: number = ev.winner;
          const delta: [number,number,number] = ev.deltaScores || [0,0,0];
          totals = [totals[0]+delta[0], totals[1]+delta[1], totals[2]+delta[2]] as any;

          // TrueSkill 更新：地主 vs 农民
          const farmers = [ (landlord+1)%3, (landlord+2)%3 ];
          updateTwoTeamTrueSkill([landlord], farmers, ratings,
            winner === landlord ? 'A' : 'B'
          );

          line(res, { type:'tsupd', round: roundNo, seats: ratings.map(({mu,sigma,rc})=>({mu, sigma, rc})) });
          line(res, { type:'totals', round: roundNo, totals });
        }
      }
    };

    if (!enabled) {
      line(res, { type:'warn', message:'未启用对局（enabled=false）' });
      return res.end();
    }

    for (let i=0;i<rounds;i++) {
      await playOne(i+1);
      if (stopBelowZero && totals.some(v => v < 0)) {
        line(res, { type:'warn', message:'检测到总分 < 0，停止连打。' });
        break;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    try { res.end(); } catch {}
  } catch (err: any) {
    line(res, { type:'error', message:`事件循环异常：${err?.message || err}`, stack: err?.stack });
    try { res.end(); } catch {}
  }
}
