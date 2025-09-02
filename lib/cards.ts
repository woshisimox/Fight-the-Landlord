// lib/cards.ts
import type { Card, Suit, Rank } from './types';

const SUITS: Suit[] = ['♠','♥','♣','♦'];
const SUIT_ORDER: Record<string, number> = { '♠':3,'♥':2,'♣':1,'♦':0, '🃏':-1 };

const FACE_OF: Record<number, string> = {
  3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',
  11:'J',12:'Q',13:'K',14:'A',15:'2',16:'SJ',17:'BJ'
};

let uid = 0;
function mkId(label: string): string {
  uid += 1;
  return `${label}#${uid}`;
}

export function newDeck(): Card[] {
  const deck: Card[] = [];
  // 3..2 (i.e., 3 to 15), four suits each
  for (let r = 3 as Rank; r <= 15; r = (r + 1) as Rank) {
    const face = FACE_OF[r];
    for (const s of SUITS) {
      const label = `${s}${face}`;
      deck.push({ id: mkId(label), suit: s, label, rank: r as Rank });
    }
  }
  // Jokers
  deck.push({ id: mkId('SJ'), suit: '🃏', label: 'SJ', rank: 16 });
  deck.push({ id: mkId('BJ'), suit: '🃏', label: 'BJ', rank: 17 });
  return deck;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sort: rank desc, then suit desc (♠ > ♥ > ♣ > ♦), jokers last by suit order map
export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    return SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit];
  });
}

export function deal3() {
  const deck = shuffle(newDeck());
  const hands: [Card[],Card[],Card[]] = [[],[],[]];
  for (let i=0;i<51;i++) hands[i%3].push(deck[i]);
  const bottom = deck.slice(51);
  hands[0] = sortHand(hands[0]);
  hands[1] = sortHand(hands[1]);
  hands[2] = sortHand(hands[2]);
  return { hands, bottom };
}
