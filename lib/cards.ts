import { Card, Suit } from './types';
const SUITS: Suit[] = ['♠','♥','♦','♣'];
export function rankLabel(rank: number): string {
  if (rank===11) return 'J'; if (rank===12) return 'Q'; if (rank===13) return 'K';
  if (rank===14) return 'A'; if (rank===15) return '2'; if (rank===16) return 'SJ';
  if (rank===17) return 'BJ'; return String(rank);
}
export function makeCard(rank: number, suit: Suit): Card {
  if (rank>=16) { return { rank, suit: 'JOKER', label: rank===16 ? 'SJ' : 'BJ', isJoker: true }; }
  return { rank, suit, label: `${suit}${rankLabel(rank)}` };
}
export function generateDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (let r=3; r<=15; r++) deck.push(makeCard(r, s));
  deck.push(makeCard(16, 'JOKER')); deck.push(makeCard(17, 'JOKER')); return deck;
}
function shuffle<T>(arr: T[]): T[] { const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
export function deal3() { const deck = shuffle(generateDeck()); const hands: [Card[],Card[],Card[]] = [[],[],[]];
  for (let i=0;i<51;i++) hands[i%3].push(deck[i]); const bottom = deck.slice(51); return { hands, bottom }; }
export function suitOrder(s: Suit): number { if (s==='♠') return 4; if (s==='♥') return 3; if (s==='♦') return 2; if (s==='♣') return 1; return 0; }
export function sortHand(hand: Card[]): Card[] { return hand.slice().sort((a,b)=> a.rank!==b.rank ? a.rank-b.rank : (suitOrder(a.suit)-suitOrder(b.suit)) ); }
export function labels(cards: Card[]): string[] { return cards.map(c=>c.label); }