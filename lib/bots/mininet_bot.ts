// lib/bots/mininet_bot.ts
// 轻量内置AI：MiniNet（纯TS两层MLP对候选出牌打分）——健壮版候选提取
type Card = any;
type BotMove = { move: 'play' | 'pass'; cards?: Card[]; reason?: string };

const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
const MOVE_TYPES = [
  'pass','single','pair','triple','straight','pair-straight','plane',
  'triple-with-single','triple-with-pair','four-with-two','bomb','rocket'
] as const;
type MoveType = typeof MOVE_TYPES[number];

function toRankChar(raw:any): string {
  if (raw==null) return '3';
  // If already a typical rank string
  const s = String(raw);
  const t = s.length===1 ? s : s.slice(-1); // try last char if token like '7H' or '♦7'
  const up = t.toUpperCase();
  if (['3','4','5','6','7','8','9','T','J','Q','K','A','2','X'].includes(up)) return up;
  if (up==='0') return 'T';
  if (up==='小' || up==='S') return 'X'; // small joker heuristic
  return '3';
}


function rankIndex(c: Card): number { const r = toRankChar(c); const i = RANKS.indexOf(r as any); return i>=0?i:0; }
function hist15(cards: Card[]|undefined): number[] { const h=new Array(15).fill(0); if(cards)for(const c of cards)h[rankIndex(c)]++; return h; }

function classifyMove(cards?: Card[]): MoveType {
  if (!cards || cards.length===0) return 'pass';
  const n=cards.length, h=hist15(cards), uniq=h.filter(x=>x>0).length;
  const isBomb = uniq===1 && n===4 && !cards.includes('x') && !cards.includes('X');
  const isRocket = n===2 && cards.includes('x') && cards.includes('X');
  if (isRocket) return 'rocket';
  if (isBomb) return 'bomb';
  if (n===1) return 'single';
  if (n===2 && uniq===1) return 'pair';
  if (n===3 && uniq===1) return 'triple';
  const run=h.map(v=>v>0?1:0); let best=0,cur=0;
  for(let i=0;i<12;i++){ cur=run[i]?cur+1:0; best=Math.max(best,cur); }
  if (best>=5 && uniq===n) return 'straight';
  return 'single';
}

type MiniState = {
  role: 0|1|2;
  landlord: 0|1|2;
  lastMove?: { kind:'play'|'pass'; cards?: Card[] };
  myHand?: Card[];
  counts?: [number,number,number];
  bombsUsed?: number;
};

function stateFeat(s: MiniState): number[] {
  const roleOne=[0,0,0]; roleOne[s.role]=1;
  const lordOne=[0,0,0]; lordOne[s.landlord]=1;
  const counts=(s.counts??[17,17,17]).map(x=>Math.min(20,x)/20);
  const bombs=[(s.bombsUsed??0)/6];
  const lastType = classifyMove(s.lastMove?.cards);
  const lastOne = Array.from(MOVE_TYPES,t=>t===lastType?1:0);
  const handH = hist15(s.myHand??[]).map(x=>Math.min(4,x)/4);
  return [...roleOne, ...lordOne, ...counts, ...bombs, ...lastOne, ...handH];
}

function moveFeat(cards?: Card[]): number[] {
  const t=classifyMove(cards);
  const one = Array.from(MOVE_TYPES, x=>x===t?1:0);
  const n=(cards?.length??0)/20;
  let hi=0; if(cards&&cards.length>0){ hi = cards.map(rankIndex).reduce((a,b)=>Math.max(a,b),0)/14; }
  return [...one, n, hi];
}

function buildX(s: MiniState, m?: Card[]): number[] {
  const v=[...stateFeat(s), ...moveFeat(m)];
  while(v.length<64) v.push(0);
  return v;
}


function getHandFromCtx(ctx:any): any[] {
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
    if (Array.isArray(v) && v.length) return v as any[];
  }
  // hands[seat]
  const seat = (typeof ctx?.seat==='number') ? ctx.seat : (typeof ctx?.role==='number' ? ctx.role : null);
  if (Array.isArray(ctx?.hands) && seat!=null && Array.isArray(ctx.hands[seat])) { return ctx.hands[seat] as any[]; }
  if (Array.isArray(ctx?.state?.hands) && seat!=null && Array.isArray(ctx.state.hands[seat])) { return ctx.state.hands[seat] as any[]; }
  return [];
}

function genNaiveCandidatesFromHand(hand:any[]): any[][] {
  if (!Array.isArray(hand) || hand.length===0) return [];
  const byRank: Record<string, any[]> = {};
  for (const c of hand) {
    const r = toRankChar(c);
    (byRank[r] ||= []).push(c);
  }
  const cands: any[][] = [];
  // singles
  for (const c of hand) cands.push([c]);
  // pairs / triples / bombs using grouped raw tokens
  for (const r in byRank) {
    const arr = byRank[r];
    if (arr.length>=2) cands.push(arr.slice(0,2));
    if (arr.length>=3) cands.push(arr.slice(0,3));
    if (arr.length>=4) cands.push(arr.slice(0,4)); // bomb
  }
  // rocket (use rank char detection)
  const ranks = hand.map(toRankChar);
  if (ranks.includes('X') && ranks.filter(x=>x==='X').length>=2) {
    // If jokers are both represented as 'X' variants; try to find two raw jokers
    const jokers = hand.filter(c => ['x','X','joker','JOKER','🃏','Jk','JK'].includes(String(c)) or toRankChar(c)==='X');
    if (jokers.length>=2) cands.push([jokers[0], jokers[1]]);
  }
  return cands;
};
  for (const c of hand) {
    (byRank[c] ||= []).push(c);
  }
  const cands: string[][] = [];
  // singles
  for (const c of hand) cands.push([c]);
  // pairs / triples / bombs
  for (const r in byRank) {
    const arr = byRank[r];
    if (arr.length>=2) cands.push(arr.slice(0,2));
    if (arr.length>=3) cands.push(arr.slice(0,3));
    if (arr.length>=4) cands.push(arr.slice(0,4)); // bomb
  }
  // rocket
  if (hand.includes('x') && hand.includes('X')) cands.push(['x','X']);
  return cands;
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
    if(isMove){ const t=MOVE_TYPES[moveIdx]; if(t==='bomb') return -0.06; if(t==='rocket') return -0.08; if(t==='straight') return 0.06; }
    return 0.0;
  }));
  const b1=new Array(h).fill(0);
  const z2=[Array.from({length:h},(_,j)=>(j<8?0.1:0.02))];
  const b2=[0];
  return {l1:{W:z1,b:b1}, l2:{W:z2,b:b2}};
}

const M=initHeuristicMLP();
function mlpScore(x:number[]): number { const h1=matVec(M.l1.W,x,M.l1.b).map(relu); return matVec(M.l2.W,h1,M.l2.b)[0]; }

// -------- Robust candidate extractor --------
function extractCandidates(ctx:any): any[][] {
  const fields = ['legalMoves','candidates','cands','moves','options','legal','legal_cards','getLegal','getCandidates','genMoves'];
  for (const key of fields) {
    const v = ctx?.[key];
    if (Array.isArray(v) && v.length) {
      const norm: string[][] = [];
      for (const it of v) {
        if (Array.isArray(it)) norm.push(it as string[]);
        else if (it && typeof it==='object' && Array.isArray((it as any).cards)) {
          norm.push((it as any).cards as string[]);
        }
      }
      if (norm.length) return norm;
    }
    const f = ctx && typeof ctx[key]==='function' ? ctx[key] : null;
    // If there is a function like getLegalMoves, try calling it safely
    if (typeof f === 'function') {
      try {
        const got = f.call(ctx);
        if (Array.isArray(got) && got.length) {
          const norm: string[][] = [];
          for (const it of got) {
            if (Array.isArray(it)) norm.push(it as string[]);
            else if (it && typeof it==='object' && Array.isArray((it as any).cards)) {
              norm.push((it as any).cards as string[]);
            }
          }
          if (norm.length) return norm;
        }
      } catch {}
    }
  }
  const hand = getHandFromCtx(ctx);
  if (hand.length) return genNaiveCandidatesFromHand(hand);
  return [];
}

export async function MiniNetBot(ctx:any): Promise<BotMove> {
  const state: MiniState = {
    role: Number(ctx?.role ?? 0) as 0|1|2,
    landlord: Number(ctx?.landlord ?? 0) as 0|1|2,
    lastMove: ctx?.lastMove,
    myHand: getHandFromCtx(ctx).map(toRankChar),
    counts: ctx?.counts,
    bombsUsed: ctx?.stats?.bombs ?? ctx?.bombsUsed ?? 0,
  };

  const moves = extractCandidates(ctx);
  if(!moves.length){
    return { move:'pass', reason:`MiniNet: no candidates (keys=${Object.keys(ctx||{}).join(',')})` };
  }

  let best=moves[0], bestScore=-1e9;
  for(const m of moves){
    const x=buildX(state,m);
    let s=mlpScore(x);
    s += (Math.random()-0.5)*0.01;
    if(s>bestScore){ bestScore=s; best=m; }
  }
  return { move:'play', cards: best, reason:`MiniNet (cands=${moves.length}, score=${bestScore.toFixed(3)})` };
}

export function loadMiniNetWeights(json: MLP){ M.l1.W=json.l1.W; M.l1.b=json.l1.b; M.l2.W=json.l2.W; M.l2.b=json.l2.b; }
