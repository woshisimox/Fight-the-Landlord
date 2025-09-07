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
      // 首家（require=null）可以出等于 minRank（仅当 minRank=0 时才命中）
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

// 类型守卫：把 Move[] 过滤成 PlayMove[]
type PlayMove = Extract<Move, { kind:'play' }>;
function isPlay(m: Move): m is PlayMove { return m.kind === 'play'; }

const builtinGreedyMax: BotFunc = ({ legal }) => {
  const plays: PlayMove[] = legal.filter(isPlay);
  if (plays.length === 0) return { type:'pass' };
  plays.sort((a,b)=> a.rank===b.rank ? typeOrder(a.type)-typeOrder(b.type) : a.rank-b.rank);
  const pick = plays[plays.length-1];
  if (!pick) return { type:'pass' };        // 兼容 noUncheckedIndexedAccess
  return { type:'play', cards: pick.cards, comboType: pick.type };
};

const builtinGreedyMin: BotFunc = ({ legal }) => {
  const plays: PlayMove[] = legal.filter(isPlay);
  if (plays.length === 0) return { type:'pass' };
  plays.sort((a,b)=> a.rank===b.rank ? typeOrder(a.type)-typeOrder(b.type) : a.rank-b.rank);
  const pick = plays[0];
  if (!pick) return { type:'pass' };
  return { type:'play', cards: pick.cards, comboType: pick.type };
};

const builtinRandomLegal: BotFunc = ({ legal, rnd }) => {
  const plays: PlayMove[] = legal.filter(isPlay);
  if (plays.length === 0) return { type:'pass' };
  const idx = Math.floor(rnd()*plays.length);
  const pick = plays[idx];
  if (!pick) return { type:'pass' };
  return { type:'play', cards: pick.cards, comboType: pick.type };
};

function typeOrder(t: ComboType): number {
  switch (t) {
    case 'single': return 1;
    case 'pair': return 2;
    case 'triple': return 3;
    case 'bomb': return 9;
    case 'rocket': return 10;
    default: return 5;
  }
}

function pickSmallestSingle(hand: Label[]): Label {
  let best = hand[0], br = rankValue(hand[0] ?? '');
  for (const c of hand) {
    const r = rankValue(c);
    if (r < br) { best = c; br = r; }
  }
  return best!;
}

// ---------- 记分 ----------
function settle(winner: Seat, landlord: Seat, multiplier: number): [number,number,number] {
  const base = multiplier; // base × 倍数
  const delta: [number,number,number] = [0,0,0];
  if (winner === landlord) {
    delta[landlord] = +2 * base;
    delta[(landlord+1)%3] = -1 * base;
    delta[(landlord+2)%3] = -1 * base;
  } else {
    delta[landlord] = -2 * base;
    delta[(landlord+1)%3] = +1 * base;
    delta[(landlord+2)%3] = +1 * base;
  }
  return delta;
}

// ---------- 主流程（含两处防止卡死的修复） ----------
export async function runSeries(opts: RunOptions, emit: Emit) {
  const rounds = Math.max(1, Math.floor(opts.rounds || 1));
  const delay = async (ms:number) => new Promise(r=>setTimeout(r, ms));
  const rnd = mulberry32(0xC0FFEE);

  for (let round=0; round<rounds; round++) {
    const { hands, landlord } = deal(rnd);
    await emit({ type:'state', kind:'init', landlord, hands: clone(hands) });

    let turn: Seat = landlord;
    let leader: Seat = landlord;
    let require: Require = null;
    let passCount = 0;
    let multiplier = 1;
    let lastPlaySeat: Seat = landlord;

    const bots: BotFunc[] = [
      builtinGreedyMax, builtinGreedyMin, builtinRandomLegal
    ];

    const isEmpty = (h:Label[]) => h.length === 0;

    for (;;) {
      const isLeader = (turn === leader);
      const effRequire: Require = isLeader ? null : require;

      let legal = generateMoves(hands[turn], effRequire);

      if (opts.debug) {
        await emit({ type:'log',
          message: `[turn] seat=${turn} leader=${leader} isLeader=${isLeader} `
                 + `require=${effRequire?`${(effRequire as any).type}@${(effRequire as any).rank}`:'null'} `
                 + `cand=${legal.filter(isPlay).length}`
        });
      }

      // 修复 #1：首家兜底，永不为 0
      if (isLeader && legal.filter(isPlay).length === 0) {
        const c = pickSmallestSingle(hands[turn]);
        legal = [{ kind:'play', cards:[c], type:'single', rank:rankValue(c) }];
        if (opts.debug) {
          await emit({ type:'log', message: '[fallback] empty candidates at lead → force smallest single' });
        }
      }

      // 选择动作
      let move: Move;
      const plays = legal.filter(isPlay);
      if (plays.length === 0) {
        move = { kind:'pass' };       // 跟牌无候选 → 必过
      } else {
        const bot = bots[turn] || builtinGreedyMin;
        const choice = await Promise.resolve(bot({
          seat: turn, hand: hands[turn], legal, isLeader, require: effRequire, rnd
        }));
        move = choice.type === 'play'
          ? { kind:'play', cards: choice.cards, type: choice.comboType, rank: rankValue(choice.cards[0] ?? '') }
          : { kind:'pass' };
      }

      if (move.kind === 'pass') {
        await emit({ type:'event', kind:'play', seat: turn, move:'pass' });
        passCount++;
        // 两家过 → reset
        if (passCount >= 2) {
          await emit({ type:'event', kind:'trick-reset' });
          // 修复 #2：一次性重置上下文
          require = null;
          leader  = lastPlaySeat;
          turn    = leader;
          passCount = 0;
          continue;
        } else {
          turn = ((turn + 1) % 3) as Seat;
          continue;
        }
      } else {
        // 执行出牌
        const cards = move.cards;
        for (const c of cards) {
          const idx = hands[turn].indexOf(c);
          if (idx >= 0) hands[turn].splice(idx,1);
          else {
            const r = normalizeRank(c);
            const j = hands[turn].findIndex(x=>normalizeRank(x)===r);
            if (j>=0) hands[turn].splice(j,1);
          }
        }

        await emit({ type:'event', kind:'play', seat: turn, move:'play', cards: clone(cards), comboType: move.type });

        if (move.type === 'bomb' || move.type === 'rocket') multiplier *= 2;

        leader = turn;
        lastPlaySeat = turn;
        passCount = 0;

        if (move.type === 'single') require = { type:'single', rank: move.rank };
        else if (move.type === 'pair') require = { type:'pair', rank: move.rank };
        else if (move.type === 'bomb') require = { type:'bomb', rank: move.rank };
        else require = { type:'single', rank: move.rank };

        if (isEmpty(hands[turn])) {
          const winner = turn;
          const delta = settle(winner, landlord, multiplier);
          await emit({ type:'event', kind:'win', winner, multiplier, deltaScores: delta });
          break;
        }

        turn = ((turn + 1) % 3) as Seat;
      }

      const ms = Math.max(0, Math.floor((opts.seatDelayMs?.[turn] ?? 0)));
      if (ms) await delay(ms);
    }
  }
}

// ---------- 伪随机 ----------
function mulberry32(a:number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
