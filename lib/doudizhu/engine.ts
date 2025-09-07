/* lib/doudizhu/engine.ts
 * Dou Dizhu engine with safe trick-reset + lead-fallback to prevent stalls.
 * 事件协议：
 * - {type:'state', kind:'init', landlord, hands}
 * - {type:'event', kind:'play', seat, move:'play'|'pass', cards?, comboType?}
 * - {type:'event', kind:'trick-reset'}
 * - {type:'event', kind:'win', winner, multiplier, deltaScores:[n,n,n]}
 * - {type:'log', message}
 */

export type Label = string;
export type Seat = 0 | 1 | 2;
export type Four2Policy = 'both' | '2singles' | '2pairs';

export type ComboType =
  | 'single' | 'pair' | 'triple' | 'bomb' | 'rocket'
  | 'straight' | 'pair-straight' | 'plane'
  | 'triple-with-single' | 'triple-with-pair'
  | 'four-with-two-singles' | 'four-with-two-pairs';

export type EngineEvent =
  | { type:'state', kind:'init', landlord:Seat, hands: Label[][] }
  | { type:'event', kind:'play', seat:Seat, move:'play'|'pass', cards?:Label[], comboType?:ComboType, reason?:string }
  | { type:'event', kind:'trick-reset' }
  | { type:'event', kind:'win', winner:Seat, multiplier:number, deltaScores:[number,number,number] }
  | { type:'log', message:string };

export type Emit = (ev: EngineEvent) => void | Promise<void>;

export type RunOptions = {
  rounds: number;
  startScore?: number;
  enabled?: boolean;
  rob?: boolean;
  four2?: Four2Policy;
  seatDelayMs?: number[];
  seats?: string[];
  debug?: boolean;
};

type Require =
  | null
  | { type:'single'; rank:number }
  | { type:'pair';   rank:number }
  | { type:'bomb';   rank:number };

type Move =
  | { kind:'pass' }
  | { kind:'play'; cards:Label[]; type:ComboType; rank:number };

type Group = { rank:number; labels:Label[] };

const SUITS = ['♠','♥','♦','♣'];
const RANK_ORDER = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
const RANK_VAL: Record<string, number> = Object.fromEntries(RANK_ORDER.map((r,i)=>[r,i]));

// ---------- 工具 ----------
function normalizeRank(l: Label): string {
  if (!l) return '';
  if (l.startsWith('🃏')) {
    const r = l.slice(2);
    return (r === 'X' || r === 'x') ? r : 'X';
  }
  const c0 = l[0];
  if (SUITS.includes(c0)) {
    const r = l.slice(1).replace(/10/i,'T').toUpperCase();
    return r;
  }
  return l.replace(/10/i,'T').toUpperCase();
}

function rankValue(l: Label | string): number {
  const r = typeof l === 'string' && l.length <= 2 ? l : normalizeRank(l as string);
  return RANK_VAL[r] ?? -1;
}

function clone<T>(x:T): T { return JSON.parse(JSON.stringify(x)); }

// ---------- 发牌 ----------
function makeDeck(): Label[] {
  const ranks = ['3','4','5','6','7','8','9','T','J','Q','K','A','2'];
  const deck: Label[] = [];
  for (const s of SUITS) for (const r of ranks) deck.push(`${s}${r}`);
  deck.push('🃏x', '🃏X');
  return deck;
}
function shuffle<T>(a:T[], rnd:()=>number) {
  for (let i=a.length-1;i>0;i--) {
    const j = Math.floor(rnd()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
}
function deal(rnd:()=>number): { hands:Label[][], landlord:Seat } {
  const deck = makeDeck();
  shuffle(deck, rnd);
  const hands: Label[][] = [[],[],[]];
  for (let i=0;i<51;i++) hands[i%3].push(deck[i]);
  const landlord = Math.floor(rnd()*3) as Seat;
  hands[landlord].push(deck[51], deck[52], deck[53]);
  return { hands, landlord };
}

// ---------- 候选生成（最常用：single/pair/bomb/rocket） ----------
function groupByRank(hand: Label[]): Group[] {
  const m = new Map<string, Label[]>();
  for (const c of hand) {
    const r = normalizeRank(c);
    if (!m.has(r)) m.set(r, []);
    m.get(r)!.push(c);
  }
  const arr = Array.from(m.entries()).map(([r, labels])=>({ rank: RANK_VAL[r], labels }));
  arr.sort((a,b)=>a.rank-b.rank);
  return arr;
}

function generateMoves(hand: Label[], require: Require): Move[] {
  const groups = groupByRank(hand);
  const hasx = hand.includes('🃏x'), hasX = hand.includes('🃏X');
  const out: Move[] = [];

  const addSingles = (minRank=0) => {
    for (const g of groups) {
      if (require === null || g.rank > minRank) {
        for (const l of g.labels) out.push({ kind:'play', cards:[l], type:'single', rank:g.rank });
      }
    }
  };
  const addPairs = (minRank=0) => {
    for (const g of groups) {
      if (g.labels.length>=2 && (require === null || g.rank > minRank)) {
        out.push({ kind:'play', cards:[g.labels[0], g.labels[1]], type:'pair', rank:g.rank });
      }
    }
  };
  const addBombs = (minRank=0) => {
    for (const g of groups) {
      if (g.labels.length===4 && (require===null || g.rank>minRank)) {
        out.push({ kind:'play', cards:[...g.labels], type:'bomb', rank:g.rank });
      }
    }
  };
  const addRocket = () => {
    if (hasx && hasX) out.push({ kind:'play', cards:['🃏x','🃏X'], type:'rocket', rank:RANK_VAL['X'] });
  };

  if (require === null) {
    addSingles();
    addPairs();
    addBombs();
    addRocket();
    return out;
  }

  if (require.type === 'single') {
    addSingles(require.rank);
    addBombs(require.rank);
    addRocket();
  } else if (require.type === 'pair') {
    addPairs(require.rank);
    addBombs(require.rank);
    addRocket();
  } else if (require.type === 'bomb') {
    addBombs(require.rank);
    addRocket();
  }
  return out;
}

// ---------- 选择策略（内置） ----------
export type BotMove = { type:'pass' } | { type:'play', cards:Label[], comboType:ComboType };
export type BotCtx = {
  seat: Seat;
  hand: Label[];
  legal: Move[];
  isLeader: boolean;
  require: Require;
  rnd: ()=>number;
};
export type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

type PlayMove = Extract<Move, { kind:'play' }>;
function isPlay(m: Move): m is PlayMove { return m.kind === 'play'; }

const builtinGreedyMax: BotFunc = ({ legal }) => {
  const plays: PlayMove[] = legal.filter(isPlay);
  if (plays.length === 0) return { type:'pass' };
  plays.sort((a,b)=> a.rank===b.rank ? typeOrder(a.type)-typeOrder(b.type) : a.rank-b.rank);
  const pick = plays[plays.length-1];
  if (!pick) return { type:'pass' };
  return { type:'play', cards: pick.cards, comboType: pick.type };
};

const bu
