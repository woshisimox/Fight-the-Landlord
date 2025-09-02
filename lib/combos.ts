import { Card, Combo } from './types';
export function isRocket(cards: Card[]): boolean {
  const ranks = cards.map(c=>c.rank).sort((a,b)=>a-b); return ranks.length===2 && ranks[0]===16 && ranks[1]===17;
}
export function isBomb(cards: Card[]): boolean { if (cards.length!==4) return false; const r = cards[0].rank; return cards.every(c=>c.rank===r); }
export function isPair(cards: Card[]): boolean { return cards.length===2 && cards[0].rank===cards[1].rank && cards[0].rank<=15; }
export function toCombo(cards: Card[]): Combo|null {
  if (isRocket(cards)) return { type:'rocket', length:1, mainRank:17, cards };
  if (isBomb(cards)) return { type:'bomb', length:1, mainRank:cards[0].rank, cards };
  if (isPair(cards)) return { type:'pair', length:1, mainRank:cards[0].rank, cards };
  if (cards.length===1) return { type:'single', length:1, mainRank:cards[0].rank, cards }; return null;
}
export function enumerateAllCombos(hand: Card[]): Combo[] {
  const out: Combo[] = [];
  for (const c of hand) out.push({ type:'single', length:1, mainRank:c.rank, cards:[c] });
  const byRank = new Map<number, Card[]>(); for (const c of hand){ if (c.rank>15) continue; if (!byRank.has(c.rank)) byRank.set(c.rank, []); byRank.get(c.rank)!.push(c); }
  for (const [r, arr] of byRank){ if (arr.length>=2){ for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) out.push({ type:'pair', length:1, mainRank:r, cards:[arr[i],arr[j]] }); }
    if (arr.length===4) out.push({ type:'bomb', length:1, mainRank:r, cards:arr.slice() }); }
  const sj = hand.find(c=>c.rank===16); const bj = hand.find(c=>c.rank===17); if (sj && bj) out.push({ type:'rocket', length:1, mainRank:17, cards:[sj,bj] });
  return out;
}
export function enumerateResponses(hand: Card[], require: Combo): Combo[] {
  const all = enumerateAllCombos(hand); return all.filter(c=>winsOver(c, require));
}
export function winsOver(a: Combo, b: Combo): boolean {
  if (a.type==='rocket') return true; if (b.type==='rocket') return false; if (a.type==='bomb' && b.type!=='bomb') return true; if (a.type!==b.type) return false; return a.mainRank>b.mainRank;
}