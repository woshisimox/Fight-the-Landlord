// lib/eliminationCore.ts
// Shared utilities for elimination tournaments that can run in both
// Node (server) and browser environments. Provides the data structures
// and math needed to update ratings and stats from externally supplied
// game results so that different runners (API / front-end viewer) can
// stay in sync.

import type { BotSpec, IBot } from './arenaStream';
import {
  conservative,
  defaultConfig,
  defaultRating,
  rate2Teams,
  type Rating,
  type TSConfig,
} from './trueskill';

export type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:mininet'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'ai:openai'
  | 'ai:gemini'
  | 'ai:grok'
  | 'ai:kimi'
  | 'ai:qwen'
  | 'ai:deepseek'
  | 'http';

export type ParticipantUi = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  httpBase?: string;
  httpToken?: string;
};

export type ParticipantEntry =
  | { id: string; label?: string; spec: BotSpec; ui?: ParticipantUi }
  | { id: string; label?: string; makeBot: (seat: number) => IBot; ui?: ParticipantUi };

export type PlayerStats = {
  games: number;
  wins: number;
  landlordGames: number;
  landlordWins: number;
  farmerGames: number;
  farmerWins: number;
  scoreSum: number;
};

export type PlayerState = {
  entry: ParticipantEntry;
  label: string;
  rating: Rating;
  stats: PlayerStats;
  eliminatedRound: number | null;
};

export type PlayerSnapshot = {
  id: string;
  label: string;
  rating: Rating;
  ladder: number;
  stats: PlayerStats;
  eliminatedRound: number | null;
};

export type PlayerRoundDelta = PlayerSnapshot & { delta: PlayerStats };

export type GroupResult = {
  round: number;
  groupIndex: number;
  players: PlayerRoundDelta[];
  eliminated: PlayerSnapshot | null;
};

export type AutoElimination = {
  round: number;
  reason: 'insufficient-slots';
  player: PlayerSnapshot;
};

export type RoundSummary = {
  round: number;
  groups: GroupResult[];
  autoEliminated: AutoElimination[];
};

export type FinalRoundSummary = {
  games: number;
  group: GroupResult;
};

export type TournamentResult = {
  rounds: RoundSummary[];
  finalRound: FinalRoundSummary | null;
  standings: PlayerSnapshot[];
};

export type TournamentOptions = {
  gamesPerRound?: number;
  seed?: number;
  config?: TSConfig;
};

export function makeStats(): PlayerStats {
  return {
    games: 0,
    wins: 0,
    landlordGames: 0,
    landlordWins: 0,
    farmerGames: 0,
    farmerWins: 0,
    scoreSum: 0,
  };
}

export function cloneStats(stats: PlayerStats): PlayerStats {
  return {
    games: stats.games,
    wins: stats.wins,
    landlordGames: stats.landlordGames,
    landlordWins: stats.landlordWins,
    farmerGames: stats.farmerGames,
    farmerWins: stats.farmerWins,
    scoreSum: stats.scoreSum,
  };
}

export function diffStats(after: PlayerStats, before: PlayerStats): PlayerStats {
  return {
    games: after.games - before.games,
    wins: after.wins - before.wins,
    landlordGames: after.landlordGames - before.landlordGames,
    landlordWins: after.landlordWins - before.landlordWins,
    farmerGames: after.farmerGames - before.farmerGames,
    farmerWins: after.farmerWins - before.farmerWins,
    scoreSum: after.scoreSum - before.scoreSum,
  };
}

export function snapshot(player: PlayerState): PlayerSnapshot {
  return {
    id: player.entry.id,
    label: player.label,
    rating: { mu: player.rating.mu, sigma: player.rating.sigma },
    ladder: conservative(player.rating),
    stats: cloneStats(player.stats),
    eliminatedRound: player.eliminatedRound,
  };
}

export function ladderValue(player: PlayerState): number {
  return conservative(player.rating);
}

export function applyGameResult(
  players: PlayerState[],
  landlord: number,
  winner: number,
  seatDeltas: [number, number, number],
  cfg: TSConfig,
): void {
  const landlordPlayer = players[landlord];
  const farmerSeats = [0, 1, 2].filter((s) => s !== landlord);
  const farmerPlayers = farmerSeats.map((seat) => players[seat]);
  if (farmerPlayers.length !== 2) {
    throw new Error('Dou Dizhu requires exactly two farmers per game.');
  }

  const landlordRating = [{ ...landlordPlayer.rating }];
  const farmerRatings = farmerPlayers.map((p) => ({ ...p.rating }));

  if (winner === landlord) {
    const res = rate2Teams(landlordRating, farmerRatings, cfg);
    landlordPlayer.rating = res.winners[0];
    farmerPlayers[0].rating = res.losers[0];
    farmerPlayers[1].rating = res.losers[1];
  } else {
    const res = rate2Teams(farmerRatings, landlordRating, cfg);
    farmerPlayers[0].rating = res.winners[0];
    farmerPlayers[1].rating = res.winners[1];
    landlordPlayer.rating = res.losers[0];
  }

  for (let seat = 0; seat < 3; seat++) {
    const player = players[seat];
    player.stats.games += 1;
    if (seat === landlord) {
      player.stats.landlordGames += 1;
    } else {
      player.stats.farmerGames += 1;
    }
    if (seat === winner) {
      player.stats.wins += 1;
      if (seat === landlord) {
        player.stats.landlordWins += 1;
      } else {
        player.stats.farmerWins += 1;
      }
    }
    player.stats.scoreSum += seatDeltas[seat];
  }
}

export function summarizeGroup(
  players: PlayerState[],
  before: Map<string, PlayerStats>,
  round: number,
  groupIndex: number,
  eliminateLowest: boolean,
): GroupResult {
  let eliminated: PlayerSnapshot | null = null;
  if (eliminateLowest) {
    const lowest = players.reduce((min, p) =>
      ladderValue(p) < ladderValue(min) ? p : min,
    players[0]);
    lowest.eliminatedRound = round;
    eliminated = snapshot(lowest);
  }

  const playersWithDelta: PlayerRoundDelta[] = players.map((p) => {
    const after = snapshot(p);
    const beforeStats = before.get(p.entry.id) ?? makeStats();
    const delta = diffStats(after.stats, beforeStats);
    return { ...after, delta };
  });

  return {
    round,
    groupIndex,
    players: playersWithDelta,
    eliminated,
  };
}

export function initPlayer(entry: ParticipantEntry, cfg: TSConfig): PlayerState {
  const mu = cfg.mu ?? defaultConfig().mu;
  const sigma = cfg.sigma ?? mu / 3;
  const rating = defaultRating(mu, sigma);
  return {
    entry,
    label: entry.label ?? entry.id,
    rating,
    stats: makeStats(),
    eliminatedRound: null,
  };
}

export function buildConfig(opts?: TournamentOptions): TSConfig {
  const base = defaultConfig();
  const targetMu = opts?.config?.mu ?? 1000;
  return {
    ...base,
    ...opts?.config,
    mu: targetMu,
    sigma: opts?.config?.sigma ?? targetMu / 3,
    beta: opts?.config?.beta ?? targetMu / 6,
    tau: opts?.config?.tau ?? targetMu / 300,
  };
}

export function requiredOptions(opts?: TournamentOptions): Required<
  Pick<TournamentOptions, 'gamesPerRound'>
> {
  return {
    gamesPerRound: opts?.gamesPerRound ?? 100,
  };
}

export function sortStandings(players: PlayerState[]): PlayerSnapshot[] {
  return players
    .map((p) => snapshot(p))
    .sort((a, b) => {
      const ladderDiff = b.ladder - a.ladder;
      if (Math.abs(ladderDiff) > 1e-9) return ladderDiff;
      const roundA = a.eliminatedRound ?? Number.POSITIVE_INFINITY;
      const roundB = b.eliminatedRound ?? Number.POSITIVE_INFINITY;
      return roundB - roundA;
    });
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
