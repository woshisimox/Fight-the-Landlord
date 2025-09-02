// lib/combos.ts
import type { Card, Combo, Rank } from './types';

// Group by rank helper
function groupByRank(cards: Card[]): Map<Rank, Card[]> {
  const m = new Map<Rank, Card[]>();
  for (const c of cards) {
    const arr = m.get(c.rank);
    if (arr) arr.push(c);
    else m.set(c.rank, [c]);
  }
  return m;
}

function allSingles(hand: Card[]): Combo[] {
  return hand.map(c => ({ type:'single' as const, cards:[c], mainRank:c.rank, length:1 }));
}

function allPairs(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const g = groupByRank(hand);
  for (const [rank, arr] of g.entries()) {
    if (arr.length >= 2) {
      // list all combinations of 2 (distinct suits/ids)
      for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) {
        res.push({ type:'pair', cards:[arr[i], arr[j]], mainRank:rank, length:1 });
      }
    }
  }
  return res;
}

function allTriples(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const g = groupByRank(hand);
  for (const [rank, arr] of g.entries()) {
    if (arr.length >= 3) {
      // choose any 3 (we only need one canonical triple for now)
      for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) for (let k=j+1;k<arr.length;k++) {
        res.push({ type:'triple', cards:[arr[i],arr[j],arr[k]], mainRank:rank, length:1 });
      }
    }
  }
  return res;
}

function allBombs(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const g = groupByRank(hand);
  for (const [rank, arr] of g.entries()) {
    if (arr.length === 4) {
      res.push({ type:'bomb', cards:[...arr], mainRank:rank, length:1 });
    }
  }
  // Joker bomb (SJ + BJ)
  const hasSJ = hand.some(c => c.rank===16);
  const hasBJ = hand.some(c => c.rank===17);
  if (hasSJ && hasBJ) {
    const sj = hand.find(c=>c.rank===16)!;
    const bj = hand.find(c=>c.rank===17)!;
    res.push({ type:'joker-bomb', cards:[sj,bj], mainRank:17 as Rank, length:1 });
  }
  return res;
}

export function enumerateAllCombos(hand: Card[]): Combo[] {
  return [
    ...allSingles(hand),
    ...allPairs(hand),
    ...allTriples(hand),
    ...allBombs(hand),
  ];
}

// Enumerate responses that can beat the required combo.
// Basic DouDiZhu rule: any bomb can beat any non-bomb; joker-bomb beats everything.
export function enumerateResponses(hand: Card[], require: Combo): Combo[] {
  const bombs = allBombs(hand);
  if (!require) return enumerateAllCombos(hand);

  const res: Combo[] = [];
  if (require.type === 'single') {
    const singles = allSingles(hand).filter(c => c.mainRank > require.mainRank);
    res.push(...singles, ...bombs);
  } else if (require.type === 'pair') {
    const pairs = allPairs(hand).filter(c => c.mainRank > require.mainRank);
    res.push(...pairs, ...bombs);
  } else if (require.type === 'triple') {
    const triples = allTriples(hand).filter(c => c.mainRank > require.mainRank);
    res.push(...triples, ...bombs);
  } else if (require.type === 'bomb') {
    const onlyStrongerBombs = bombs.filter(c => (c.type === 'joker-bomb') || (c.type==='bomb' && c.mainRank > require.mainRank));
    res.push(...onlyStrongerBombs);
  } else if (require.type === 'joker-bomb') {
    // nothing can beat joker-bomb
  }
  return res;
}
