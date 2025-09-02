import type { Card, Combo } from './types';

export function detectCombo(cards: Card[]): Combo | null {
  if (!cards || cards.length===0) return { type:'pass', cards: [] } as any;
  if (cards.length===1) return { type:'single', cards, length:1, mainRank: cards[0].rank };
  if (cards.length===2 && cards[0].rank===cards[1].rank) return { type:'pair', cards, length:1, mainRank: cards[0].rank };
  return null;
}

export function enumerateAllCombos(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  for (const c of hand) res.push({ type:'single', cards:[c], length:1, mainRank:c.rank });
  const bucket = new Map<number,Card[]>();
  for (const c of hand) bucket.set(c.rank, [...(bucket.get(c.rank)||[]), c]);
  for (const [rank, arr] of bucket) if (arr.length>=2)
    res.push({ type:'pair', cards: arr.slice(0,2), length:1, mainRank:rank });
  // 简化版：只实现单张/对子，便于演示与调试
  res.sort((a,b)=> (a.type===b.type?0: a.type==='single'? -1 : 1) || (a.mainRank! - b.mainRank!));
  return res;
}

export function enumerateResponses(hand: Card[], require: Combo): Combo[] {
  if (!require || require.type==='pass') return enumerateAllCombos(hand);
  const all = enumerateAllCombos(hand);
  return all.filter(c => c.type===require.type && (c.mainRank??0) > (require.mainRank??0));
}
