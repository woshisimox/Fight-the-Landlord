// 轻量 TrueSkill（两队对战：地主 1v2 农民），单位标尺适配“初始分=1000”

export type TS = { mu: number; sigma: number };
export type TSParams = { MU0: number; SIG0: number; BETA: number; TAU: number };

export const DefaultTSParams: TSParams = {
  MU0: 1000,
  SIG0: 1000 / 3,   // ≈333.33
  BETA: 1000 / 6,   // ≈166.67
  TAU: 1000 / 300,  // ≈3.33  （赛季漂移，极小）
};

// --- 数学辅助 ---
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

function v_non_draw(x: number) {
  const denom = Math.max(Phi(x), 1e-12);
  return phi(x) / denom;
}
function w_non_draw(x: number) {
  const v = v_non_draw(x);
  return v * (v + x);
}

// --- 两队更新（A 胜 B） ---
function updateTwoTeams(
  teamA: TS[], teamB: TS[], params: TSParams
): { A: TS[]; B: TS[] } {
  const { BETA, TAU } = params;

  // 漂移：把 TAU^2 加到每个选手的σ^2上（TrueSkill 动态因子）
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

// --- 斗地主：地主(单人) vs 农民(两人) ---
export function ddzUpdateTrueSkill(
  seats: TS[], landlordIdx: number, landlordWon: boolean, params: TSParams = DefaultTSParams
): TS[] {
  const L = seats[landlordIdx];
  const farmersIdx = [0,1,2].filter(i => i !== landlordIdx);
  const F = [ seats[farmersIdx[0]], seats[farmersIdx[1]] ];

  if (landlordWon) {
    const { A, B } = updateTwoTeams([L], F, params);
    const out = seats.slice();
    out[landlordIdx] = A[0];
    out[farmersIdx[0]] = B[0];
    out[farmersIdx[1]] = B[1];
    return out;
  } else {
    const { A, B } = updateTwoTeams(F, [L], params); // 农民胜：把农民当作 A
    const out = seats.slice();
    out[landlordIdx] = B[0];
    out[farmersIdx[0]] = A[0];
    out[farmersIdx[1]] = A[1];
    return out;
  }
}

export function initialTS(params: TSParams = DefaultTSParams): TS {
  return { mu: params.MU0, sigma: params.SIG0 };
}

export function conservative(mu: number, sigma: number, k: number = 3) {
  return mu - k * sigma;
}
