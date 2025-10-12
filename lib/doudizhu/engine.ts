// lib/doudizhu/engine.ts
/* === Inject: bid-eval helper (bidding debug) === */
function __emitRobEval(gen:any, seat:number, score:number, threshold:number, decision:'call'|'bid'|'pass', roundNo?:number){
  try { gen && gen.next && gen.next({ type:'event', kind:'bid-eval', seat, score, threshold, decision, roundNo }); } catch(e){}
}
// Dou Dizhu (斗地主) “真引擎”实现（适配 Bot Arena 项目）。
// - 牌型完整（单、对、三、三带、顺子、连对、飞机/带翅膀、四带二、炸弹、王炸）
// - 比较完整
// - 生成可跟牌完整（含炸弹、王炸；同型同长更大）
// - 流程：发牌 → 抢地主 → 亮底 → 正式对局（地主先手）
// - 防假死：首家不许过；若“有人出过牌后连着两家过”⇒ trick-reset；若首家仍传回 pass ⇒ 强制出最小单
// - 计分：叫/抢倍数（每抢×2）、炸弹/王炸×2、春天/反春天×2
// ========== 类型 ==========
export type Four2Policy = 'both' | '2singles' | '2pairs';
export type Label = string;
export type BotMove =
  | { move: 'pass'; reason?: string }
  | { move: 'play'; cards: Label[]; reason?: string };
export type PlayEvent = {
  seat: number;
  move: 'play' | 'pass';
  cards?: Label[];
  comboType?: Combo['type'];
  trick: number;            // 第几轮（从 0 开始）
};
export type BotCtx = {
  hands: Label[];
  require: Combo | null;    // 当前需跟牌型（首家为 null）
  canPass: boolean;
  policy?: { four2?: Four2Policy };
  // --- 新增：对局上下文（记牌 / 历史 / 角色信息） ---
  seat: number;             // 当前出牌座位（0/1/2）
  landlord: number;         // 地主座位
  leader: number;           // 本轮首家座位
  trick: number;            // 当前轮次（从 0 开始）
  history: PlayEvent[];     // 截至当前的全部出牌/过牌历史（含 trick 序号）
  currentTrick: PlayEvent[];// 当前这一轮里，至今为止的出牌序列
  seen: Label[];            // 所有“已公开可见”的牌：底牌 + 历史出牌
  bottom: Label[];          // 亮底的三张牌（开局已公布）
  seenBySeat?: Label[][];
  handsCount: [number, number, number]; // 各家的手牌张数
  role: 'landlord' | 'farmer';          // 当前角色
  teammates: number[];      // 队友座位（农民互为队友；地主为空数组）
  opponents: number[];      // 对手座位
  // 计数信息（便于策略快速使用）
  counts: {
    handByRank: Record<string, number>;
    seenByRank: Record<string, number>;
    remainingByRank: Record<string, number>; // 54 张减去 seen 与自己手牌后的估计余量
  };
};

// ========== 新增：抢地主上下文与决策 ==========
export type BidDecision = {
  decision: 'bid' | 'pass';
  confidence?: number;   // 用于第二轮比较（越大越强）
  reason?: string;       // 可选，用于日志
};

export type BidContext = {
  hand: Label[];
  seat: number;
  roundNo: number;
  phase: 'first-round' | 'second-round';
  previousBids: { seat: number; decision: 'bid' | 'pass' }[];
  currentMultiplier: number;
  rules: {
    four2: Four2Policy;
    coop: boolean;
  };
};

// 扩展 BotFunc：可选的 bid 方法
export type BotFunc = {
  (ctx: BotCtx): Promise<BotMove> | BotMove;
  bid?: (ctx: BidContext) => Promise<BidDecision> | BidDecision;
};

// ========== 牌面与工具 ==========
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const; // x=小王 X=大王
const ORDER: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));
function tallyByRank(labels: Label[]): Record<string, number> {
  const map = countByRank(labels);
  const out: Record<string, number> = {};
  for (const [idx, arr] of map.entries()) out[RANKS[idx]] = arr.length;
  for (const r of RANKS) if (!(r in out)) out[r] = 0;
  return out;
}
function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }
function rankOf(label: Label): string {
  const s = String(label);
  const ch = s[0];
  if (SUITS.includes(ch as any)) {
    // '♠A' '♥T' ...
    return s.slice(1);
  }
  // 'x' / 'X'
  return s;
}
function v(label: Label): number {
  return ORDER[rankOf(label)] ?? -1;
}
function byValueAsc(a: Label, b: Label) {
  const va = v(a), vb = v(b);
  if (va !== vb) return va - vb;
  // 次序稳定一点：按花色字典
  return a.localeCompare(b);
}
function sorted(hand: Label[]) {
  return [...hand].sort(byValueAsc);
}
function removeLabels(hand: Label[], pick: Label[]) {
  // 精确移除数量
  for (const c of pick) {
    const i = hand.indexOf(c);
    if (i >= 0) hand.splice(i, 1);
  }
}
// ========== 牌型判定 ==========
type ComboType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple_one'
  | 'triple_pair'
  | 'straight'
  | 'pair_seq'
  | 'plane'
  | 'plane_single'
  | 'plane_pair'
  | 'four_two_singles'
  | 'four_two_pairs'
  | 'bomb'
  | 'rocket';
export type Combo = {
  type: ComboType;
  // “核心”比较点：单/对/三/炸弹 => 该点；顺子/连对/飞机 => 最高点；三带/四带 => 主体点（不比带牌）
  rank: number;
  // 顺子/连对/飞机长度（分别是牌张数、对数、三张组数）
  len?: number;
  // 便于二次生成/比较的附属结构
  cards?: Label[];
};
// 对手牌点数统计
function countByRank(cards: Label[]) {
  const map = new Map<number, Label[]>();
  for (const c of cards) {
    const R = v(c);
    if (!map.has(R)) map.set(R, []);
    map.get(R)!.push(c);
  }
  return map; // value -> labels[]
}
// 连续段（不给 2、王）
const CHAIN_MIN = {
  straight: 5,
  pair_seq: 3,     // 对数
  plane: 2,        // 三张组数
};
const MAX_SEQ_VALUE = ORDER['A']; // 顺子、连对、飞机核心不可含 '2' 与王
function classify(cards: Label[], four2: Four2Policy = 'both'): Combo | null {
  const N = cards.length;
  if (N <= 0) return null;
  const cnt = countByRank(cards);
  // 王炸
  if (N === 2 && cnt.get(ORDER['x'])?.length === 1 && cnt.get(ORDER['X'])?.length === 1) {
    return { type: 'rocket', rank: ORDER['X'], cards: sorted(cards) };
  }
  // 炸弹
  if (N === 4) {
    for (const [rv, arr] of cnt) {
      if (arr.length === 4) return { type: 'bomb', rank: rv, cards: sorted(cards) };
    }
  }
  // 单/对/三
  for (const [rv, arr] of cnt) {
    if (arr.length === 1 && N === 1) return { type: 'single', rank: rv, cards: sorted(cards) };
    if (arr.length === 2 && N === 2) return { type: 'pair', rank: rv, cards: sorted(cards) };
    if (arr.length === 3) {
      if (N === 3) return { type: 'triple', rank: rv, cards: sorted(cards) };
      if (N === 4) {
        // 三带一
        return { type: 'triple_one', rank: rv, cards: sorted(cards) };
      }
      if (N === 5) {
        // 三带二（对子）
        const hasPair = Array.from(cnt.values()).some(a => a.length === 2);
        if (hasPair) return { type: 'triple_pair', rank: rv, cards: sorted(cards) };
      }
    }
    if (arr.length === 4) {
      // 四带二
      if ((four2 === 'both' || four2 === '2singles') && N === 6) {
        // 四带两张单牌
        return { type: 'four_two_singles', rank: rv, cards: sorted(cards) };
      }
      if ((four2 === 'both' || four2 === '2pairs') && N === 8) {
        // 四带两对
        const pairCnt = Array.from(cnt.values()).filter(a => a.length === 2 && v(a[0]) !== rv).length;
        if (pairCnt === 2) return { type: 'four_two_pairs', rank: rv, cards: sorted(cards) };
      }
    }
  }
  // 顺子（>=5，不含2/王；必须全单且连续）
  const uniq = [...cnt.entries()]
    .filter(([rv]) => rv <= MAX_SEQ_VALUE)
    .sort((a,b) => a[0]-b[0])
    .filter(([_, arr]) => arr.length >= 1);
  if (uniq.length >= CHAIN_MIN.straight && uniq.length === N) {
    let ok = true;
    for (let i=1;i<uniq.length;i++) if (uniq[i][0] !== uniq[i-1][0]+1) { ok=false; break; }
    if (ok) return { type: 'straight', rank: uniq[uniq.length-1][0], len: N, cards: sorted(cards) };
  }
  // 连对（>=3，对对连续；不能含2/王）
  const pairs = [...cnt.entries()].filter(([rv,a]) => rv <= MAX_SEQ_VALUE && a.length >= 2).sort((a,b)=>a[0]-b[0]);
  if (pairs.length >= CHAIN_MIN.pair_seq && pairs.length*2 === N) {
    let ok = true;
    for (let i=1;i<pairs.length;i++) if (pairs[i][0] !== pairs[i-1][0]+1) { ok=false; break; }
    if (ok) return { type: 'pair_seq', rank: pairs[pairs.length-1][0], len: pairs.length, cards: sorted(cards) };
  }
  // 飞机（不带/带翅膀）
  const triples = [...cnt.entries()].filter(([rv,a]) => rv <= MAX_SEQ_VALUE && a.length >= 3).sort((a,b)=>a[0]-b[0]);
  // 不带
  if (triples.length >= CHAIN_MIN.plane && triples.length*3 === N) {
    let ok = true;
    for (let i=1;i<triples.length;i++) if (triples[i][0] !== triples[i-1][0]+1) { ok=false; break; }
    if (ok) return { type: 'plane', rank: triples[triples.length-1][0], len: triples.length, cards: sorted(cards) };
  }
  // 带单 / 带对
  if (triples.length >= CHAIN_MIN.plane) {
    // 三张组数量
    for (let len = triples.length; len >= CHAIN_MIN.plane; len--) {
      for (let i=0; i+len<=triples.length; i++) {
        let ok = true;
        for (let k=1;k<len;k++) if (triples[i+k][0] !== triples[i+k-1][0]+1) { ok = false; break; }
        if (!ok) continue;
        const planeRanks = new Set<number>(triples.slice(i,i+len).map(([rv]) => rv));
        const coreCount = len*3;
        const rest = N - coreCount;
        if (rest === len) { // 每组三带一单
          // 检查剩余张是否都来自 plane 以外，并恰好 len 张单
          const others: Label[] = [];
          for (const [rv, arr] of cnt) {
            const need = planeRanks.has(rv) ? Math.max(0, arr.length - 3) : arr.length; // plane 之外全可用；plane 内最多可再取 0
            for (let t=0;t<need;t++) others.push(arr[t]);
          }
          if (others.length === len) {
            return { type: 'plane_single', rank: triples[i+len-1][0], len, cards: sorted(cards) };
          }
        } else if (rest === len*2) { // 每组三带一对
          const pairAvail = [...cnt.entries()]
            .filter(([rv, arr]) => !planeRanks.has(rv) && arr.length >= 2).length;
          if (pairAvail >= len) {
            return { type: 'plane_pair', rank: triples[i+len-1][0], len, cards: sorted(cards) };
          }
        }
      }
    }
  }
  return null;
}
// 比较：b 是否能压过 a
function beats(a: Combo, b: Combo): boolean {
  if (b.type === 'rocket') return true;
  if (a.type === 'rocket') return false;
  if (b.type === 'bomb' && a.type !== 'bomb') return true;
  if (a.type === 'bomb' && b.type === 'bomb') return b.rank > a.rank;
  if (a.type !== b.type) return false;
  // 同型比较
  switch (a.type) {
    case 'single': case 'pair': case 'triple':
    case 'triple_one': case 'triple_pair':
    case 'four_two_singles': case 'four_two_pairs':
      return b.rank > a.rank;
    case 'straight': case 'pair_seq': case 'plane':
    case 'plane_single': case 'plane_pair':
      if ((a.len ?? 0) !== (b.len ?? 0)) return false;
      return b.rank > a.rank;
    case 'bomb':
      return b.rank > a.rank;
    default: return false;
  }
}
// ========== 可跟/可出 生成 ==========
function* singlesFrom(map: Map<number, Label[]>) {
  for (const [rv, arr] of [...map.entries()].sort((a,b)=>a[0]-b[0])) {
    for (const c of arr) yield [c];
  }
}
function* pairsFrom(map: Map<number, Label[]>) {
  for (const [rv, arr] of [...map.entries()].sort((a,b)=>a[0]-b[0])) {
    if (arr.length >= 2) yield [arr[0], arr[1]];
  }
}
function* triplesFrom(map: Map<number, Label[]>) {
  for (const [rv, arr] of [...map.entries()].sort((a,b)=>a[0]-b[0])) {
    if (arr.length >= 3) yield [arr[0], arr[1], arr[2]];
  }
}
function* bombsFrom(map: Map<number, Label[]>) {
  for (const [rv, arr] of [...map.entries()].sort((a,b)=>a[0]-b[0])) {
    if (arr.length === 4) yield [arr[0], arr[1], arr[2], arr[3]];
  }
}
function rocketFrom(map: Map<number, Label[]>) {
  const sx = map.get(ORDER['x'])?.[0];
  const bX = map.get(ORDER['X'])?.[0];
  return (sx && bX) ? [sx, bX] : null;
}
function* straightsFrom(map: Map<number, Label[]>) {
  const okRanks = [...map.entries()].filter(([rv, arr]) => rv <= MAX_SEQ_VALUE && arr.length >= 1).map(([rv]) => rv).sort((a,b)=>a-b);
  if (!okRanks.length) return;
  // merge consecutive runs
  let i=0;
  while (i<okRanks.length) {
    let j=i;
    while (j+1<okRanks.length && okRanks[j+1] === okRanks[j]+1) j++;
    const run = okRanks.slice(i, j+1);
    if (run.length >= CHAIN_MIN.straight) {
      for (let L=CHAIN_MIN.straight; L<=run.length; L++) {
        for (let s=0; s+L<=run.length; s++) {
          const ranks = run.slice(s, s+L);
          const use = ranks.map(rv => map.get(rv)![0]);
          yield use;
        }
      }
    }
    i = j+1;
  }
}
function* pairSeqFrom(map: Map<number, Label[]>) {
  const okRanks = [...map.entries()].filter(([rv, arr]) => rv <= MAX_SEQ_VALUE && arr.length >= 2).map(([rv]) => rv).sort((a,b)=>a-b);
  let i=0;
  while (i<okRanks.length) {
    let j=i;
    while (j+1<okRanks.length && okRanks[j+1] === okRanks[j]+1) j++;
    const run = okRanks.slice(i, j+1);
    if (run.length >= CHAIN_MIN.pair_seq) {
      for (let L=CHAIN_MIN.pair_seq; L<=run.length; L++) {
        for (let s=0; s+L<=run.length; s++) {
          const ranks = run.slice(s, s+L);
          const use = ranks.flatMap(rv => [map.get(rv)![0], map.get(rv)![1]]);
          yield use;
        }
      }
    }
    i = j+1;
  }
}
function* planeCoreFrom(map: Map<number, Label[]>) {
  const okRanks = [...map.entries()].filter(([rv, arr]) => rv <= MAX_SEQ_VALUE && arr.length >= 3).map(([rv]) => rv).sort((a,b)=>a-b);
  let i=0;
  while (i<okRanks.length) {
    let j=i;
    while (j+1<okRanks.length && okRanks[j+1] === okRanks[j]+1) j++;
    const run = okRanks.slice(i, j+1);
    if (run.length >= CHAIN_MIN.plane) {
      for (let L=CHAIN_MIN.plane; L<=run.length; L++) {
        for (let s=0; s+L<=run.length; s++) {
          const ranks = run.slice(s, s+L);
          const use = ranks.flatMap(rv => map.get(rv)!.slice(0,3));
          yield use; // 只返回核心，不带翅膀
        }
      }
    }
    i = j+1;
  }
}
function generateAllMoves(hand: Label[], four2: Four2Policy): Label[][] {
  const map = countByRank(hand);
  const res: Label[][] = [];
  // 火箭/炸弹
  const rocket = rocketFrom(map);
  if (rocket) res.push(rocket);
  for (const b of bombsFrom(map)) res.push(b);
  // 单、对、三
  for (const s of singlesFrom(map)) res.push(s);
  for (const p of pairsFrom(map)) res.push(p);
  for (const t of triplesFrom(map)) res.push(t);
  // 三带
  for (const t of triplesFrom(map)) {
    // 带一单
    const used = new Set(t.map(x => x));
    for (const s of singlesFrom(map)) {
      if (used.has(s[0])) continue;
      res.push([...t, ...s]);
      break; // 控制枚举规模：每个三张只取一个带法
    }
    // 带一对
    for (const p of pairsFrom(map)) {
      if (p.some(x => used.has(x))) continue;
      res.push([...t, ...p]);
      break;
    }
  }
  // 顺子、连对
  for (const s of straightsFrom(map)) res.push(s);
  for (const p of pairSeqFrom(map)) res.push(p);
  // 飞机（不带/带单/带对）——每个核心只接一种带法，控制枚举量
  for (const core of planeCoreFrom(map)) {
    res.push(core); // 不带
    const cnt = countByRank(hand);
    // 去掉核心
    for (const c of core) {
      const arr = cnt.get(v(c))!;
      const i = arr.indexOf(c); arr.splice(i,1);
      if (arr.length === 0) cnt.delete(v(c));
    }
    const group = core.length/3;
    // 带单
    const singles: Label[] = [];
    for (const [rv, arr] of cnt) for (const c of arr) singles.push(c);
    if (singles.length >= group) res.push([...core, ...singles.slice(0, group)]);
    // 带对
    const pairs: Label[][] = [];
    for (const [rv,a2] of cnt) if (rv !== v(core[0]) && a2.length >= 2) pairs.push([a2[0], a2[1]]);
    if (pairs.length >= group) res.push([...core, ...pairs.slice(0, group).flat()]);
  }
  // 四带二
  for (const [rv, arr] of map) if (arr.length === 4) {
    if (four2 === 'both' || four2 === '2singles') {
      const pool: Label[] = [];
      for (const [r2, a2] of map) if (r2 !== rv) for (const c of a2) pool.push(c);
      if (pool.length >= 2) res.push([...arr, ...pool.slice(0,2)]);
    }
    if (four2 === 'both' || four2 === '2pairs') {
      const pairs: Label[][] = [];
      for (const [r2,a2] of map) if (r2 !== rv && a2.length >= 2) pairs.push([a2[0],a2[1]]);
      if (pairs.length >= 2) res.push([...arr, ...pairs[0], ...pairs[1]]);
    }
  }
  // 去重/排序
  const key = (xs:Label[]) => xs.slice().sort().join('|');
  const uniq = new Map<string, Label[]>();
  for (const m of res) uniq.set(key(m), m);
  return [...uniq.values()].sort((A,B) => {
    const ca = classify(A, four2)!, cb = classify(B, four2)!;
    if (ca.type === cb.type) return (ca.rank - cb.rank);
    // 非严格排序，仅稳定输出
    return ca.type.localeCompare(cb.type);
  });
}
function generateMoves(hand: Label[], require: Combo | null, four2: Four2Policy): Label[][] {
  const all = generateAllMoves(hand, four2);
  if (!require) return all;
  // 找能压住的（炸弹/王炸规则包含在 beats 内）
  const out: Label[][] = [];
  for (const mv of all) {
    const cc = classify(mv, four2)!;
    if (beats(require, cc)) out.push(mv);
  }
  return out;
}
// ========== 内置 Bot ==========
// ...（此处省略 GreedyMax / GreedyMin / RandomLegal 等内置 Bot 实现，保持原样）...
// ========== 发牌 / 抢地主 ==========
function freshDeck(): Label[] {
  const d: Label[] = [];
  for (const r of RANKS) {
    if (r === 'x' || r === 'X') continue;
    for (const s of SUITS) d.push(s + r);
  }
  d.push('x', 'X');
  return d;
}
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function evalRobScore(hand: Label[]): number {
  const map = countByRank(hand);
  const hasRocket = !!rocketFrom(map);
  const bombs = [...bombsFrom(map)].length;
  const twos = map.get(ORDER['2'])?.length ?? 0;
  const As = map.get(ORDER['A'])?.length ?? 0;
  let score = 0;
  if (hasRocket) score += 4;
  score += bombs * 1.8;
  if (twos >= 2) score += 1.2 + Math.max(0, twos-2) * 0.6;
  if (As   >= 3) score += (As-2) * 0.5;
  return score;
}
// ========== 对局主循环 ==========
export async function* runOneGame(opts: {
  seats: [BotFunc, BotFunc, BotFunc] | BotFunc[];
  delayMs?: number;
  bid?: boolean;
  four2?: Four2Policy;
  roundNo?: number; // 新增：用于轮转叫牌
}): AsyncGenerator<any, void, unknown> {
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const bots: BotFunc[] = Array.from(opts.seats as BotFunc[]);
  const four2 = opts.four2 || 'both';
  const roundNo = opts.roundNo ?? 1;
  // 发牌
  let deck = shuffle(freshDeck());
  let hands: Label[][] = [[],[],[]];
  for (let i=0;i<17;i++) for (let s=0;s<3;s++) hands[s].push(deck[i*3+s]);
  let bottom = deck.slice(17*3); // 3 张
  for (let s=0;s<3;s++) hands[s] = sorted(hands[s]);
  // 抢地主流程
  let landlord = 0;
  let multiplier = 1;
  let bidMultiplier = 1;
  if (opts.bid !== false) {
    for (let __attempt = 0; __attempt < 5; __attempt++) {
      const __bidders: { seat: number; confidence: number; decision: 'bid' | 'pass' }[] = [];
      let last = -1;
      bidMultiplier = 1;
      multiplier = 1;
      // === 第一轮叫牌 ===
      const firstRoundBids: { seat: number; decision: 'bid' | 'pass' }[] = [];
      for (let s = 0; s < 3; s++) {
        const bot = bots[s];
        let decision: 'bid' | 'pass';
        let confidence: number | undefined;
        // 尝试调用外部 AI 的 bid 方法
        if (typeof bot === 'object' && typeof (bot as any).bid === 'function') {
          const bidCtx: BidContext = {
            hand: hands[s],
            seat: s,
            roundNo,
            phase: 'first-round',
            previousBids: [...firstRoundBids],
            currentMultiplier: multiplier,
            rules: { four2, coop: true },
          };
          const res = await Promise.resolve((bot as any).bid(bidCtx));
          decision = res.decision;
          confidence = res.confidence ?? 0;
          yield {
            type: 'event',
            kind: 'ai-bid',
            seat: s,
            decision,
            confidence,
            reason: res.reason,
          };
        } else {
          // fallback 到 evalRobScore + 阈值
          const sc = evalRobScore(hands[s]);
          const __thMapChoice: Record<string, number> = {
            'built-in:greedy-max': 1.6,
            'built-in:ally-support': 1.8,
            'built-in:random-legal': 2.0,
            'built-in:endgame-rush': 2.1,
            'built-in:mininet': 2.2,
            'built-in:greedy-min': 2.4,
            'external': 2.2,
            'external:ai': 2.2,
            'external:http': 2.2,
            'ai': 2.2,
            'http': 2.2,
            'openai': 2.2,
            'gpt': 2.2,
            'claude': 2.2,
          };
          const __choice = String((bot as any)?.choice || '').toLowerCase();
          const __name = String((bot as any)?.name || (bot as any)?.constructor?.name || '').toLowerCase();
          const __th = __thMapChoice[__choice] ?? __thMapChoice[__name] ?? 1.8;
          decision = sc >= __th ? 'bid' : 'pass';
          confidence = sc;
          yield {
            type: 'event',
            kind: 'bid-eval',
            seat: s,
            score: sc,
            threshold: __th,
            decision,
            bidMult: bidMultiplier,
            mult: multiplier,
          };
        }
        firstRoundBids.push({ seat: s, decision });
        if (decision === 'bid') {
          __bidders.push({ seat: s, confidence: confidence!, decision });
          multiplier = Math.min(64, multiplier * 2);
          last = s;
          yield {
            type: 'event',
            kind: 'bid',
            seat: s,
            bid: true,
            score: confidence,
            bidMult: bidMultiplier,
            mult: multiplier,
          };
        }
        if (opts.delayMs) await wait(opts.delayMs);
      }
      // === 第二轮：仅对第一轮 bid 的人，比较 confidence（同分后手优先）===
      if (__bidders.length > 0) {
        let bestSeat = -1;
        let bestConfidence = -Infinity;
        for (let t = 0; t < 3; t++) {
          const bidder = __bidders.find(b => b.seat === t);
          if (!bidder) continue;
          bidMultiplier = Math.min(64, bidMultiplier * 2);
          multiplier = bidMultiplier;
          yield {
            type: 'event',
            kind: 'rob2',
            seat: t,
            confidence: bidder.confidence,
            bidMult: bidMultiplier,
            mult: multiplier,
          };
          if (bidder.confidence >= bestConfidence) {
            bestConfidence = bidder.confidence;
            bestSeat = t;
          }
        }
        landlord = bestSeat;
      }
      // === 无人抢：重发牌 ===
      if (__bidders.length === 0) {
        try {
          yield { type: 'event', kind: 'bid-skip', reason: 'no-bidders' };
        } catch {}
        // 重新发牌
        deck = shuffle(freshDeck());
        hands = [[], [], []];
        for (let i = 0; i < 17; i++)
          for (let s = 0; s < 3; s++) hands[s].push(deck[i * 3 + s]);
        bottom = deck.slice(17 * 3);
        for (let s = 0; s < 3; s++) hands[s] = sorted(hands[s]);
        continue;
      }
      multiplier = bidMultiplier;
      if (last !== -1) landlord = last;
      break;
    }
  }
  // 亮底 & 地主收底
  yield { type:'event', kind:'reveal', bottom: bottom.slice() };
  hands[landlord].push(...bottom);
  hands[landlord] = sorted(hands[landlord]);
  // === 加倍阶段（略，保持原逻辑）===
  // ...（此处省略加倍逻辑，保持原样）...
  // 初始化 & 正式对局循环（略，保持原样）
  // ...（此处省略 play loop，保持原样）...
}