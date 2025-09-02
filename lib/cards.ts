import { Card, RankLabel, RANK_VALUE, Suit } from './types';

const SUITS: Suit[] = ['S','H','D','C'];

export function makeDeck(): Card[] {
  const cards: Card[] = [];
  const labels: RankLabel[] = ['3','4','5','6','7','8','9','T','J','Q','K','A','2'];
  let uid = 0;
  for (const label of labels) {
    for (const s of SUITS) {
      cards.push({ id: `c${uid++}`, suit: s, label, rank: RANK_VALUE[label] });
    }
  }
  // Jokers (no suit or suit 'J')
  cards.push({ id:`c${uid++}`, suit:'J', label:'SJ', rank: RANK_VALUE['SJ'] });
  cards.push({ id:`c${uid++}`, suit:'J', label:'BJ', rank: RANK_VALUE['BJ'] });
  return cards;
}

export function handLabels(hand: Card[]): string[] {
  return hand.map(c=>c.label);
}
