'use client';

import { useMemo, useState } from 'react';
import type { GobangAction, GobangState } from './game';
import { gobangEngine } from './game';

const BOARD_SIZE = (gobangEngine.initialState().data.board.length ?? 15) as number;

type CellDisplay = {
  label: string;
  className: string;
};

function renderCell(player: 0 | 1 | null): CellDisplay {
  if (player === 0) {
    return { label: '●', className: 'text-black' };
  }
  if (player === 1) {
    return { label: '○', className: 'text-slate-500' };
  }
  return { label: '', className: 'text-transparent' };
}

function formatCoordinate(row: number, col: number): string {
  const letter = String.fromCharCode('A'.charCodeAt(0) + col);
  return `${letter}${row + 1}`;
}

export default function GobangRenderer() {
  const [state, setState] = useState<GobangState>(() => gobangEngine.initialState());
  const { board, lastMove, winner } = state.data;

  const legalMoves = useMemo(() => gobangEngine.legalActions(state), [state]);

  const statusText = winner !== null
    ? `Player ${winner + 1} wins!`
    : state.status === 'finished'
    ? 'Draw — no more available moves.'
    : `Player ${state.currentPlayer + 1}'s turn`;

  const handleCellClick = (row: number, col: number) => {
    if (state.status === 'finished') return;
    if (board[row][col] !== null) return;

    const action: GobangAction = { row, col };
    const next = gobangEngine.nextState(state, action);
    setState(next);
  };

  const handleReset = () => {
    setState(gobangEngine.initialState());
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Gomoku (五子棋)</h2>
          <p className="text-sm text-slate-600">
            Place five stones in a row. Click the grid to alternate moves between Player 1 (●) and Player 2 (○).
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-700">
          <span className="font-medium">Status:</span>
          <span>{statusText}</span>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
          >
            Reset game
          </button>
        </div>
      </div>

      <div className="overflow-auto">
        <div className="inline-grid border border-slate-300 bg-[#f4f1de]" style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 2.5rem))` }}>
          {board.map((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const { label, className } = renderCell(cell);
              const isLastMove = lastMove && lastMove.row === rowIndex && lastMove.col === colIndex;

              return (
                <button
                  key={`${rowIndex}-${colIndex}`}
                  type="button"
                  className={`relative flex h-10 w-10 items-center justify-center border border-slate-300/80 text-xl ${
                    isLastMove ? 'bg-amber-200' : 'bg-transparent hover:bg-amber-100'
                  } ${className}`}
                  onClick={() => handleCellClick(rowIndex, colIndex)}
                >
                  {label}
                  <span className="pointer-events-none absolute inset-0 flex items-start justify-start p-1 text-[10px] text-slate-400">
                    {formatCoordinate(rowIndex, colIndex)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <h3 className="mb-2 font-semibold text-slate-900">Engine debug</h3>
        <p>
          Legal moves remaining: <span className="font-mono">{legalMoves.length}</span>
        </p>
        {lastMove ? (
          <p>
            Last move: Player {lastMove.player + 1} → {formatCoordinate(lastMove.row, lastMove.col)}
          </p>
        ) : (
          <p>No moves played yet.</p>
        )}
      </div>
    </div>
  );
}
