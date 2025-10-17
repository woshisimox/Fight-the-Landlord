// lib/eliminationClient.ts
// Front-end friendly tournament engine that mirrors the server elimination
// rules but relies on externally supplied game results (e.g. streamed from
// the viewer) instead of running matches on the server. This lets the UI show
// every hand in real time while keeping standings and summaries consistent.

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
  type FinalRoundSummary,
  type GroupResult,
  type ParticipantEntry,
  type PlayerState,
  type PlayerStats,
  type RoundSummary,
  type TournamentOptions,
  type TournamentResult,
} from './eliminationCore';
import type { TSConfig } from './trueskill';

export type GameRecord = {
  landlord: number;
  winner: number;
  seatDeltas: [number, number, number];
};

type AssignmentBase = {
  round: number;
  players: PlayerState[];
  before: Map<string, PlayerStats>;
  gamesPlayed: number;
  eliminateLowest: boolean;
};

export type GroupAssignment = AssignmentBase & {
  type: 'group';
  groupIndex: number;
};

export type FinalAssignment = AssignmentBase & {
  type: 'final';
  groupIndex: 0;
};

export type Assignment = GroupAssignment | FinalAssignment;

type CompleteResult =
  | { type: 'group'; summary: GroupResult }
  | { type: 'final'; summary: FinalRoundSummary };

export class EliminationEngine {
  private readonly cfg: TSConfig;
  readonly options: Required<Pick<TournamentOptions, 'gamesPerRound'>>;
  private readonly rng: () => number;
  readonly players: PlayerState[];
  private survivors: PlayerState[];
  readonly rounds: RoundSummary[] = [];
  private pendingGroups: PlayerState[][] = [];
  private currentRound: RoundSummary | null = null;
  private roundNumber = 1;
  private assignment: Assignment | null = null;
  private finalRoundSummary: FinalRoundSummary | null = null;

  constructor(entries: ParticipantEntry[], opts?: TournamentOptions) {
    this.cfg = buildConfig(opts);
    this.options = requiredOptions(opts);
    this.rng = mulberry32((opts?.seed ?? 0x13579bdf) >>> 0);
    this.players = entries.map((entry) => initPlayer(entry, this.cfg));
    this.survivors = this.players.slice();
  }

  nextAssignment(): Assignment | null {
    if (this.assignment) return this.assignment;

    if (this.survivors.length <= 3) {
      if (this.survivors.length === 3 && !this.finalRoundSummary) {
        const before = new Map(
          this.survivors.map((p) => [p.entry.id, cloneStats(p.stats)] as const),
        );
        const assignment: FinalAssignment = {
          type: 'final',
          round: this.roundNumber,
          groupIndex: 0,
          players: this.survivors,
          before,
          gamesPlayed: 0,
          eliminateLowest: false,
        };
        this.assignment = assignment;
        return assignment;
      }
      return null;
    }

    if (!this.currentRound) {
      this.currentRound = { round: this.roundNumber, groups: [], autoEliminated: [] };
      const remainder = this.survivors.length % 3;
      if (remainder > 0) {
        const sorted = [...this.survivors].sort(
          (a, b) => snapshot(a).ladder - snapshot(b).ladder,
        );
        const autoDrop = sorted.slice(0, remainder);
        for (const drop of autoDrop) {
          drop.eliminatedRound = this.roundNumber;
          this.currentRound.autoEliminated.push({
            round: this.roundNumber,
            reason: 'insufficient-slots',
            player: snapshot(drop),
          });
        }
        this.survivors = this.survivors.filter((p) => !autoDrop.includes(p));
        if (this.survivors.length <= 3) {
          this.rounds.push(this.currentRound);
          this.currentRound = null;
          this.roundNumber += 1;
          return this.nextAssignment();
        }
      }

      const pool = this.survivors.slice();
      shuffleInPlace(pool, this.rng);
      this.pendingGroups = [];
      for (let i = 0; i + 2 < pool.length; i += 3) {
        this.pendingGroups.push([pool[i], pool[i + 1], pool[i + 2]]);
      }
    }

    if (!this.pendingGroups.length) {
      if (this.currentRound) {
        this.rounds.push(this.currentRound);
        this.currentRound = null;
        this.roundNumber += 1;
      }
      return this.nextAssignment();
    }

    const players = this.pendingGroups.shift()!;
    const before = new Map(
      players.map((p) => [p.entry.id, cloneStats(p.stats)] as const),
    );
    const assignment: GroupAssignment = {
      type: 'group',
      round: this.currentRound!.round,
      groupIndex: this.currentRound!.groups.length,
      players,
      before,
      gamesPlayed: 0,
      eliminateLowest: true,
    };
    this.assignment = assignment;
    return assignment;
  }

  recordGame(result: GameRecord): void {
    if (!this.assignment) return;
    applyGameResult(
      this.assignment.players,
      result.landlord,
      result.winner,
      result.seatDeltas,
      this.cfg,
    );
    this.assignment.gamesPlayed += 1;
  }

  completeAssignment(): CompleteResult | null {
    if (!this.assignment) return null;
    const assignment = this.assignment;
    this.assignment = null;

    if (assignment.type === 'group') {
      const summary = summarizeGroup(
        assignment.players,
        assignment.before,
        assignment.round,
        assignment.groupIndex,
        assignment.eliminateLowest,
      );
      this.currentRound?.groups.push(summary);
      if (summary.eliminated) {
        this.survivors = this.survivors.filter(
          (p) => p.entry.id !== summary.eliminated?.id,
        );
      }
      if (!this.pendingGroups.length && this.currentRound) {
        this.rounds.push(this.currentRound);
        this.currentRound = null;
        this.roundNumber += 1;
      }
      return { type: 'group', summary };
    }

    const summary = summarizeGroup(
      assignment.players,
      assignment.before,
      assignment.round,
      0,
      false,
    );
    this.finalRoundSummary = {
      games: this.options.gamesPerRound,
      group: summary,
    };
    return { type: 'final', summary: this.finalRoundSummary };
  }

  snapshot(): TournamentResult {
    return {
      rounds: this.rounds.slice(),
      finalRound: this.finalRoundSummary,
      standings: sortStandings(this.players),
    };
  }

  resetStateOnAbort(): void {
    this.assignment = null;
    this.pendingGroups = [];
    this.currentRound = null;
    this.roundNumber = 1;
    this.rounds.length = 0;
    this.finalRoundSummary = null;
    this.survivors = this.players.slice();
  }
}
