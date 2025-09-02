import { IBot } from "./bots/types";

export interface GameState {
  players: Record<string, string[]>;
  landlord: string;
  currentPlayer: string;
  history: Record<string, string[][]>;
}

export function initGame(): GameState {
  const deck = genDeck();
  shuffle(deck);
  const players = {
    A: deck.slice(0, 17),
    B: deck.slice(17, 34),
    C: deck.slice(34, 51),
  };
  const bottom = deck.slice(51);
  players.A.push(...bottom); // 简化: A为地主
  return {
    players,
    landlord: "A",
    currentPlayer: "A",
    history: { A: [], B: [], C: [] },
  };
}

export async function step(
  state: GameState,
  bots: Record<string, IBot>
): Promise<GameState> {
  const player = state.currentPlayer;
  const bot = bots[player];
  const lastPlay = getLastPlay(state);
  const move = await bot.play(state.players[player], lastPlay, state.history);
  state.players[player] = state.players[player].filter((c) => !move.includes(c));
  state.history[player].push(move);
  const order = ["A", "B", "C"];
  const next = order[(order.indexOf(player) + 1) % 3];
  state.currentPlayer = next;
  return state;
}

function genDeck(): string[] {
  const ranks = ["3","4","5","6","7","8","9","T","J","Q","K","A","2"];
  const suits = ["H","D","S","C"];
  const deck: string[] = [];
  for (let r of ranks) for (let s of suits) deck.push(r + s);
  deck.push("SJ","BJ");
  return deck;
}

function shuffle<T>(a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function getLastPlay(state: GameState): string[] | null {
  const plays = [...state.history.A, ...state.history.B, ...state.history.C].flat();
  return plays.length > 0 ? plays[plays.length - 1] : null;
}
