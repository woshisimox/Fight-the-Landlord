import { Card, Rank } from './types';

const RANK_LABELS: Record<Rank, string> = {
  3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'SJ',17:'BJ'
};

export function makeDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let r=3 as Rank; r<=15; r = (r+1) as Rank) {
    for (let i=0;i<4;i++) {
      cards.push({ id: id++, rank: r as Rank, label: RANK_LABELS[r as Rank] });
    }
  }
  cards.push({ id: id++, rank: 16, label: 'SJ' });
  cards.push({ id: id++, rank: 17, label: 'BJ' });
  return cards;
}

export function rankLabel(r: Rank): string {
  return RANK_LABELS[r];
}
