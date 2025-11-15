import type { GameEngine, GameState } from '../../core/types';
import type { Combo, Four2Policy, Label } from '../../lib/doudizhu/engine';
import { classify, evalRobScore, generateMoves } from '../../lib/doudizhu/engine';
import config from './config.json';

const FOUR2_POLICY: Four2Policy = 'both';

export type DdzAction =
  | { type: 'pass' }
  | { type: 'play'; cards: Label[] };

export type DdzHistoryEvent =
  | { seat: number; type: 'pass' }
  | { seat: number; type: 'play'; cards: Label[]; combo: Combo };

export interface DdzStateData {
  hands: Label[][];
  bottom: Label[];
  landlord: number;
  require: Combo | null;
  lastPlay: { seat: number; cards: Label[]; combo: Combo } | null;
  passesInRow: number;
  history: DdzHistoryEvent[];
  winner: number | null;
}

export type DdzState = GameState<DdzStateData>;

const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2', 'x', 'X'] as const;
const ORDER_MAP = new Map<string, number>(RANKS.map((r, idx) => [r, idx]));

function cloneCombo(combo: Combo): Combo {
  return {
    ...combo,
    cards: combo.cards ? combo.cards.slice() : undefined,
    rankOrder: combo.rankOrder ? combo.rankOrder.slice() : undefined,
    rankOrderLabel: combo.rankOrderLabel ? combo.rankOrderLabel.slice() : undefined,
  };
}

function createDeck(): Label[] {
  const deck: Label[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (rank === 'x' || rank === 'X') continue;
      deck.push(`${suit}${rank}` as Label);
    }
  }
  deck.push('x' as Label, 'X' as Label);
  return deck;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sortHand(hand: Label[]): Label[] {
  return hand.slice().sort((a, b) => rankValue(a) - rankValue(b));
}

function rankValue(label: Label): number {
  const rank = label === 'x' || label === 'X' ? label : label.slice(-1);
  return ORDER_MAP.get(rank) ?? -1;
}

function cloneStateData(data: DdzStateData): DdzStateData {
  return {
    hands: data.hands.map((hand) => hand.slice()),
    bottom: data.bottom.slice(),
    landlord: data.landlord,
    require: data.require ? cloneCombo(data.require) : null,
    lastPlay: data.lastPlay
      ? {
          seat: data.lastPlay.seat,
          cards: data.lastPlay.cards.slice(),
          combo: cloneCombo(data.lastPlay.combo),
        }
      : null,
    passesInRow: data.passesInRow,
    history: data.history.map((entry) =>
      entry.type === 'pass'
        ? { seat: entry.seat, type: 'pass' }
        : { seat: entry.seat, type: 'play', cards: entry.cards.slice(), combo: cloneCombo(entry.combo) }
    ),
    winner: data.winner,
  };
}

function removeCards(hand: Label[], cards: Label[]): Label[] {
  const next = hand.slice();
  for (const card of cards) {
    const idx = next.indexOf(card);
    if (idx === -1) {
      throw new Error(`Card ${card} not found in hand.`);
    }
    next.splice(idx, 1);
  }
  return next;
}

function lowestSingle(hand: Label[]): Label | null {
  if (hand.length === 0) return null;
  const sorted = sortHand(hand);
  return sorted[0] ?? null;
}

function pickLandlord(hands: Label[][]): number {
  let bestSeat = 0;
  let bestScore = -Infinity;
  hands.forEach((hand, seat) => {
    const score = evalRobScore(hand);
    if (score > bestScore) {
      bestScore = score;
      bestSeat = seat;
    }
  });
  return bestSeat;
}

function formatHistory(history: DdzHistoryEvent[]): string {
  if (!history.length) return 'none';
  return history
    .map((event) =>
      event.type === 'pass'
        ? `seat${event.seat}:pass`
        : `seat${event.seat}:${event.cards.join(' ')}`
    )
    .join('\n');
}

export const ddzEngine: GameEngine<DdzState, DdzAction> = {
  name: config.id,
  maxPlayers: config.maxPlayers,
  initialState(seed) {
    const rng = typeof seed === 'number' ? mulberry32(seed) : () => Math.random();
    const deck = shuffle(createDeck(), rng);

    const hands: Label[][] = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)].map(sortHand);
    const bottom = deck.slice(51);

    const landlord = pickLandlord(hands);
    hands[landlord] = sortHand([...hands[landlord], ...bottom]);

    const data: DdzStateData = {
      hands,
      bottom,
      landlord,
      require: null,
      lastPlay: null,
      passesInRow: 0,
      history: [],
      winner: null,
    };

    return {
      currentPlayer: landlord,
      turn: 0,
      status: 'running',
      data,
    };
  },
  legalActions(state) {
    if (state.status === 'finished') return [];
    const { hands, require, lastPlay } = state.data;
    const hand = hands[state.currentPlayer] ?? [];
    const legalMoves = generateMoves(hand, require, FOUR2_POLICY);
    const actions: DdzAction[] = legalMoves.map((cards) => ({ type: 'play', cards: cards.slice() }));

    const canPass = require !== null && lastPlay?.seat !== state.currentPlayer;
    if (canPass) {
      actions.push({ type: 'pass' });
    }

    if (!actions.length) {
      const fallback = lowestSingle(hand);
      if (fallback) {
        actions.push({ type: 'play', cards: [fallback] as Label[] });
      }
    }

    return actions;
  },
  nextState(state, action) {
    if (state.status === 'finished') return state;

    const data = cloneStateData(state.data);
    const currentSeat = state.currentPlayer;
    let nextSeat = (currentSeat + 1) % ddzEngine.maxPlayers;
    let status: DdzState['status'] = 'running';

    if (action.type === 'pass') {
      data.history.push({ seat: currentSeat, type: 'pass' });
      if (data.require === null || data.lastPlay?.seat === currentSeat) {
        data.passesInRow = 0;
      } else {
        data.passesInRow += 1;
        if (data.passesInRow >= ddzEngine.maxPlayers - 1 && data.lastPlay) {
          nextSeat = data.lastPlay.seat;
          data.require = null;
          data.lastPlay = null;
          data.passesInRow = 0;
        }
      }
    } else {
      const combo = classify(action.cards, FOUR2_POLICY);
      if (!combo) {
        throw new Error('Invalid combo for Dou Dizhu action.');
      }

      data.hands[currentSeat] = removeCards(data.hands[currentSeat], action.cards);
      data.history.push({ seat: currentSeat, type: 'play', cards: action.cards.slice(), combo });
      data.require = combo;
      data.lastPlay = { seat: currentSeat, cards: action.cards.slice(), combo };
      data.passesInRow = 0;

      if (data.hands[currentSeat].length === 0) {
        data.winner = currentSeat;
        status = 'finished';
        nextSeat = currentSeat;
      }
    }

    return {
      currentPlayer: nextSeat,
      turn: state.turn + 1,
      status,
      data,
    };
  },
  isTerminal(state) {
    return state.status === 'finished';
  },
  getWinner(state) {
    return state.data.winner;
  },
  encodeState(state, player) {
    const { hands, landlord, require, lastPlay, history } = state.data;
    const role = landlord === player ? 'landlord' : 'farmer';
    const hand = hands[player]?.join(' ') ?? '';
    const last = lastPlay ? `${lastPlay.seat}:${lastPlay.cards.join(' ')}` : 'none';
    const req = require ? `${require.type}:${require.len ?? ''}` : 'none';

    return [
      `game:${config.id}`,
      `role:${role}`,
      `player:${player}`,
      `landlord:${landlord}`,
      `hand:${hand}`,
      `require:${req}`,
      `last:${last}`,
      'history:',
      formatHistory(history),
    ].join('\n');
  },
};

export type DdzEngine = typeof ddzEngine;
