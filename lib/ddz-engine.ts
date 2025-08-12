import { Card, Combo, sortByRank } from './ddz-types';
export function makeDeck(): Card[] {
  const suits = ['♣','♦','♥','♠'] as const;
  const ranks = [3,4,5,6,7,8,9,10,11,12,13,14,15] as const;
  const deck: Card[] = [];
  for (const r of ranks) for (const s of suits) deck.push({ id: `${r<=10?r:(r===11?'J':r===12?'Q':r===13?'K':r===14?'A':'2')}${s}`, rank: r as any, suit: s });
  deck.push({ id:'SJ', rank:16 as any, suit:'🃏' });
  deck.push({ id:'BJ', rank:17 as any, suit:'🃏' });
  return deck;
}
export function shuffle<T>(arr:T[], rng=Math.random): T[] { const a=[...arr]; for (let i=a.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
export function deal(deck: Card[]): [Card[],Card[],Card[],Card[]] {
  const a=[...deck]; const p0:Card[]=[]; const p1:Card[]=[]; const p2:Card[]=[]; const bottom:Card[]=[];
  for (let i=0;i<51;i++){ const t=a[i]; (i%3===0?p0:i%3===1?p1:p2).push(t); }
  bottom.push(a[51],a[52],a[53]); return [sortByRank(p0), sortByRank(p1), sortByRank(p2), bottom];
}
function counts(cards: Card[]): Map<number,number> { const m=new Map<number,number>(); for (const c of cards) m.set(c.rank,(m.get(c.rank)||0)+1); return m; }
function isRocket(cards: Card[]): Combo|null { return cards.length===2 && cards.every(c=>c.rank>=16)? { type:'rocket', main:17 as any, cards }: null; }
function isBomb(cards: Card[]): Combo|null { if (cards.length===4){ const m=counts(cards); return [...m.values()][0]===4? { type:'bomb', main:cards[0].rank as any, cards }: null } return null; }
function isSingle(cards: Card[]): Combo|null { return cards.length===1? { type:'single', main:cards[0].rank as any, cards }: null }
function isPair(cards: Card[]): Combo|null { return cards.length===2 && cards[0].rank===cards[1].rank? { type:'pair', main:cards[0].rank as any, cards }: null }
function isTriple(cards: Card[]): Combo|null { return cards.length===3 && cards.every(c=>c.rank===cards[0].rank)? { type:'triple', main:cards[0].rank as any, cards }: null }
function isStraight(cards: Card[]): Combo|null { const r=sortByRank(cards).map(c=>c.rank); if (r.length<5) return null; if (r.some(x=>x>=15)) return null; for (let i=1;i<r.length;i++) if (r[i]!==r[i-1]+1) return null; return { type:'straight', main:r[0] as any, cards }; }
function isPairs(cards: Card[]): Combo|null {
  if (cards.length%2!==0) return null; const sorted=sortByRank(cards); const r=sorted.map(c=>c.rank); if (r.some(x=>x>=15)) return null;
  for (let i=0;i<r.length;i+=2){ if (r[i]!==r[i+1]) return null; if (i>0 && r[i]!==r[i-2]+1) return null; } if (r.length<6) return null; return { type:'pairs', main:r[0] as any, cards };
}
export function detectCombo(cards: Card[]): Combo|null {
  if (cards.length===0) return { type:'pass', main:3 as any, cards:[] };
  return isRocket(cards) || isBomb(cards) || isSingle(cards) || isPair(cards) || isTriple(cards) || isPairs(cards) || isStraight(cards);
}
export function canBeat(a: Combo, b: Combo|null): boolean {
  if (!b) return a.type!=='pass'; if (a.type==='pass') return false; if (a.type==='rocket') return true; if (b.type==='rocket') return false;
  if (a.type==='bomb' && b.type!=='bomb') return true; if (a.type===b.type && a.cards.length===b.cards.length) return a.main>b.main; return false;
}
export function removeCards(from: Card[], take: Card[]): Card[] { const f=[...from]; for (const t of take){ const i=f.findIndex(x=>x.id===t.id); if (i>=0) f.splice(i,1);} return f; }
