
// Extended Dou Dizhu core: singles, pairs, triples, bombs/rocket, straight, consecutive pairs, airplane with/without wings.
export type Suit = '♠'|'♥'|'♣'|'♦'|'JOKER';
export type Rank = '3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A'|'2'|'SJ'|'BJ';
export type Card = string;

export type ComboType =
  | 'PASS'
  | 'SINGLE'
  | 'PAIR'
  | 'TRIPLE'
  | 'TRIPLE_WITH_SINGLE'
  | 'TRIPLE_WITH_PAIR'
  | 'STRAIGHT'               // length >=5, 3..A (no 2/jokers)
  | 'CONSECUTIVE_PAIRS'      // >=3 pairs, 3..A (no 2/jokers)
  | 'AIRPLANE'               // >=2 consecutive triples, no wings
  | 'AIRPLANE_SINGLE'        // airplane + N singles
  | 'AIRPLANE_PAIR'          // airplane + N pairs
  | 'BOMB'                   // 4 same
  | 'ROCKET';                // SJ + BJ

export interface Combo {
  type: ComboType;
  cards: string[];
  mainRank?: Rank;          // comparison anchor
  length?: number;          // for straight/pairs/airplane main length
  wingsKind?: 'single'|'pair'|null;
  key?: string;
}

export interface GameStateSnap {
  landlord: number;
  currentPlayer: number;
  lastCombo: Combo | null;
  hands: string[][];
  bottom: string[];
  scores: number[];
  trick: number;
}

const orderMap: Record<Rank, number> = {
  '3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,'J':8,'Q':9,'K':10,'A':11,'2':12,'SJ':13,'BJ':14
};
const ranksLinear: Rank[] = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','SJ','BJ'];

export function makeDeck(): string[] {
  const suits: Suit[] = ['♠','♥','♣','♦'];
  const result: string[] = [];
  const normal: Rank[] = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  for (const r of normal) for (const s of suits) result.push(`${r}${s}`);
  result.push('SJ'); result.push('BJ');
  return result;
}

export function shuffle<T>(arr: T[], seed = 0): T[] {
  let x = (seed||1) >>> 0; if (!x) x = 1;
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    const j = x % (i+1);
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

export function deal(seed=1){
  const d = shuffle(makeDeck(), seed);
  const hands = [d.slice(0,17), d.slice(17,34), d.slice(34,51)];
  const bottom = d.slice(51);
  return {hands, bottom};
}

export function startState(seed=1): GameStateSnap {
  const {hands, bottom} = deal(seed);
  const landlord = seed % 3;
  hands[landlord].push(...bottom);
  hands.forEach(h=>h.sort((a,b)=> rankOrder(cardRank(a)) - rankOrder(cardRank(b)) ));
  return { landlord, currentPlayer: landlord, lastCombo: null, hands, bottom, scores:[0,0,0], trick:0 };
}

export function applyMove(state: GameStateSnap, who: number, cards: string[]): { ok: boolean; reason?: string; combo?: Combo; next: GameStateSnap } {
  const hand = state.hands[who].slice();
  for (const c of cards){ const i = hand.indexOf(c); if (i<0) return { ok:false, reason:`card ${c} not in hand`, next: state}; hand.splice(i,1); }
  const combo = inferCombo(cards);
  if (!combo) return { ok:false, reason:'illegal combo', next: state };
  if (combo.type!=='PASS' && !beats(combo, state.lastCombo)) return { ok:false, reason:'does not beat last', next: state };
  const next = structuredClone(state);
  next.hands[who] = hand;
  next.lastCombo = combo.type==='PASS' ? state.lastCombo : combo;
  next.currentPlayer = (who+1)%3;
  next.trick = state.trick + 1;
  return { ok:true, combo, next };
}

export function isGameOver(state: GameStateSnap): number | null {
  for (let i=0;i<3;i++) if (state.hands[i].length===0) return i;
  return null;
}

// ========== Parsing helpers ==========
export function cardRank(c:string): Rank {
  if (c==='SJ' || c==='BJ') return c;
  const m = c.match(/10|[2-9JQKA]/);
  return (m ? (m[0] as Rank) : '3');
}
export function rankOrder(r: Rank){ return orderMap[r]; }

function countRanks(cards: string[]): Map<Rank, number> {
  const m = new Map<Rank, number>();
  for (const c of cards) {
    const r = cardRank(c);
    m.set(r, (m.get(r)||0)+1);
  }
  return m;
}

function sortByRankAsc(cards: string[]): string[] {
  return cards.slice().sort((a,b)=>rankOrder(cardRank(a))-rankOrder(cardRank(b)));
}

// ========== Combo inference ==========
export function inferCombo(cards: string[]): Combo | null {
  if (cards.length===0) return { type:'PASS', cards:[] };

  const s = sortByRankAsc(cards);
  const ranks = s.map(cardRank);
  const m = countRanks(cards);

  // Rocket
  if (cards.length===2 && ranks.includes('SJ') && ranks.includes('BJ')) {
    return { type:'ROCKET', cards, mainRank: 'BJ' };
  }

  // Bomb (4 same)
  if (cards.length===4 && m.size===1) {
    const r = ranks[0];
    return { type:'BOMB', cards, mainRank: r };
  }

  // Simple types
  if (cards.length===1) return { type:'SINGLE', cards, mainRank: ranks[0] };
  if (cards.length===2 && m.size===1) return { type:'PAIR', cards, mainRank: ranks[0] };
  if (cards.length===3 && m.size===1) return { type:'TRIPLE', cards, mainRank: ranks[0] };
  if (cards.length===4 && m.size===2) {
    // TRIPLE_WITH_SINGLE (3+1)
    for (const [r,cnt] of m) if (cnt===3) return { type:'TRIPLE_WITH_SINGLE', cards, mainRank: r };
  }
  if (cards.length===5 && m.size===2) {
    // TRIPLE_WITH_PAIR (3+2)
    let has3=false, has2=false, r3:'3'| '4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A'|'2'|'SJ'|'BJ' = '3';
    for (const [r,cnt] of m){ if (cnt===3){ has3=true; r3=r; } if (cnt===2) has2=true; }
    if (has3 && has2) return { type:'TRIPLE_WITH_PAIR', cards, mainRank: r3 };
  }

  // Straight (>=5), consecutive ranks, no 2/jokers
  if (cards.length>=5 && allUnique(ranks) && isConsecutive(ranks) && maxRank(ranks) !== '2' && !ranks.includes('SJ') && !ranks.includes('BJ')) {
    return { type:'STRAIGHT', cards, mainRank: maxRank(ranks), length: cards.length };
  }

  // Consecutive pairs (>=3 pairs), no 2/jokers
  if (cards.length % 2 === 0 && cards.length>=6) {
    const pairs = Array.from(m.values()).every(v=>v===2) && m.size === cards.length/2;
    if (pairs) {
      const keys = Array.from(m.keys());
      if (!keys.includes('2') && !keys.includes('SJ') && !keys.includes('BJ') && isConsecutive(keys)) {
        return { type:'CONSECUTIVE_PAIRS', cards, mainRank: maxRank(keys), length: keys.length };
      }
    }
  }

  // Airplane related
  // group by count
  const triples: Rank[] = [];
  const singles: Rank[] = [];
  const pairs: Rank[] = [];
  for (const [r,cnt] of m) {
    if (cnt===3) triples.push(r);
    else if (cnt===2) pairs.push(r);
    else if (cnt===1) singles.push(r);
    else if (cnt===4) {} // bombs are already handled
    else return null;
  }
  triples.sort((a,b)=>rankOrder(a)-rankOrder(b));

  if (triples.length>=2 && isConsecutive(triples) && !triples.includes('2') && !triples.includes('SJ') && !triples.includes('BJ')) {
    const tlen = triples.length;
    const total = cards.length;
    const tripleCards = tlen * 3;
    const remain = total - tripleCards;

    if (remain===0) {
      return { type:'AIRPLANE', cards, mainRank: maxRank(triples), length: tlen, wingsKind: null };
    }
    if (remain===tlen && singles.length===tlen) {
      return { type:'AIRPLANE_SINGLE', cards, mainRank: maxRank(triples), length: tlen, wingsKind: 'single' };
    }
    if (remain===tlen*2 && pairs.length===tlen) {
      return { type:'AIRPLANE_PAIR', cards, mainRank: maxRank(triples), length: tlen, wingsKind: 'pair' };
    }
  }

  return null;
}

// ========== Comparison ==========
export function beats(a: Combo, b: Combo | null): boolean {
  if (!b || b.type==='PASS') return a.type!=='PASS';
  // Rocket beats everything
  if (a.type==='ROCKET') return b.type!=='ROCKET';
  if (b.type==='ROCKET') return false;

  // Bomb beats non-bomb
  if (a.type==='BOMB' && b.type!=='BOMB') return true;
  if (b.type==='BOMB' && a.type!=='BOMB') return false;

  if (a.type!==b.type) return false;

  // same type compare
  switch (a.type) {
    case 'SINGLE':
    case 'PAIR':
    case 'TRIPLE':
    case 'TRIPLE_WITH_SINGLE':
    case 'TRIPLE_WITH_PAIR':
    case 'BOMB':
    case 'STRAIGHT':
      if (a.length!==b.length) return false;
      return rankOrder(a.mainRank!) > rankOrder(b.mainRank!);
    case 'CONSECUTIVE_PAIRS':
      if (a.length!==b.length) return false;
      return rankOrder(a.mainRank!) > rankOrder(b.mainRank!);
    case 'AIRPLANE':
      if (a.length!==b.length) return false;
      return rankOrder(a.mainRank!) > rankOrder(b.mainRank!);
    case 'AIRPLANE_SINGLE':
      if (a.length!==b.length) return false;
      return rankOrder(a.mainRank!) > rankOrder(b.mainRank!);
    case 'AIRPLANE_PAIR':
      if (a.length!==b.length) return false;
      return rankOrder(a.mainRank!) > rankOrder(b.mainRank!);
    default:
      return false;
  }
}

// helpers
function allUnique(arr: Rank[]): boolean {
  return new Set(arr).size === arr.length;
}
function isConsecutive(arr: Rank[]): boolean {
  if (arr.length<=1) return true;
  const ord = arr.map(r=>rankOrder(r)).sort((a,b)=>a-b);
  for (let i=1;i<ord.length;i++) if (ord[i]!==ord[i-1]+1) return false;
  return true;
}
function maxRank(arr: Rank[]): Rank {
  return arr.reduce((acc, r)=> rankOrder(r) > rankOrder(acc) ? r : acc, arr[0]);
}
