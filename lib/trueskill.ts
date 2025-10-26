// lib/trueskill.ts
// Lightweight TrueSkill implementation for 2-team (win/lose) updates.
// Designed for 3-player Dou Dizhu: team of 1 (landlord) vs team of 2 (farmers).
// No external dependencies. TS/ESM friendly.

/** Player rating (Gaussian) */
export type Rating = { mu: number; sigma: number };

/** Global config */
export type TSConfig = {
  /** Default mean */
  mu: number;
  /** Default stddev */
  sigma: number;
  /** Performance variance scale (skill to performance) */
  beta: number;
  /** Dynamics factor per game (adds uncertainty between games) */
  tau: number;
  /** Draw probability (kept for API completeness; not used in this no-draw impl) */
  drawProbability: number;
};

/** Conventional defaults used by the TrueSkill paper/communities. */
export const defaultConfig = (): TSConfig => {
  const mu = 25;
  const sigma = mu / 3;     // ≈ 8.333
  const beta = mu / 6;      // ≈ 4.166
  const tau = mu / 300;     // ≈ 0.083
  const drawProbability = 0;
  return { mu, sigma, beta, tau, drawProbability };
};

/** Make a default rating (optionally overriding mu/sigma). */
export const defaultRating = (
  mu: number = defaultConfig().mu,
  sigma: number = defaultConfig().sigma
): Rating => ({ mu, sigma });

/** Conservative rating often used for leaderboards: mu - k*sigma (k=3 by default). */
export function conservative(r: Rating, k: number = 3): number {
  return r.mu - k * r.sigma;
}

/** Standard normal PDF */
function phi(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 approximation of erf) */
function Phi(x: number): number {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** v = N'(z)/N(z) for win case; stable with guard near zero. */
function V(z: number): number {
  const denom = Phi(z);
  if (denom < 1e-12) return z < 0 ? -z : 0; // guard against division by tiny
  return phi(z) / denom;
}

/** w = v (v + z) */
function W(z: number): number {
  const v = V(z);
  return v * (v + z);
}

/** Result object for two-team update. */
type RateResult = { winners: Rating[]; losers: Rating[] };

/**
 * Update two teams' ratings (no draws) where `winners` beat `losers`.
 *
 * Notes:
 * - Each player's prior variance is inflated by tau^2 (dynamics).
 * - Team performance variance includes both teams' variances plus 2*beta^2.
 * - Each player's update is scaled by their own variance share.
 * - Safe-guards keep sigmas non-negative.
 */
export function rate2Teams(
  winners: Rating[],
  losers: Rating[],
  cfg: TSConfig = defaultConfig()
): RateResult {
  const tau2 = cfg.tau * cfg.tau;
  const beta2 = cfg.beta * cfg.beta;

  const priorW = winners.map((r) => ({ mu: r.mu, s2: r.sigma * r.sigma + tau2 }));
  const priorL = losers.map((r) => ({ mu: r.mu, s2: r.sigma * r.sigma + tau2 }));

  const teamMuW = priorW.reduce((s, x) => s + x.mu, 0);
  const teamMuL = priorL.reduce((s, x) => s + x.mu, 0);
  const teamVar =
    priorW.reduce((s, x) => s + x.s2, 0) +
    priorL.reduce((s, x) => s + x.s2, 0) +
    2 * beta2;

  const c = Math.sqrt(Math.max(1e-12, teamVar));
  const z = (teamMuW - teamMuL) / c;
  const v = V(z);
  const w = W(z);

  const updWin = (mu: number, s2: number): Rating => {
    const mu2 = mu + (s2 / c) * v;
    const s22 = s2 * (1 - (s2 / (c * c)) * w);
    return { mu: mu2, sigma: Math.sqrt(Math.max(1e-9, s22)) };
  };
  const updLose = (mu: number, s2: number): Rating => {
    const mu2 = mu - (s2 / c) * v;
    const s22 = s2 * (1 - (s2 / (c * c)) * w);
    return { mu: mu2, sigma: Math.sqrt(Math.max(1e-9, s22)) };
  };

  return {
    winners: priorW.map((x) => updWin(x.mu, x.s2)),
    losers: priorL.map((x) => updLose(x.mu, x.s2)),
  };
}

/**
 * Convenience wrapper with team ranks (lower rank = better).
 * Only supports exactly two teams (no draws) in this lightweight module.
 *
 * Example:
 *   // Team A beat Team B
 *   const [A2, B2] = rateTeams([A, B], [0, 1])
 */
export function rateTeams(
  teams: Rating[][],
  ranks: number[],
  cfg: TSConfig = defaultConfig()
): Rating[][] {
  if (teams.length !== 2 || ranks.length !== 2) {
    throw new Error(
      'rateTeams: only two teams are supported in this lightweight implementation.'
    );
  }
  const iWin = ranks[0] < ranks[1] ? 0 : 1;
  const iLose = iWin === 0 ? 1 : 0;

  const res = rate2Teams(teams[iWin], teams[iLose], cfg);
  const out: Rating[][] = [];
  out[iWin] = res.winners;
  out[iLose] = res.losers;
  return out;
}

/** Optional helper: compute a rough win probability (logistic on (Δμ / c)). */
export function winProbability(
  teamA: Rating[],
  teamB: Rating[],
  cfg: TSConfig = defaultConfig()
): number {
  const tau2 = cfg.tau * cfg.tau;
  const beta2 = cfg.beta * cfg.beta;
  const prior = (team: Rating[]) =>
    team.map((r) => ({ mu: r.mu, s2: r.sigma * r.sigma + tau2 }));
  const A = prior(teamA);
  const B = prior(teamB);
  const muA = A.reduce((s, x) => s + x.mu, 0);
  const muB = B.reduce((s, x) => s + x.mu, 0);
  const varSum =
    A.reduce((s, x) => s + x.s2, 0) +
    B.reduce((s, x) => s + x.s2, 0) +
    2 * beta2;
  const c = Math.sqrt(Math.max(1e-12, varSum));
  const z = (muA - muB) / c;
  // Probability that A's performance exceeds B's (normal CDF)
  return Phi(z);
}
