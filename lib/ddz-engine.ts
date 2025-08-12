import { Card, Combo } from './ddz-types';

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
function isTriple1(cards: Card[]): Combo|null { if (cards.length!==4) return null; const m=counts(cards); const t=[...m.entries()].find(([,v])=>v===3); const s=[...m.entries()].find(([,v])=>v===1); return t&&s? { type:'triple1', main:t[0] as any, cards }: null; }
function isTriple2(cards: Card[]): Combo|null { if (cards.length!==5) return null; const m=counts(cards); const t=[...m.entries()].find(([,v])=>v===3); const p=[...m.entries()].find(([,v])=>v===2); return t&&p? { type:'triple2', main:t[0] as any, cards }: null; }
function isStraight(cards: Card[]): Combo|null { const r=sortByRank(cards).map(c=>c.rank); if (r.length<5) return null; if (r.some(x=>x>=15)) return null; for (let i=1;i<r.length;i++) if (r[i]!==r[i-1]+1) return null; return { type:'straight', main:r[0] as any, cards }; }
function isPairs(cards: Card[]): Combo|null {
  if (cards.length%2!==0) return null; const sorted=sortByRank(cards); const r=sorted.map(c=>c.rank); if (r.some(x=>x>=15)) return null;
  for (let i=0;i<r.length;i+=2){ if (r[i]!==r[i+1]) return null; if (i>0 && r[i]!==r[i-2]+1) return null; } if (r.length<6) return null; return { type:'pairs', main:r[0] as any, cards };
}
function isAir(cards: Card[]): Combo|null {
  if (cards.length%3!==0) return null; const m=counts(cards); const triples=[...m.entries()].filter(([,v])=>v===3).map(([k])=>k).sort((a,b)=>a-b);
  if (triples.length<2) return null; if (triples.some(x=>x>=15)) return null; for (let i=1;i<triples.length;i++) if (triples[i]!==triples[i-1]+1) return null;
  if (triples.length*3!==cards.length) return null; return { type:'air', main:triples[0] as any, cards };
}
function isAirWings(cards: Card[]): Combo|null {
  const n=cards.length; if (n<8) return null; const m=counts(cards); const triples=[...m.entries()].filter(([,v])=>v===3).map(([k])=>k).sort((a,b)=>a-b);
  if (triples.length<2) return null; if (triples.some(x=>x>=15)) return null; for (let i=1;i<triples.length;i++) if (triples[i]!==triples[i-1]+1) return null;
  const tripleCount=triples.length; const singles=[...m.values()].filter(v=>v===1).length; const pairs=[...m.values()].filter(v=>v===2).length;
  if (singles===tripleCount) return { type:'airWings', main:triples[0] as any, cards };
  if (pairs===tripleCount && (n-tripleCount*3)===pairs*2) return { type:'airWings', main:triples[0] as any, cards };
  return null;
}

export function detectCombo(cards: Card[]): Combo|null {
  if (cards.length===0) return { type:'pass', main:3 as any, cards:[] };
  return isRocket(cards) || isBomb(cards) || isSingle(cards) || isPair(cards) || isTriple(cards) ||
         isTriple1(cards) || isTriple2(cards) || isAir(cards) || isAirWings(cards) || isPairs(cards) || isStraight(cards);
}

export function canBeat(a: Combo, b: Combo|null): boolean {
  if (!b) return a.type!=='pass'; if (a.type==='pass') return false; if (a.type==='rocket') return true; if (b.type==='rocket') return false;
  if (a.type==='bomb' && b.type!=='bomb') return true; if (a.type===b.type && a.cards.length===b.cards.length) return a.main>b.main; return false;
}

export function removeCards(from: Card[], take: Card[]): Card[] { const f=[...from]; for (const t of take){ const i=f.findIndex(x=>x.id===t.id); if (i>=0) f.splice(i,1);} return f; }

export function allLegalResponses(hand: Card[], last: Combo | null): Combo[] {
  const res: Combo[] = [];
  const n = hand.length;

  // singles / pairs / triples
  for (let i = 0; i < n; i++) {
    const c = detectCombo([hand[i]]);
    if (c) res.push(c);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = detectCombo([hand[i], hand[j]]);
      if (c) res.push(c);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const c = detectCombo([hand[i], hand[j], hand[k]]);
        if (c) res.push(c);
      }
    }
  }
  // bombs
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        for (let l = k + 1; l < n; l++) {
          const c = detectCombo([hand[i], hand[j], hand[k], hand[l]]);
          if (c) res.push(c);
        }
      }
    }
  }
  // straights 5..8
  const sorted = sortByRank(hand);
  for (let len = 5; len <= 8; len++) {
    for (let i = 0; i <= sorted.length - len; i++) {
      const c = detectCombo(sorted.slice(i, i + len));
      if (c && c.type === 'straight') res.push(c);
    }
  }
  // consecutive pairs (3..5 pairs)
  for (let len = 6; len <= 10; len += 2) {
    for (let i = 0; i <= sorted.length - len; i++) {
      const c = detectCombo(sorted.slice(i, i + len));
      if (c && c.type === 'pairs') res.push(c);
    }
  }
  // airplane variants
  for (let len = 6; len <= 12; len++) {
    for (let i = 0; i <= sorted.length - len; i++) {
      const c = detectCombo(sorted.slice(i, i + len));
      if (c && (c.type === 'air' || c.type === 'airWings')) res.push(c);
    }
  }
  // unique + keep only combos that can beat `last`
  const unique: Combo[] = [];
  const seen = new Set<string>();
  for (const c of res) {
    const k = c.type + '|' + c.cards.map(x => x.id).join(',');
    if (!seen.has(k)) { seen.add(k); unique.push(c); }
  }
  return unique.filter(c => canBeat(c, last));
}

// helper used above
export function sortByRank(cards: Card[]): Card[] {
  return [...cards].sort((a,b)=> a.rank===b.rank ? a.suit.localeCompare(b.suit) : a.rank-b.rank);
}
