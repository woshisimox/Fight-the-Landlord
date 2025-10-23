// lib/bots/mininet_bot.ts (v8.1 - use extractCandidatesFromCtx in main; follow-logic + qwen hands + counts fix)
type AnyCard = any;
type BotMove =
  | { phase?: 'play'; move: 'play' | 'pass'; cards?: AnyCard[]; reason?: string }
  | { phase: 'bid'; bid: boolean; reason?: string }
  | { phase: 'double'; double: boolean; reason?: string };

const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
type RankChar = typeof RANKS[number];
const RANK_IDX: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i])) as Record<string, number>;
const STRAIGHT_RANKS: RankChar[] = ['3','4','5','6','7','8','9','T','J','Q','K','A'];

const MOVE_TYPES = [
  'pass','single','pair','triple','straight','pair-straight','plane',
  'triple-with-single','triple-with-pair','four-with-two','bomb','rocket'
] as const;
type MoveType = typeof MOVE_TYPES[number];

function toRankChar(raw: any): RankChar {
  if (raw == null) return '3';
  const s = String(raw);
  if (s === 'x' || s === 'X') return s as RankChar;
  const up = s.toUpperCase();
  if (['3','4','5','6','7','8','9','T','J','Q','K','A','2'].includes(up)) return up as RankChar;
  if (s.length > 1) {
    const last = s[s.length - 1].toUpperCase();
    if (['3','4','5','6','7','8','9','T','J','Q','K','A','2'].includes(last)) return last as RankChar;
  }
  return '3';
}
function rankIndex(raw: any): number { const r = toRankChar(raw); return RANK_IDX[r] ?? 0; }

// ===== tiny MLP =====
function hist15(cards: AnyCard[] | undefined): number[] {
  const h = new Array(15).fill(0);
  if (cards) for (const c of cards) h[rankIndex(c)]++;
  return h;
}
function classifyMove(cards?: AnyCard[]): MoveType {
  if (!cards || cards.length === 0) return 'pass';
  const n = cards.length;
  const h = hist15(cards);
  const uniq = h.filter(x => x > 0).length;
  const ranks = cards.map(toRankChar);
  const hasRocket = ranks.includes('x') && ranks.includes('X') && n === 2;
  if (hasRocket) return 'rocket';
  if (h.find(x => x === 4) && n === 4) return 'bomb';
  if (n === 1) return 'single';
  if (n === 2 && uniq === 1) return 'pair';
  if (n === 3 && uniq === 1) return 'triple';

  const run = h.map(v => v > 0 ? 1 : 0);
  let best = 0, cur = 0;
  for (let i = 0; i < 13; i++) { cur = run[i] ? cur + 1 : 0; best = Math.max(best, cur); }
  if (best >= 5 && uniq === n) return 'straight';
  return 'single';
}
type MiniState = {
  role: 0|1|2;
  landlord: 0|1|2;
  lastMove?: { kind:'play'|'pass'; cards?: AnyCard[] };
  myHand?: AnyCard[];
  counts?: [number, number, number];
  bombsUsed?: number;
};
function stateFeat(s: MiniState): number[] {
  const roleOne = [0,0,0]; roleOne[s.role] = 1;
  const lordOne = [0,0,0]; lordOne[s.landlord] = 1;
  const countsArr = (Array.isArray(s.counts) ? s.counts : [17,17,17]) as number[];
  const counts = countsArr.map(x => Math.min(20, Number(x)||0) / 20);
  const bombs = [(s.bombsUsed ?? 0) / 6];
  const lastType = classifyMove(s.lastMove?.cards);
  const lastOneHot = MOVE_TYPES.map(t => t === lastType ? 1 : 0);
  const handH = hist15(s.myHand ?? []).map(x => Math.min(4, x) / 4);
  return [...roleOne, ...lordOne, ...counts, ...bombs, ...lastOneHot, ...handH];
}
function moveFeat(cards?: AnyCard[]): number[] {
  const t = classifyMove(cards);
  const onehot = MOVE_TYPES.map(x => x === t ? 1 : 0);
  const n = (cards?.length ?? 0) / 20;
  let hi = 0; if (cards && cards.length > 0) hi = cards.map(rankIndex).reduce((a, b) => Math.max(a, b), 0) / 14;
  return [...onehot, n, hi];
}
function buildX(s: MiniState, m?: AnyCard[]): number[] {
  const v = [...stateFeat(s), ...moveFeat(m)];
  while (v.length < 64) v.push(0);
  return v;
}
type Dense = { W: number[][]; b: number[] };
type MLP = { l1: Dense; l2: Dense };
function relu(x:number){ return x>0?x:0; }
function matVec(W:number[][], x:number[], b:number[]): number[] { const y = new Array(W.length).fill(0); for (let i=0;i<W.length;i++){ let s=b[i]||0; const row=W[i]; for (let j=0;j<row.length;j++) s+=row[j]*x[j]; y[i]=s; } return y; }
function initHeuristicMLP(): MLP {
  const inDim=64,h=48;
  const z1 = Array.from({length:h}, (_,i)=> Array.from({length:inDim}, (__,j)=> {
    const isHandHist = (j>= (3+3+3+1+12)) && (j < (3+3+3+1+12+15));
    const handIdx = j - (3+3+3+1+12);
    const isMoveTypeStart = (j>= (3+3+3+1)) && (j < (3+3+3+1+12));
    const moveTypeIdx = j - (3+3+3+1);
    if (isHandHist) { if (handIdx <= 4) return 0.05; if (handIdx >= 12) return -0.03; return 0.01; }
    if (isMoveTypeStart) { if (['bomb','rocket'].includes(MOVE_TYPES[moveTypeIdx] as any)) return -0.06; if (MOVE_TYPES[moveTypeIdx]==='straight') return 0.06; }
    return 0.0;
  }));
  const b1 = new Array(h).fill(0);
  const z2 = [ Array.from({length:h}, (_,j)=> (j<8?0.1:0.02)) ];
  const b2 = [0];
  return { l1:{W:z1,b:b1}, l2:{W:z2,b:b2} };
}
const M = initHeuristicMLP();
function mlpScore(x:number[]): number { const h1 = matVec(M.l1.W, x, M.l1.b).map(relu); const y = matVec(M.l2.W, h1, M.l2.b)[0]; return y; }

// ===== Counts normalization (robust) =====
function normalizeCountsFromCtx(c:any): [number,number,number] {
  const srcs = [(c as any)?.counts, (c as any)?.handsCount, (c as any)?.state?.counts];
  for (const s of srcs) {
    if (Array.isArray(s) && s.length>=3 && s.every((x:any)=> typeof x==='number')) {
      return [Number(s[0])||0, Number(s[1])||0, Number(s[2])||0];
    }
    if (s && typeof s==='object') {
      const tryKeys:any[] = ['0','1','2',0,1,2,'甲','乙','丙','landlord','farmerA','farmerB','地主','农民A','农民B'];
      const got:number[] = [];
      for (const k of tryKeys) {
        if ((s as any)[k] != null && typeof (s as any)[k] === 'number') got.push(Number((s as any)[k])||0);
      }
      if (got.length>=3) return [got[0],got[1],got[2]] as [number,number,number];
      const vals = Object.values(s).filter(v=>typeof v==='number') as number[];
      if (vals.length>=3) return [Number(vals[0])||0, Number(vals[1])||0, Number(vals[2])||0];
    }
    if (typeof s === 'number') return [s,s,s] as [number,number,number];
  }
  try {
    const h = (c as any)?.hands;
    if (Array.isArray(h) && Array.isArray(h[0])) {
      const a = (h as any[]).map((x:any)=> Array.isArray(x)? x.length : 0);
      if (a.length>=3) return [a[0]||0,a[1]||0,a[2]||0];
    } else if (h && typeof h==='object') {
      const tryKeys:any[] = ['0','1','2',0,1,2,'甲','乙','丙','landlord','farmerA','farmerB','地主','农民A','农民B'];
      const arr:number[] = [];
      for (const k of tryKeys) if (Array.isArray((h as any)[k])) arr.push(((h as any)[k] as any[]).length);
      if (arr.length>=3) return [arr[0]||0,arr[1]||0,arr[2]||0];
    }
  } catch {}
  return [17,17,17];
}

// ===== Seat & hand helpers =====
function getSeatKey(c:any): any { if (c && ('seat' in c)) return c.seat; if (c && ('role' in c)) return c.role; if (c && ('player' in c)) return c.player; return undefined; }
function getSeat(c:any): number | undefined { const k = getSeatKey(c); return (typeof k === 'number') ? k : undefined; }

function normalizeHandTokens(raw:any): AnyCard[] {
  if (Array.isArray(raw)) return raw as AnyCard[];
  if (raw && typeof raw === 'object') {
    const inner = (raw as any).hand ?? (raw as any).cards ?? (raw as any).list;
    if (Array.isArray(inner)) return inner as AnyCard[];
  }
  return [];
}

function getHandFromCtx(c:any): AnyCard[] {
  const direct = (c as any)?.hands;
  if (Array.isArray(direct) && (direct.length === 0 || !Array.isArray(direct[0]))) {
    return normalizeHandTokens(direct);
  }
  const tryPaths: Array<(x:any)=>any> = [
    (x:any)=> x?.hand,
    (x:any)=> x?.myHand,
    (x:any)=> x?.cards,
    (x:any)=> x?.myCards,
    (x:any)=> x?.state?.hand,
    (x:any)=> x?.state?.myHand,
  ];
  for (const f of tryPaths) {
    const v = f(c);
    const norm = normalizeHandTokens(v);
    if (norm.length) return norm;
  }
  const seatNum = getSeat(c);
  const hands = (c as any)?.hands ?? (c as any)?.state?.hands;
  if (Array.isArray(hands)) {
    if (typeof seatNum === 'number' && Array.isArray(hands[seatNum])) return normalizeHandTokens(hands[seatNum]);
    for (const arr of hands) { const norm = normalizeHandTokens(arr); if (norm.length) return norm; }
  } else if (hands && typeof hands === 'object') {
    const seatKey = getSeatKey(c);
    const candidateKeys:any[] = [seatKey, String(seatKey), (c as any)?.role, (c as any)?.seat, '甲','乙','丙','地主','农民A','农民B','landlord','farmerA','farmerB','0','1','2'];
    for (const k of candidateKeys) {
      if (k!=null && k in hands) {
        const norm = normalizeHandTokens((hands as any)[k]);
        if (norm.length) return norm;
      }
    }
    for (const k of Object.keys(hands)) {
      const norm = normalizeHandTokens((hands as any)[k]);
      if (norm.length) return norm;
    }
  }
  return [];
}

// ===== Require & move analysis =====
type Req = { type: MoveType|'lead'|'any'; len?: number; wings?: 'single'|'pair'|null; baseIdx?: number; };
function lastNonPassFrom(c:any): AnyCard[] | undefined {
  const sources = [c?.currentTrick, c?.trick, c?.history];
  for (const s of sources) {
    if (Array.isArray(s) && s.length) {
      for (let i=s.length-1; i>=0; i--) {
        const it = s[i];
        const cards = (it as any)?.cards ?? (it as any)?.move?.cards ?? (it as any)?.play ?? it;
        if (Array.isArray(cards) && cards.length > 0) return cards as AnyCard[];
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
  if (h.find(x=>x===4) && cards.length===4) {
    const idx = h.findIndex(x=>x===4);
    return {type:'bomb', baseIdx: idx};
  }
  if (ranks.includes('x') && ranks.includes('X') && cards.length===2) return {type:'rocket', baseIdx: 99};

  const idxs = ranks.map(r=>RANK_IDX[r]).sort((a,b)=>a-b);
  const uniq = Array.from(new Set(idxs));
  const isStraight = uniq.every(i=>i<=RANK_IDX['A']) && uniq.length>=5 && uniq.length===cards.length && uniq.every((v,i)=> i===0 || v-uniq[i-1]===1);
  if (isStraight) return {type:'straight', len: uniq.length, baseIdx: uniq[uniq.length-1]};

  const pairIdxs: number[] = [];
  for (let i=0;i<13;i++){ if (h[i]>=2) pairIdxs.push(i); }
  pairIdxs.sort((a,b)=>a-b);
  const needPairs = cards.length/2;
  for (let i=0;i+needPairs-1<pairIdxs.length;i++){
    const window = pairIdxs.slice(i,i+needPairs);
    const ok = window.every((v,k)=>k===0 || v-window[k-1]===1);
    if (ok && needPairs>=3) return {type:'pair-straight', len: needPairs, baseIdx: window[window.length-1]};
  }

  const tripleIdxs: number[] = []; for (let i=0;i<13;i++){ if (h[i]===3) tripleIdxs.push(i); }
  if (tripleIdxs.length>=2){
    if (tripleIdxs.length*3 === cards.length) {
      tripleIdxs.sort((a,b)=>a-b);
      if (tripleIdxs.every((v,k)=>k===0 || v-tripleIdxs[k-1]===1))
        return {type:'plane', len: tripleIdxs.length, baseIdx: tripleIdxs[tripleIdxs.length-1]};
    } else {
      tripleIdxs.sort((a,b)=>a-b);
      const width = tripleIdxs.length;
      const rest = cards.length - width*3;
      if (rest===width) return {type:'triple-with-single', len: width, baseIdx: tripleIdxs[tripleIdxs.length-1], wings:'single'};
      if (rest===width*2) return {type:'triple-with-pair', len: width, baseIdx: tripleIdxs[tripleIdxs.length-1], wings:'pair'};
    }
  }
  const fourIdx = h.findIndex(x=>x===4);
  if (fourIdx>=0){ return {type:'four-with-two', baseIdx: fourIdx}; }
  return {type:'single', baseIdx: rankIndex(cards[0])};
}
function parseRequire(c:any): Req {
  const r = c?.require;
  if (r && typeof r === 'object') {
    const t = (r as any).type ?? (r as any).kind ?? (r as any).moveType ?? (r as any).name ?? (r as any).expected ?? 'any';
    const name = String(t).toLowerCase();
    const map: Record<string, MoveType|'lead'|'any'> = {
      'lead':'lead','any':'any','single':'single','pair':'pair','triple':'triple',
      'straight':'straight','shunzi':'straight','pair-straight':'pair-straight','liandui':'pair-straight',
      'plane':'plane','feiji':'plane','triple-with-single':'triple-with-single','triple-with-pair':'triple-with-pair',
      'four-with-two':'four-with-two','bomb':'bomb','rocket':'rocket'
    };
    const type = map[name] ?? 'any';
    const len  = (r as any).len ?? (r as any).length ?? (r as any).size ?? (r as any).width ?? undefined;
    let baseIdx: number | undefined;
    if ((r as any).baseIdx != null) {
      baseIdx = Number((r as any).baseIdx);
    } else if ((r as any).baseRank != null) {
      baseIdx = rankIndex((r as any).baseRank);
    } else if ((r as any).rank != null) {
      const rawRank = (r as any).rank;
      baseIdx = typeof rawRank === 'number' ? Number(rawRank) : rankIndex(rawRank);
    }
    const wings = ((r as any).wings==='pair' || (r as any).wings==='single') ? (r as any).wings : undefined;
    return { type, len, baseIdx, wings: wings??null };
  }
  const last = lastNonPassFrom(c);
  if (Array.isArray(last)) {
    const a = analyzeMove(last);
    return { type:a.type, len:a.len, baseIdx:a.baseIdx, wings:a.wings??null };
  }
  return { type:'lead' };
}

// ===== Policy scan =====
function looksLikeCandidatesArray(a:any): boolean {
  return Array.isArray(a) && a.some(x => Array.isArray(x) || (x && typeof x === 'object' && Array.isArray((x as any).cards)));
}
function normalizeCandidates(a:any): AnyCard[][] {
  const out: AnyCard[][] = [];
  if (!Array.isArray(a)) return out;
  for (const it of a) {
    if (Array.isArray(it)) { if (it.length) out.push(it as AnyCard[]); }
    else if (it && typeof it==='object' && Array.isArray((it as any).cards)) {
      const c = (it as any).cards as AnyCard[];
      if (c.length) out.push(c);
    }
  }
  return out;
}
const POLICY_KEYS = ['legal','candidates','moves','options','plays','follow','followups','list','actions','choices','combos','legalMoves','legal_cards'];
function extractFromPolicy(pol:any, depth=0): AnyCard[][] {
  if (!pol || depth>4) return [];
  if (looksLikeCandidatesArray(pol)) return normalizeCandidates(pol);
  if (Array.isArray(pol) && pol.length && looksLikeCandidatesArray(pol[0])) {
    return extractFromPolicy(pol[0], depth+1);
  }
  if (typeof pol==='object') {
    for (const k of POLICY_KEYS) {
      if (k in pol) {
        const cand = normalizeCandidates((pol as any)[k]);
        if (cand.length) return cand;
      }
    }
    for (const k of Object.keys(pol)) {
      const v = (pol as any)[k];
      const cand = extractFromPolicy(v, depth+1);
      if (cand.length) return cand;
    }
  }
  if (typeof pol === 'function') {
    try { const ret = pol(); const cand = normalizeCandidates(ret); if (cand.length) return cand; } catch {}
  }
  return [];
}
function extractCandidatesFromCtx(c:any): {cands: AnyCard[][], source: string} {
  if ('policy' in (c||{})) {
    const pc = extractFromPolicy((c as any).policy, 0);
    if (pc.length) return { cands: pc, source: 'policy' };
  }
  const keys = ['legalMoves','candidates','cands','moves','options','legal','legal_cards'];
  for (const k of keys) {
    const v = (c as any)[k];
    const norm = normalizeCandidates(v);
    if (norm.length) return { cands: norm, source: k };
  }
  return { cands: [], source: 'none' };
}

// ===== Candidate generators =====
function byRankBuckets(hand: AnyCard[]): Record<RankChar, AnyCard[]> {
  const buckets: Record<RankChar, AnyCard[]> = Object.fromEntries(RANKS.map(r=>[r, []])) as any;
  for (const card of hand) buckets[toRankChar(card)].push(card);
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
  for (let i=0;i+len-1<STRAIGHT_RANKS.length;i++){
    const seq = STRAIGHT_RANKS.slice(i, i+len);
    const maxIdx = RANK_IDX[seq[seq.length-1]];
    if (maxIdx <= RANK_IDX['A'] && seq.every(ch => b[ch].length>=1)) {
      if (maxIdx > minIdx) out.push(seq.map(ch => b[ch][0]));
    }
  }
  return out;
}
function pickPairStraight(b: Record<RankChar,AnyCard[]>, len:number, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (let i=0;i+len-1<STRAIGHT_RANKS.length;i++){
    const seq = STRAIGHT_RANKS.slice(i, i+len);
    const maxIdx = RANK_IDX[seq[seq.length-1]];
    if (seq.every(ch => b[ch].length>=2)) {
      if (maxIdx > minIdx) {
        const cand: AnyCard[] = [];
        for (const ch of seq) { cand.push(b[ch][0], b[ch][1]); }
        out.push(cand);
      }
    }
  }
  return out;
}
function pickPlane(b: Record<RankChar,AnyCard[]>, width:number, minIdx:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (let i=0;i+width-1<STRAIGHT_RANKS.length;i++){
    const seq = STRAIGHT_RANKS.slice(i, i+width);
    const maxIdx = RANK_IDX[seq[seq.length-1]];
    if (seq.every(ch => b[ch].length>=3)) {
      if (maxIdx > minIdx) {
        const cand: AnyCard[] = [];
        for (const ch of seq) { cand.push(b[ch][0], b[ch][1], b[ch][2]); }
        out.push(cand);
      }
    }
  }
  return out;
}
function addWingsSingles(core: AnyCard[][], b: Record<RankChar,AnyCard[]>, width:number): AnyCard[][] {
  const out: AnyCard[][] = [];
  for (const c of core){
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
      if (arr.length>=2) { pairs.push(arr[0], arr[1]); if (pairs.length>=width*2) break; }
    }
    if (pairs.length>=width*2){
      out.push([...c, ...pairs.slice(0, width*2)]);
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
        const singles: AnyCard[] = [];
        for (const rr of RANKS) for (const t of b[rr]) if (!used.has(t)) singles.push(t);
        if (singles.length>=2) out.push([...core, singles[0], singles[1]]);
      } else {
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

// Build by rules according to require
function buildRuleCandidates(hand: AnyCard[], ctx:any): AnyCard[][] {
  const req = parseRequire(ctx);
  const b = byRankBuckets(hand);
  let cands: AnyCard[][] = [];

  // bombs/rocket always allowed as overcall (common rule)
  const bombsAny = pickBombsAbove(b, -1);
  const rocketAny = pickRocket(b);

  if (req.type==='lead' || req.type==='any'){
    for (let L=8; L>=5; L--) cands.push(...pickStraight(b, L, -1));
    for (let L=5; L>=3; L--) cands.push(...pickPairStraight(b, L, -1));
    cands.push(...pickTriplesAbove(b, -1));
    cands.push(...pickPairsAbove(b, -1));
    cands.push(...pickSinglesAbove(b, -1));
    cands.push(...bombsAny, ...rocketAny);
    return cands.slice(0,200);
  }

  const base = req.baseIdx ?? -1;
  switch (req.type){
    case 'single': cands.push(...pickSinglesAbove(b, base)); break;
    case 'pair':   cands.push(...pickPairsAbove  (b, base)); break;
    case 'triple': cands.push(...pickTriplesAbove(b, base)); break;
    case 'straight': {
      const L = Math.max(5, req.len ?? 5);
      cands.push(...pickStraight(b, L, base));
      break;
    }
    case 'pair-straight': {
      const L = Math.max(3, req.len ?? 3);
      cands.push(...pickPairStraight(b, L, base));
      break;
    }
    case 'plane': {
      const W = Math.max(2, req.len ?? 2);
      cands.push(...pickPlane(b, W, base));
      break;
    }
    case 'triple-with-single': {
      const W = Math.max(1, req.len ?? 1);
      const core = pickPlane(b, W, base);
      cands.push(...addWingsSingles(core, b, W));
      break;
    }
    case 'triple-with-pair': {
      const W = Math.max(1, req.len ?? 1);
      const core = pickPlane(b, W, base);
      cands.push(...addWingsPairs(core, b, W));
      break;
    }
    case 'four-with-two': {
      const usePairs = (ctx?.require?.wings==='pair');
      cands.push(...pickFourWithTwo(b, base, !!usePairs));
      break;
    }
    case 'bomb': {
      cands.push(...pickBombsAbove(b, base));
      break;
    }
    case 'rocket': {
      cands.push(...pickRocket(b));
      break;
    }
  }
  if (req.type!=='bomb' && req.type!=='rocket'){
    cands.push(...bombsAny, ...rocketAny);
  }
  return cands.slice(0,200);
}

// ======== Bot main ========
export async function MiniNetBot(ctx:any): Promise<BotMove> {
  if (ctx?.phase === 'bid') {
    const info = ctx?.bid || {};
    const score = typeof info.score === 'number' ? info.score : NaN;
    const threshold = typeof info.threshold === 'number' ? info.threshold : NaN;
    const recommend = typeof info.recommended === 'boolean' ? info.recommended : !!info.bid;
    const parts = [
      'MiniNet:bid',
      Number.isFinite(score) ? `score=${score.toFixed(2)}` : '',
      Number.isFinite(threshold) ? `threshold=${threshold.toFixed(2)}` : '',
      `decision=${recommend ? 'bid' : 'pass'}`,
    ].filter(Boolean);
    return { phase: 'bid', bid: !!recommend, reason: parts.join(' | ') };
  }
  if (ctx?.phase === 'double') {
    const info = ctx?.double || {};
    const recommend = typeof info.recommended === 'boolean' ? info.recommended : false;
    const parts = [
      'MiniNet:double',
      info?.role ? `role=${info.role}` : '',
      `decision=${recommend ? 'double' : 'keep'}`,
    ].filter(Boolean);
    if (info?.info?.farmer) {
      const f = info.info.farmer;
      if (typeof f.dLhat === 'number') parts.push(`Δ̂=${f.dLhat.toFixed(2)}`);
      if (typeof f.counter === 'number') parts.push(`counter=${f.counter.toFixed(2)}`);
    }
    if (info?.info?.landlord && typeof info.info.landlord.delta === 'number') {
      parts.push(`Δ=${info.info.landlord.delta.toFixed(2)}`);
    }
    return { phase: 'double', double: !!recommend, reason: parts.join(' | ') };
  }
  const state: MiniState = {
    role: Number(ctx?.role ?? 0) as 0|1|2,
    landlord: Number(ctx?.landlord ?? 0) as 0|1|2,
    lastMove: undefined,
    myHand: getHandFromCtx(ctx).map(toRankChar),
    counts: normalizeCountsFromCtx(ctx),
    bombsUsed: ctx?.stats?.bombs ?? ctx?.bombsUsed ?? 0,
  };

  const rawHand: AnyCard[] = getHandFromCtx(ctx);
  const handsShape = Array.isArray((ctx as any)?.hands) ? (Array.isArray(((ctx as any).hands || [])[0]) ? 'nested' : 'flat') : (typeof (ctx as any)?.hands === 'object' ? 'object' : 'none');
  // 1) policy via helper
  const { cands: policyData, source } = extractCandidatesFromCtx(ctx);
  // 2) rules
  const ruleCands = buildRuleCandidates(rawHand, ctx);
  let candidates: AnyCard[][] = policyData.length ? policyData : ruleCands;

  if (!candidates.length) {
    const sk = getSeatKey(ctx);
    const handLen = Array.isArray(rawHand) ? rawHand.length : -1;
    if (ctx?.canPass) return { move:'pass', reason:`MiniNet v8.1: no candidates (source=${source}, seatKey=${String(sk)}, handLen=${handLen}, handsShape=${handsShape})` };
    const lowest = Array.isArray(rawHand) && rawHand.length ? [...rawHand].sort((a,b)=>rankIndex(a)-rankIndex(b))[0] : undefined;
    if (lowest!=null) candidates = [[lowest]];
  }

  // Choose by heuristic
  let best = candidates[0];
  let bestScore = -1e9;
  for (const m of candidates) {
    const x = buildX(state, m.map(toRankChar));
    let score = mlpScore(x);
    score += (Math.random()-0.5)*0.01;
    if (score > bestScore) { bestScore = score; best = m; }
  }

  const req = parseRequire(ctx);
  const reqStr = `${req.type}${req.len?`(${req.len})`:''}${req.baseIdx!=null?`>${req.baseIdx}`:''}${req.wings?`[${req.wings}]`:''}`;
  const srcStr = policyData.length ? 'policy' : 'rule';
  return { move:'play', cards: best, reason:`MiniNet v8.1: cands=${candidates.length} src=${srcStr} req=${reqStr} score=${bestScore.toFixed(3)}` };
}

export function loadMiniNetWeights(json: {l1:Dense; l2:Dense}) {
  M.l1.W = json.l1.W; M.l1.b = json.l1.b;
  M.l2.W = json.l2.W; M.l2.b = json.l2.b;
}
