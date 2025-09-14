// /pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// === 如果你已有引擎与各类 Bot，这些 import 保留 ===
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

// ===================== TrueSkill 轻量实现（内嵌，不依赖第三方） =====================
type TS = { mu: number; sigma: number };
type TSParams = { MU0: number; SIG0: number; BETA: number; TAU: number };

const TS_DEFAULT: TSParams = {
  MU0: 1000,
  SIG0: 1000 / 3,     // ≈ 333.33
  BETA: 1000 / 6,     // ≈ 166.67
  TAU:  1000 / 300,   // ≈   3.33（很小的赛季漂移）
};

const SQRT2PI = Math.sqrt(2 * Math.PI);
function phi(x: number) { return Math.exp(-0.5 * x * x) / SQRT2PI; }
function erf(x: number) {
  const s = Math.sign(x); x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
}
function Phi(x: number) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function v_non_draw(x: number) { const d = Math.max(Phi(x), 1e-12); return phi(x) / d; }
function w_non_draw(x: number) { const v = v_non_draw(x); return v * (v + x); }

function updateTwoTeams(teamA: TS[], teamB: TS[], params: TSParams) {
  const { BETA, TAU } = params;
  const effA = teamA.map(p => ({ mu: p.mu, sigma2: p.sigma * p.sigma + TAU * TAU }));
  const effB = teamB.map(p => ({ mu: p.mu, sigma2: p.sigma * p.sigma + TAU * TAU }));

  const muA = effA.reduce((s, x) => s + x.mu, 0);
  const muB = effB.reduce((s, x) => s + x.mu, 0);
  const s2A = effA.reduce((s, x) => s + x.sigma2, 0);
  const s2B = effB.reduce((s, x) => s + x.sigma2, 0);

  const c2 = s2A + s2B + 2 * BETA * BETA;
  const c  = Math.sqrt(c2);
  const t  = (muA - muB) / c;
  const v  = v_non_draw(t);
  const w  = w_non_draw(t);

  const updA = effA.map((x, i) => {
    const mu = teamA[i].mu + (x.sigma2 / c) * v;
    const sigma2 = x.sigma2 * (1 - (x.sigma2 / c2) * w);
    return { mu, sigma: Math.sqrt(Math.max(sigma2, 1e-9)) };
  });
  const updB = effB.map((x, i) => {
    const mu = teamB[i].mu - (x.sigma2 / c) * v;
    const sigma2 = x.sigma2 * (1 - (x.sigma2 / c2) * w);
    return { mu, sigma: Math.sqrt(Math.max(sigma2, 1e-9)) };
  });
  return { A: updA, B: updB };
}

function ddzUpdateTrueSkill(seats: TS[], landlordIdx: number, landlordWon: boolean, params: TSParams = TS_DEFAULT): TS[] {
  const L = seats[landlordIdx];
  const farmersIdx = [0,1,2].filter(i => i !== landlordIdx);
  const F = [ seats[farmersIdx[0]], seats[farmersIdx[1]] ];

  if (landlordWon) {
    const { A, B } = updateTwoTeams([L], F, params);
    const out = seats.slice();
    out[landlordIdx]   = A[0];
    out[farmersIdx[0]] = B[0];
    out[farmersIdx[1]] = B[1];
    return out;
  } else {
    const { A, B } = updateTwoTeams(F, [L], params);
    const out = seats.slice();
    out[landlordIdx]   = B[0];
    out[farmersIdx[0]] = A[0];
    out[farmersIdx[1]] = A[1];
    return out;
  }
}
function conservative(mu: number, sigma: number, k = 3) { return mu - k * sigma; }
function initialTS(): TS { return { mu: TS_DEFAULT.MU0, sigma: TS_DEFAULT.SIG0 }; }

// ===================== NDJSON 工具 =====================
function writeLine(res: NextApiResponse, obj: any) {
  try { res.write(JSON.stringify(obj) + '\n'); } catch {}
}

// ===================== API Handler =====================
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const rounds: number = body.rounds ?? 1;
  const debug: boolean = !!body.debug;

  // TrueSkill 跨局累积（若前端传来 tsSeats 则延续，否则按 1000/333 初始化）
  let tsSeats: TS[] = Array.isArray(body?.tsSeats)
    ? (body.tsSeats as any[]).map((x: any) => ({ mu: Number(x?.mu) || TS_DEFAULT.MU0, sigma: Number(x?.sigma) || TS_DEFAULT.SIG0 }))
    : [initialTS(), initialTS(), initialTS()];

  // 把本次起始 TS 先发一条（可选）
  writeLine(res, { type: 'ts', round: 0, seats: tsSeats.map(s => ({ mu: s.mu, sigma: s.sigma, rc: conservative(s.mu, s.sigma) })) });

  for (let round = 1; round <= rounds; round++) {
    let landlordIdx = -1;
    let landlordWin: boolean | null = null;
    let lastDelta: [number, number, number] = [0,0,0];

    // 开局提示
    writeLine(res, { type: 'log', message: `—— 第 ${round} 局开始 ——` });

    // === 调用你的引擎（做两种签名兼容） ===
    let iter: any;
    try {
      // 常见：runOneGame(options)
      iter = (runOneGame as any)({ ...body });
    } catch {
      try {
        // 备选：runOneGame(ctx, options)
        iter = (runOneGame as any)(undefined, { ...body });
      } catch (e2) {
        writeLine(res, { type: 'error', message: `runOneGame 调用失败：${(e2 as Error)?.message || e2}` });
        break;
      }
    }

    // === 事件循环：透传 + 抓取地主与胜负 ===
    try {
      for await (const ev of (iter as any)) {
        // 原样透传
        writeLine(res, ev);

        // 抓 landlordIdx（兼容不同字段）
        if (landlordIdx < 0) {
          if (typeof (ev as any).landlordIdx === 'number') landlordIdx = (ev as any).landlordIdx;
          else if (typeof (ev as any).landlord === 'number') landlordIdx = (ev as any).landlord;
          else if ((ev as any).init && typeof (ev as any).init.landlordIdx === 'number') landlordIdx = (ev as any).init.landlordIdx;
        }

        // 记录 deltaScores（0 和本局分）
        if (Array.isArray((ev as any).deltaScores) && (ev as any).deltaScores.length === 3) {
          const d = (ev as any).deltaScores;
          lastDelta = [Number(d[0])|0, Number(d[1])|0, Number(d[2])|0];
        }

        // 结束判定 → 计算 TS
        if ((ev as any).type === 'end' || (ev as any).kind === 'end') {
          // 地主位兜底
          if (landlordIdx < 0) {
            if (typeof (ev as any).landlordIdx === 'number') landlordIdx = (ev as any).landlordIdx;
          }

          // 胜负判定：优先看事件字段；否则看最后一次 deltaScores 在地主位的符号
          if (typeof (ev as any).landlordWin === 'boolean') landlordWin = (ev as any).landlordWin;
          else if ((ev as any).winnerRole === 'landlord') landlordWin =
