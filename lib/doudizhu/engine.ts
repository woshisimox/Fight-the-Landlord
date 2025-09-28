// lib/doudizhu/engine.ts
// Dou Dizhu (斗地主) 引擎（单文件可替换版）
// - 牌型：single, pair, triple, triple-with-single, triple-with-pair, straight, pair-straight, plane, four-with-two, bomb, rocket
// - 流程：发牌 → （可选）抢地主 → 亮底 → 对局（地主先手）
// - 导出：runOneGame, GreedyMax, GreedyMin, RandomLegal, classify, generateMoves 等

/* ==================== 类型定义 ==================== */

export type Card = string;           // '♠3' | '♥A' | 'x' | 'X'
export type MoveType =
  | 'single' | 'pair' | 'triple'
  | 'triple-with-single' | 'triple-with-pair'
  | 'straight' | 'pair-straight' | 'plane'
  | 'four-with-two' | 'bomb' | 'rocket';

export type Classified = {
  type: MoveType;
  len?: number;      // 顺子/连对/飞机等序列长度
  key: number;       // 比较强度键（如最大牌的 rank）
};

export type Require = Classified & { // 需要“同型同长且更大”的参考
  // 可选其它上下文字段（例如上一手座位、是否不可过等），这里只保留必要键
};

export type Four2Policy = 'both' | '2singles' | '2pairs';

export type Policy = {
  four2?: Four2Policy;
  followProb?: number;  // RandomLegal 的“接牌概率”（0~1），默认 1
};

export type PlayMove = { move: 'play'; cards: Card[]; reason?: string };
export type PassMove = { move: 'pass'; reason?: string };
export type RobMove  = { move: 'rob' | 'nrob'; score?: number; reason?: string };
export type BotMove  = PlayMove | PassMove | RobMove;

export type BotCtx = {
  seat: number;        // 0/1/2
  hands: Card[];       // 当前手牌（已排序）
  require?: Require;   // 跟牌需求（若有）
  canPass: boolean;    // 当前是否允许过牌
  landlord: number;    // 地主座位
  policy?: Policy;     // 策略
  dipai?: Card[];      // 底牌（亮底后可见）
};

export type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

export type RunOptions = {
  seats: BotFunc[];            // 三个 bot
  seed?: number;               // 随机种子（可选）
  rob?: boolean;               // 是否走抢地主阶段（默认 true）
  four2?: Four2Policy;         // 'both' | '2singles' | '2pairs'（默认 'both'）
};

export type GameEvent =
  | { type: 'init'; hands: Card[][]; dipai: Card[] }
  | { type: 'rob'; seat: number; action: 'rob' | 'nrob'; score?: number; reason?: string }
  | { type: 'reveal'; landlord: number; dipai: Card[]; hands: Card[][] }
  | { type: 'play'; seat: number; cards: Card[]; cls: Classified; remain: number; reason?: string }
  | { type: 'pass'; seat: number; reason?: string }
  | { type: 'end'; landlord: number; winner: number; lastMove?: Classified };

/* ==================== 牌面与排序工具 ==================== */

// 牌点强度：3 < ... < A < 2 < x < X
const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
const SUITS = ['♠','♥','♦','♣'] as const;
const rankIndex: Record<string, number> = Object.fromEntries(RANKS.map((r, i)=>[r, i]));

function rankOf(c: Card): string {
  // Jokers: 'x' / 'X'
  if (c === 'x' || c === 'X') return c;
  return c.slice(-1);
}
function valOf(c: Card): number {
  const r = rankOf(c);
  return rankIndex[r] ?? -1;
}

function sortCardsAsc(cards: Card[]): Card[] {
  return [...cards].sort((a,b)=> valOf(a)-valOf(b) || a.localeCompare(b));
}
function sortCardsDesc(cards: Card[]): Card[] {
  return [...cards].sort((a,b)=> valOf(b)-valOf(a) || a.localeCompare(b));
}

/* ==================== 组牌/计数/辅助 ==================== */

function countByRank(cards: Card[]): Map<string, Card[]> {
  const m = new Map<string, Card[]>();
  for (const c of cards) {
    const r = rankOf(c);
    if (!m.has(r)) m.set(r, []);
    m.get(r)!.push(c);
  }
  return m;
}

function isSequential(ranks: string[], minLen=5): boolean {
  if (ranks.length < minLen) return false;
  // 不能包含 2 / Jokers
  if (ranks.some(r => r==='2' || r==='x' || r==='X')) return false;
  // 连续性判断
  for (let i=1;i<ranks.length;i++){
    if (rankIndex[ranks[i]] !== rankIndex[ranks[i-1]]+1) return false;
  }
  return true;
}

/* ==================== 牌型判定 ==================== */

export function classify(cards: Card[], four2: Four2Policy='both'): Classified | null {
  const n = cards.length;
  const sorted = sortCardsAsc(cards);
  const ranks = sorted.map(rankOf);

  // 王炸
  if (n === 2 && ranks.includes('x') && ranks.includes('X')) {
    return { type: 'rocket', key: rankIndex['X'] };
  }

  const groups = countByRank(sorted); // rank -> list of cards
  const byCount: Record<number, string[]> = { 1:[], 2:[], 3:[], 4:[] };
  [...groups.entries()].forEach(([r, arr])=>{
    byCount[arr.length].push(r);
  });
  byCount[1].sort((a,b)=>rankIndex[a]-rankIndex[b]);
  byCount[2].sort((a,b)=>rankIndex[a]-rankIndex[b]);
  byCount[3].sort((a,b)=>rankIndex[a]-rankIndex[b]);
  byCount[4].sort((a,b)=>rankIndex[a]-rankIndex[b]);

  // 炸弹
  if (n === 4 && byCount[4].length === 1) {
    const r = byCount[4][0];
    return { type: 'bomb', key: rankIndex[r] };
  }

  // 四带二（4+2）
  if (n === 6 && byCount[4].length === 1 && (byCount[1].length === 2 || byCount[2].length === 1)) {
    const r = byCount[4][0];
    return { type: 'four-with-two', key: rankIndex[r] };
  }

  // 三张
  if (n === 3 && byCount[3].length === 1) {
    const r = byCount[3][0];
    return { type: 'triple', key: rankIndex[r] };
  }
  // 三带一
  if (n === 4 && byCount[3].length === 1 && byCount[1].length === 1) {
    const r = byCount[3][0];
    return { type: 'triple-with-single', key: rankIndex[r] };
  }
  // 三带二
  if (n === 5 && byCount[3].length === 1 && byCount[2].length === 1) {
    const r = byCount[3][0];
    return { type: 'triple-with-pair', key: rankIndex[r] };
  }

  // 单，对
  if (n === 1) return { type: 'single', key: rankIndex[ranks[0]] };
  if (n === 2 && byCount[2].length === 1) {
    const r = byCount[2][0];
    return { type: 'pair', key: rankIndex[r] };
  }

  // 顺子
  if (n >= 5 && byCount[1].length === n) {
    if (isSequential(byCount[1])) {
      return { type: 'straight', len: n, key: rankIndex[byCount[1][byCount[1].length-1]] };
    }
  }

  // 连对：>=3 对，按序
  if (n % 2 === 0 && n >= 6 && byCount[2].length*2 === n) {
    if (isSequential(byCount[2], 3)) {
      return { type: 'pair-straight', len: byCount[2].length, key: rankIndex[byCount[2][byCount[2].length-1]] };
    }
  }

  // 飞机不带 / 带翅（简化：要求等张数三顺 + 等数量附加牌）
  // 先检测三顺
  if (byCount[3].length >= 2) {
    const triRanks = byCount[3];
    if (isSequential(triRanks, 2)) {
      const L = triRanks.length;
      // 不带（3*L）
      if (n === 3*L) {
        return { type: 'plane', len: L, key: rankIndex[triRanks[triRanks.length-1]] };
      }
      // 带翅（+L 个单，或 +L 对）
      if (n === 4*L && byCount[1].length === L) {
        return { type: 'plane', len: L, key: rankIndex[triRanks[triRanks.length-1]] };
      }
      if (n === 5*L && byCount[2].length === L) {
        return { type: 'plane', len: L, key: rankIndex[triRanks[triRanks.length-1]] };
      }
    }
  }

  return null;
}

/* ==================== 合法出牌生成 ==================== */

export function generateMoves(hands: Card[], require?: Require, four2: Four2Policy='both'): Card[][] {
  // 生成“全部可能”的思路会很重；这里采用“足够好 & 可用”的启发式生成：
  // 1) 当 require 存在：筛选出“同型同长且更大”的组合；若没有，再给出炸弹/王炸
  // 2) 当 require 不存在：给出若干小牌开局候选，避免爆炸式组合（已满足内置 bot 的需要）

  const hand = sortCardsAsc(hands);
  const groups = countByRank(hand);

  const ret: Card[][] = [];

  // ===== 工具：从同 rank 抽 n 张（若足够） =====
  const takeN = (r: string, n: number): Card[] | null => {
    const arr = groups.get(r) || [];
    if (arr.length >= n) return arr.slice(0, n);
    return null;
  };

  // ===== 工具：构建三顺 / 连对 / 顺子 =====
  const buildSinglesSequential = (minLen=5) => {
    const ranks = [...groups.keys()].filter(r => (groups.get(r)!.length>=1 && r!=='2' && r!=='x' && r!=='X'))
      .sort((a,b)=>rankIndex[a]-rankIndex[b]);
    // 扫描所有顺子区间
    for (let i=0;i<ranks.length;i++){
      let j=i;
      while (j+1<ranks.length && rankIndex[ranks[j+1]] === rankIndex[ranks[j]]+1) j++;
      const seg = ranks.slice(i, j+1);
      if (seg.length >= minLen) {
        for (let L=minLen; L<=seg.length; L++){
          const window = seg.slice(0, L);
          ret.push(window.flatMap(r => takeN(r,1)!));
        }
      }
      i = j;
    }
  };

  const buildPairsSequential = (minPairs=3) => {
    const ranks = [...groups.keys()].filter(r => (groups.get(r)!.length>=2 && r!=='2' && r!=='x' && r!=='X'))
      .sort((a,b)=>rankIndex[a]-rankIndex[b]);
    for (let i=0;i<ranks.length;i++){
      let j=i;
      while (j+1<ranks.length && rankIndex[ranks[j+1]] === rankIndex[ranks[j]]+1) j++;
      const seg = ranks.slice(i, j+1);
      if (seg.length >= minPairs) {
        for (let L=minPairs; L<=seg.length; L++){
          const window = seg.slice(0, L);
          ret.push(window.flatMap(r => takeN(r,2)!));
        }
      }
      i = j;
    }
  };

  const buildTriplesSequential = (minTri=2) => {
    const ranks = [...groups.keys()].filter(r => (groups.get(r)!.length>=3 && r!=='2' && r!=='x' && r!=='X'))
      .sort((a,b)=>rankIndex[a]-rankIndex[b]);
    for (let i=0;i<ranks.length;i++){
      let j=i;
      while (j+1<ranks.length && rankIndex[ranks[j+1]] === rankIndex[ranks[j]]+1) j++;
      const seg = ranks.slice(i, j+1);
      if (seg.length >= minTri) {
        const L = seg.length;
        // 飞机不带
        ret.push(seg.flatMap(r=>takeN(r,3)!));
        // 带翅（+L 单）
        if ([...groups.values()].reduce((acc,arr)=>acc+(arr.length===1?1:0),0) >= L) {
          const singles: Card[] = [];
          // 收集 L 个单（不从飞机核心 rank 里拿，尽量不同 rank）
          const ranks1 = [...groups.entries()]
            .filter(([rk,arr])=> arr.length===1 && !seg.includes(rk))
            .map(([rk])=>rk)
            .slice(0, L);
          if (ranks1.length===L) {
            ranks1.forEach(rk => singles.push(...takeN(rk,1)!));
            ret.push(seg.flatMap(r=>takeN(r,3)!).concat(singles));
          }
        }
        // 带翅（+L 对）
        const pairRanks = [...groups.entries()]
          .filter(([rk,arr])=> arr.length>=2 && !seg.includes(rk))
          .map(([rk])=>rk)
          .slice(0, L);
        if (pairRanks.length===L) {
          const pairs = pairRanks.flatMap(rk=>takeN(rk,2)!);
          ret.push(seg.flatMap(r=>takeN(r,3)!).concat(pairs));
        }
      }
      i = j;
    }
  };

  // ===== 基础小型构型 =====
  const singles = [...groups.entries()].flatMap(([r, arr]) => arr.length>=1 ? [arr.slice(0,1)] : []);
  const pairs   = [...groups.entries()].flatMap(([r, arr]) => arr.length>=2 ? [arr.slice(0,2)] : []);
  const triples = [...groups.entries()].flatMap(([r, arr]) => arr.length>=3 ? [arr.slice(0,3)] : []);
  const bombs   = [...groups.entries()].flatMap(([r, arr]) => arr.length===4 ? [arr.slice(0,4)] : []);
  // 四带二
  const fourWithTwo: Card[][] = [];
  for (const [r, arr] of groups.entries()) {
    if (arr.length === 4) {
      // 两单
      const singles2 = singles.filter(s => rankOf(s[0])!==r).slice(0,2);
      if (singles2.length===2) fourWithTwo.push(arr.slice(0,4).concat(singles2[0], singles2[1]));
      // 一对
      const pair2 = pairs.find(p => rankOf(p[0])!==r);
      if (pair2) fourWithTwo.push(arr.slice(0,4).concat(pair2));
    }
  }
  // 王炸
  const hasx = hand.includes('x'), hasX = hand.includes('X');
  const rockets = (hasx && hasX) ? [[ 'x', 'X' ] as Card[]] : [];

  // 构建序列类
  buildSinglesSequential(5);
  buildPairsSequential(3);
  buildTriplesSequential(2);

  // 全部候选（未去重）
  let candidates: Card[][] = [
    ...singles, ...pairs, ...triples,
    ...fourWithTwo, ...bombs, ...rockets,
    ...ret, // 顺子、连对、飞机等
  ];

  // 去重（按牌面字符串拼接）
  const uniq = new Map<string, Card[]>();
  for (const mv of candidates) {
    const k = sortCardsAsc(mv).join(',');
    if (!uniq.has(k)) uniq.set(k, mv);
  }
  candidates = [...uniq.values()];

  // 过滤 & 排序
  if (require) {
    const legal = candidates.filter(mv=>{
      const c = classify(mv, four2);
      if (!c) return false;
      // 同型同长且更大
      if (c.type === require.type) {
        if ((typeof c.len === 'number') !== (typeof require.len === 'number')) return false;
        if (typeof c.len === 'number' && typeof require.len === 'number' && c.len !== require.len) return false;
        return c.key > require.key;
      }
      // 炸弹 / 王炸：可以压所有非炸弹（王炸压所有）
      if (c.type === 'bomb' && require.type !== 'bomb' && require.type !== 'rocket') return true;
      if (c.type === 'rocket') return true;
      // 炸弹压炸弹（更大）
      if (c.type === 'bomb' && require.type === 'bomb') {
        return c.key > require.key;
      }
      return false;
    });

    // 升序（方便“最小可压优先”）
    legal.sort((a,b)=>{
      const ca = classify(a, four2)!; const cb = classify(b, four2)!;
      const orderType = (t:MoveType):number => {
        if (t==='rocket') return 100;
        if (t==='bomb') return 90;
        return 10;
      };
      const ot = orderType(ca.type) - orderType(cb.type);
      if (ot) return ot;
      if ((ca.len||0)!==(cb.len||0)) return (ca.len||0)-(cb.len||0);
      return ca.key - cb.key;
    });
    return legal;
  } else {
    // 首出：给出一组“偏小”的候选，避免一次性爆炸
    const smalls: Card[][] = [];
    // 先单，再对，再三，再顺子，避免浪费关键牌
    smalls.push(...singles.slice(0,4));
    smalls.push(...pairs.slice(0,2));
    smalls.push(...triples.slice(0,1));
    // 取一两个短顺、短连对（若有）
    const seqs = ret
      .map(mv => ({ mv, c: classify(mv, four2)! }))
      .filter(x => x.c.type==='straight' || x.c.type==='pair-straight')
      .sort((a,b)=> (a.c.len||0)-(b.c.len||0) || a.c.key-b.c.key)
      .slice(0,2)
      .map(x=>x.mv);
    smalls.push(...seqs);

    // 兜底：至少有一个最小单
    if (smalls.length===0 && singles.length) smalls.push(singles[0]);

    // 升序
    smalls.sort((a,b)=>{
      const ca = classify(a, four2)!; const cb = classify(b, four2)!;
      if ((ca.len||0)!==(cb.len||0)) return (ca.len||0)-(cb.len||0);
      return ca.key - cb.key;
    });
    return smalls;
  }
}

/* ==================== 内置算法 ==================== */

// 默认 RandomLegal 的“接牌概率”
const RANDOMLEGAL_FOLLOW_PROB = 1;

export const RandomLegal: BotFunc = (ctx) => {
  const four2 = (ctx?.policy?.four2 ?? 'both') as Four2Policy;
  const legal = generateMoves(ctx.hands, ctx.require, four2);

  // 需要跟牌：优先同型最小可压；没有同型→炸弹/王炸；确无→pass
  if (ctx.require) {
    const followProb = Math.max(0, Math.min(1, ctx?.policy?.followProb ?? RANDOMLEGAL_FOLLOW_PROB));

    if (legal.length) {
      // 同型优先
      const annotated = legal.map(mv => classify(mv, four2)!);
      const sameIdx = annotated.findIndex(c => c.type===ctx.require!.type && (c.len??0)===(ctx.require!.len??0));
      if (Math.random() < followProb) {
        if (sameIdx >= 0) return { move:'play', cards: legal[sameIdx] };
        // 没有同型：找炸弹/王炸
        const bombIdx = annotated.findIndex(c => c.type==='bomb');
        if (bombIdx >= 0) return { move:'play', cards: legal[bombIdx] };
        const rockIdx = annotated.findIndex(c => c.type==='rocket');
        if (rockIdx >= 0) return { move:'play', cards: legal[rockIdx] };
      } else {
        if (ctx.canPass) return { move:'pass', reason:'random-pass' };
      }
    }
    if (ctx.canPass) return { move:'pass', reason:'no-legal' };
  }

  // 首出/被迫出：选择最小候选
  if (legal.length) return { move:'play', cards: legal[0] };

  // 兜底：至少打一张
  const c = ctx.hands?.[0] ?? '♠3';
  return { move:'play', cards:[c] };
};

// GreedyMin：总是打“可行中的最小”
export const GreedyMin: BotFunc = (ctx) => {
  const four2 = (ctx?.policy?.four2 ?? 'both') as Four2Policy;
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (ctx.require) {
    if (legal.length) return { move:'play', cards: legal[0], reason:'min' };
    if (ctx.canPass) return { move:'pass', reason:'no-legal' };
  } else {
    if (legal.length) return { move:'play', cards: legal[0], reason:'min' };
  }
  const c = ctx.hands?.[0] ?? '♠3';
  return { move:'play', cards:[c], reason:'fallback' };
};

// GreedyMax：偏激进，优先更大的及强势牌（炸弹/王炸）
export const GreedyMax: BotFunc = (ctx) => {
  const four2 = (ctx?.policy?.four2 ?? 'both') as Four2Policy;
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (!legal.length) {
    if (ctx.require && ctx.canPass) return { move:'pass', reason:'no-legal' };
    const c = ctx.hands?.[0] ?? '♠3';
    return { move:'play', cards:[c], reason:'fallback' };
  }
  // 最大优先：rocket > bomb > others by key/len
  legal.sort((a,b)=>{
    const ca = classify(a, four2)!; const cb = classify(b, four2)!;
    const ord = (t:MoveType)=> t==='rocket'?3 : t==='bomb'?2 : 1;
    const o = ord(cb.type)-ord(ca.type);
    if (o) return o;
    if ((cb.len||0)!==(ca.len||0)) return (cb.len||0)-(ca.len||0);
    return cb.key - ca.key;
  });
  return { move:'play', cards: legal[0], reason:'max' };
};

/* ==================== 发牌 & 运行一局 ==================== */

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      if (r==='x' || r==='X') continue; // Jokers 另外加
      deck.push(`${s}${r}`);
    }
  }
  deck.push('x'); deck.push('X');
  return deck;
}

function shuffle<T>(arr: T[], seed?: number): T[] {
  const a = [...arr];
  let rng = mulberry32(seed ?? Math.floor(Math.random()*2**31));
  for (let i=a.length-1;i>0;i--){
    const j = Math.floor(rng()* (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(a:number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a>>>15, 1 | a);
    t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  }
}

function evalHandStrength(hand: Card[]): number {
  // 粗糙评估：高牌、对/三/炸、是否有王炸等
  const g = countByRank(hand);
  let s = 0;
  for (const [r, arr] of g.entries()) {
    const v = rankIndex[r];
    if (arr.length===1) s += v*0.6;
    else if (arr.length===2) s += v*1.5;
    else if (arr.length===3) s += v*2.5;
    else if (arr.length===4) s += v*4.0;
  }
  const hasx = hand.includes('x'), hasX = hand.includes('X');
  if (hasx) s += 10; if (hasX) s += 15; if (hasx && hasX) s += 40;
  return s;
}

export async function* runOneGame(opts: RunOptions): AsyncGenerator<GameEvent> {
  const { seats, seed, rob=true, four2='both' } = { rob:true, four2:'both', ...opts };
  if (!seats || seats.length<3) throw new Error('seats must be 3 bot functions');

  // 1) 发牌
  const deck = shuffle(makeDeck(), seed);
  const hands: Card[][] = [deck.slice(0,17), deck.slice(17,34), deck.slice(34,51)];
  const dipai: Card[] = deck.slice(51);
  hands[0] = sortCardsAsc(hands[0]); hands[1] = sortCardsAsc(hands[1]); hands[2] = sortCardsAsc(hands[2]);

  yield { type:'init', hands, dipai };

  // 2) 抢地主（简化：若 rob=false，直接给最强手做地主）
  let landlord = 0;
  if (rob) {
    // 轮询三次，若有多人“rob”，最后一个“rob”者为地主；若无人抢，则最强者为地主
    let lastRob: number | null = null;
    for (let r=0;r<3;r++){
      const seat = r%3;
      const ctx: BotCtx = {
        seat, hands: hands[seat], require: undefined, canPass: true, landlord: -1, policy: { four2 },
      };
      const mv = await Promise.resolve(seats[seat](ctx));
      const action = (mv.move==='rob') ? 'rob' : 'nrob';
      if (action==='rob') lastRob = seat;
      yield { type:'rob', seat, action: action as 'rob'|'nrob', score: (mv as any).score, reason: mv.reason };
    }
    if (lastRob!=null) landlord = lastRob;
    else {
      // 无人抢：选最强
      const scores = hands.map(h=>evalHandStrength(h));
      landlord = scores.indexOf(Math.max(...scores));
    }
  } else {
    // 直接最强
    const scores = hands.map(h=>evalHandStrength(h));
    landlord = scores.indexOf(Math.max(...scores));
  }

  // 3) 亮底（底牌归地主）
  hands[landlord].push(...dipai);
  hands[landlord] = sortCardsAsc(hands[landlord]);
  yield { type:'reveal', landlord, dipai, hands };

  // 4) 对局：地主先手，直到一方出完牌
  let turn = landlord;
  let require: Require | undefined = undefined;
  let lastPlayedSeat = -1;

  while (true) {
    const myHand = hands[turn];
    // 是否允许过牌
    const canPass = !!require && lastPlayedSeat !== turn;

    const ctx: BotCtx = {
      seat: turn,
      hands: myHand,
      require,
      canPass,
      landlord,
      policy: { four2 },
      dipai,
    };

    const mv = await Promise.resolve(seats[turn](ctx));

    if (mv.move === 'pass') {
      // 只有在 canPass 时才允许 pass
      if (!canPass) {
        // 被迫改为出最小
        const legal = generateMoves(myHand, require, four2);
        const play = legal[0] ?? [myHand[0]];
        applyMove(hands, turn, play);
        const cls = classify(play, four2)!;
        require = cls;
        lastPlayedSeat = turn;
        yield { type:'play', seat:turn, cards: play, cls, remain: hands[turn].length, reason:'forced' };
      } else {
        yield { type:'pass', seat:turn, reason: mv.reason || 'pass' };
      }
    } else if (mv.move === 'play') {
      // 校验是否合法；不合法则改最小合法（兜底）
      const legal = generateMoves(myHand, require, four2);
      let play = sortCardsAsc(mv.cards || []);
      if (!play.length || !includesAll(myHand, play) || !containsCombo(legal, play)) {
        play = legal[0] ?? [myHand[0]];
      }
      applyMove(hands, turn, play);
      const cls = classify(play, four2)!;
      require = cls;
      lastPlayedSeat = turn;
      yield { type:'play', seat:turn, cards: play, cls, remain: hands[turn].length, reason: mv.reason };
    } else {
      // 抢地主阶段外收到 rob/nrob：忽略为 pass 处理
      if (canPass) {
        yield { type:'pass', seat:turn, reason:'n/a' };
      } else {
        // 必须出牌
        const legal = generateMoves(myHand, require, four2);
        const play = legal[0] ?? [myHand[0]];
        applyMove(hands, turn, play);
        const cls = classify(play, four2)!;
        require = cls;
        lastPlayedSeat = turn;
        yield { type:'play', seat:turn, cards: play, cls, remain: hands[turn].length, reason:'fallback' };
      }
    }

    // 是否出完
    if (hands[turn].length === 0) {
      const winner = turn;
      yield { type:'end', landlord, winner, lastMove: require };
      return;
    }

    // trick reset：若两家连续 pass，则轮到上一手出牌者自由出牌
    const next = (turn+1)%3;
    const next2 = (turn+2)%3;
    // 简化：当轮到“上一手出牌者”时且上两家都 pass 才 reset
    // 这里只在“该上一手者再获行动权时”重置 require
    if (lastPlayedSeat===next && peekIsPassEvent) {
      // 留给外层逻辑处理；为简洁，这里不做复杂事件缓存；当轮换时自动判断
    }

    // 轮换
    turn = (turn+1)%3;

    // 如果新行动者等于最后出牌者，且上一轮两家都 pass，则 reset
    if (turn === lastPlayedSeat) {
      // 重置：上一 trick 结束
      require = undefined;
    }
  }
}

// 辅助：从手牌移除出过的牌
function applyMove(hands: Card[][], seat: number, play: Card[]) {
  for (const p of play) {
    const idx = hands[seat].indexOf(p);
    if (idx >= 0) hands[seat].splice(idx, 1);
  }
}

// 辅助：hand 是否包含 play 所有牌
function includesAll(hand: Card[], play: Card[]): boolean {
  const m = new Map<string, number>();
  for (const c of hand) m.set(c, (m.get(c)||0)+1);
  for (const c of play) {
    const v = (m.get(c)||0)-1;
    if (v<0) return false;
    m.set(c, v);
  }
  return true;
}

// 辅助：legal 中是否包含与 play“牌面相同”的组合
function containsCombo(legal: Card[][], play: Card[]): boolean {
  const k = sortCardsAsc(play).join(',');
  return legal.some(m => sortCardsAsc(m).join(',') === k);
}
