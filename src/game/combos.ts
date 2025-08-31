import { Card, Combo, ComboType, Rank } from './types';

const SEQ_MIN = 5;       // straight min length
const PAIRSEQ_MIN = 3;   // consecutive pairs min count
const PLANE_MIN = 2;     // plane min triplets count

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

function rankCounts(cards: Card[]): Map<Rank, Card[]> {
  const m = new Map<Rank, Card[]>();
  for (const c of cards) {
    const arr = m.get(c.rank) ?? [];
    arr.push(c);
    m.set(c.rank, arr);
  }
  return m;
}

function isNormalRank(r: Rank) {
  return r>=3 && r<=14; // 3..A
}
function canInStraight(r: Rank) {
  return r>=3 && r<=14; // 3..A only; 2 and Jokers excluded
}
function canInPairSeq(r: Rank) {
  return r>=3 && r<=14;
}
function canInPlane(r: Rank) {
  return r>=3 && r<=14;
}

export function sortByRankAsc(cards: Card[]): Card[] {
  return cards.slice().sort((a,b)=>a.rank-b.rank || a.id-b.id);
}

export function labelOf(cards: Card[]): string {
  return sortByRankAsc(cards).map(c=>c.label).join('');
}

// --- Detect combo type of given cards ---
export function detectCombo(cards: Card[]): Combo | null {
  const n = cards.length;
  if (n===0) return { type: 'pass', cards: [] };

  const m = rankCounts(cards);
  const counts = [...m.entries()].map(([r,arr])=>({r, c:arr.length, arr})).sort((a,b)=>a.r-b.r);

  // Rocket
  if (n===2 && m.has(16) && m.has(17)) {
    return { type:'rocket', cards: cards.slice() };
  }

  // Bomb
  if (n===4 && counts.length===1 && counts[0].c===4) {
    return { type:'bomb', mainRank: counts[0].r, cards: cards.slice() };
  }

  // Single / Pair / Triple
  if (n===1) return { type:'single', mainRank: counts[0].r, cards: cards.slice() };
  if (n===2 && counts.length===1 && counts[0].c===2) return { type:'pair', mainRank: counts[0].r, cards: cards.slice() };
  if (n===3 && counts.length===1 && counts[0].c===3) return { type:'triple', mainRank: counts[0].r, cards: cards.slice() };

  // Triple with single / pair
  if (n===4 && counts.length===2) {
    const three = counts.find(x=>x.c===3);
    const one = counts.find(x=>x.c===1);
    if (three && one) return { type:'triple1', mainRank: three.r, cards: cards.slice() };
  }
  if (n===5 && counts.length===2) {
    const three = counts.find(x=>x.c===3);
    const pair = counts.find(x=>x.c===2);
    if (three && pair) return { type:'triple2', mainRank: three.r, cards: cards.slice() };
  }

  // Straight (>=5, consecutive singles, 3..A)
  if (n>=SEQ_MIN) {
    const ranks = [...new Set(sortByRankAsc(cards).map(c=>c.rank))];
    if (ranks.length===n && ranks.every(canInStraight)) {
      let ok=true;
      for (let i=1;i<ranks.length;i++) if (ranks[i]!==ranks[i-1]+1) { ok=false; break; }
      if (ok) return { type:'straight', mainRank: ranks[0], length: n, cards: cards.slice() };
    }
  }

  // Pair sequence (>=3 pairs, consecutive, 3..A)
  if (n%2===0) {
    const pairCount = n/2;
    if (pairCount>=PAIRSEQ_MIN) {
      const pairs: number[] = [];
      for (const {r,c} of counts) if (c===2 && canInPairSeq(r)) pairs.push(r);
      // verify consecutive and exactly pairCount pairs used
      if (pairs.length===pairCount) {
        let ok=true;
        for (let i=1;i<pairs.length;i++) if (pairs[i]!==pairs[i-1]+1) { ok=false; break; }
        if (ok) return { type:'pairseq', mainRank: pairs[0] as Rank, length: pairCount, cards: cards.slice() };
      }
    }
  }

  // Plane and plane with wings (no 2/jokers, triplets consecutive)
  // Try to find consecutive triplets first
  const triples = counts.filter(x=>x.c===3 && canInPlane(x.r)).map(x=>x.r);
  // plane only
  if (triples.length>=PLANE_MIN) {
    // Are they consecutive with no gaps?
    let ok=true;
    for (let i=1;i<triples.length;i++) if (triples[i]!==triples[i-1]+1) { ok=false; break; }
    // But above collects all triples in the hand; here we detect exactly if the given cards represent a plane
    // A robust way: try to partition given cards into K consecutive triplets plus wings.
  }
  // For general detection, brute-force over possible K (>=2) and contiguous windows
  for (let k=PLANE_MIN;k<=12;k++) {
    // main body size = 3*k
    if (n<3*k) continue;
    // gather ranks eligible for plane
    const rs = [...new Set(sortByRankAsc(cards).map(c=>c.rank))].filter(canInPlane);
    rs.sort((a,b)=>a-b);
    for (let i=0;i+ k <= rs.length; i++) {
      let ok=true;
      for (let j=1;j<k;j++) if (rs[i+j]!==rs[i]+j) { ok=false; break; }
      if (!ok) continue;
      const needTriples: Rank[] = [];
      for (let j=0;j<k;j++) needTriples.push((rs[i]+j) as Rank);
      // check we have 3 of each
      const m = rankCounts(cards);
      if (needTriples.every(r => (m.get(r)?.length ?? 0) >= 3)) {
        // remove 3 of each to see wings
        const copy = cards.slice();
        const used: Card[] = [];
        for (const r of needTriples) {
          let taken = 0;
          for (let t=0;t<copy.length && taken<3;t++) {
            if (copy[t].rank===r) { used.push(copy[t]); copy.splice(t,1); t--; taken++; }
          }
        }
        const wings = copy; // remaining
        if (wings.length===0) {
          return { type:'plane', mainRank: needTriples[0], length: k, cards: cards.slice() };
        }
        if (wings.length===k) {
          // plane + singles
          const okw = wings.every(w=>true); // any singles allowed (2/king disallowed? rule says wings may or may not allow 2/王; configurable)
          return { type:'plane1', mainRank: needTriples[0], length: k, cards: cards.slice() };
        }
        if (wings.length===2*k) {
          // ensure wings form k pairs
          const wm = rankCounts(wings);
          let pairs = 0;
          for (const [r,arr] of wm.entries()) if (arr.length===2) pairs++;
          if (pairs===k) {
            return { type:'plane2', mainRank: needTriples[0], length: k, cards: cards.slice() };
          }
        }
      }
    }
  }

  // Four with two singles / or two pairs
  if (n===6 && counts.length===3) {
    const four = counts.find(x=>x.c===4);
    if (four) {
      // remaining are two singles or one pair+two singles? Here strictly two singles
      const singles = counts.filter(x=>x.c===1);
      if (singles.length===2) return { type:'four2', mainRank: four.r, cards: cards.slice() };
    }
  }
  if (n===8 && counts.length===3) {
    const four = counts.find(x=>x.c===4);
    if (four) {
      const pairs = counts.filter(x=>x.c===2);
      if (pairs.length===2) return { type:'four2pairs', mainRank: four.r, cards: cards.slice() };
    }
  }

  return null;
}

// --- Comparison: whether b beats a (same type & shape), or bombs/rocket override ---
export function beats(a: Combo, b: Combo): boolean {
  // If b is rocket, always wins
  if (b.type==='rocket') return true;
  // If a is rocket, nothing beats it
  if (a.type==='rocket') return false;
  // Bomb logic
  const aIsBomb = a.type==='bomb';
  const bIsBomb = b.type==='bomb';
  if (aIsBomb && bIsBomb) {
    return (b.mainRank! > a.mainRank!);
  }
  if (!aIsBomb && bIsBomb) return true;
  if (aIsBomb && !bIsBomb) return false;

  // Same type required, and same shape (length for sequences/planes)
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'single':
    case 'pair':
    case 'triple':
    case 'triple1':
    case 'triple2':
    case 'bomb':
      return (b.mainRank! > a.mainRank!);
    case 'straight':
    case 'pairseq':
    case 'plane':
    case 'plane1':
    case 'plane2':
      if (a.length !== b.length) return false;
      return (b.mainRank! > a.mainRank!);
    case 'four2':
    case 'four2pairs':
      return (b.mainRank! > a.mainRank!);
    default:
      return false;
  }
}

// --- Helpers to enumerate legal plays ---

// Get all singles/pairs/triples/bombs etc from a hand; sequences are enumerated greedily.
export function allSingles(hand: Card[]): Combo[] {
  return hand.map(c=>({ type:'single', mainRank:c.rank, cards:[c] }));
}
export function allPairs(hand: Card[]): Combo[] {
  const m = rankCounts(hand);
  const res: Combo[] = [];
  for (const [r, arr] of m.entries()) if (arr.length>=2) {
    res.push({ type:'pair', mainRank: r, cards: arr.slice(0,2) });
  }
  return res;
}
export function allTriples(hand: Card[]): Combo[] {
  const m = rankCounts(hand);
  const res: Combo[] = [];
  for (const [r, arr] of m.entries()) if (arr.length>=3) {
    res.push({ type:'triple', mainRank: r, cards: arr.slice(0,3) });
  }
  return res;
}
export function allBombs(hand: Card[]): Combo[] {
  const m = rankCounts(hand);
  const res: Combo[] = [];
  for (const [r, arr] of m.entries()) if (arr.length===4) {
    res.push({ type:'bomb', mainRank: r, cards: arr.slice(0,4) });
  }
  // rocket
  const hasSJ = hand.find(c=>c.rank===16);
  const hasBJ = hand.find(c=>c.rank===17);
  if (hasSJ && hasBJ) res.push({ type:'rocket', cards:[hasSJ, hasBJ] });
  return res;
}

export function allStraights(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const m = new Map<Rank, number>();
  for (const c of hand) m.set(c.rank, (m.get(c.rank) ?? 0)+1);
  const ranks = [...new Set(hand.map(c=>c.rank))].filter(r=>r>=3 && r<=14).sort((a,b)=>a-b);
  let i=0;
  while (i<ranks.length) {
    let j=i;
    while (j+1<ranks.length && ranks[j+1]===ranks[j]+1) j++;
    // [i..j] is a consecutive run
    const run = ranks.slice(i, j+1);
    if (run.length>=5) {
      for (let len=5; len<=run.length; len++) {
        for (let s=0; s+len<=run.length; s++) {
          const seg = run.slice(s, s+len);
          // pick one of each rank
          const cards: Card[] = [];
          const used = new Set<number>();
          for (const r of seg) {
            const c = hand.find(c=>c.rank===r && !used.has(c.id))!;
            used.add(c.id); cards.push(c);
          }
          res.push({ type:'straight', mainRank: seg[0], length: len, cards });
        }
      }
    }
    i=j+1;
  }
  return res;
}

export function allPairSeqs(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const ranks = [...new Set(hand.map(c=>c.rank))].filter(r=>r>=3 && r<=14).sort((a,b)=>a-b);
  // For each rank, must have at least 2 cards
  const pairable = ranks.filter(r => hand.filter(c=>c.rank===r).length >= 2);
  let i=0;
  while (i<pairable.length) {
    let j=i;
    while (j+1<pairable.length && pairable[j+1]===pairable[j]+1) j++;
    const run = pairable.slice(i, j+1);
    if (run.length>=3) {
      for (let len=3; len<=run.length; len++) {
        for (let s=0; s+len<=run.length; s++) {
          const seg = run.slice(s, s+len);
          const cards: Card[] = [];
          for (const r of seg) {
            const arr = hand.filter(c=>c.rank===r).slice(0,2);
            cards.push(...arr);
          }
          res.push({ type:'pairseq', mainRank: seg[0], length: len, cards });
        }
      }
    }
    i=j+1;
  }
  return res;
}

export function allPlanes(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const ranks = [...new Set(hand.map(c=>c.rank))].filter(r=>r>=3 && r<=14).sort((a,b)=>a-b);
  const tripleable = ranks.filter(r => hand.filter(c=>c.rank===r).length >= 3);
  let i=0;
  while (i<tripleable.length) {
    let j=i;
    while (j+1<tripleable.length && tripleable[j+1]===tripleable[j]+1) j++;
    const run = tripleable.slice(i, j+1);
    if (run.length>=2) {
      for (let len=2; len<=run.length; len++) {
        for (let s=0; s+len<=run.length; s++) {
          const seg = run.slice(s, s+len);
          const body: Card[] = [];
          for (const r of seg) {
            body.push(...hand.filter(c=>c.rank===r).slice(0,3));
          }
          res.push({ type:'plane', mainRank: seg[0], length: len, cards: body });
          // wings: singles
          // choose len singles from remaining
          const remain = hand.filter(c=>!body.find(b=>b.id===c.id));
          if (remain.length>=len) {
            // pick the smallest len singles
            const singles = remain.slice(0,len);
            res.push({ type:'plane1', mainRank: seg[0], length: len, cards: body.concat(singles) });
          }
          // wings: pairs
          const pm = new Map<Rank, Card[]>();
          for (const c of remain) {
            const arr = pm.get(c.rank) ?? [];
            arr.push(c); pm.set(c.rank, arr);
          }
          const pairs: Rank[] = [];
          for (const [r,arr] of pm.entries()) if (arr.length>=2) pairs.push(r);
          if (pairs.length>=len) {
            const chosen = pairs.slice(0,len);
            const wingCards: Card[] = [];
            for (const r of chosen) wingCards.push(...pm.get(r)!.slice(0,2));
            res.push({ type:'plane2', mainRank: seg[0], length: len, cards: body.concat(wingCards) });
          }
        }
      }
    }
    i=j+1;
  }
  return res;
}

export function allFourWithTwo(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  const m = new Map<Rank, Card[]>();
  for (const c of hand) {
    const arr = m.get(c.rank) ?? []; arr.push(c); m.set(c.rank, arr);
  }
  for (const [r,arr] of m.entries()) if (arr.length===4) {
    // two singles
    const remain = hand.filter(c=>c.rank!==r);
    if (remain.length>=2) {
      res.push({ type:'four2', mainRank: r, cards: arr.concat(remain.slice(0,2)) });
    }
    // two pairs
    const pm = new Map<Rank, Card[]>();
    for (const c of remain) { const a = pm.get(c.rank) ?? []; a.push(c); pm.set(c.rank, a); }
    const pairs: Rank[] = [];
    for (const [rr, aa] of pm.entries()) if (aa.length>=2) pairs.push(rr);
    if (pairs.length>=2) {
      const chosen = pairs.slice(0,2);
      const wings: Card[] = [];
      for (const rr of chosen) wings.push(...pm.get(rr)!.slice(0,2));
      res.push({ type:'four2pairs', mainRank: r, cards: arr.concat(wings) });
    }
  }
  return res;
}

// Gather all combos for leading (may be pruned by bots' strategy)
export function enumerateAllCombos(hand: Card[]): Combo[] {
  const res: Combo[] = [];
  res.push(...allBombs(hand));
  res.push(...allPlanes(hand));
  res.push(...allPairSeqs(hand));
  res.push(...allStraights(hand));
  res.push(...allFourWithTwo(hand));
  res.push(...allTriples(hand));
  res.push(...allPairs(hand));
  res.push(...allSingles(hand));
  return res;
}

// For following: same type beating target OR any bomb/rocket
export function enumerateResponses(hand: Card[], target: Combo): Combo[] {
  const res: Combo[] = [];
  const all = enumerateAllCombos(hand);
  for (const c of all) {
    if (c.type==='bomb' || c.type==='rocket') {
      if (target.type!=='rocket') res.push(c);
      continue;
    }
    if (c.type===target.type) {
      if ((target.length ?? 0) !== (c.length ?? 0)) continue;
      if ((target.type==='straight' || target.type==='pairseq' || target.type.startsWith('plane'))) {
        if (c.length !== target.length) continue;
      }
      if (beats(target, c)) res.push(c);
    }
  }
  // Sort responses by mainRank ascending (so smallest winning move first)
  res.sort((a,b)=> (a.type===b.type ? ((a.mainRank ?? 0)-(b.mainRank ?? 0)) : a.type.localeCompare(b.type)));
  return res;
}
