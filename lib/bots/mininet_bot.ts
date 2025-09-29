// lib/bots/mininet_bot.ts (v4 - rule-aware)
// MiniNet: tiny MLP scorer + LEGAL candidate generator for Dou Dizhu (斗地主).
// - Respects require/type when following: same type & size, bigger core; bombs/rocket allowed anytime.
// - If require not present, infers from last non-pass trick; if still unknown -> free lead.
// - Returns raw tokens (whatever your engine uses), only normalizes ranks for features/scoring.

type AnyCard = any;
type BotMove = { move: 'play' | 'pass'; cards?: AnyCard[]; reason?: string };

const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
type RankChar = typeof RANKS[number];
const RANK_IDX = Object.fromEntries(RANKS.map((r,i)=>[r,i])) as Record<string, number>;
const STRAIGHT_RANKS: RankChar[] = ['3','4','5','6','7','8','9','T','J','Q','K','A']; // no 2 / jokers

const MOVE_TYPES = [
  'pass','single','pair','triple','straight','pair-straight','plane',
  'triple-with-single','triple-with-pair','four-with-two','bomb','rocket'
] as const;
type MoveType = typeof MOVE_TYPES[number];

// ========= Normalization helpers =========
function isSmallJokerToken(s: string){ return s==='x' || s==='XJ' || s==='SJ' || s==='jokerS' || s==='🃏s'; }
function isBigJokerToken(s: string){ return s==='X' || s==='BJ' || s==='LJ' || s==='JOKER' || s==='🃏'; }

function toRankChar(raw:any): RankChar {
  if (raw==null) return '3';
  const s = String(raw);
  // Keep 'x' small, 'X' big if explicitly given
  if (s==='x' || s==='X') return s as RankChar;
  const up = s.toUpperCase();
  if (['3','4','5','6','7','8','9','T','J','Q','K','A','2'].includes(up)) return up as RankChar;
  // Heuristics for tokens like '7H', '♦7'
  if (s.length>1){
    const last = s[s.length-1].toUpperCase();
    if (['3','4','5','6','7','8','9','T','J','Q','K','A','2'].includes(last)) return last as RankChar;
  }
  if (isSmallJokerToken(s)) return 'x';
  if (isBigJokerToken(s))   return 'X';
  return '3';
}
function rankIndex(raw:any): number { const r = toRankChar(raw); return RANK_IDX[r] ?? 0; }

// ========= Feature builder (same MLP as before) =========
function hist15(cards: AnyCard[]|undefined): number[] {
  const h = new Array(15).fill(0);
  if (cards) for (const c of cards) h[rankIndex(c)]++;
  return h;
}

function classifyMove(cards?: AnyCard[]): MoveType {
  if (!cards || cards.length === 0) return 'pass';
  const n = cards.length;
  const h = hist15(cards);
  const uniq = h.filter(x=>x>0).length;
  const ranks = cards.map(toRankChar);

  const hasRocket = ranks.includes('x') && ranks.includes('X') && n===2;
  if (hasRocket) return 'rocket';

  const some4 = h.find(x=>x===4);
  if (some4 && (n===4)) return 'bomb';

  if (n === 1) return 'single';
  if (n === 2 && uniq === 1) return 'pair';
  if (n === 3 && uniq === 1) return 'triple';

  // Naive straight checks (we'll use stricter checks in candidate builder)
  const run = h.map(v=>v>0?1:0);
  let best=0, cur=0;
  for (let i=0;i<13;i++){ // include '2' here just for continuity; rule disallows 2/jokers later
    cur = run[i]?cur+1:0; best = Math.max(best, cur);
  }
  if (best>=5 && uniq===n) return 'straight';

  // We won't try to perfectly classify complex combos here.
  // The legal candidate generator will produce properly-typed combos.
  return 'single';
}

type MiniState = {
  role: 0|1|2;
  landlord: 0|1|2;
  lastMove?: { kind:'play'|'pass'; cards?: AnyCard[] };
  myHand?: AnyCard[];
  counts?: [number,number,number];
  bombsUsed?: number;
};
function stateFeat(s: MiniState): number[] {
  const roleOne = [0,0,0]; roleOne[s.role] = 1;
  const lordOne = [0,0,0]; lordOne[s.landlord] = 1;
  const counts  = (s.counts ?? [17,17,17]).map(x => Math.min(20, x)/20);
  const bombs   = [(s.bombsUsed ?? 0)/6];
  const lastType = classifyMove(s.lastMove?.cards);
  const lastOneHot = MOVE_TYPES.map(t => t===lastType ? 1 : 0);
  const handH = hist15(s.myHand ?? []).map(x=>Math.min(4,x)/4);
  return [...roleOne, ...lordOne, ...counts, ...bombs, ...lastOneHot, ...handH];
}
function moveFeat(cards?: AnyCard[]): number[] {
  const t = classifyMove(cards);
  const onehot = MOVE_TYPES.map(x => x===t ? 1 : 0);
  const n = (cards?.length ?? 0)/20;
  let hi = 0;
  if (cards && cards.length>0) hi = cards.map(rankIndex).reduce((a,b)=>Math.max(a,b),0)/14;
  return [...onehot, n, hi];
}
function buildX(s: MiniState, m?: AnyCard[]): number[] {
  const a = stateFeat(s);
  const b = moveFeat(m);
  const v = [...a, ...b];
  while (v.length < 64) v.push(0);
  return v;
}
type Dense = { W: number[][]; b: number[] };
type MLP = { l1: Dense; l2: Dense };
function relu(x:number){ return x>0?x:0; }
function matVec(W:number[][], x:number[], b:number[]): number[] {
  const y = new Array(W.length).fill(0);
  for (let i=0;i<W.length;i++){
    let sum = b[i] || 0;
    const row = W[i];
    for (let j=0;j<row.length;j++) sum += row[j]*x[j];
    y[i] = sum;
  }
  return y;
}
function initHeuristicMLP(): MLP {
  const inDim=64, h=48;
  const z1 = Array.from({length:h}, (_,i)=> Array.from({length:inDim}, (__,j)=> {
    const isHandHist = (j>= (3+3+3+1+12)) && (j < (3+3+3+1+12+15));
    const handIdx = j - (3+3+3+1+12);
    const isMoveTypeStart = (j>= (3+3+3+1)) && (j < (3+3+3+1+12));
    const moveTypeIdx = j - (3+3+3+1);
    if (isHandHist) {
      if (handIdx <= 4) return 0.05;
      if (handIdx >= 12) return -0.03;
      return 0.01;
    }
    if (isMoveTypeStart) {
      if (['bomb','rocket'].includes(MOVE_TYPES[moveTypeIdx] as any)) return -0.06;
      if (MOVE_TYPES[moveTypeIdx]==='straight') return 0.06;
    }
    return 0.0;
  }));
  const b1 = new Array(h).fill(0);
  const z2 = [ Array.from({length:h}, (_,j)=> (j<8?0.1:0.02)) ];
  const b2 = [0];
  return { l1:{W:z1,b:b1}, l2:{W:z2,b:b2} };
}
const M = initHeuristicMLP();
function mlpScore(x:number[]): number {
  const h1 = matVec(M.l1.W, x, M.l1.b).map(relu);
  const y  = matVec(M.l2.W, h1, M.l2.b)[0];
  return y;
}

// ========= Hand + trick utilities =========
function getSeat(ctx:any): number|undefined {
  if (typeof ctx?.seat==='number') return ctx.seat;
  if (typeof ctx?.role==='number') return ctx.role;
  return undefined;
}
function getHandFromCtx(ctx:any): AnyCard[] {
  const tryPaths = [
    (c:any)=> c?.hand,
    (c:any)=> c?.myHand,
    (c:any)=> c?.cards,
    (c:any)=> c?.myCards,
    (c:any)=> c?.state?.hand,
    (c:any)=> c?.state?.myHand,
  ];
  for (const f of tryPaths) {
    const v = f(ctx);
    if (Array.isArray(v) && v.length) return v as AnyCard[];
  }
  const seat = getSeat(ctx);
  if (Array.isArray(ctx?.hands) && seat!=null && Array.isArray(ctx.hands[seat])) return ctx.hands[seat] as AnyCard[];
  if (Array.isArray(ctx?.state?.hands) && seat!=null && Array.isArray(ctx.state.hands[seat])) return ctx.state.hands[seat] as AnyCard[];
  return [];
}
type Req = {
  type: MoveType|'lead'|'any';
  len?: number;     // straight length / number of pairs / number of triples for plane
  wings?: 'single'|'pair'|null;
  baseIdx?: number; // rank index for core comparison
};
function lastNonPassFrom(ctx:any): AnyCard[]|undefined {
  const sources = [ctx?.currentTrick, ctx?.trick, ctx?.history];
  for (const s of sources) {
    if (Array.isArray(s) && s.length) {
      for (let i=s.length-1;i>=0;i--){
        const it = s[i];
        const cards = it?.cards ?? it?.move?.cards ?? it?.play ?? it;
        if (Array.isArray(cards) && cards.length>0) return cards as AnyCard[];
      }
    }
  }
  return undefined;
}
function analyzeMove(cards: AnyCard[]): {type:MoveType, len?:number, baseIdx?:number, wings?:'single'|'pair'|null} {
  const h = hist15(cards);
  const ranks = cards.map(toRankChar);
  const type = classifyMove(cards);
  if (type==='single') return {type, baseIdx: rankIndex(cards[0])};
  if (type==='pair')   return {type, baseIdx: rankIndex(cards[0])};
  if (type==='triple') return {type, baseIdx: rankIndex(cards[0])};

  // Detect bomb
  if (h.find(x=>x===4) && cards.length===4) {
    const idx = h.findIndex(x=>x===4);
    return {type:'bomb', baseIdx: idx};
  }
  if (ranks.includes('x') && ranks.includes('X') && cards.length===2) return {type:'rocket', baseIdx: 99};

  // Straight-like
  const idxs = ranks.map(r=>RANK_IDX[r]).sort((a,b)=>a-b);
  const uniq = Array.from(new Set(idxs));
  const isStraight = uniq.every(i=>i<=RANK_IDX['A']) && uniq.length>=5 && uniq.length===cards.length && uniq.every((v,i)=> i===0 || v-uniq[i-1]===1);
  if (isStraight) return {type:'straight', len: uniq.length, baseIdx: uniq[uniq.length-1]};

  // Pair-straight
  const pairIdxs: number[] = [];
  for (let i=0;i<13;i++){ if (h[i]>=2) pairIdxs.push(i); }
  pairIdxs.sort((a,b)=>a-b);
  // Find longest run that equals cards.length/2
  const needPairs = cards.length/2;
  for (let i=0;i+needPairs-1<pairIdxs.length;i++){
    const window = pairIdxs.slice(i,i+needPairs);
    const ok = window.every((v,k)=>k===0 || v-window[k-1]===1);
    if (ok && needPairs>=3) return {type:'pair-straight', len: needPairs, baseIdx: window[window.length-1]};
  }

  // Triple-based
  const tripleIdxs: number[] = []; for (let i=0;i<13;i++){ if (h[i]===3) tripleIdxs.push(i); }
  if (tripleIdxs.length>=2){
    // assume pure plane (no wings) if counts match
    if (tripleIdxs.length*3 === cards.length) {
      tripleIdxs.sort((a,b)=>a-b);
      if (tripleIdxs.every((v,k)=>k===0 || v-tripleIdxs[k-1]===1))
        return {type:'plane', len: tripleIdxs.length, baseIdx: tripleIdxs[tripleIdxs.length-1]};
    } else {
      // with wings: we cannot reliably infer wings type only from raw cards; try to guess
      tripleIdxs.sort((a,b)=>a-b);
      const width = tripleIdxs.length;
      const rest = cards.length - width*3;
      if (rest===width) return {type:'triple-with-single', len: width, baseIdx: tripleIdxs[tripleIdxs.length-1], wings:'single'};
      if (rest===width*2) return {type:'triple-with-pair', len: width, baseIdx: tripleIdxs[tripleIdxs.length-1], wings:'pair'};
    }
  }

  // Four-with-two (two singles)
  const fourIdx = h.findIndex(x=>x===4);
  if (fourIdx>=0){
    return {type:'four-with-two', baseIdx: fourIdx};
  }
  return {type:'single', baseIdx: rankIndex(cards[0])};
}

function parseRequire(ctx:any): Req {
  const r = ctx?.require;
  if (r && typeof r==='object'){
    const t = (r.type || r.kind || r.moveType || r.name || r.expected)?.toString()?.toLowerCase() || 'any';
    const map: Record<string, MoveType|'lead'|'any'> = {
      'lead':'lead','any':'any',
      'single':'single','pair':'pair','triple':'triple',
      'straight':'straight','shunzi':'straight',
      'pair-straight':'pair-straight','liandui':'pair-straight',
      'plane':'plane','feiji':'plane',
      'triple-with-single':'triple-with-single',
      'triple-with-pair':'triple-with-pair',
      'four-with-two':'four-with-two',
      'bomb':'bomb','rocket':'rocket'
    };
    const type = map[t] ?? 'any';
    const len  = r.len ?? r.length ?? r.size ?? r.width ?? undefined;
    const baseIdx = (r.baseIdx!=null) ? Number(r.baseIdx) :
                    (r.baseRank!=null) ? rankIndex(r.baseRank) :
                    (r.rank!=null) ? rankIndex(r.rank) : undefined;
    const wings = (r.wings==='pair' || r.wings==='single') ? r.wings : undefined;
    return { type, len, baseIdx, wings: wings??null };
  }

  // Infer from last non-pass trick
  const last = lastNonPassFrom(ctx);
  if (Array.isArray(last)) {
    const a = analyzeMove(last);
    return { type:a.type, len:a.len, baseIdx:a.baseIdx, wings:a.wings??null };
  }
  return { type: 'lead' };
}

// ========= Candidate generator respecting rules =========
function byRankBuckets(hand: AnyCard[]): Record<RankChar, AnyCard[]> {
  const buckets: Record<RankChar, AnyCard[]> = Object.fromEntries(RANKS.map(r=>[r, []])) as any;
  for (const c of hand) buckets[toRankChar(c)].push(c);
  return buckets;
}
function pickSinglesAbove(b: Record<RankChar,AnyCard[]>, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const r of RANKS){
    const idx = RANK_IDX[r];
    if (idx>minIdx && b[r].length>=1) out.push([b[r][0]]);
  }
  return out;
}
function pickPairsAbove(b: Record<RankChar,AnyCard[]>, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const r of RANKS){
    const idx = RANK_IDX[r];
    if (idx>minIdx && b[r].length>=2) out.push([b[r][0], b[r][1]]);
  }
  return out;
}
function pickTriplesAbove(b: Record<RankChar,AnyCard[]>, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const r of RANKS){
    const idx = RANK_IDX[r];
    if (idx>minIdx && b[r].length>=3) out.push([b[r][0], b[r][1], b[r][2]]);
  }
  return out;
}
function pickBombsAbove(b: Record<RankChar,AnyCard[]>, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const r of RANKS){
    const idx = RANK_IDX[r];
    if (b[r].length>=4 && (minIdx<0 || idx>minIdx)) out.push([b[r][0], b[r][1], b[r][2], b[r][3]]);
  }
  return out;
}
function pickRocket(b: Record<RankChar,AnyCard[]>): AnyCard[][] {
  if (b['x'].length>=1 && b['X'].length>=1) return [[b['x'][0], b['X'][0]]];
  return [];
}

function pickStraight(b: Record<RankChar,AnyCard[]>, len:number, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  const idxs = STRAIGHT_RANKS.map(r=>RANK_IDX[r]);
  for (let i=0;i+len-1<idxs.length;i++){
    const window = idxs.slice(i, i+len);
    if (window[window.length-1] <= RANK_IDX['A'] &&
        window.every(idx => Object.values(b)[idx]?.length>=1)) {
      if (window[window.length-1] > minIdx) {
        out.push(window.map(idx => Object.values(b)[idx][0]));
      }
    }
  }
  return out;
}
function pickPairStraight(b: Record<RankChar,AnyCard[]>, len:number, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  const idxs = STRAIGHT_RANKS.map(r=>RANK_IDX[r]);
  for (let i=0;i+len-1<idxs.length;i++){
    const window = idxs.slice(i, i+len);
    if (window.every(idx => Object.values(b)[idx]?.length>=2)) {
      if (window[window.length-1] > minIdx) {
        const cand: AnyCard[] = [];
        for (const idx of window) {
          const arr = Object.values(b)[idx];
          cand.push(arr[0], arr[1]);
        }
        out.push(cand);
      }
    }
  }
  return out;
}
function pickPlane(b: Record<RankChar,AnyCard[]>, width:number, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  const idxs = STRAIGHT_RANKS.map(r=>RANK_IDX[r]);
  for (let i=0;i+width-1<idxs.length;i++){
    const window = idxs.slice(i, i+width);
    if (window.every(idx => Object.values(b)[idx]?.length>=3)) {
      if (window[window.length-1] > minIdx) {
        const cand: AnyCard[] = [];
        for (const idx of window) {
          const arr = Object.values(b)[idx];
          cand.push(arr[0], arr[1], arr[2]);
        }
        out.push(cand);
      }
    }
  }
  return out;
}
function addWingsSingles(core: AnyCard[][], b: Record<RankChar,AnyCard[]>, width:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const c of core){
    // remove core tokens from a temp copy
    const used = new Set(c);
    const singles: AnyCard[] = [];
    for (const r of RANKS){
      for (const t of b[r]) if (!used.has(t)) singles.push(t);
    }
    if (singles.length>=width){
      out.push([...c, ...singles.slice(0,width)]);
    }
  }
  return out;
}
function addWingsPairs(core: AnyCard[][], b: Record<RankChar,AnyCard[]>, width:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const c of core){
    const used = new Set(c);
    const pairs: AnyCard[] = [];
    for (const r of RANKS){
      const arr = b[r].filter(x=>!used.has(x));
      if (arr.length>=2) pairs.push(arr[0], arr[1]);
      if (pairs.length>=width*2) break;
    }
    if (pairs.length>=width*2){
      out.push([...c, ...pairs.slice(0,width*2)]);
    }
  }
  return out;
}
function pickFourWithTwo(b: Record<RankChar,AnyCard[]>, minIdx:number, usePairs:boolean): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const r of RANKS){
    const idx = RANK_IDX[r];
    if (b[r].length>=4 && idx>minIdx){
      const core = [b[r][0],b[r][1],b[r][2],b[r][3]];
      const used = new Set(core);
      if (!usePairs){
        // two singles
        const singles: AnyCard[] = [];
        for (const rr of RANKS) for (const t of b[rr]) if (!used.has(t)) singles.push(t);
        if (singles.length>=2) out.push([...core, singles[0], singles[1]]);
      } else {
        // two pairs
        const pairs: AnyCard[] = [];
        for (const rr of RANKS){
          const arr = b[rr].filter(x=>!used.has(x));
          if (arr.length>=2) { pairs.push(arr[0], arr[1]); if (pairs.length>=4) break; }
        }
        if (pairs.length>=4) out.push([...core, ...pairs.slice(0,4)]);
      }
    }
  }
  return out;
}

function buildLegalCandidates(hand: AnyCard[], ctx:any): AnyCard[][] {
  const req = parseRequire(ctx);
  const buckets = byRankBuckets(hand);
  const canPass = !!ctx?.canPass;
  const cands: AnyCard[][] = [];

  // Rocket & Bombs are always allowed to beat anything (rule). We'll add them later if needed.
  const bombsAny = pickBombsAbove(buckets, -1);
  const rocketAny = pickRocket(buckets);

  if (req.type==='lead' || req.type==='any'){
    // free lead: allow many shapes; to keep small, include straights (>=5), pairs, triples, singles; keep bombs as last-resort
    // Straights of length 5..8
    for (let L=8; L>=5; L--) cands.push(...pickStraight(buckets, L, -1));
    // Pair-straights (3..5 pairs)
    for (let L=5; L>=3; L--) cands.push(...pickPairStraight(buckets, L, -1));
    // Triples (prefer)
    cands.push(...pickTriplesAbove(buckets, -1));
    // Pairs
    cands.push(...pickPairsAbove(buckets, -1));
    // Singles
    cands.push(...pickSinglesAbove(buckets, -1));
    // Optional: avoid always exposing bombs on lead; we add them at the end as low-priority
    cands.push(...bombsAny);
    cands.push(...rocketAny);
    return cands.slice(0,200);
  }

  const base = req.baseIdx ?? -1;
  switch (req.type){
    case 'single': cands.push(...pickSinglesAbove(buckets, base)); break;
    case 'pair':   cands.push(...pickPairsAbove  (buckets, base)); break;
    case 'triple': cands.push(...pickTriplesAbove(buckets, base)); break;
    case 'straight': {
      const L = Math.max(5, req.len ?? 5);
      cands.push(...pickStraight(buckets, L, base));
      break;
    }
    case 'pair-straight': {
      const L = Math.max(3, req.len ?? 3);
      cands.push(...pickPairStraight(buckets, L, base));
      break;
    }
    case 'plane': {
      const W = Math.max(2, req.len ?? 2);
      cands.push(...pickPlane(buckets, W, base));
      break;
    }
    case 'triple-with-single': {
      const W = Math.max(1, req.len ?? 1);
      const core = pickPlane(buckets, W, base);
      cands.push(...addWingsSingles(core, buckets, W));
      break;
    }
    case 'triple-with-pair': {
      const W = Math.max(1, req.len ?? 1);
      const core = pickPlane(buckets, W, base);
      cands.push(...addWingsPairs(core, buckets, W));
      break;
    }
    case 'four-with-two': {
      // 默认两单；若 r.wings==='pair' 则两对
      const usePairs = (ctx?.require?.wings==='pair');
      cands.push(...pickFourWithTwo(buckets, base, !!usePairs));
      break;
    }
    case 'bomb': {
      cands.push(...pickBombsAbove(buckets, base));
      break;
    }
    case 'rocket': {
      cands.push(...pickRocket(buckets));
      break;
    }
  }
  // If we are following a non-bomb, allow bombs/rocket as override
  if (req.type!=='bomb' && req.type!=='rocket'){
    cands.push(...bombsAny, ...rocketAny);
  }
  return cands.slice(0,200);
}

// ========= Bot main =========
export async function MiniNetBot(ctx:any): Promise<BotMove> {
  const state: MiniState = {
    role: Number(ctx?.role ?? 0) as 0|1|2,
    landlord: Number(ctx?.landlord ?? 0) as 0|1|2,
    lastMove: undefined, // not strictly used in scoring; kept for feature completeness
    myHand: getHandFromCtx(ctx).map(toRankChar),
    counts: ctx?.counts,
    bombsUsed: ctx?.stats?.bombs ?? ctx?.bombsUsed ?? 0,
  };

  const rawHand: AnyCard[] = getHandFromCtx(ctx);
  let candidates = buildLegalCandidates(rawHand, ctx);

  if (!candidates.length) {
    // No legal follow-up; if canPass=true, pass; else try single lowest as a fallback
    if (ctx?.canPass) return { move:'pass', reason:`MiniNet: no legal candidates (keys=${Object.keys(ctx||{}).join(',')})` };
    const lowest = [...rawHand].sort((a,b)=>rankIndex(a)-rankIndex(b))[0];
    if (lowest!=null) candidates = [[lowest]];
  }

  // Score & pick
  let best = candidates[0];
  let bestScore = -1e9;
  for (const m of candidates) {
    const x = buildX(state, m.map(toRankChar));
    let score = mlpScore(x);
    score += (Math.random()-0.5)*0.01;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  const req = parseRequire(ctx);
  const reqDesc = `${req.type}${req.len?`(${req.len})`:''}${req.baseIdx!=null?`>${req.baseIdx}`:''}`;
  return { move:'play', cards: best, reason:`MiniNet(v4): cands=${candidates.length} req=${reqDesc} score=${bestScore.toFixed(3)}` };
}

export function loadMiniNetWeights(json: MLP) {
  M.l1.W = json.l1.W; M.l1.b = json.l1.b;
  M.l2.W = json.l2.W; M.l2.b = json.l2.b;
}
