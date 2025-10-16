// lib/elimination.ts
// Triple-elimination style tournament driver that keeps running 100-game sets
// for randomly drawn groups of three bots. Each round eliminates the lowest
// ladder (TrueSkill) competitor in every group while survivors carry their
// updated ratings forward. Once only three bots remain, a 100-game final set
// decides the podium based on the final ladder standings.

import { getBot, type BotSpec, type IBot } from './arenaStream';
import { runOneGame } from './engine';
import {
  conservative,
  defaultConfig,
  defaultRating,
  rate2Teams,
  type Rating,
  type TSConfig,
} from './trueskill';

export type ParticipantEntry =
  | { id: string; label?: string; spec: BotSpec }
  | { id: string; label?: string; makeBot: (seat: number) => IBot };

type PlayerStats = {
  games: number;
  wins: number;
  landlordGames: number;
  landlordWins: number;
  farmerGames: number;
  farmerWins: number;
  scoreSum: number;
};

type PlayerState = {
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
  /** Games to play per round (default 100). */
  gamesPerRound?: number;
  /** Seed for deterministic shuffling. */
  seed?: number;
  /** Custom TrueSkill configuration (mu defaults to 1000). */
  config?: TSConfig;
};

function cloneStats(stats: PlayerStats): PlayerStats {
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

function diffStats(after: PlayerStats, before: PlayerStats): PlayerStats {
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

function makeStats(): PlayerStats {
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

function snapshot(player: PlayerState): PlayerSnapshot {
  return {
    id: player.entry.id,
    label: player.label,
    rating: { mu: player.rating.mu, sigma: player.rating.sigma },
    ladder: conservative(player.rating),
    stats: cloneStats(player.stats),
    eliminatedRound: player.eliminatedRound,
  };
}

function seatBot(entry: ParticipantEntry, seat: number): IBot {
  if ('makeBot' in entry) return entry.makeBot(seat);
  return getBot(entry.spec, seat);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function ladderValue(player: PlayerState): number {
  return conservative(player.rating);
}

async function playSeries(
  players: PlayerState[],
  options: Required<Pick<TournamentOptions, 'gamesPerRound'>>,
  cfg: TSConfig,
  round: number,
  groupIndex: number,
  eliminateLowest: boolean
): Promise<GroupResult> {
  const before = new Map(players.map((p) => [p.entry.id, cloneStats(p.stats)]));

  const seatOrders = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ];

  for (let game = 0; game < options.gamesPerRound; game++) {
    const order = seatOrders[game % seatOrders.length];
    const seatPlayers = order.map((idx) => players[idx]);
    const bots = seatPlayers.map((p, seatIdx) => seatBot(p.entry, seatIdx)) as [
      IBot,
      IBot,
      IBot,
    ];

    const generator = runOneGame({ seats: bots, bid: true, delayMs: 0 });
    let landlord = 0;
    let winner = 0;
    let deltas: [number, number, number] = [0, 0, 0];

    for await (const event of generator as AsyncGenerator<any, void, unknown>) {
      if (event?.type === 'state' && event.kind === 'init') {
        landlord = typeof event.landlord === 'number' ? event.landlord : 0;
      }
      if (event?.type === 'event' && event.kind === 'win') {
        winner = typeof event.winner === 'number' ? event.winner : 0;
        if (Array.isArray(event.deltaScores)) {
          deltas = event.deltaScores as [number, number, number];
        }
      }
    }

    const seatDeltas: [number, number, number] = [0, 0, 0];
    for (let s = 0; s < 3; s++) {
      seatDeltas[s] = deltas[((s - landlord) % 3 + 3) % 3];
    }

    const landlordPlayer = seatPlayers[landlord];
    const farmerSeats = [0, 1, 2].filter((s) => s !== landlord);
    const farmerPlayers = farmerSeats.map((seat) => seatPlayers[seat]);
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
      const player = seatPlayers[seat];
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

function initPlayer(entry: ParticipantEntry, cfg: TSConfig): PlayerState {
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

function buildConfig(opts?: TournamentOptions): TSConfig {
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

function requiredOptions(opts?: TournamentOptions): Required<
  Pick<TournamentOptions, 'gamesPerRound'>
> {
  return {
    gamesPerRound: opts?.gamesPerRound ?? 100,
  };
}

export async function runTripleElimination(
  entries: ParticipantEntry[],
  opts?: TournamentOptions
): Promise<TournamentResult> {
  if (!entries.length) {
    return { rounds: [], finalRound: null, standings: [] };
  }

  const cfg = buildConfig(opts);
  const options = requiredOptions(opts);
  const rng = mulberry32((opts?.seed ?? 0x13579bdf) >>> 0);

  const players: PlayerState[] = entries.map((entry) => initPlayer(entry, cfg));
  const rounds: RoundSummary[] = [];

  let survivors = players.slice();
  let round = 1;

  while (survivors.length > 3) {
    const currentRound: RoundSummary = { round, groups: [], autoEliminated: [] };

    const remainder = survivors.length % 3;
    if (remainder > 0) {
      const sorted = [...survivors].sort(
        (a, b) => ladderValue(a) - ladderValue(b)
      );
      const autoDrop = sorted.slice(0, remainder);
      for (const drop of autoDrop) {
        drop.eliminatedRound = round;
        currentRound.autoEliminated.push({
          round,
          reason: 'insufficient-slots',
          player: snapshot(drop),
        });
      }
      survivors = survivors.filter((p) => !autoDrop.includes(p));
      if (survivors.length <= 3) {
        rounds.push(currentRound);
        break;
      }
    }

    const pool = survivors.slice();
    shuffleInPlace(pool, rng);

    const groups: PlayerState[][] = [];
    for (let i = 0; i + 2 < pool.length; i += 3) {
      groups.push([pool[i], pool[i + 1], pool[i + 2]]);
    }

    let groupIndex = 0;
    for (const group of groups) {
      const result = await playSeries(
        group,
        options,
        cfg,
        round,
        groupIndex,
        true
      );
      currentRound.groups.push(result);
      if (result.eliminated) {
        survivors = survivors.filter((p) => p.entry.id !== result.eliminated?.id);
      }
      groupIndex += 1;
    }

    rounds.push(currentRound);
    round += 1;
  }

  let finalRound: FinalRoundSummary | null = null;
  if (survivors.length === 3) {
    const finalGroup = await playSeries(
      survivors,
      options,
      cfg,
      round,
      0,
      false
    );
    finalRound = { games: options.gamesPerRound, group: finalGroup };
  }

  const standings = players
    .map((p) => snapshot(p))
    .sort((a, b) => {
      const ladderDiff = b.ladder - a.ladder;
      if (Math.abs(ladderDiff) > 1e-9) return ladderDiff;
      const roundA = a.eliminatedRound ?? Number.POSITIVE_INFINITY;
      const roundB = b.eliminatedRound ?? Number.POSITIVE_INFINITY;
      return roundB - roundA;
    });

  return { rounds, finalRound, standings };
}
