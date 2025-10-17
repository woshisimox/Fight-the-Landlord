// lib/elimination.ts
// Triple-elimination style tournament driver that keeps running 100-game sets
// for randomly drawn groups of three bots. Each round eliminates the lowest
// ladder (TrueSkill) competitor in every group while survivors carry their
// updated ratings forward. Once only three bots remain, a 100-game final set
// decides the podium based on the final ladder standings.

import { getBot, type BotSpec, type IBot } from './arenaStream';
import { runOneGame } from './engine';
import {
  applyGameResult,
  buildConfig,
  cloneStats,
  initPlayer,
  mulberry32,
  requiredOptions,
  shuffleInPlace,
  snapshot,
  sortStandings,
  summarizeGroup,
  type GroupResult,
  type ParticipantEntry,
  type PlayerState,
  type PlayerStats,
  type RoundSummary,
  type FinalRoundSummary,
  type TournamentResult,
  type TournamentOptions,
} from './eliminationCore';
import type { TSConfig } from './trueskill';

function seatBot(entry: ParticipantEntry, seat: number): IBot {
  if ('makeBot' in entry) return entry.makeBot(seat);
  return getBot(entry.spec, seat);
}

async function playSeries(
  players: PlayerState[],
  options: Required<Pick<TournamentOptions, 'gamesPerRound'>>,
  cfg: TSConfig,
  round: number,
  groupIndex: number,
  eliminateLowest: boolean,
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

    applyGameResult(seatPlayers, landlord, winner, seatDeltas, cfg);
  }

  return summarizeGroup(players, before as Map<string, PlayerStats>, round, groupIndex, eliminateLowest);
}

export async function runTripleElimination(
  entries: ParticipantEntry[],
  opts?: TournamentOptions,
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
        (a, b) => snapshot(a).ladder - snapshot(b).ladder,
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
        true,
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
      false,
    );
    finalRound = { games: options.gamesPerRound, group: finalGroup };
  }

  const standings = sortStandings(players);

  return { rounds, finalRound, standings };
}

export type {
  ParticipantEntry,
  PlayerStats,
  PlayerState,
  GroupResult,
  RoundSummary,
  FinalRoundSummary,
  TournamentResult,
  TournamentOptions,
} from './eliminationCore';
