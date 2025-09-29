// lib/bots/mininet_bot.ts (v7 - qwen-style hands + policy scan + rule fallback, compile-safe)
type AnyCard = any;
type BotMove = { move: 'play' | 'pass'; cards?: AnyCard[]; reason?: string };

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
  const counts = (s.counts ?? [17,17,17]).map(x => Math.min(20, x) / 20);
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

// ===== Seat & hand helpers =====
function getSeatKey(c:any): any { if (c && ('seat' in c)) return c.seat; if (c && ('role' in c)) return c.role; if (c && ('player' in c)) return c.player; return undefined; }
function getSeat(c:any): number | undefined { const k = getSeatKey(c); return (typeof k === 'number') ? k : undefined; }

function normalizeHandTokens(raw:any): AnyCard[] {
  if (Array.isArray(raw)) return raw as AnyCard[];
  if (raw && typeof raw === 'object') {
    // Common wrappers: {hand:[...]}, {cards:[...]}, {list:[...]}
    const inner = (raw as any).hand ?? (raw as any).cards ?? (raw as any).list;
    if (Array.isArray(inner)) return inner as AnyCard[];
  }
  return [];
}

function getHandFromCtx(c:any): AnyCard[] {
  // 1) qwen-style: ctx.hands is a flat array = current player's hand
  const direct = (c as any)?.hands;
  if (Array.isArray(direct) && (direct.length === 0 || !Array.isArray(direct[0]))) {
    return normalizeHandTokens(direct);
  }
  // 2) other direct paths
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
  // 3) hands as array-of-arrays (by seat)
  const seatNum = getSeat(c);
  const hands = (c as any)?.hands ?? (c as any)?.state?.hands;
  if (Array.isArray(hands)) {
    if (typeof seatNum === 'number' && Array.isArray(hands[seatNum])) return normalizeHandTokens(hands[seatNum]);
    for (const arr of hands) { const norm = normalizeHandTokens(arr); if (norm.length) return norm; }
  } else if (hands && typeof hands === 'object') {
    // 4) object map: keys may be numeric strings, Chinese seat names, or roles
    const seatKey = getSeatKey(c);
    const candidateKeys = [seatKey, String(seatKey), (c as any)?.role, (c as any)?.seat, '甲','乙','丙','地主','农民A','农民B','landlord','farmerA','farmerB','0','1','2'];
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

// ===== Require & simple rules =====
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
function parseRequire(c:any): Req {
  const r = c?.require;
  if (r && typeof r === 'object') {
    const t = (r as any).type ?? (r as any).kind ?? (r as any).moveType ?? (r as any).name ?? (r as any).expected ?? 'any';
    const name = String(t).toLowerCase();
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
    const type = map[name] ?? 'any';
    const len  = (r as any).len ?? (r as any).length ?? (r as any).size ?? (r as any).width ?? undefined;
    const baseIdx = (r as any).baseIdx!=null ? Number((r as any).baseIdx) :
                    (r as any).baseRank!=null ? rankIndex((r as any).baseRank) :
                    (r as any).rank!=null ? rankIndex((r as any).rank) : undefined;
    const wings = ((r as any).wings==='pair' || (r as any).wings==='single') ? (r as any).wings : undefined;
    return { type, len, baseIdx, wings: wings??null };
  }
  const last = lastNonPassFrom(c);
  if (Array.isArray(last)) return { type:'any' };
  return { type:'lead' };
}

// ===== Policy deep scan =====
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

// ===== Simple lead candidates (fallback) =====
function byRankBuckets(hand: AnyCard[]): Record<RankChar, AnyCard[]> {
  const buckets: Record<RankChar, AnyCard[]> = Object.fromEntries(RANKS.map(r=>[r, []])) as any;
  for (const card of hand) buckets[toRankChar(card)].push(card);
  return buckets;
}
function leadCandidatesFromHand(hand: AnyCard[]): AnyCard[][] {
  const b = byRankBuckets(hand), out: AnyCard[][] = [];
  // straights 8..5
  for (let L=8; L>=5; L--) {
    const idxs = STRAIGHT_RANKS.map(r=>RANK_IDX[r]);
    for (let i=0;i+L-1<idxs.length;i++){
      const window = idxs.slice(i, i+L);
      if (window.every(idx => Object.values(b)[idx]?.length>=1)) out.push(window.map(idx => Object.values(b)[idx][0]));
    }
  }
  // triples, pairs, singles
  for (const r of RANKS) if (b[r].length>=3) out.push([b[r][0],b[r][1],b[r][2]]);
  for (const r of RANKS) if (b[r].length>=2) out.push([b[r][0],b[r][1]]);
  for (const r of RANKS) if (b[r].length>=1) out.push([b[r][0]]);
  return out.slice(0,200);
}

// ======== Bot main ========
export async function MiniNetBot(ctx:any): Promise<BotMove> {
  const state: MiniState = {
    role: Number(ctx?.role ?? 0) as 0|1|2,
    landlord: Number(ctx?.landlord ?? 0) as 0|1|2,
    lastMove: undefined,
    myHand: getHandFromCtx(ctx).map(toRankChar),
    counts: ctx?.counts,
    bombsUsed: ctx?.stats?.bombs ?? ctx?.bombsUsed ?? 0,
  };

  const rawHand: AnyCard[] = getHandFromCtx(ctx);
  const handsShape = Array.isArray((ctx as any)?.hands) ? (Array.isArray(((ctx as any).hands || [])[0]) ? 'nested' : 'flat') : (typeof (ctx as any)?.hands === 'object' ? 'object' : 'none');
  const { cands: policyCands, source } = extractCandidatesFromCtx(ctx);
  let candidates: AnyCard[][] = policyCands;

  if (!candidates.length) {
    if (Array.isArray(rawHand) && rawHand.length) {
      const req = parseRequire(ctx);
      if (req.type === 'lead' || req.type === 'any') {
        candidates = leadCandidatesFromHand(rawHand);
      }
    }
  }

  if (!candidates.length) {
    const sk = getSeatKey(ctx);
    const handLen = Array.isArray(rawHand) ? rawHand.length : -1;
    if (ctx?.canPass) return { move:'pass', reason:`MiniNet v7: no candidates (source=${source}, seatKey=${String(sk)}, handLen=${handLen}, handsShape=${handsShape})` };
    const lowest = Array.isArray(rawHand) && rawHand.length ? [...rawHand].sort((a,b)=>rankIndex(a)-rankIndex(b))[0] : undefined;
    if (lowest!=null) candidates = [[lowest]];
  }

  let best = candidates[0];
  let bestScore = -1e9;
  for (const m of candidates) {
    const x = buildX(state, m.map(toRankChar));
    let score = mlpScore(x);
    score += (Math.random()-0.5)*0.01;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return { move:'play', cards: best, reason:`MiniNet v7: cands=${candidates.length} from=${source} score=${bestScore.toFixed(3)}` };
}

export function loadMiniNetWeights(json: {l1:Dense; l2:Dense}) {
  M.l1.W = json.l1.W; M.l1.b = json.l1.b;
  M.l2.W = json.l2.W; M.l2.b = json.l2.b;
}
