// lib/bots/mininet_bot.ts (v5 policy-scan + seatfix)
// Generates legal candidates by (1) scanning ctx.policy deeply, (2) falling back to hand-based rule generator.
// Returns raw tokens to engine; uses tiny MLP to score.

type AnyCard = any;
type BotMove = { move: 'play' | 'pass'; cards?: AnyCard[]; reason?: string };

const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
type RankChar = typeof RANKS[number];
const RANK_IDX = Object.fromEntries(RANKS.map((r,i)=>[r,i])) as Record<string, number>;
const STRAIGHT_RANKS: RankChar[] = ['3','4','5','6','7','8','9','T','J','Q','K','A'];

const MOVE_TYPES = [
  'pass','single','pair','triple','straight','pair-straight','plane',
  'triple-with-single','triple-with-pair','four-with-two','bomb','rocket'
] as const;
type MoveType = typeof MOVE_TYPES[number];

function toRankChar(raw:any): RankChar {
  if (raw==null) return '3';
  const s = String(raw);
  if (s==='x' || s==='X') return s as RankChar;
  const up = s.toUpperCase();
  if (['3','4','5','6','7','8','9','T','J','Q','K','A','2'].includes(up)) return up as RankChar;
  if (s.length>1){
    const last = s[s.length-1].toUpperCase();
    if (['3','4','5','6','7','8','9','T','J','Q','K','A','2'].includes(last)) return last as RankChar;
  }
  return '3';
}
function rankIndex(raw:any): number { const r = toRankChar(raw); return RANK_IDX[r] ?? 0; }

// ===== tiny MLP (same as v4) =====
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
  if (h.find(x=>x===4) && n===4) return 'bomb';
  if (n===1) return 'single';
  if (n===2 && uniq===1) return 'pair';
  if (n===3 && uniq===1) return 'triple';
  const run=h.map(v=>v>0?1:0); let best=0,cur=0;
  for (let i=0;i<13;i++){ cur=run[i]?cur+1:0; best=Math.max(best,cur); }
  if (best>=5 && uniq===n) return 'straight';
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
  const roleOne=[0,0,0]; roleOne[s.role]=1;
  const lordOne=[0,0,0]; lordOne[s.landlord]=1;
  const counts=(s.counts??[17,17,17]).map(x=>Math.min(20,x)/20);
  const bombs=[(s.bombsUsed??0)/6];
  const lastType = classifyMove(s.lastMove?.cards);
  const lastOne = MOVE_TYPES.map(t=>t===lastType?1:0);
  const handH = hist15(s.myHand??[]).map(x=>Math.min(4,x)/4);
  return [...roleOne, ...lordOne, ...counts, ...bombs, ...lastOne, ...handH];
}
function moveFeat(cards?: AnyCard[]): number[] {
  const t = classifyMove(cards);
  const one = MOVE_TYPES.map(x=>x===t?1:0);
  const n = (cards?.length??0)/20;
  let hi=0; if(cards&&cards.length>0){ hi = cards.map(rankIndex).reduce((a,b)=>Math.max(a,b),0)/14; }
  return [...one, n, hi];
}
function buildX(s: MiniState, m?: AnyCard[]): number[] {
  const v=[...stateFeat(s), ...moveFeat(m)];
  while(v.length<64) v.push(0);
  return v;
}
type Dense={W:number[][]; b:number[]}; type MLP={l1:Dense; l2:Dense};
function relu(x:number){ return x>0?x:0; }
function matVec(W:number[][], x:number[], b:number[]): number[]{ const y=new Array(W.length).fill(0); for(let i=0;i<W.length;i++){ let s=b[i]||0; const row=W[i]; for(let j=0;j<row.length;j++) s+=row[j]*x[j]; y[i]=s; } return y; }
function initHeuristicMLP(): MLP {
  const inDim=64,h=48;
  const z1=Array.from({length:h},(_,i)=>Array.from({length:inDim},(__,j)=>{
    const isHand=(j>=(3+3+3+1+12))&&(j<(3+3+3+1+12+15));
    const handIdx=j-(3+3+3+1+12);
    const isMove=(j>=(3+3+3+1))&&(j<(3+3+3+1+12));
    const moveIdx=j-(3+3+3+1);
    if(isHand){ if(handIdx<=4) return 0.05; if(handIdx>=12) return -0.03; return 0.01; }
    if(isMove){ const t=MOVE_TYPES[moveIdx]; if(t==='bomb'||t==='rocket') return -0.06; if(t==='straight') return 0.06; }
    return 0.0;
  }));
  const b1=new Array(h).fill(0);
  const z2=[Array.from({length:h},(_,j)=>(j<8?0.1:0.02))];
  const b2=[0];
  return {l1:{W:z1,b:b1}, l2:{W:z2,b:b2}};
}
const M=initHeuristicMLP();
function mlpScore(x:number[]): number { const h1=matVec(M.l1.W,x,M.l1.b).map(relu); return matVec(M.l2.W,h1,M.l2.b)[0]; }

// ====== Seat & hand ======
function getSeatKey(ctx:any): any {
  if (ctx && ('seat' in ctx)) return ctx.seat;
  if (ctx && ('role' in ctx)) return ctx.role;
  if (ctx && ('player' in ctx)) return (ctx as any).player;
  return undefined;
}
function getSeat(ctx:any): number|undefined {
  const k = getSeatKey(ctx);
  return (typeof k === 'number') ? k : undefined;
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
  const seatNum = getSeat(ctx);
  const seatKey = getSeatKey(ctx);
  const hands = ctx?.hands ?? ctx?.state?.hands;
  if (Array.isArray(hands)) {
    if (typeof seatNum === 'number' && Array.isArray(hands[seatNum])) return hands[seatNum] as AnyCard[];
    for (const arr of hands){ if (Array.isArray(arr) && arr.length) return arr as AnyCard[]; }
  } else if (hands && typeof hands === 'object') {
    if (seatKey!=null && Array.isArray(hands[seatKey])) return hands[seatKey] as AnyCard[];
    const seatAliases = [seatKey, ctx?.role, ctx?.seat, '甲','乙','丙','地主','农民A','农民B','landlord','farmerA','farmerB'];
    for (const k of seatAliases) {
      if (k!=null && Array.isArray((hands as any)[k])) return (hands as any)[k] as AnyCard[];
    }
    for (const k of Object.keys(hands)) {
      const v = (hands as any)[k];
      if (Array.isArray(v) && v.length) return v as AnyCard[];
    }
  }
  return [];
}

// ====== Require & rules (same as v4) ======
type Req = { type: MoveType|'lead'|'any'; len?: number; wings?: 'single'|'pair'|null; baseIdx?: number; };
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
    const len  = (r as any).len ?? (r as any).length ?? (r as any).size ?? (r as any).width ?? undefined;
    const baseIdx = (r as any).baseIdx!=null ? Number((r as any).baseIdx) :
                    (r as any).baseRank!=null ? rankIndex((r as any).baseRank) :
                    (r as any).rank!=null ? rankIndex((r as any).rank) : undefined;
    const wings = ((r as any).wings==='pair' || (r as any).wings==='single') ? (r as any).wings : undefined;
    return { type, len, baseIdx, wings: wings??null };
  }
  const p = (r as any)?.pattern || (r as any)?.shape || (r as any)?.follow || (r as any)?.sameAs || (r as any)?.expected || (r as any)?.need;
  if (p && typeof p==='object'){
    const t2 = (p.type || p.kind || p.name)?.toString()?.toLowerCase();
    if (t2) {
      const map2: Record<string, MoveType|'lead'|'any'> = {
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
      const type = map2[t2] ?? 'any';
      const len  = (p as any).len ?? (p as any).length ?? (p as any).size ?? (p as any).width ?? undefined;
      const baseIdx = (p as any).baseIdx!=null ? Number((p as any).baseIdx) :
                      (p as any).baseRank!=null ? rankIndex((p as any).baseRank) :
                      (p as any).rank!=null ? rankIndex((p as any).rank) : undefined;
      const wings = ((p as any).wings==='pair' || (p as any).wings==='single') ? (p as any).wings : undefined;
      return { type, len, baseIdx, wings: wings??null };
    }
  }
  const last = lastNonPassFrom(ctx);
  if (Array.isArray(last)) {
    // basic inference (omitted for brevity in v5)
    return { type:'any' };
  }
  return { type: 'lead' };
}

// ====== Policy deep scan ======
function looksLikeCardsArray(a:any): boolean {
  return Array.isArray(a) && a.length>0;
}
function looksLikeCandidatesArray(a:any): boolean {
  // either array of arrays, or array of objects with .cards arrays
  return Array.isArray(a) && a.some(x=>Array.isArray(x) || (x && typeof x==='object' && Array.isArray((x as any).cards)));
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
  // direct forms
  if (looksLikeCandidatesArray(pol)) return normalizeCandidates(pol);
  if (Array.isArray(pol) && pol.length && looksLikeCandidatesArray(pol[0])) {
    // nested array
    return extractFromPolicy(pol[0], depth+1);
  }
  if (typeof pol==='object') {
    for (const k of POLICY_KEYS) {
      if (k in pol) {
        const cand = normalizeCandidates((pol as any)[k]);
        if (cand.length) return cand;
      }
    }
    // recursive search
    for (const k of Object.keys(pol)) {
      const v = (pol as any)[k];
      const cand = extractFromPolicy(v, depth+1);
      if (cand.length) return cand;
    }
  }
  if (typeof pol === 'function') {
    try {
      const ret = pol();
      const cand = normalizeCandidates(ret);
      if (cand.length) return cand;
    } catch {}
  }
  return [];
}
function extractCandidatesFromCtx(ctx:any): {cands: AnyCard[][], source: string} {
  // 1) policy
  if ('policy' in (ctx||{})) {
    const pc = extractFromPolicy((ctx as any).policy, 0);
    if (pc.length) return { cands: pc, source: 'policy' };
  }
  // 2) top-level keys (compat with v3)
  const keys = ['legalMoves','candidates','cands','moves','options','legal','legal_cards'];
  for (const k of keys) {
    const v = (ctx as any)[k];
    const norm = normalizeCandidates(v);
    if (norm.length) return { cands: norm, source: k };
  }
  return { cands: [], source: 'none' };
}

// ====== Rule-based fallback (subset; re-use some v4 helpers) ======
function byRankBuckets(hand: AnyCard[]): Record<RankChar, AnyCard[]> {
  const buckets: Record<RankChar, AnyCard[]> = Object.fromEntries(RANKS.map(r=>[r, []])) as any;
  for (const c of hand) buckets[toRankChar(c)].push(c);
  return buckets;
}
// simple lead generator if we have hand (omitting follow-up strictness due to unknown require encoding)
function leadCandidatesFromHand(hand: AnyCard[]): AnyCard[][] {
  const b = byRankBuckets(hand), out: AnyCard[][] = [];
  // prefer straights/pairs/triples then singles
  for (let L=8; L>=5; L--) {
    const idxs = STRAIGHT_RANKS.map(r=>RANK_IDX[r]);
    for (let i=0;i+L-1<idxs.length;i++){
      const window = idxs.slice(i, i+L);
      if (window.every(idx => Object.values(b)[idx]?.length>=1)) out.push(window.map(idx => Object.values(b)[idx][0]));
    }
  }
  for (const r of RANKS) if (b[r].length>=3) out.push([b[r][0],b[r][1],b[r][2]]);
  for (const r of RANKS) if (b[r].length>=2) out.push([b[r][0],b[r][1]]);
  for (const r of RANKS) if (b[r].length>=1) out.push([b[r][0]]);
  return out.slice(0,200);
}

// ====== Bot main ======
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
  const { cands: policyCands, source } = extractCandidatesFromCtx(ctx);
  let candidates: AnyCard[][] = policyCands;

  if (!candidates.length) {
    if (Array.isArray(rawHand) && rawHand.length) {
      const req = parseRequire(ctx);
      if (req.type==='lead' || req.type==='any') {
        candidates = leadCandidatesFromHand(rawHand);
      }
    }
  }

  if (!candidates.length) {
    const sk = getSeatKey(ctx);
    const handLen = Array.isArray(rawHand) ? rawHand.length : -1;
    if (ctx?.canPass) return { move:'pass', reason:`MiniNet v5: no candidates (source=${source}, seatKey=${String(sk)}, handLen=${handLen})` };
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
  return { move:'play', cards: best, reason:`MiniNet v5: cands=${candidates.length} from=${source} score=${bestScore.toFixed(3)}` };
}

export function loadMiniNetWeights(json: {l1:Dense; l2:Dense}) {
  M.l1.W = json.l1.W; M.l1.b = json.l1.b;
  M.l2.W = json.l2.W; M.l2.b = json.l2.b;
}
