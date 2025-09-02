import type { Card, Combo } from './types';
import { rankValue } from './cards';

export function isRocket(cards: Card[]): boolean {
  if (cards.length!==2) return false;
  const r = cards.map(c=>c.rank).sort().join(',');
  return r==='BJ,SJ' || r==='SJ,BJ';
}

export function isBomb(cards: Card[]): boolean {
  if (cards.length!==4) return false;
  const v = cards[0].value;
  return cards.every(c=>c.value===v) && cards.map(c=>c.rank).every(r=>r!=='SJ' && r!=='BJ');
}

export function isTriple(cards: Card[]): boolean {
  return cards.length===3 && cards.every(c=>c.value===cards[0].value) && cards[0].rank!=='SJ' && cards[0].rank!=='BJ';
}

export function isPair(cards: Card[]): boolean {
  return cards.length===2 && cards[0].value===cards[1].value && cards[0].rank!=='SJ' && cards[0].rank!=='BJ';
}

export function isSingle(cards: Card[]): boolean {
  return cards.length===1;
}

export function toCombo(cards: Card[]): Combo | null {
  if (isRocket(cards)) return { type:'rocket', mainRank: rankValue['BJ'], length:1, cards };
  if (isBomb(cards)) return { type:'bomb', mainRank: cards[0].value, length:1, cards };
  if (isTriple(cards)) return { type:'triple', mainRank: cards[0].value, length:1, cards };
  if (isPair(cards))   return { type:'pair', mainRank: cards[0].value, length:1, cards };
  if (isSingle(cards)) return { type:'single', mainRank: cards[0].value, length:1, cards };
  return null;
}

export function enumerateAllCombos(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  // singles
  for (const c of hand) res.push({ type:'single', mainRank:c.value, length:1, cards:[c] });
  // pairs/triples/bombs by rank ignoring suit
  const byRank = new Map<number, Card[]>();
  for (const c of hand) {
    const arr = byRank.get(c.value) || [];
    arr.push(c); byRank.set(c.value, arr);
  }
  for (const [v, cs] of byRank) {
    if (cs.length>=2 && v<rankValue['SJ']) {
      // enumerate all choose-2 pairs
      for (let i=0;i<cs.length;i++) for (let j=i+1;j<cs.length;j++) {
        res.push({ type:'pair', mainRank:v, length:1, cards:[cs[i], cs[j]] });
      }
    }
    if (cs.length>=3 && v<rankValue['SJ']) {
      // choose any 3
      for (let i=0;i<cs.length;i++) for (let j=i+1;j<cs.length;j++) for (let k=j+1;k<cs.length;k++) {
        res.push({ type:'triple', mainRank:v, length:1, cards:[cs[i], cs[j], cs[k]] });
      }
    }
    if (cs.length===4 && v<rankValue['SJ']) {
      res.push({ type:'bomb', mainRank:v, length:1, cards: cs });
    }
  }
  // rocket
  const hasSJ = hand.find(c=>c.rank==='SJ'); const hasBJ = hand.find(c=>c.rank==='BJ');
  if (hasSJ && hasBJ) res.push({ type:'rocket', mainRank: rankValue['BJ'], length:1, cards:[hasSJ, hasBJ] });
  return res;
}

export function compareCombos(a: Combo, b: Combo): number {
  if (a.type===b.type) {
    if (a.mainRank===b.mainRank) return 0;
    return a.mainRank>b.mainRank? +1 : -1;
  }
  if (a.type==='rocket') return +1;
  if (b.type==='rocket') return -1;
  if (a.type==='bomb' && b.type!=='bomb') return +1;
  if (b.type==='bomb' && a.type!=='bomb') return -1;
  return -1;
}

export function enumerateResponses(hand: Card[], require: Combo): Combo[] {
  const all = enumerateAllCombos(hand);
  const ok = all.filter(c=>{
    if (require.type==='rocket') return false;
    if (c.type==='rocket') return true;
    if (c.type==='bomb' && require.type!=='bomb') return true;
    if (c.type!==require.type) return false;
    return c.mainRank>require.mainRank;
  });
  return ok.sort((a,b)=> a.mainRank - b.mainRank || (a.type==='bomb'? +1 : 0) - (b.type==='bomb'? +1 : 0));
}
