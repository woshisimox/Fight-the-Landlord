'use client';

import { useMemo, useState } from 'react';
import type { GobangAction, GobangState } from './game';
import { gobangEngine } from './game';

const BOARD_SIZE = (gobangEngine.initialState().data.board.length ?? 15) as number;

interface PlayerPresentation {
  id: 0 | 1;
  name: string;
  avatar: string;
  flag: string;
  rating: number;
  delta: number;
  clock: string;
  accentSoft: string;
  stoneGradient: string;
}

const PLAYERS: PlayerPresentation[] = [
  {
    id: 0,
    name: 'simoX',
    avatar: '🧠',
    flag: '🇯🇵',
    rating: 1012,
    delta: 12,
    clock: '04:42',
    accentSoft: 'rgba(251, 113, 133, 0.5)',
    stoneGradient: 'linear-gradient(135deg, #fb7185, #f43f5e)',
  },
  {
    id: 1,
    name: 'Paper Man',
    avatar: '🤖',
    flag: '🇨🇳',
    rating: 998,
    delta: -12,
    clock: '04:54',
    accentSoft: 'rgba(52, 211, 153, 0.45)',
    stoneGradient: 'linear-gradient(135deg, #34d399, #059669)',
  },
];

interface MoveLogEntry {
  turn: number;
  player: 0 | 1;
  row: number | null;
  col: number | null;
  coordinate: string;
  type: 'move' | 'resign';
}

function formatCoordinate(row: number, col: number): string {
  const letter = String.fromCharCode('A'.charCodeAt(0) + col);
  return `${letter}${row + 1}`;
}

function formatDelta(delta: number): string {
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export default function GobangRenderer() {
  const [state, setState] = useState<GobangState>(() => gobangEngine.initialState());
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);
  const { board, lastMove, winner } = state.data;

  const legalMoves = useMemo(() => gobangEngine.legalActions(state), [state]);

  const matchStatus = winner !== null
    ? `${PLAYERS[winner].name} takes the win`
    : state.status === 'finished'
    ? 'Draw — no more moves available'
    : `${PLAYERS[state.currentPlayer].name} to move`;

  const seriesScore: [number, number] = winner !== null
    ? winner === 0
      ? [1, 0]
      : [0, 1]
    : [0, 0];

  const handleCellClick = (row: number, col: number) => {
    if (state.status === 'finished') return;
    if (board[row][col] !== null) return;

    const action: GobangAction = { row, col };
    const next = gobangEngine.nextState(state, action);
    setState(next);

    setMoveLog((previous) => [
      ...previous,
      {
        turn: state.turn + 1,
        player: state.currentPlayer as 0 | 1,
        row,
        col,
        coordinate: formatCoordinate(row, col),
        type: 'move',
      },
    ]);
  };

  const handleReset = () => {
    setState(gobangEngine.initialState());
    setMoveLog([]);
  };

  const handleResign = () => {
    if (state.status === 'finished') return;

    const resigning = state.currentPlayer as 0 | 1;
    const victorious = (resigning + 1) % gobangEngine.maxPlayers as 0 | 1;

    setState({
      ...state,
      status: 'finished',
      data: {
        ...state.data,
        winner: victorious,
      },
    });

    setMoveLog((previous) => [
      ...previous,
      {
        turn: state.turn + 1,
        player: resigning,
        row: null,
        col: null,
        coordinate: 'Resign',
        type: 'resign',
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-8 text-slate-100">
      <section className="rounded-3xl bg-[#0b1220] p-6 shadow-2xl ring-1 ring-white/5">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          {PLAYERS.map((player) => {
            const isActive = winner !== null ? winner === player.id : state.currentPlayer === player.id;
            const deltaColor = player.delta >= 0 ? 'text-emerald-400' : 'text-rose-400';

            return (
              <div
                key={player.id}
                className={`flex flex-1 items-center gap-4 rounded-2xl border border-white/10 px-4 py-3 transition-all duration-200 ${
                  isActive ? 'bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.08)]' : 'bg-white/[0.03]'
                }`}
                style={{ boxShadow: isActive ? `0 0 25px ${player.accentSoft}` : undefined }}
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full text-xl"
                  style={{ background: player.stoneGradient }}
                >
                  <span>{player.avatar}</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <span>{player.name}</span>
                    <span className="text-lg">{player.flag}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-sm text-slate-300">
                    <span className="font-medium">TrueSkill {player.rating}</span>
                    <span className={deltaColor}>{formatDelta(player.delta)}</span>
                    <span className="text-xs uppercase tracking-wide text-slate-400">{player.clock}</span>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex w-full max-w-[12rem] flex-col items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Score</div>
            <div className="flex items-center gap-3 text-4xl font-bold">
              <span className="text-rose-400">{seriesScore[0]}</span>
              <span className="text-slate-500">•</span>
              <span className="text-emerald-400">{seriesScore[1]}</span>
            </div>
            <p className="text-xs text-slate-400">Bo1 • Ranked Ladder</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-slate-500">Match</span>
            <span className="rounded-full bg-white/10 px-2 py-1 font-mono text-xs">GOB-2024-001</span>
          </div>
          <div className="text-slate-200">{matchStatus}</div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Moves played</span>
            <span className="font-semibold text-slate-200">{state.turn}</span>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex w-full flex-col gap-4 lg:flex-1">
          <div className="rounded-[32px] bg-[#0b1220] p-6 shadow-2xl ring-1 ring-white/5">
            <div className="mx-auto w-full max-w-[560px]">
              <div className="relative aspect-square w-full">
                <div
                  className="absolute inset-0 rounded-[28px] border border-white/10 bg-[#111b2e]"
                  style={{ boxShadow: 'inset 0 40px 80px rgba(15, 23, 42, 0.6)' }}
                >
                  <div className="absolute inset-[6%] rounded-3xl border border-white/10 bg-transparent">
                    <div
                      className="grid h-full w-full"
                      style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${BOARD_SIZE}, minmax(0, 1fr))` }}
                    >
                      {board.map((row, rowIndex) =>
                        row.map((cell, colIndex) => {
                          const isLastMove = !!lastMove && lastMove.row === rowIndex && lastMove.col === colIndex;
                          const isDisabled = state.status === 'finished' || cell !== null;

                          return (
                            <button
                              key={`${rowIndex}-${colIndex}`}
                              type="button"
                              aria-label={`Place stone at ${formatCoordinate(rowIndex, colIndex)}`}
                              className={`group relative flex items-center justify-center border border-white/5 transition-colors duration-150 ${
                                isDisabled ? 'cursor-not-allowed bg-white/[0.02]' : 'hover:bg-white/5'
                              }`}
                              onClick={() => handleCellClick(rowIndex, colIndex)}
                              disabled={isDisabled}
                            >
                              {cell !== null ? (
                                <span
                                  className="pointer-events-none block h-6 w-6 rounded-full shadow-lg transition-all duration-200 md:h-7 md:w-7"
                                  style={{
                                    background: PLAYERS[cell].stoneGradient,
                                    boxShadow: isLastMove
                                      ? `0 0 0 5px ${PLAYERS[cell].accentSoft}`
                                      : `0 12px 28px ${PLAYERS[cell].accentSoft}`,
                                  }}
                                />
                              ) : null}

                              {isLastMove ? (
                                <span className="pointer-events-none absolute inset-1 rounded-full border border-white/40" />
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0b1220] px-5 py-4 text-sm text-slate-200 shadow-xl ring-1 ring-white/5">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-slate-500">Legal moves</span>
              <span className="rounded-full bg-white/10 px-2 py-1 font-mono text-sm text-white">{legalMoves.length}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-full bg-white/10 px-4 py-2 font-medium text-white transition hover:bg-white/20"
              >
                Reset match
              </button>
              <button
                type="button"
                onClick={handleResign}
                disabled={state.status === 'finished'}
                className="rounded-full border border-rose-400/50 px-4 py-2 font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                认输 (Resign)
              </button>
            </div>
          </div>
        </div>

        <aside className="flex w-full flex-col gap-4 lg:max-w-xs">
          <div className="rounded-3xl bg-[#0b1220] p-6 shadow-2xl ring-1 ring-white/5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Match Insights</h3>
            <dl className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Current turn</dt>
                <dd className="font-medium text-white">{state.status === 'finished' ? '—' : PLAYERS[state.currentPlayer].name}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Last move</dt>
                <dd className="font-mono text-white">
                  {lastMove ? `${PLAYERS[lastMove.player].name} → ${formatCoordinate(lastMove.row, lastMove.col)}` : 'None'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Game state</dt>
                <dd className="font-medium text-white">{state.status === 'finished' ? (winner !== null ? 'Victory' : 'Draw') : 'In progress'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Legal moves</dt>
                <dd className="font-mono text-white">{legalMoves.length}</dd>
              </div>
            </dl>
          </div>

          <div className="flex-1 rounded-3xl bg-[#0b1220] p-6 shadow-2xl ring-1 ring-white/5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Moves Timeline</h3>
            <div className="mt-4 max-h-80 overflow-auto pr-2">
              {moveLog.length === 0 ? (
                <p className="text-sm text-slate-400">No moves recorded yet. Click the board to start the duel.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {moveLog.map((entry, index) => {
                    const player = PLAYERS[entry.player];
                    const badgeColor = entry.player === 0 ? 'bg-rose-500/20 text-rose-200' : 'bg-emerald-500/20 text-emerald-200';
                    const label = entry.type === 'resign' ? 'Resigned' : entry.coordinate;

                    return (
                      <li
                        key={`${entry.turn}-${index}`}
                        className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-3 py-2"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}>
                            {player.name}
                          </span>
                          <span className="text-xs uppercase tracking-wide text-slate-400">Turn {entry.turn.toString().padStart(2, '0')}</span>
                        </div>
                        <span className="font-mono text-sm text-white">{label}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
