import type { Card, Rank, Suit } from './types';

const suitOrder: Suit[] = ['♠','♥','♣','♦'];
const rankOrder: Rank[] = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','SJ','BJ'];
const rankValue: Record<Rank, number> = Object.fromEntries(rankOrder.map((r,i)=>[r, i+3])) as any;

export function makeDeck(): Card[] {
  const cards: Card[] = [];
  const ranks: Rank[] = ['3','4','5','6','7','8','9','T','J','Q','K','A','2'];
  const suits: Suit[] = ['♠','♥','♣','♦'];
  for (const r of ranks) {
    for (const s of suits) {
      cards.push({ suit:s, rank:r, face:`${s}${r}`, label:r, value:rankValue[r] });
    }
  }
  // Jokers
  cards.push({ suit:null, rank:'SJ', face:'SJ', label:'SJ', value:rankValue['SJ'] });
  cards.push({ suit:null, rank:'BJ', face:'BJ', label:'BJ', value:rankValue['BJ'] });
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i=arr.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

export function deal3(): { hands: [Card[],Card[],Card[]], bottom: Card[] } {
  const deck = shuffle(makeDeck());
  const hands: [Card[],Card[],Card[]] = [[],[],[]] as any;
  for (let i=0;i<51;i++) hands[i%3].push(deck[i]);
  const bottom = deck.slice(51);
  return { hands, bottom };
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a,b)=>{
    if (a.value!==b.value) return b.value - a.value; // high to low by rank
    const ai = a.suit? suitOrder.indexOf(a.suit): 4;
    const bi = b.suit? suitOrder.indexOf(b.suit): 4;
    return ai - bi; // suit order
  });
}

export { rankValue };
