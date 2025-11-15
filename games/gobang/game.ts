import type { GameEngine, GameState } from '../../core/types';
import config from './config.json';

type GobangPlayer = 0 | 1;
export type GobangCell = GobangPlayer | null;

export interface GobangStateData {
  board: GobangCell[][];
  lastMove: { row: number; col: number; player: GobangPlayer } | null;
  winner: GobangPlayer | null;
}

export type GobangState = GameState<GobangStateData>;

export interface GobangAction {
  row: number;
  col: number;
}

const BOARD_SIZE = config.boardSize ?? 15;
const WIN_LENGTH = 5;

function createEmptyBoard(size: number): GobangCell[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function cloneBoard(board: GobangCell[][]): GobangCell[][] {
  return board.map((row) => row.slice());
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function countDirection(board: GobangCell[][], row: number, col: number, dr: number, dc: number, player: GobangPlayer): number {
  let r = row + dr;
  let c = col + dc;
  let count = 0;

  while (inBounds(r, c) && board[r][c] === player) {
    count += 1;
    r += dr;
    c += dc;
  }

  return count;
}

function isWinningMove(board: GobangCell[][], row: number, col: number, player: GobangPlayer): boolean {
  const directions: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  return directions.some(([dr, dc]) => {
    const forward = countDirection(board, row, col, dr, dc, player);
    const backward = countDirection(board, row, col, -dr, -dc, player);
    return forward + backward + 1 >= WIN_LENGTH;
  });
}

function isBoardFull(board: GobangCell[][]): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

function encodeBoard(board: GobangCell[][]): string[] {
  return board.map((row) =>
    row
      .map((cell) => {
        if (cell === 0) return 'B';
        if (cell === 1) return 'W';
        return '.';
      })
      .join('')
  );
}

export const gobangEngine: GameEngine<GobangState, GobangAction> = {
  name: config.id,
  maxPlayers: config.maxPlayers,
  initialState() {
    return {
      currentPlayer: 0,
      turn: 0,
      status: 'running',
      data: {
        board: createEmptyBoard(BOARD_SIZE),
        lastMove: null,
        winner: null,
      },
    };
  },
  legalActions(state) {
    if (state.status === 'finished') return [];

    const actions: GobangAction[] = [];
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        if (state.data.board[row][col] === null) {
          actions.push({ row, col });
        }
      }
    }
    return actions;
  },
  nextState(state, action) {
    if (state.status === 'finished') return state;

    const { row, col } = action;
    if (!inBounds(row, col)) {
      throw new Error('Move is out of bounds for Gobang.');
    }

    if (state.data.board[row][col] !== null) {
      throw new Error('Cell already occupied in Gobang.');
    }

    const board = cloneBoard(state.data.board);
    const player = state.currentPlayer as GobangPlayer;
    board[row][col] = player;

    const winner = isWinningMove(board, row, col, player) ? player : null;
    const draw = winner === null && isBoardFull(board);

    const status = winner !== null || draw ? 'finished' : 'running';
    const nextPlayer = status === 'finished' ? state.currentPlayer : (state.currentPlayer + 1) % gobangEngine.maxPlayers;

    return {
      currentPlayer: nextPlayer,
      turn: state.turn + 1,
      status,
      data: {
        board,
        lastMove: { row, col, player },
        winner,
      },
    };
  },
  isTerminal(state) {
    return state.status === 'finished';
  },
  getWinner(state) {
    return state.data.winner;
  },
  encodeState(state, player) {
    const { board, lastMove, winner } = state.data;
    const boardLines = encodeBoard(board);

    const last = lastMove ? `${lastMove.row},${lastMove.col},${lastMove.player}` : 'none';
    const winLine = winner !== null ? `winner:${winner}` : 'winner:none';

    return [
      `game:${config.id}`,
      `player:${player}`,
      `currentPlayer:${state.currentPlayer}`,
      winLine,
      `lastMove:${last}`,
      'board:',
      ...boardLines,
    ].join('\n');
  },
};

export type GobangEngine = typeof gobangEngine;
