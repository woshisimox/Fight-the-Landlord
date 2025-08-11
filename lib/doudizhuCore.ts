
export type Rank = '3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A'|'2'|'BJ'|'RJ';
export type ComboType = 'single'|'pair'|'triple'|'bomb';
export type Combo = { type: ComboType, cards: string[], rankValue: number };

const rankOrder: Rank[] = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','BJ','RJ'];
export const rankValue = (r: string) => rankOrder.indexOf(r as Rank);

export function countByRank(cards: string[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of cards) m[c] = (m[c]||0)+1;
  return m;
}

export function sortHand(hand: string[]): string[] {
  return [...hand].sort((a,b)=>rankValue(a)-rankValue(b));
}

export function parseCards(input: string): string[] {
  return input.trim().split(/\s+/).map(s=>s.toUpperCase());
}

export function genCombos(hand: string[]): Combo[] {
  const m = countByRank(hand);
  const combos: Combo[] = [];
  for (const [r, n] of Object.entries(m)) {
    if (n>=1) combos.push({ type:'single', cards:[r], rankValue: rankValue(r)});
    if (n>=2) combos.push({ type:'pair', cards:[r,r], rankValue: rankValue(r)});
    if (n>=3) combos.push({ type:'triple', cards:[r,r,r], rankValue: rankValue(r)});
    if (n===4) combos.push({ type:'bomb', cards:[r,r,r,r], rankValue: rankValue(r)});
  }
  // optional: BJ+RJ as "rocket" bomb
  if (m['BJ']===1 && m['RJ']===1) {
    combos.push({ type:'bomb', cards:['BJ','RJ'], rankValue: rankValue('RJ') });
  }
  // sort by strength
  combos.sort((a,b)=> a.type===b.type ? a.rankValue-b.rankValue : typeOrder(a.type)-typeOrder(b.type));
  return combos;
}

function typeOrder(t: ComboType): number {
  return ({single:0, pair:1, triple:2, bomb:3} as any)[t];
}

export type LastPlay = { type: ComboType, count: number, rankValue: number, isBomb?: boolean } | null;

export function canBeat(candidate: Combo, last: LastPlay): boolean {
  if (!last) return true;
  // Bomb beats any non-bomb
  if (candidate.type==='bomb' && last.type!=='bomb') return true;
  if (candidate.type!==last.type) return false;
  if (candidate.cards.length !== last.count) return false;
  return candidate.rankValue > last.rankValue;
}

export function removeCards(hand: string[], cards: string[]): string[] {
  const h = [...hand];
  for (const c of cards) {
    const idx = h.indexOf(c);
    if (idx===-1) throw new Error('Card not in hand: '+c);
    h.splice(idx,1);
  }
  return h;
}
