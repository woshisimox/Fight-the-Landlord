import { Card, Combo, ComboType } from './types';

function groupByRank(cards: Card[]): Map<number, Card[]> {
  const m = new Map<number, Card[]>();
  for (const c of cards) {
    const a = m.get(c.rank) || [];
    a.push(c);
    m.set(c.rank, a);
  }
  return m;
}

export function enumerateAllCombos(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const byRank = groupByRank(hand);

  // singles
  for (const [rank, arr] of byRank) {
    for (const c of arr) res.push({ type:'single', length:1, mainRank:rank, cards:[c] });
  }
  // pairs
  for (const [rank, arr] of byRank) {
    if (arr.length >= 2) {
      for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) {
        res.push({ type:'pair', length:1, mainRank:rank, cards:[arr[i],arr[j]] });
      }
    }
  }
  // triples
  for (const [rank, arr] of byRank) {
    if (arr.length >= 3) {
      for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) for (let k=j+1;k<arr.length;k++) {
        res.push({ type:'triple', length:1, mainRank:rank, cards:[arr[i],arr[j],arr[k]] });
      }
    }
  }
  // bombs (four of a kind)
  for (const [rank, arr] of byRank) {
    if (arr.length === 4) {
      res.push({ type:'bomb', length:1, mainRank:rank, cards:[...arr] });
    }
  }
  // king-bomb
  const sj = hand.find(c=>c.label==='SJ');
  const bj = hand.find(c=>c.label==='BJ');
  if (sj && bj) {
    res.push({ type:'king-bomb', length:1, mainRank:Infinity, cards:[sj,bj] });
  }
  return res;
}

function beats(a: Combo, b: Combo): boolean {
  if (a.type === 'king-bomb') return true;
  if (b.type === 'king-bomb') return false;
  if (a.type === 'bomb' && b.type !== 'bomb') return true;
  if (a.type !== b.type || a.length !== b.length) return false;
  return a.mainRank > b.mainRank;
}

export function enumerateResponses(hand: Card[], require: Combo): Combo[] {
  const all = enumerateAllCombos(hand);
  return all.filter(c => beats(c, require));
}
