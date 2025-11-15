'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GobangAction, GobangState } from './game';
import { gobangEngine } from './game';

const BOARD_SIZE = gobangEngine.initialState().data.board.length;

interface PlayerPresentation {
  id: 0 | 1;
  name: string;
  avatar: string;
  flag: string;
  rating: number;
  delta: number;
  stoneFill: string;
  shadow: string;
}

const PLAYERS: PlayerPresentation[] = [
  {
    id: 0,
    name: 'simoX',
    avatar: '🧠',
    flag: '🇯🇵',
    rating: 1012,
    delta: 12,
    stoneFill: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.95), #fb7185)',
    shadow: '0 12px 30px rgba(248, 113, 113, 0.45)',
  },
  {
    id: 1,
    name: 'Paper Man',
    avatar: '🤖',
    flag: '🇨🇳',
    rating: 998,
    delta: -12,
    stoneFill: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.95), #34d399)',
    shadow: '0 12px 30px rgba(16, 185, 129, 0.45)',
  },
];

type PlayerMode = 'human' | 'ai_random';

const MODE_LABEL: Record<PlayerMode, string> = {
  human: '人类',
  ai_random: 'AI (随机)',
};

const MODE_OPTIONS: Array<{ value: PlayerMode; label: string }> = [
  { value: 'human', label: '人类' },
  { value: 'ai_random', label: 'AI (随机)' },
];

type MoveOrigin = 'human' | 'ai' | 'resign';

interface MoveLogEntry {
  turn: number;
  player: 0 | 1;
  row: number | null;
  col: number | null;
  coordinate: string;
  origin: MoveOrigin;
}

const STAR_POINTS: Array<{ row: number; col: number }> = [
  { row: 3, col: 3 },
  { row: 3, col: 11 },
  { row: 7, col: 7 },
  { row: 11, col: 3 },
  { row: 11, col: 11 },
];

const BOARD_BACKGROUND =
  'radial-gradient(circle at 20% 20%, rgba(15, 23, 42, 0.45), transparent 55%), radial-gradient(circle at 80% 30%, rgba(15, 23, 42, 0.35), transparent 50%), #020817';

function formatCoordinate(row: number, col: number): string {
  const letter = String.fromCharCode('A'.charCodeAt(0) + col);
  return `${letter}${row + 1}`;
}

function formatDelta(delta: number): string {
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function pickAiMove(state: GobangState, legal: GobangAction[]): GobangAction {
  const { lastMove } = state.data;
  if (legal.length === 0) {
    throw new Error('No legal moves available.');
  }

  if (lastMove) {
    const nearby = legal.filter((move) => Math.abs(move.row - lastMove.row) <= 1 && Math.abs(move.col - lastMove.col) <= 1);
    if (nearby.length > 0) {
      return nearby[Math.floor(Math.random() * nearby.length)];
    }
  }

  const center = (BOARD_SIZE - 1) / 2;
  let best = legal[0];
  let bestScore = Number.POSITIVE_INFINITY;

  legal.forEach((move) => {
    const score = Math.abs(move.row - center) + Math.abs(move.col - center);
    if (score < bestScore) {
      best = move;
      bestScore = score;
    }
  });

  return best;
}

function getMatchStatus(state: GobangState): string {
  const { winner } = state.data;
  if (winner !== null) {
    return `${PLAYERS[winner].name} 获胜`;
  }
  if (state.status === 'finished') {
    return '对局结束';
  }
  return `${PLAYERS[state.currentPlayer as 0 | 1].name} 落子`;
}

export default function GobangRenderer() {
  const [state, setState] = useState<GobangState>(() => gobangEngine.initialState());
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);
  const [playerModes, setPlayerModes] = useState<PlayerMode[]>(['human', 'ai_random']);

  const legalMoves = useMemo(() => gobangEngine.legalActions(state), [state]);
  const matchStatus = getMatchStatus(state);
  const { board, lastMove } = state.data;

  const applyAction = useCallback((action: GobangAction, origin: MoveOrigin) => {
    setState((previous) => {
      if (previous.status === 'finished') {
        return previous;
      }

      const nextState = gobangEngine.nextState(previous, action);
      const player = previous.currentPlayer as 0 | 1;

      setMoveLog((history) => [
        ...history,
        {
          turn: previous.turn + 1,
          player,
          row: action.row,
          col: action.col,
          coordinate: formatCoordinate(action.row, action.col),
          origin,
        },
      ]);

      return nextState;
    });
  }, []);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (state.status !== 'running') return;
      if (board[row][col] !== null) return;

      const current = state.currentPlayer as 0 | 1;
      if (playerModes[current] !== 'human') return;

      applyAction({ row, col }, 'human');
    },
    [applyAction, board, playerModes, state]
  );

  const handleReset = useCallback(() => {
    setState(gobangEngine.initialState());
    setMoveLog([]);
  }, []);

  const handleResign = useCallback(() => {
    if (state.status !== 'running') return;

    const resigning = state.currentPlayer as 0 | 1;
    const winner = ((resigning + 1) % gobangEngine.maxPlayers) as 0 | 1;

    setState((previous) => ({
      ...previous,
      status: 'finished',
      data: {
        ...previous.data,
        winner,
      },
    }));

    setMoveLog((history) => [
      ...history,
      {
        turn: state.turn + 1,
        player: resigning,
        row: null,
        col: null,
        coordinate: 'Resign',
        origin: 'resign',
      },
    ]);
  }, [state]);

  useEffect(() => {
    if (state.status !== 'running') return;

    const currentPlayer = state.currentPlayer as 0 | 1;
    const mode = playerModes[currentPlayer];
    if (mode === 'human') return;

    const legal = gobangEngine.legalActions(state);
    if (legal.length === 0) return;

    const timer = window.setTimeout(() => {
      const action = pickAiMove(state, legal);
      applyAction(action, 'ai');
    }, 400);

    return () => window.clearTimeout(timer);
  }, [applyAction, playerModes, state]);

  return (
    <div className="flex flex-col gap-8 text-slate-100">
      <section className="rounded-3xl bg-[#071020] px-6 py-5 shadow-2xl ring-1 ring-white/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 rounded-2xl bg-[#0d1628] px-4 py-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-rose-600 text-2xl">
                  {PLAYERS[0].avatar}
                </div>
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <span>{PLAYERS[0].name}</span>
                    <span>{PLAYERS[0].flag}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-300">
                    <span>TrueSkill {PLAYERS[0].rating}</span>
                    <span className={PLAYERS[0].delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatDelta(PLAYERS[0].delta)}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wider text-slate-400">先手</span>
                  </div>
                  <select
                    aria-label="Player 1 mode"
                    value={playerModes[0]}
                    onChange={(event) => {
                      const mode = event.target.value as PlayerMode;
                      setPlayerModes((previous) => {
                        const next = [...previous] as PlayerMode[];
                        next[0] = mode;
                        return next;
                      });
                    }}
                    className="mt-2 w-full rounded-xl bg-[#111d35] px-3 py-2 text-xs font-medium text-slate-200 ring-1 ring-slate-700/60 focus:outline-none focus:ring-emerald-400/60"
                  >
                    {MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl bg-[#0d1628] px-4 py-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-2xl">
                  {PLAYERS[1].avatar}
                </div>
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <span>{PLAYERS[1].name}</span>
                    <span>{PLAYERS[1].flag}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-300">
                    <span>TrueSkill {PLAYERS[1].rating}</span>
                    <span className={PLAYERS[1].delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{formatDelta(PLAYERS[1].delta)}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-wider text-slate-400">后手</span>
                  </div>
                  <select
                    aria-label="Player 2 mode"
                    value={playerModes[1]}
                    onChange={(event) => {
                      const mode = event.target.value as PlayerMode;
                      setPlayerModes((previous) => {
                        const next = [...previous] as PlayerMode[];
                        next[1] = mode;
                        return next;
                      });
                    }}
                    className="mt-2 w-full rounded-xl bg-[#111d35] px-3 py-2 text-xs font-medium text-slate-200 ring-1 ring-slate-700/60 focus:outline-none focus:ring-emerald-400/60"
                  >
                    {MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="flex h-full w-full max-w-[220px] flex-col items-center justify-center gap-2 rounded-2xl bg-[#0d1628] px-6 py-4 text-center">
            <div className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Match</div>
            <div className="text-4xl font-bold text-white">Gobang</div>
            <p className="text-xs text-slate-400">{matchStatus}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <div className="rounded-[36px] bg-[#050b17] p-6 shadow-[0_30px_80px_rgba(2,6,23,0.65)] ring-1 ring-white/5">
            <div className="mx-auto w-full max-w-[520px]">
              <div className="relative aspect-square w-full overflow-hidden rounded-[32px] border border-slate-800/60 bg-[#020817]">
                <div
                  className="absolute inset-0"
                  style={{
                    background: BOARD_BACKGROUND,
                  }}
                />
                <div className="absolute inset-6 rounded-[26px] border border-slate-700/60 bg-black/10 shadow-[inset_0_0_40px_rgba(15,23,42,0.55)]" />
                <div className="absolute inset-[2.75rem]">
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage: `linear-gradient(to right, rgba(100,116,139,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,0.35) 1px, transparent 1px)`,
                      backgroundSize: `${100 / (BOARD_SIZE - 1)}% ${100 / (BOARD_SIZE - 1)}%`,
                      backgroundPosition: 'center',
                    }}
                  />
                  {STAR_POINTS.map((point) => (
                    <span
                      key={`${point.row}-${point.col}`}
                      className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-200/80"
                      style={{
                        left: `${(point.col / (BOARD_SIZE - 1)) * 100}%`,
                        top: `${(point.row / (BOARD_SIZE - 1)) * 100}%`,
                        boxShadow: '0 0 20px rgba(148, 163, 184, 0.35)',
                      }}
                    />
                  ))}
                  <div
                    className="absolute inset-0 grid"
                    style={{
                      gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
                    }}
                  >
                    {board.map((row, rowIndex) =>
                      row.map((cell, colIndex) => {
                        const isLastMove = !!lastMove && lastMove.row === rowIndex && lastMove.col === colIndex;
                        const isHumanTurn = state.status === 'running' && playerModes[state.currentPlayer as 0 | 1] === 'human';
                        const disabled = cell !== null || !isHumanTurn;

                        return (
                          <button
                            key={`${rowIndex}-${colIndex}`}
                            type="button"
                            aria-label={`Place stone at ${formatCoordinate(rowIndex, colIndex)}`}
                            onClick={() => handleCellClick(rowIndex, colIndex)}
                            disabled={disabled}
                            className={`relative flex items-center justify-center transition-colors duration-150 ${
                              !disabled ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'
                            }`}
                          >
                            {cell !== null ? (
                              <span
                                className="pointer-events-none block h-6 w-6 rounded-full shadow-[0_10px_18px_rgba(0,0,0,0.45)] md:h-7 md:w-7"
                                style={{
                                  background: PLAYERS[cell].stoneFill,
                                  boxShadow: `${PLAYERS[cell].shadow}${
                                    isLastMove ? ', 0 0 0 4px rgba(255,255,255,0.25)' : ''
                                  }`,
                                }}
                              />
                            ) : (
                              <span className="pointer-events-none h-3 w-3 rounded-full bg-transparent" />
                            )}
                            {isLastMove ? (
                              <span className="pointer-events-none absolute inset-1 rounded-full border border-white/30" />
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

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#071020] px-5 py-4 text-sm text-slate-200 shadow-xl ring-1 ring-white/5">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-slate-400">合法落点</span>
              <span className="rounded-full bg-white/10 px-2 py-1 font-mono text-sm text-white">{legalMoves.length}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
              >
                重新开始
              </button>
              <button
                type="button"
                onClick={handleResign}
                disabled={state.status !== 'running'}
                className="rounded-full border border-rose-500/60 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                认输
              </button>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-3xl bg-[#071020] p-6 shadow-2xl ring-1 ring-white/5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">对局信息</h3>
            <dl className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">当前回合</dt>
                <dd className="font-medium text-white">{state.turn}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">轮到</dt>
                <dd className="font-medium text-white">
                  {state.status === 'running' ? PLAYERS[state.currentPlayer as 0 | 1].name : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">状态</dt>
                <dd className="font-medium text-white">{matchStatus}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">AI 模式</dt>
                <dd className="font-medium text-white">
                  {playerModes.map((mode, index) => `${PLAYERS[index].name}: ${MODE_LABEL[mode]}`).join(' | ')}
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex-1 rounded-3xl bg-[#071020] p-6 shadow-2xl ring-1 ring-white/5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">落子记录</h3>
            <div className="mt-4 max-h-80 overflow-auto pr-2">
              {moveLog.length === 0 ? (
                <p className="text-sm text-slate-400">尚未开始，请点击棋盘或等待 AI 落子。</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {moveLog.map((entry, index) => {
                    const player = PLAYERS[entry.player];
                    const badgeColor =
                      entry.player === 0 ? 'bg-rose-500/20 text-rose-200' : 'bg-emerald-500/20 text-emerald-200';
                    const label = entry.origin === 'resign' ? '认输' : entry.coordinate;
                    const originLabel = entry.origin === 'ai' ? 'AI' : entry.origin === 'human' ? '人类' : '系统';

                    return (
                      <li key={`${entry.turn}-${index}`} className="flex items-center justify-between rounded-2xl bg-white/5 px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}>{player.name}</span>
                          <span className="text-xs uppercase tracking-wide text-slate-400">T{String(entry.turn).padStart(2, '0')}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-300">
                          <span className="font-mono text-sm text-white">{label}</span>
                          <span className="rounded-full bg-white/10 px-2 py-0.5">{originLabel}</span>
                        </div>
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
