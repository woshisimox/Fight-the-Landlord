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

type CoopRecommendation = (BotMove & { via?: string });

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

  coop?: {
    enabled: boolean;
    teammate: number | null;
    landlord: number;
    teammateHistory: PlayEvent[];
    landlordHistory: PlayEvent[];
    teammateLastPlay: PlayEvent | null;
    landlordLastPlay: PlayEvent | null;
    teammateSeen: Label[];
    landlordSeen: Label[];
    teammateHandCount: number;
    landlordHandCount: number;
    recommended?: CoopRecommendation;
  };
};


export type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

// ========== 牌面与工具 ==========
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const; // x=小王 X=大王
const ORDER: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const RANK_LABELS: Record<string, string> = {
  '3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9',
  'T':'10','J':'J','Q':'Q','K':'K','A':'A','2':'2',
  'x':'小王','X':'大王'
};
const ORDER_HINT_RAW = RANKS.join('<');
const ORDER_HINT_LABEL = RANKS.map(r => RANK_LABELS[r] ?? r).join('<');
function tallyByRank(labels: Label[]): Record<string, number> {
  const map = countByRank(labels);
  const out: Record<string, number> = {};
  for (const [idx, arr] of map.entries()) out[RANKS[idx]] = arr.length;
  for (const r of RANKS) if (!(r in out)) out[r] = 0;
  return out;
}

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

function normalizeMove(move: any): BotMove | null {
  if (!move || typeof move !== 'object') return null;
  if (move.move === 'pass') {
    return { move: 'pass', reason: typeof move.reason === 'string' ? move.reason : undefined };
  }
  if (move.move === 'play' && Array.isArray(move.cards)) {
    return {
      move: 'play',
      cards: move.cards.slice(),
      reason: typeof move.reason === 'string' ? move.reason : undefined,
    };
  }
  return null;
}

function maybeFollowCoop(ctx: BotCtx): BotMove | null {
  const coop = ctx?.coop;
  if (!coop?.enabled || ctx.role !== 'farmer') return null;
  if (!coop.recommended) return null;
  if (coop.recommended.move === 'pass') {
    const baseReason = coop.recommended.reason || `FarmerCoop${coop.recommended.via ? `(${coop.recommended.via})` : ''}`;
    return { move: 'pass', reason: baseReason };
  }
  if (coop.recommended.move === 'play') {
    const cards = Array.isArray(coop.recommended.cards) ? coop.recommended.cards.slice() : [];
    const baseReason = coop.recommended.reason || `FarmerCoop${coop.recommended.via ? `(${coop.recommended.via})` : ''}`;
    return { move: 'play', cards, reason: baseReason };
  }
  return null;
}


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

function remainingCountByRank(seen: Label[], hand: Label[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const r of RANKS) total[r] = (r === 'x' || r === 'X') ? 1 : 4;
  const subtract = (labels: Label[]) => {
    for (const card of labels) {
      const rk = rankOf(card);
      total[rk] = (total[rk] || 0) - 1;
    }
  };
  subtract(seen);
  subtract(hand);
  for (const r of RANKS) if (!(r in total)) total[r] = 0;
  return total;
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
  // —— 供外置 Bot 理解牌型需求的附加描述 ——
  label?: string;
  description?: string;
  rankSymbol?: string;
  rankLabel?: string;
  minRankSymbol?: string;
  minRankLabel?: string;
  maxRankSymbol?: string;
  maxRankLabel?: string;
  rankOrder?: string[];
  rankOrderLabel?: string[];
  orderHint?: string;
  orderHintLabel?: string;
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

function rankSymbolOf(idx?: number): string | undefined {
  if (typeof idx !== 'number') return undefined;
  if (idx < 0 || idx >= RANKS.length) return undefined;
  return RANKS[idx];
}

function readableRank(symbol?: string): string | undefined {
  if (!symbol) return undefined;
  return RANK_LABELS[symbol] ?? symbol;
}

function allowedRankSymbolsFor(type: ComboType): string[] {
  switch (type) {
    case 'single':
      return [...RANKS];
    case 'pair':
      return RANKS.filter(r => r !== 'x' && r !== 'X');
    case 'triple':
    case 'triple_one':
    case 'triple_pair':
    case 'four_two_singles':
    case 'four_two_pairs':
    case 'bomb':
      return RANKS.filter(r => r !== 'x' && r !== 'X');
    case 'straight':
    case 'pair_seq':
    case 'plane':
    case 'plane_single':
    case 'plane_pair':
      return RANKS.filter(r => ORDER[r] <= MAX_SEQ_VALUE);
    case 'rocket':
      return ['x', 'X'];
    default:
      return [...RANKS];
  }
}

function nextRankSymbolFor(combo: Combo): string | undefined {
  const symbol = rankSymbolOf(combo.rank);
  if (!symbol) return undefined;
  const allowed = allowedRankSymbolsFor(combo.type);
  const idx = allowed.indexOf(symbol);
  if (idx < 0 || idx + 1 >= allowed.length) return undefined;
  return allowed[idx + 1];
}

function maxRankSymbolFor(combo: Combo): string | undefined {
  const allowed = allowedRankSymbolsFor(combo.type);
  if (!allowed.length) return undefined;
  return allowed[allowed.length - 1];
}

function comboTypeName(combo: Combo): string {
  const len = combo.len ?? 0;
  switch (combo.type) {
    case 'single': return '单张';
    case 'pair': return '对子';
    case 'triple': return '三张';
    case 'triple_one': return '三带一';
    case 'triple_pair': return '三带一对';
    case 'straight': return len ? `${len}张顺子` : '顺子';
    case 'pair_seq': return len ? `${len}连对` : '连对';
    case 'plane': return len ? `${len}组三张飞机` : '飞机';
    case 'plane_single': return len ? `${len}组三带一` : '飞机带单';
    case 'plane_pair': return len ? `${len}组三带对` : '飞机带对';
    case 'four_two_singles': return '四带两单';
    case 'four_two_pairs': return '四带两对';
    case 'bomb': return '炸弹';
    case 'rocket': return '王炸';
    default: return combo.type;
  }
}

function labelForFollow(combo: Combo, rankLabel?: string): string {
  const len = combo.len ?? 0;
  switch (combo.type) {
    case 'single':
      return rankLabel ? `大于${rankLabel}的单张` : '需跟更大的单张';
    case 'pair':
      return rankLabel ? `大于对${rankLabel}的对子` : '需跟更大的对子';
    case 'triple':
      return rankLabel ? `大于${rankLabel}的三张` : '需跟更大的三张';
    case 'triple_one':
      return rankLabel ? `大于${rankLabel}的三带一` : '需跟更大的三带一';
    case 'triple_pair':
      return rankLabel ? `大于${rankLabel}的三带一对` : '需跟更大的三带一对';
    case 'straight':
      return rankLabel ? `大于以${rankLabel}为顶的${len}张顺子` : `需跟更大的${len}张顺子`;
    case 'pair_seq':
      return rankLabel ? `大于以${rankLabel}为顶的${len}连对` : `需跟更大的${len}连对`;
    case 'plane':
      return rankLabel ? `大于以${rankLabel}为顶的${len}组三张飞机` : `需跟更大的${len}组三张飞机`;
    case 'plane_single':
      return rankLabel ? `大于以${rankLabel}为顶的${len}组三带一` : `需跟更大的${len}组三带一`;
    case 'plane_pair':
      return rankLabel ? `大于以${rankLabel}为顶的${len}组三带对` : `需跟更大的${len}组三带对`;
    case 'four_two_singles':
      return rankLabel ? `大于${rankLabel}的四带两单` : '需跟更大的四带两单';
    case 'four_two_pairs':
      return rankLabel ? `大于${rankLabel}的四带两对` : '需跟更大的四带两对';
    case 'bomb':
      return rankLabel ? `大于${rankLabel}的炸弹` : '需跟更大的炸弹';
    case 'rocket':
      return '王炸（最大牌型）';
    default:
      return combo.type;
  }
}

function describeFollowRequirement(combo: Combo): Combo {
  const copy: Combo = { ...combo };
  const rankSymbol = rankSymbolOf(combo.rank);
  const rankLabel = readableRank(rankSymbol);
  const nextSymbol = combo.type === 'rocket' ? undefined : nextRankSymbolFor(combo);
  const nextLabel = readableRank(nextSymbol);
  const maxSymbol = maxRankSymbolFor(combo);
  const maxLabel = readableRank(maxSymbol);
  const typeName = comboTypeName(combo);
  const label = labelForFollow(combo, rankLabel);

  let description: string;
  if (combo.type === 'rocket') {
    description = '王炸为最大牌型，无法被压制。';
  } else if (combo.type === 'bomb') {
    if (nextLabel) {
      description = `需要出比 ${rankLabel} 更大的炸弹（至少 ${nextLabel}），否则只有王炸可以压制。`;
    } else {
      description = `${rankLabel ? `${rankLabel} 炸弹` : '该炸弹'} 已是最大，只能用王炸压制。`;
    }
  } else {
    if (nextLabel) {
      description = `需要出比 ${rankLabel} 更大的${typeName}（至少 ${nextLabel}），也可以用炸弹或王炸压制。`;
    } else {
      description = `${typeName}${rankLabel ? ` ${rankLabel}` : ''} 已是该类型最大，只能使用炸弹或王炸压制。`;
    }
  }

  copy.label = label;
  copy.description = description;
  copy.rankSymbol = rankSymbol;
  copy.rankLabel = rankLabel;
  copy.minRankSymbol = nextSymbol;
  copy.minRankLabel = nextLabel;
  copy.maxRankSymbol = maxSymbol;
  copy.maxRankLabel = maxLabel;
  copy.rankOrder = [...RANKS];
  copy.rankOrderLabel = RANKS.map(r => readableRank(r) ?? r);
  copy.orderHint = ORDER_HINT_RAW;
  copy.orderHintLabel = ORDER_HINT_LABEL;
  return copy;
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
    for (const [rv, arr] of cnt) if (arr.length >= 2) pairs.push([arr[0], arr[1]]);
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
export const RandomLegal: BotFunc = (ctx) => {
  const coopMove = maybeFollowCoop(ctx);
  if (coopMove) return coopMove;
  const four2 = ctx?.policy?.four2 || 'both';
  const legal = generateMoves(ctx.hands, ctx.require, four2);

  const isType = (t:any,...n:string[])=>n.includes(String(t));
  const rankOfLocal = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
  const removeCards=(h:string[],p:string[])=>{const a=h.slice();for(const c of p){const i=a.indexOf(c);if(i>=0)a.splice(i,1);}return a;};
  const countByRankLocal=(cs:string[])=>{const m=new Map<string,number>();for(const c of cs){const r=rankOfLocal(c);m.set(r,(m.get(r)||0)+1);}return m;};
  const SEQ=['3','4','5','6','7','8','9','T','J','Q','K','A'];
  const POS=Object.fromEntries(SEQ.map((r,i)=>[r,i])) as Record<string,number>;
  const ORDER=['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
  const POSALL=Object.fromEntries(ORDER.map((r,i)=>[r,i])) as Record<string,number>;

  const longestSingleChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.keys()).filter(r=>r!=='2'&&r!=='x'&&r!=='X').sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};
  const longestPairChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.entries()).filter(([r,n])=>n>=2&&r!=='2'&&r!=='x'&&r!=='X').map(([r])=>r).sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};

  const keyRankOfMove=(mv:string[])=>{const cls=classify(mv,four2)! as any;const cnt=countByRankLocal(mv);
    if(isType(cls.type,'rocket'))return'X';
    if(isType(cls.type,'bomb','four_two_singles','four_two_pairs')){for(const[r,n]of cnt.entries())if(n===4)return r;}
    if(isType(cls.type,'pair','pair_seq')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=2&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'triple','triple_one','triple_pair','plane','plane_single','plane_pair')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=3&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'straight')){let best='3',bp=-1;for(const r of Object.keys(cnt))if(r!=='2'&&r!=='x'&&r!=='X'&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    let best='3',bp=-1;for(const r of Object.keys(cnt)){const p=POSALL[r]??-1;if(p>bp){best=r;bp=p;}}return best;};

  // —— 未现牌估计（结合已出牌与手牌）
  const BASE:Record<string,number>=Object.fromEntries(ORDER.map(r=>[r,(r==='x'||r==='X')?1:4])) as Record<string,number>;
  const seenAll:string[]=(globalThis as any).__DDZ_SEEN ?? [];
  const unseen=new Map<string,number>(Object.entries(BASE));
  const sub=(arr:string[])=>{for(const c of arr){const r=rankOfLocal(c);unseen.set(r,Math.max(0,(unseen.get(r)||0)-1));}}; sub(ctx.hands); sub(seenAll);

  const baseOvertakeRisk=(mv:string[])=>{const cls=classify(mv,four2)! as any;
    if(isType(cls.type,'rocket'))return 0;
    if(isType(cls.type,'bomb')){const rx=(unseen.get('x')||0)>0&&(unseen.get('X')||0)>0?1:0;return rx*3;}
    const keyR=keyRankOfMove(mv); const kp=POSALL[keyR]??-1;
    if(isType(cls.type,'single')){let h=0;for(const r of ORDER)if((POSALL[r]??-1)>kp)h+=(unseen.get(r)||0);return h*0.2+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'pair')){let hp=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=2)hp++;}return hp+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'triple','triple_one','triple_pair')){let ht=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=3)ht++;}return ht+0.5;}
    if(isType(cls.type,'four_two_singles','four_two_pairs')){let hb=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)===4)hb++;}return hb*1.5+(((unseen.get('x')||0)&&(unseen.get('X')||0))?2:0);}
    if(isType(cls.type,'straight','pair_seq','plane','plane_single','plane_pair')){let hm=0;for(const r of SEQ){const p=POSALL[r]??-1;if(p>kp)hm+=(unseen.get(r)||0);}return hm*0.1+0.6;}
    return 1;
  };

  // —— 座位权重：对手的反压计入，队友弱化为 0.25
  const afterSeats=[(ctx.seat+1)%3,(ctx.seat+2)%3];
  const isOpp=(s:number)=> (ctx.seat===ctx.landlord) ? true : (s===ctx.landlord);
  const numOppAfter=afterSeats.filter(isOpp).length;
  const numAllyAfter=afterSeats.length - numOppAfter;
  const seatRiskFactor=(numOppAfter + 0.25*numAllyAfter)/2;

  const shapeScore=(before:string[],picked:string[])=>{
    const after=removeCards(before,picked);
    const pre=countByRankLocal(before), post=countByRankLocal(after);
    let singles=0,lowSingles=0,pairs=0,triples=0,bombs=0,jokers=0;
    for(const [r,n] of post.entries()){ if(n===1){singles++; if(r!=='2'&&r!=='x'&&r!=='X')lowSingles++;} else if(n===2)pairs++; else if(n===3)triples++; else if(n===4)bombs++; if(r==='x'||r==='X')jokers+=n; }
    let breakPenalty=0; const used=countByRankLocal(picked);
    for(const [r,k] of used.entries()){ const preN=pre.get(r)||0; if(preN>=2&&k<preN) breakPenalty += (preN===2?1.0:preN===3?0.8:1.2); }
    const chain=longestSingleChain(after), pairSeq=longestPairChain(after);
    const t=classify(picked,four2)! as any; const bombPenalty=isType(t.type,'bomb','rocket')?1.2:0;
    const outReward=picked.length*0.4;
    return outReward - singles*1.0 - lowSingles*0.3 + pairs*0.4 + triples*0.5 + bombs*0.6 + jokers*0.2 + chain*0.25 + pairSeq*0.25 - breakPenalty - bombPenalty;
  };

  const scoreMove=(mv:string[])=>{
    const sShape=shapeScore(ctx.hands,mv);
    const sRisk = - baseOvertakeRisk(mv) * seatRiskFactor;
    return sShape + sRisk * 0.35;
  };

  // —— softmax 加权随机选择（保持“随机”风格，但受策略影响）
  function pickWeighted(pool:string[][]): string[] {
    const scores = pool.map(mv => scoreMove(mv));
    const T = 0.6; // 温度：越小越贪心，越大越随机
    const exps = scores.map(s => Math.exp(s / T));
    const sum = exps.reduce((a,b)=>a+b,0) || 1;
    let r = Math.random()*sum;
    for (let i=0;i<pool.length;i++){ r -= exps[i]; if (r<=0) return pool[i]; }
    return pool[pool.length-1];
  }

  // ====== 决策 ======
  if (ctx.require) {
    if (!legal.length) return ctx.canPass ? { move:'pass', reason:'RandomLegal: 需跟但无可接，选择过牌' } : { move:'play', cards:[ctx.hands[0] ?? '♠3'], reason:'RandomLegal: 需跟无可接且不许过，只能兜底' };
    const req = ctx.require as any;
    const same = legal.filter(mv => { const c = classify(mv, four2)! as any; return c.type===req.type && (c.len??0)===(req.len??0); });
    const pool = same.length ? same : legal;          // 优先同型同长度
    const choice = pickWeighted(pool);
    const t=(classify(choice,four2) as any)?.type; const key=keyRankOfMove(choice);
    const all:string[]=(globalThis as any).__DDZ_SEEN ?? []; const lens=((globalThis as any).__DDZ_SEEN_BY_SEAT || [[],[],[]]).map((a:any)=>Array.isArray(a)?a.length:0).join('/');
    const sc = scoreMove(choice);
    const reason = ['RandomLegal', `seat=${ctx.seat} landlord=${ctx.landlord}`, `seen=${all.length} seatSeen=${lens}`, `follow`, `type=${t} key=${key}`, `score=${sc.toFixed(2)}`].join(' | ');
    return { move:'play', cards: choice, reason };
  }

  if (legal.length) {
    // 首出时尽量不消耗炸弹
    const nonBombs = legal.filter(mv => { const t=(classify(mv, four2)! as any).type; return !isType(t,'bomb','rocket'); });
    const pool = nonBombs.length ? nonBombs : legal;
    const choice = pickWeighted(pool);
    const t=(classify(choice,four2) as any)?.type; const key=keyRankOfMove(choice);
    const all:string[]=(globalThis as any).__DDZ_SEEN ?? []; const lens=((globalThis as any).__DDZ_SEEN_BY_SEAT || [[],[],[]]).map((a:any)=>Array.isArray(a)?a.length:0).join('/');
    const sc = scoreMove(choice);
    const reason = ['RandomLegal', `seat=${ctx.seat} landlord=${ctx.landlord}`, `seen=${all.length} seatSeen=${lens}`, `lead`, `type=${t} key=${key}`, `score=${sc.toFixed(2)}`].join(' | ');
    return { move:'play', cards: choice, reason };
  }

  // 兜底
  const c = ctx.hands[0] ?? '♠3';
  return { move:'play', cards:[c], reason:'RandomLegal: 无可选，兜底打首张' };
};



export const GreedyMin: BotFunc = (ctx) => {
  const coopMove = maybeFollowCoop(ctx);
  if (coopMove) return coopMove;
  const four2 = ctx?.policy?.four2 || 'both';
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (ctx.require && ctx.canPass && !legal.length) return { move:'pass' };

  const isType = (t:any,...n:string[])=>n.includes(String(t));
  const rankOfLocal = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
  const removeCards=(h:string[],p:string[])=>{const a=h.slice();for(const c of p){const i=a.indexOf(c);if(i>=0)a.splice(i,1);}return a;};
  const countByRankLocal=(cs:string[])=>{const m=new Map<string,number>();for(const c of cs){const r=rankOfLocal(c);m.set(r,(m.get(r)||0)+1);}return m;};
  const SEQ=['3','4','5','6','7','8','9','T','J','Q','K','A'];
  const POS=Object.fromEntries(SEQ.map((r,i)=>[r,i])) as Record<string,number>;
  const ORDER=['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
  const POSALL=Object.fromEntries(ORDER.map((r,i)=>[r,i])) as Record<string,number>;

  const longestSingleChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.keys()).filter(r=>r!=='2'&&r!=='x'&&r!=='X').sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};
  const longestPairChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.entries()).filter(([r,n])=>n>=2&&r!=='2'&&r!=='x'&&r!=='X').map(([r])=>r).sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};
  const keyRankOfMove=(mv:string[])=>{const cls=classify(mv,four2)! as any;const cnt=countByRankLocal(mv);
    if(isType(cls.type,'rocket'))return'X';
    if(isType(cls.type,'bomb','four_two_singles','four_two_pairs')){for(const[r,n]of cnt.entries())if(n===4)return r;}
    if(isType(cls.type,'pair','pair_seq')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=2&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'triple','triple_one','triple_pair','plane','plane_single','plane_pair')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=3&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'straight')){let best='3',bp=-1;for(const r of Object.keys(cnt))if(r!=='2'&&r!=='x'&&r!=='X'&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    let best='3',bp=-1;for(const r of Object.keys(cnt)){const p=POSALL[r]??-1;if(p>bp){best=r;bp=p;}}return best;};

  const BASE:Record<string,number>=Object.fromEntries(ORDER.map(r=>[r,(r==='x'||r==='X')?1:4])) as Record<string,number>;
  const seenAll:string[]=(globalThis as any).__DDZ_SEEN ?? [];
  const unseen=new Map<string,number>(Object.entries(BASE));
  const sub=(arr:string[])=>{for(const c of arr){const r=rankOfLocal(c);unseen.set(r,Math.max(0,(unseen.get(r)||0)-1));}};
  sub(ctx.hands); sub(seenAll);

  const baseOvertakeRisk=(mv:string[])=>{const cls=classify(mv,four2)! as any;
    if(isType(cls.type,'rocket'))return 0;
    if(isType(cls.type,'bomb')){const rx=(unseen.get('x')||0)>0&&(unseen.get('X')||0)>0?1:0;return rx*3;}
    const keyR=keyRankOfMove(mv); const kp=POSALL[keyR]??-1;
    if(isType(cls.type,'single')){let h=0;for(const r of ORDER)if((POSALL[r]??-1)>kp)h+=(unseen.get(r)||0);return h*0.2+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'pair')){let hp=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=2)hp++;}return hp+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'triple','triple_one','triple_pair')){let ht=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=3)ht++;}return ht+0.5;}
    if(isType(cls.type,'four_two_singles','four_two_pairs')){let hb=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)===4)hb++;}return hb*1.5+(((unseen.get('x')||0)&&(unseen.get('X')||0))?2:0);}
    if(isType(cls.type,'straight','pair_seq','plane','plane_single','plane_pair')){let hm=0;for(const r of SEQ){const p=POSALL[r]??-1;if(p>kp)hm+=(unseen.get(r)||0);}return hm*0.1+0.6;}
    return 1;
  };

  const afterSeats=[(ctx.seat+1)%3,(ctx.seat+2)%3];
  const isOpp=(s:number)=> (ctx.seat===ctx.landlord) ? true : (s===ctx.landlord);
  const numOppAfter=afterSeats.filter(isOpp).length;
  const numAllyAfter=afterSeats.length - numOppAfter;
  const seatRiskFactor=(numOppAfter + 0.25*numAllyAfter)/2;

  const shapeScore=(before:string[],picked:string[])=>{
    const after=removeCards(before,picked);
    const pre=countByRankLocal(before), post=countByRankLocal(after);
    let singles=0,lowSingles=0,pairs=0,triples=0,bombs=0,jokers=0;
    for(const [r,n] of post.entries()){ if(n===1){singles++; if(r!=='2'&&r!=='x'&&r!=='X')lowSingles++;} else if(n===2)pairs++; else if(n===3)triples++; else if(n===4)bombs++; if(r==='x'||r==='X')jokers+=n; }
    let breakPenalty=0; const used=countByRankLocal(picked);
    for(const [r,k] of used.entries()){ const preN=pre.get(r)||0; if(preN>=2&&k<preN) breakPenalty += (preN===2?1.0:preN===3?0.8:1.2); }
    const chain=longestSingleChain(after), pairSeq=longestPairChain(after);
    const t=classify(picked,four2)! as any; const bombPenalty=isType(t.type,'bomb','rocket')?1.2:0;
    const outReward=picked.length*0.4;
    return outReward - singles*1.0 - lowSingles*0.3 + pairs*0.4 + triples*0.5 + bombs*0.6 + jokers*0.2 + chain*0.25 + pairSeq*0.25 - breakPenalty - bombPenalty;
  };
  const keyPosOfMove=(mv:string[])=> (POSALL[keyRankOfMove(mv)] ?? -1);

  const scoreMove=(mv:string[])=>{
    const sShape=shapeScore(ctx.hands,mv);
    const sRisk = - baseOvertakeRisk(mv) * seatRiskFactor;
    const bias  = keyPosOfMove(mv) * (-0.05);
    return sShape + sRisk * 0.35 + bias;
  };

  if (legal.length) {
    const pool = ctx.require
      ? (()=>{ const req=ctx.require as any; const same=legal.filter(mv=>{const c=classify(mv,four2)! as any; return c.type===req.type && (c.len??0)===(req.len??0);}); return same.length?same:legal; })()
      : (()=>{ const nonBombs=legal.filter(mv=>{const t=(classify(mv,four2)! as any).type; return !isType(t,'bomb','rocket');}); return nonBombs.length?nonBombs:legal; })();

    let best=pool[0], bestScore=-Infinity;
    for (const mv of pool){ const sc=scoreMove(mv); if (sc>bestScore){bestScore=sc; best=mv;} }

    // reason
    const all: string[] = Array.isArray((globalThis as any).__DDZ_SEEN) ? (globalThis as any).__DDZ_SEEN : [];
    const lens = ((globalThis as any).__DDZ_SEEN_BY_SEAT || [[],[],[]]).map((a:any)=>Array.isArray(a)?a.length:0).join('/');
    const t=(classify(best,four2) as any)?.type; const key=keyRankOfMove(best);
    const reason = ['GreedyMin', `seat=${ctx.seat} landlord=${ctx.landlord}`, `seen=${all.length} seatSeen=${lens}`, `type=${t} key=${key}`, `score=${bestScore.toFixed(2)}`].join(' | ');

    return { move:'play', cards: best, reason };
  }

  return ctx.canPass ? { move:'pass' } : { move:'play', cards:[ctx.hands[0] ?? '♠3'] };
};



// ===== 内置 Bot 的“抢地主内部打分” =====
export function GreedyMaxBidScore(hand: Label[]): number {
  // 贴合 GreedyMax 的进攻倾向：炸力、火箭、2、A、连对/顺子的可控性
  const map = countByRank(hand);
  const hasRocket = !!rocketFrom(map);
  const bombs = [...bombsFrom(map)].length;
  const twos = map.get(ORDER['2'])?.length ?? 0;
  const As   = map.get(ORDER['A'])?.length ?? 0;
  // 估算连对/顺子潜力（粗略）：统计 3..A 的覆盖与对子的数量
  const ranks = (RANKS.slice(0, 12) as unknown as string[]);
  let coverage = 0, pairs = 0, triples = 0, singles = 0;
  for (const r of ranks) {
    const idx = (ORDER as any)[r as string];
    const n = map.get(idx)?.length ?? 0;
    if (n>0) coverage++;
    if (n>=2) pairs++;
    if (n>=3) triples++;
    if (n===1) singles++;
  }
  let score = 0;
  if (hasRocket) score += 4.0;
  score += bombs * 2.0;
  if (twos>=2) score += 1.2 + (twos-2)*0.7;
  if (As>=3)   score += (As-2)*0.6;
  score += Math.min(4, coverage/3) * 0.2; // 覆盖增强出牌灵活性
  score += Math.min(3, pairs) * 0.25;
  score += Math.min(2, triples) * 0.35;
  score -= Math.min(4, singles) * 0.05;   // 孤张略减分
  return score;
}

export function GreedyMinBidScore(hand: Label[]): number {
  // 贴合 GreedyMin 的保守倾向：更强调安全牌（2/A/炸），弱化连牌收益
  const map = countByRank(hand);
  const hasRocket = !!rocketFrom(map);
  const bombs = [...bombsFrom(map)].length;
  const twos = map.get(ORDER['2'])?.length ?? 0;
  const As   = map.get(ORDER['A'])?.length ?? 0;
  let score = 0;
  if (hasRocket) score += 4.5;
  score += bombs * 2.2;
  score += twos * 0.9;
  score += Math.max(0, As-1) * 0.5;
  // 轻微考虑结构但不鼓励冒进
  const ranks = RANKS.slice(0, 12) as unknown as string[];
  let pairs = 0;
  for (const r of ranks) {
    const idx = (ORDER as any)[r as string];
    const n = map.get(idx)?.length ?? 0; if (n>=2) pairs++; }
  score += Math.min(2, pairs) * 0.15;
  return score;
}

export function RandomLegalBidScore(_hand: Label[]): number {
  // 随机策略不具“内部打分”，返回 NaN 代表无内部分
  return Number.NaN;
}
export const GreedyMax: BotFunc = (ctx) => {
  const coopMove = maybeFollowCoop(ctx);
  if (coopMove) return coopMove;
  const four2 = ctx?.policy?.four2 || 'both';
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (ctx.require && ctx.canPass && !legal.length) return { move:'pass' };

  const isType=(t:any,...n:string[])=>n.includes(String(t));
  const rankOfLocal=(c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
  const removeCards=(h:string[],p:string[])=>{const a=h.slice();for(const c of p){const i=a.indexOf(c);if(i>=0)a.splice(i,1);}return a;};
  const countByRankLocal=(cs:string[])=>{const m=new Map<string,number>();for(const c of cs){const r=rankOfLocal(c);m.set(r,(m.get(r)||0)+1);}return m;};
  const SEQ=['3','4','5','6','7','8','9','T','J','Q','K','A'];
  const POS=Object.fromEntries(SEQ.map((r,i)=>[r,i])) as Record<string,number>;
  const ORDER=['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
  const POSALL=Object.fromEntries(ORDER.map((r,i)=>[r,i])) as Record<string,number>;

  const longestSingleChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.keys()).filter(r=>r!=='2'&&r!=='x'&&r!=='X').sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};
  const longestPairChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.entries()).filter(([r,n])=>n>=2&&r!=='2'&&r!=='x'&&r!=='X').map(([r])=>r).sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};
  const keyRankOfMove=(mv:string[])=>{const cls=classify(mv,four2)! as any;const cnt=countByRankLocal(mv);
    if(isType(cls.type,'rocket'))return'X';
    if(isType(cls.type,'bomb','four_two_singles','four_two_pairs')){for(const[r,n]of cnt.entries())if(n===4)return r;}
    if(isType(cls.type,'pair','pair_seq')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=2&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'triple','triple_one','triple_pair','plane','plane_single','plane_pair')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=3&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'straight')){let best='3',bp=-1;for(const r of Object.keys(cnt))if(r!=='2'&&r!=='x'&&r!=='X'&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    let best='3',bp=-1;for(const r of Object.keys(cnt)){const p=POSALL[r]??-1;if(p>bp){best=r;bp=p;}}return best;};

  const BASE:Record<string,number>=Object.fromEntries(ORDER.map(r=>[r,(r==='x'||r==='X')?1:4])) as Record<string,number>;
  const seenAll:string[]=(globalThis as any).__DDZ_SEEN ?? [];
  const unseen=new Map<string,number>(Object.entries(BASE));
  const sub=(arr:string[])=>{for(const c of arr){const r=rankOfLocal(c);unseen.set(r,Math.max(0,(unseen.get(r)||0)-1));}};
  sub(ctx.hands); sub(seenAll);

  const baseOvertakeRisk=(mv:string[])=>{const cls=classify(mv,four2)! as any;
    if(isType(cls.type,'rocket'))return 0;
    if(isType(cls.type,'bomb')){const rx=(unseen.get('x')||0)>0&&(unseen.get('X')||0)>0?1:0;return rx*3;}
    const keyR=keyRankOfMove(mv); const kp=POSALL[keyR]??-1;
    if(isType(cls.type,'single')){let h=0;for(const r of ORDER)if((POSALL[r]??-1)>kp)h+=(unseen.get(r)||0);return h*0.2+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'pair')){let hp=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=2)hp++;}return hp+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'triple','triple_one','triple_pair')){let ht=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=3)ht++;}return ht+0.5;}
    if(isType(cls.type,'four_two_singles','four_two_pairs')){let hb=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)===4)hb++;}return hb*1.5+(((unseen.get('x')||0)&&(unseen.get('X')||0))?2:0);}
    if(isType(cls.type,'straight','pair_seq','plane','plane_single','plane_pair')){let hm=0;for(const r of SEQ){const p=POSALL[r]??-1;if(p>kp)hm+=(unseen.get(r)||0);}return hm*0.1+0.6;}
    return 1;
  };

  const afterSeats=[(ctx.seat+1)%3,(ctx.seat+2)%3];
  const isOpp=(s:number)=> (ctx.seat===ctx.landlord) ? true : (s===ctx.landlord);
  const numOppAfter=afterSeats.filter(isOpp).length;
  const numAllyAfter=afterSeats.length - numOppAfter;
  const seatRiskFactor=(numOppAfter + 0.25*numAllyAfter)/2;

  const shapeScore=(before:string[],picked:string[])=>{
    const after=removeCards(before,picked);
    const pre=countByRankLocal(before), post=countByRankLocal(after);
    let singles=0,lowSingles=0,pairs=0,triples=0,bombs=0,jokers=0;
    for(const [r,n] of post.entries()){ if(n===1){singles++; if(r!=='2'&&r!=='x'&&r!=='X')lowSingles++;} else if(n===2)pairs++; else if(n===3)triples++; else if(n===4)bombs++; if(r==='x'||r==='X')jokers+=n; }
    let breakPenalty=0; const used=countByRankLocal(picked);
    for(const [r,k] of used.entries()){ const preN=pre.get(r)||0; if(preN>=2&&k<preN) breakPenalty += (preN===2?1.0:preN===3?0.8:1.2); }
    const chain=longestSingleChain(after), pairSeq=longestPairChain(after);
    const t=classify(picked,four2)! as any; const bombPenalty=isType(t.type,'bomb','rocket')?1.2:0;
    const outReward=picked.length*0.4;
    return outReward - singles*1.0 - lowSingles*0.3 + pairs*0.4 + triples*0.5 + bombs*0.6 + jokers*0.2 + chain*0.25 + pairSeq*0.25 - breakPenalty - bombPenalty;
  };
  const keyPosOfMove=(mv:string[])=> (POSALL[keyRankOfMove(mv)] ?? -1);

  const scoreMove=(mv:string[])=>{
    const sShape=shapeScore(ctx.hands,mv);
    const sRisk = - baseOvertakeRisk(mv) * seatRiskFactor;
    const bias  = keyPosOfMove(mv) * (+0.05);
    return sShape + sRisk * 0.35 + bias;
  };

  if (legal.length) {
    const pool = ctx.require
      ? (()=>{ const req=ctx.require as any; const same=legal.filter(mv=>{const c=classify(mv,four2)! as any; return c.type===req.type && (c.len??0)===(req.len??0);}); return same.length?same:legal; })()
      : (()=>{ const nonBombs=legal.filter(mv=>{const t=(classify(mv,four2)! as any).type; return !isType(t,'bomb','rocket');}); return nonBombs.length?nonBombs:legal; })();

    let best=pool[0], bestScore=-Infinity;
    for (const mv of pool){ const sc=scoreMove(mv); if (sc>bestScore){bestScore=sc; best=mv;} }

    // reason
    const all: string[] = Array.isArray((globalThis as any).__DDZ_SEEN) ? (globalThis as any).__DDZ_SEEN : [];
    const lens = ((globalThis as any).__DDZ_SEEN_BY_SEAT || [[],[],[]]).map((a:any)=>Array.isArray(a)?a.length:0).join('/');
    const t=(classify(best,four2) as any)?.type; const key=keyRankOfMove(best);
    const reason = ['GreedyMax', `seat=${ctx.seat} landlord=${ctx.landlord}`, `seen=${all.length} seatSeen=${lens}`, `type=${t} key=${key}`, `score=${bestScore.toFixed(2)}`].join(' | ');

    return { move:'play', cards: best, reason };
  }

  return ctx.canPass ? { move:'pass' } : { move:'play', cards:[ctx.hands[0] ?? '♠3'] };
};


export const AllySupport: BotFunc = (ctx) => {
  const four2 = ctx?.policy?.four2 || 'both';
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (ctx.require && ctx.canPass && !legal.length) return { move:'pass', reason:'AllySupport: 需跟但无可接' };

  // ---- 本地小工具（零外部依赖）----
  const isType = (t:any,...n:string[])=>n.includes(String(t));
  const rankOfLocal = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
  const removeCards=(h:string[],p:string[])=>{const a=h.slice();for(const c of p){const i=a.indexOf(c);if(i>=0)a.splice(i,1);}return a;};
  const countByRankLocal=(cs:string[])=>{const m=new Map<string,number>();for(const c of cs){const r=rankOfLocal(c);m.set(r,(m.get(r)||0)+1);}return m;};
  const SEQ=['3','4','5','6','7','8','9','T','J','Q','K','A'];
  const POS=Object.fromEntries(SEQ.map((r,i)=>[r,i])) as Record<string,number>;
  const ORDER=['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
  const POSALL=Object.fromEntries(ORDER.map((r,i)=>[r,i])) as Record<string,number>;
  const longestSingleChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.keys()).filter(r=>r!=='2'&&r!=='x'&&r!=='X').sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};
  const longestPairChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.entries()).filter(([r,n])=>n>=2&&r!=='2'&&r!=='x'&&r!=='X').map(([r])=>r).sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};

  const keyRankOfMove=(mv:string[])=>{const cls=classify(mv,four2)! as any;const cnt=countByRankLocal(mv);
    if(isType(cls.type,'rocket'))return'X';
    if(isType(cls.type,'bomb','four_two_singles','four_two_pairs')){for(const[r,n]of cnt.entries())if(n===4)return r;}
    if(isType(cls.type,'pair','pair_seq')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=2&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'triple','triple_one','triple_pair','plane','plane_single','plane_pair')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=3&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'straight')){let best='3',bp=-1;for(const r of Object.keys(cnt))if(r!=='2'&&r!=='x'&&r!=='X'&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    let best='3',bp=-1;for(const r of Object.keys(cnt)){const p=POSALL[r]??-1;if(p>bp){best=r;bp=p;}}return best;};

  // —— 未现牌估计
  const BASE:Record<string,number>=Object.fromEntries(ORDER.map(r=>[r,(r==='x'||r==='X')?1:4])) as Record<string,number>;
  const seenAll:string[]=(globalThis as any).__DDZ_SEEN ?? [];
  const unseen=new Map<string,number>(Object.entries(BASE));
  const sub=(arr:string[])=>{for(const c of arr){const r=rankOfLocal(c);unseen.set(r,Math.max(0,(unseen.get(r)||0)-1));}}; sub(ctx.hands); sub(seenAll);

  const baseOvertakeRisk=(mv:string[])=>{const cls=classify(mv,four2)! as any;
    if(isType(cls.type,'rocket'))return 0;
    if(isType(cls.type,'bomb')){const rx=(unseen.get('x')||0)>0&&(unseen.get('X')||0)>0?1:0;return rx*3;}
    const keyR=keyRankOfMove(mv); const kp=POSALL[keyR]??-1;
    if(isType(cls.type,'single')){let h=0;for(const r of ORDER)if((POSALL[r]??-1)>kp)h+=(unseen.get(r)||0);return h*0.2+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'pair')){let hp=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=2)hp++;}return hp+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'triple','triple_one','triple_pair')){let ht=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=3)ht++;}return ht+0.5;}
    if(isType(cls.type,'four_two_singles','four_two_pairs')){let hb=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)===4)hb++;}return hb*1.5+(((unseen.get('x')||0)&&(unseen.get('X')||0))?2:0);}
    if(isType(cls.type,'straight','pair_seq','plane','plane_single','plane_pair')){let hm=0;for(const r of SEQ){const p=POSALL[r]??-1;if(p>kp)hm+=(unseen.get(r)||0);}return hm*0.1+0.6;}
    return 1;
  };

  // —— 座位/队友信息
  const teammate = [0,1,2].find(s => s!==ctx.seat && s!==ctx.landlord)!;
  const afterSeats=[(ctx.seat+1)%3,(ctx.seat+2)%3];
  const isOpp=(s:number)=> (ctx.seat===ctx.landlord) ? true : (s===ctx.landlord);
  const numOppAfter=afterSeats.filter(isOpp).length;
  const numAllyAfter=afterSeats.length - numOppAfter;
  const seatRiskFactor=(numOppAfter + 0.25*numAllyAfter)/2;

  const shapeScore=(before:string[],picked:string[])=>{
    const after=removeCards(before,picked);
    const pre=countByRankLocal(before), post=countByRankLocal(after);
    let singles=0,lowSingles=0,pairs=0,triples=0,bombs=0,jokers=0;
    for(const [r,n] of post.entries()){ if(n===1){singles++; if(r!=='2'&&r!=='x'&&r!=='X')lowSingles++;} else if(n===2)pairs++; else if(n===3)triples++; else if(n===4)bombs++; if(r==='x'||r==='X')jokers+=n; }
    let breakPenalty=0; const used=countByRankLocal(picked);
    for(const [r,k] of used.entries()){ const preN=pre.get(r)||0; if(preN>=2&&k<preN) breakPenalty += (preN===2?1.0:preN===3?0.8:1.2); }
    const chain=longestSingleChain(after), pairSeq=longestPairChain(after);
    const t=classify(picked,four2)! as any; const bombPenalty=isType(t.type,'bomb','rocket')?1.2:0;
    const outReward=picked.length*0.4;
    return outReward - singles*1.0 - lowSingles*0.3 + pairs*0.4 + triples*0.5 + bombs*0.6 + jokers*0.2 + chain*0.25 + pairSeq*0.25 - breakPenalty - bombPenalty;
  };

  const scoreMove=(mv:string[], riskWeight=0.35)=>{
    const sShape=shapeScore(ctx.hands,mv);
    const sRisk = - baseOvertakeRisk(mv) * seatRiskFactor;
    return sShape + sRisk * riskWeight;
  };

  // ========= 决策 =========
  const all:string[]=(globalThis as any).__DDZ_SEEN ?? [];
  const lens=((globalThis as any).__DDZ_SEEN_BY_SEAT || [[],[],[]]).map((a:any)=>Array.isArray(a)?a.length:0).join('/');

  if (ctx.require) {
    if (!legal.length) return ctx.canPass ? { move:'pass', reason:'AllySupport: 需跟无可接' } : { move:'play', cards:[ctx.hands[0] ?? '♠3'], reason:'AllySupport: 需跟无可接且不许过' };

    // 若当前领先者是队友且允许过牌：尽量让队友继续控场
    if (ctx.canPass && ctx.leader === teammate) {
      return { move: 'pass', reason: `AllySupport: 队友${teammate}领先，选择让牌` };
    }

    // 需跟：优先同型同长度后评分挑选
    const req = ctx.require as any;
    const same = legal.filter(mv => { const c = classify(mv, four2)! as any; return c.type===req.type && (c.len??0)===(req.len??0); });
    const pool = same.length ? same : legal;

    let best = pool[0], bestScore = -Infinity;
    for (const mv of pool) { const sc = scoreMove(mv, /*风险更看重*/0.45); if (sc>bestScore){bestScore=sc; best=mv;} }
    const t=(classify(best,four2) as any)?.type; const key=keyRankOfMove(best);
    const reason = ['AllySupport', `seat=${ctx.seat} landlord=${ctx.landlord}`, `leader=${ctx.leader} teammate=${teammate}`, `seen=${all.length} seatSeen=${lens}`, `follow`, `type=${t} key=${key}`, `score=${bestScore.toFixed(2)}`].join(' | ');
    return { move:'play', cards: best, reason };
  }

  if (legal.length) {
    const nonBombs = legal.filter(mv => { const t=(classify(mv, four2)! as any).type; return !isType(t,'bomb','rocket'); });
    const pool = nonBombs.length ? nonBombs : legal;
    let best = pool[0], bestScore = -Infinity;
    for (const mv of pool) { const sc = scoreMove(mv, 0.35); if (sc>bestScore){bestScore=sc; best=mv;} }
    const t=(classify(best,four2) as any)?.type; const key=keyRankOfMove(best);
    const reason = ['AllySupport', `seat=${ctx.seat} landlord=${ctx.landlord}`, `leader=${ctx.leader} teammate=${teammate}`, `seen=${all.length} seatSeen=${lens}`, `lead`, `type=${t} key=${key}`, `score=${bestScore.toFixed(2)}`].join(' | ');
    return { move:'play', cards: best, reason };
  }

  return ctx.canPass ? { move:'pass', reason:'AllySupport: 无合法可出' } : { move:'play', cards:[ctx.hands[0] ?? '♠3'], reason:'AllySupport: 兜底' };
};


function buildCoopInfo(
  ctx: BotCtx,
  history: PlayEvent[],
  landlord: number,
  coopEnabled: boolean
): BotCtx['coop'] | undefined {
  if (!coopEnabled) return undefined;
  const teammate = ctx.teammates.length ? ctx.teammates[0] : null;
  const teammateHistoryRaw = teammate != null ? history.filter(ev => ev.seat === teammate) : [];
  const landlordHistoryRaw = history.filter(ev => ev.seat === landlord);
  const teammateHistory = clone(teammateHistoryRaw);
  const landlordHistory = clone(landlordHistoryRaw);
  const teammateLastPlay = teammateHistory.length ? clone(teammateHistory[teammateHistory.length - 1]) : null;
  const landlordLastPlay = landlordHistory.length ? clone(landlordHistory[landlordHistory.length - 1]) : null;
  const teammateSeen = teammateHistoryRaw.flatMap(ev => Array.isArray(ev.cards) ? ev.cards.slice() : []);
  const landlordSeen = landlordHistoryRaw.flatMap(ev => Array.isArray(ev.cards) ? ev.cards.slice() : []);

  const info: BotCtx['coop'] = {
    enabled: true,
    teammate,
    landlord,
    teammateHistory,
    landlordHistory,
    teammateLastPlay,
    landlordLastPlay,
    teammateSeen,
    landlordSeen,
    teammateHandCount: teammate != null ? (ctx.handsCount[teammate] ?? 0) : 0,
    landlordHandCount: ctx.handsCount[landlord] ?? 0,
  };

  if (ctx.role === 'farmer') {
    try {
      const advCtx: BotCtx = clone(ctx);
      delete (advCtx as any).coop;
      const advise = normalizeMove(AllySupport(advCtx));
      if (advise) {
        info.recommended = { ...advise, via: 'AllySupport' };
      }
    } catch {}
  }

  return info;
}


export const EndgameRush: BotFunc = (ctx) => {
  const coopMove = maybeFollowCoop(ctx);
  if (coopMove) return coopMove;
  const four2 = ctx?.policy?.four2 || 'both';
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (ctx.require && ctx.canPass && !legal.length) return { move:'pass', reason:'EndgameRush: 需跟无可接' };

  const HAND_SMALL = 5; // 认为进入收官的阈值
  const inEndgame = (ctx.hands?.length || 0) <= HAND_SMALL;

  // ---- 小工具同上（为自包含，拷贝一份）----
  const isType = (t:any,...n:string[])=>n.includes(String(t));
  const rankOfLocal = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
  const removeCards=(h:string[],p:string[])=>{const a=h.slice();for(const c of p){const i=a.indexOf(c);if(i>=0)a.splice(i,1);}return a;};
  const countByRankLocal=(cs:string[])=>{const m=new Map<string,number>();for(const c of cs){const r=rankOfLocal(c);m.set(r,(m.get(r)||0)+1);}return m;};
  const SEQ=['3','4','5','6','7','8','9','T','J','Q','K','A'];
  const POS=Object.fromEntries(SEQ.map((r,i)=>[r,i])) as Record<string,number>;
  const ORDER=['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
  const POSALL=Object.fromEntries(ORDER.map((r,i)=>[r,i])) as Record<string,number>;
  const longestSingleChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.keys()).filter(r=>r!=='2'&&r!=='x'&&r!=='X').sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};
  const longestPairChain=(cs:string[])=>{const cnt=countByRankLocal(cs);const rs=Array.from(cnt.entries()).filter(([r,n])=>n>=2&&r!=='2'&&r!=='x'&&r!=='X').map(([r])=>r).sort((a,b)=>(POS[a]??-1)-(POS[b]??-1));let best=0,i=0;while(i<rs.length){let j=i;while(j+1<rs.length&&(POS[rs[j+1]]??-1)===(POS[rs[j]]??-2)+1)j++;best=Math.max(best,j-i+1);i=j+1;}return best;};

  const keyRankOfMove=(mv:string[])=>{const cls=classify(mv,four2)! as any;const cnt=countByRankLocal(mv);
    if(isType(cls.type,'rocket'))return'X';
    if(isType(cls.type,'bomb','four_two_singles','four_two_pairs')){for(const[r,n]of cnt.entries())if(n===4)return r;}
    if(isType(cls.type,'pair','pair_seq')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=2&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'triple','triple_one','triple_pair','plane','plane_single','plane_pair')){let best='3',bp=-1;for(const[r,n]of cnt.entries())if(n>=3&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    if(isType(cls.type,'straight')){let best='3',bp=-1;for(const r of Object.keys(cnt))if(r!=='2'&&r!=='x'&&r!=='X'&&POS[r]!=null&&POS[r]>bp){best=r;bp=POS[r];}return best;}
    let best='3',bp=-1;for(const r of Object.keys(cnt)){const p=POSALL[r]??-1;if(p>bp){best=r;bp=p;}}return best;};

  // —— 未现牌估计
  const BASE:Record<string,number>=Object.fromEntries(ORDER.map(r=>[r,(r==='x'||r==='X')?1:4])) as Record<string,number>;
  const seenAll:string[]=(globalThis as any).__DDZ_SEEN ?? [];
  const unseen=new Map<string,number>(Object.entries(BASE));
  const sub=(arr:string[])=>{for(const c of arr){const r=rankOfLocal(c);unseen.set(r,Math.max(0,(unseen.get(r)||0)-1));}}; sub(ctx.hands); sub(seenAll);

  const baseOvertakeRisk=(mv:string[])=>{const cls=classify(mv,four2)! as any;
    if(isType(cls.type,'rocket'))return 0;
    if(isType(cls.type,'bomb')){const rx=(unseen.get('x')||0)>0&&(unseen.get('X')||0)>0?1:0;return rx*3;}
    const keyR=keyRankOfMove(mv); const kp=POSALL[keyR]??-1;
    if(isType(cls.type,'single')){let h=0;for(const r of ORDER)if((POSALL[r]??-1)>kp)h+=(unseen.get(r)||0);return h*0.2+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'pair')){let hp=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=2)hp++;}return hp+(((unseen.get('x')||0)&&(unseen.get('X')||0))?0.5:0);}
    if(isType(cls.type,'triple','triple_one','triple_pair')){let ht=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)>=3)ht++;}return ht+0.5;}
    if(isType(cls.type,'four_two_singles','four_two_pairs')){let hb=0;for(const r of ORDER){const p=POSALL[r]??-1;if(p>kp&&(unseen.get(r)||0)===4)hb++;}return hb*1.5+(((unseen.get('x')||0)&&(unseen.get('X')||0))?2:0);}
    if(isType(cls.type,'straight','pair_seq','plane','plane_single','plane_pair')){let hm=0;for(const r of SEQ){const p=POSALL[r]??-1;if(p>kp)hm+=(unseen.get(r)||0);}return hm*0.1+0.6;}
    return 1;
  };

  // —— 座位加权
  const afterSeats=[(ctx.seat+1)%3,(ctx.seat+2)%3];
  const isOpp=(s:number)=> (ctx.seat===ctx.landlord) ? true : (s===ctx.landlord);
  const numOppAfter=afterSeats.filter(isOpp).length;
  const numAllyAfter=afterSeats.length - numOppAfter;
  const seatRiskFactor=(numOppAfter + 0.25*numAllyAfter)/2;

  // —— 形状评分（收官时加大“出完/大幅减少”的权重）
  const shapeScore=(before:string[],picked:string[])=>{
    const after=removeCards(before,picked);
    const pre=countByRankLocal(before), post=countByRankLocal(after);
    let singles=0,lowSingles=0,pairs=0,triples=0,bombs=0,jokers=0;
    for(const [r,n] of post.entries()){ if(n===1){singles++; if(r!=='2'&&r!=='x'&&r!=='X')lowSingles++;} else if(n===2)pairs++; else if(n===3)triples++; else if(n===4)bombs++; if(r==='x'||r==='X')jokers+=n; }
    let breakPenalty=0; const used=countByRankLocal(picked);
    for(const [r,k] of used.entries()){ const preN=pre.get(r)||0; if(preN>=2&&k<preN) breakPenalty += (preN===2?1.0:preN===3?0.8:1.2); }
    const chain=longestSingleChain(after), pairSeq=longestPairChain(after);
    const t=classify(picked,four2)! as any; const bombPenalty=isType(t.type,'bomb','rocket')?1.2:0;

    const outRewardBase = picked.length*0.4;
    const finishBonus = after.length===0 ? 6.0 : 0;            // 直接出完，强力奖励
    const rushBonus   = inEndgame ? (picked.length>=2 ? 1.2 : 0.6) : 0; // 收官时鼓励多张输出

    return outRewardBase + finishBonus + rushBonus
         - singles*1.0 - lowSingles*0.3 + pairs*0.4 + triples*0.5 + bombs*0.6 + jokers*0.2
         + chain*0.25 + pairSeq*0.25 - breakPenalty - (inEndgame ? bombPenalty*0.5 : bombPenalty);
  };

  const scoreMove=(mv:string[])=>{
    const sShape=shapeScore(ctx.hands,mv);
    const sRisk = - baseOvertakeRisk(mv) * seatRiskFactor;
    const riskW = inEndgame ? 0.20 : 0.35; // 收官时适当降低对被压的恐惧
    return sShape + sRisk * riskW;
  };

  // ========= 决策 =========
  const all:string[]=(globalThis as any).__DDZ_SEEN ?? [];
  const lens=((globalThis as any).__DDZ_SEEN_BY_SEAT || [[],[],[]]).map((a:any)=>Array.isArray(a)?a.length:0).join('/');

  if (ctx.require) {
    if (!legal.length) return ctx.canPass ? { move:'pass', reason:'EndgameRush: 需跟无可接' } : { move:'play', cards:[ctx.hands[0] ?? '♠3'], reason:'EndgameRush: 需跟无可接且不许过' };
    const req = ctx.require as any;
    const same = legal.filter(mv => { const c = classify(mv, four2)! as any; return c.type===req.type && (c.len??0)===(req.len??0); });
    const pool = same.length ? same : legal;
    let best = pool[0], bestScore = -Infinity;
    for (const mv of pool) { const sc = scoreMove(mv); if (sc>bestScore){bestScore=sc; best=mv;} }
    const t=(classify(best,four2) as any)?.type; const key=keyRankOfMove(best);
    const reason = ['EndgameRush', `seat=${ctx.seat} landlord=${ctx.landlord}`, `seen=${all.length} seatSeen=${lens}`, `follow`, `type=${t} key=${key}`, `score=${bestScore.toFixed(2)}`].join(' | ');
    return { move:'play', cards: best, reason };
  }

  if (legal.length) {
    const nonBombs = legal.filter(mv => { const t=(classify(mv, four2)! as any).type; return !isType(t,'bomb','rocket'); });
    const pool = inEndgame ? legal : (nonBombs.length ? nonBombs : legal);
    let best = pool[0], bestScore = -Infinity;
    for (const mv of pool) { const sc = scoreMove(mv); if (sc>bestScore){bestScore=sc; best=mv;} }
    const t=(classify(best,four2) as any)?.type; const key=keyRankOfMove(best);
    const reason = ['EndgameRush', `seat=${ctx.seat} landlord=${ctx.landlord}`, `seen=${all.length} seatSeen=${lens}`, `lead`, `type=${t} key=${key}`, `score=${bestScore.toFixed(2)}`].join(' | ');
    return { move:'play', cards: best, reason };
  }

  return ctx.canPass ? { move:'pass', reason:'EndgameRush: 无合法可出' } : { move:'play', cards:[ctx.hands[0] ?? '♠3'], reason:'EndgameRush: 兜底' };
};


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
  // 基于 wantRob 的同口径启发，返回一个连续评分（越高越倾向抢）
  // 设计：火箭=4；每个炸弹=1.8；第2张'2'=1.2，第3张及以上每张'2'=0.6；第3个A开始每张A=0.5；
  // 另外给顺子/连对/飞机形态一些微弱加分以偏好“可控”牌型。
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
  // 连牌结构微弱加分（避免全是孤张导致后续吃力）
    // (可选) 这里预留给连牌结构的进一步加分逻辑；当前版本不使用以保持简洁与稳定。
return score;
}

function wantRob(hand: Label[]): boolean {
  // 很简单的启发：有王炸/炸弹/≥2个2/≥3个A 就抢
  const map = countByRank(hand);
  const hasRocket = !!rocketFrom(map);
  const bombs = [...bombsFrom(map)].length;
  const twos = map.get(ORDER['2'])?.length ?? 0;
  const As = map.get(ORDER['A'])?.length ?? 0;
  return hasRocket || bombs >= 1 || twos >= 2 || As >= 3;
}

// ========== 对局主循环 ==========
export async function* runOneGame(opts: {
  seats: [BotFunc, BotFunc, BotFunc] | BotFunc[];
  delayMs?: number;
  bid?: boolean;                // true => 叫/抢
  four2?: Four2Policy;
  rule?: { farmerCoop?: boolean };
  ruleId?: string;
}): AsyncGenerator<any, void, unknown> {
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const bots: BotFunc[] = Array.from(opts.seats as BotFunc[]);
  const four2 = opts.four2 || 'both';
  const coopEnabled = !!(opts.rule?.farmerCoop);

  // 发牌
  let deck = shuffle(freshDeck());
  let hands: Label[][] = [[],[],[]];
  for (let i=0;i<17;i++) for (let s=0;s<3;s++) hands[s].push(deck[i*3+s]);
  let bottom = deck.slice(17*3); // 3 张
  for (let s=0;s<3;s++) hands[s] = sorted(hands[s]);

  // 抢地主流程（简单实现）
  let landlord = 0;
  let multiplier = 1;
  let bidMultiplier = 1;
  const seatMeta = bots.map((bot:any)=>({
    phaseAware: !!((bot as any)?.phaseAware),
    choice: String((bot as any)?.choice || '').toLowerCase(),
    name: String((bot as any)?.name || (bot as any)?.constructor?.name || '').toLowerCase(),
  }));

  const MAX_BID_ATTEMPTS = 5;
  if (opts.bid !== false) {
    let last = -1;

    for (let attempt = 0; attempt < MAX_BID_ATTEMPTS; attempt++) {
      const bidders: { seat:number; score:number; threshold:number; margin:number }[] = [];
      last = -1;
      bidMultiplier = 1;
      multiplier = 1;

      for (let s = 0; s < 3; s++) {
        const sc = evalRobScore(hands[s]);

        const __thMap: Record<string, number> = {
          greedymax: 1.6,
          allysupport: 1.8,
          randomlegal: 2.0,
          endgamerush: 2.1,
          mininet: 2.2,
          greedymin: 2.4,
        };
        const __thMapChoice: Record<string, number> = {
          'built-in:greedy-max':   1.6,
          'built-in:ally-support': 1.8,
          'built-in:random-legal': 2.0,
          'built-in:endgame-rush': 2.1,
          'built-in:mininet':      2.2,
          'built-in:greedy-min':   2.4,
          'external':              2.2,
          'external:ai':           2.2,
          'external:http':         2.2,
          'ai':                    2.2,
          'http':                  2.2,
          'openai':                2.2,
          'gpt':                   2.2,
          'claude':                2.2,
        };
        const meta = seatMeta[s];
        const threshold = (__thMapChoice[meta.choice] ?? __thMap[meta.name] ?? 1.8);
        const recommended = (sc >= threshold);

        const prevBidders = bidders.map(b => ({ seat:b.seat, score:b.score, threshold:b.threshold, margin:b.margin }));
        const bidCtx: any = {
          hands: clone(hands[s]),
          require: null,
          canPass: true,
          policy: { four2 },
          phase: 'bid',
          bid: {
            score: sc,
            threshold,
            multiplier,
            bidMultiplier,
            recommended,
            attempt,
            maxAttempts: MAX_BID_ATTEMPTS,
            bidders: prevBidders,
          },
          seat: s,
          landlord: -1,
          leader: -1,
          trick: -1,
          history: [],
          currentTrick: [],
          seen: [],
          bottom: [],
          seenBySeat: [[],[],[]],
          handsCount: [hands[0].length, hands[1].length, hands[2].length],
          role: 'farmer',
          teammates: [],
          opponents: [ (s+1)%3, (s+2)%3 ],
          counts: {
            handByRank: tallyByRank(hands[s]),
            seenByRank: tallyByRank([]),
            remainingByRank: remainingCountByRank([], hands[s]),
          },
        };

        let decision = recommended;
        if (meta.phaseAware) {
          const ctxForBot: any = clone(bidCtx);
          if (ctxForBot?.bid) {
            const def = !!ctxForBot.bid.recommended;
            ctxForBot.bid.default = def;
            delete ctxForBot.bid.recommended;
            delete ctxForBot.bid.threshold;
          }
          try {
            const result = await Promise.resolve(bots[s](ctxForBot));
            const parsed = (()=>{
              if (!result) return null;
              const r: any = result;
              if (r.phase === 'bid' && typeof r.bid === 'boolean') return !!r.bid;
              if (typeof r.bid === 'boolean') return !!r.bid;
              if (r.move === 'pass') return false;
              if (r.move === 'play') return true;
              return null;
            })();
            if (parsed !== null) decision = parsed;
          } catch {}
        }

        yield { type:'event', kind:'bid-eval', seat: s, score: sc, threshold, decision: (recommended ? 'bid' : 'pass'), bidMult: bidMultiplier, mult: multiplier };

        if (decision) {
          const margin = sc - threshold;
          bidders.push({ seat: s, score: sc, threshold, margin });
          multiplier = Math.min(64, Math.max(1, (multiplier || 1) * 2));
          last = s;
          yield { type:'event', kind:'bid', seat:s, bid:true, score: sc, bidMult: bidMultiplier, mult: multiplier };
        }

        if (opts.delayMs) await wait(opts.delayMs);
      }

      if (bidders.length > 0) {
        let bestSeat = -1;
        let bestMargin = -Infinity;
        for (let t = 0; t < 3; t++) {
          const hit = bidders.find(b => b.seat === t);
          if (!hit) continue;
          bidMultiplier = Math.min(64, Math.max(1, (bidMultiplier || 1) * 2));
          multiplier = bidMultiplier;
          yield { type:'event', kind:'rob2', seat: t, score: hit.score, threshold: hit.threshold, margin: Number((hit.margin).toFixed(4)), bidMult: bidMultiplier, mult: multiplier };
          if (hit.margin >= bestMargin) { bestMargin = hit.margin; bestSeat = t; }
        }
        landlord = bestSeat;
      } else {
        try { yield { type:'event', kind:'bid-skip', reason:'no-bidders' }; } catch {}
        deck = shuffle(freshDeck());
        hands = [[],[],[]] as any;
        for (let i=0;i<17;i++) for (let s=0;s<3;s++) hands[s].push(deck[i*3+s]);
        bottom = deck.slice(17*3);
        for (let s=0;s<3;s++) hands[s] = sorted(hands[s]);
        continue;
      }

      yield { type:'event', kind:'multiplier-sync', multiplier: multiplier, bidMult: bidMultiplier };
      multiplier = bidMultiplier;
      if (last !== -1) landlord = last;
      break;
    }
  }
  // 亮底 & 地主收底
  yield { type:'event', kind:'reveal', bottom: bottom.slice() };
  hands[landlord].push(...bottom);
  hands[landlord] = sorted(hands[landlord]);

// === 加倍阶段（地主→乙→丙） ===
// 配置参数（可抽到外部 config）
const __DOUBLE_CFG = {
  landlordThreshold: 1.0,
  counterLo: 2.5,
  counterHi: 4.0,
  mcSamples: 240,
  bayes: { landlordRaiseHi: 0.8, teammateRaiseHi: 0.4 },
  // 上限，最终对位最多到 8 倍（含叫抢与加倍）；炸弹/春天在结算时另外乘
  cap: 8
};

function __counterScore(hand: Label[], bottom: Label[]): number {
  const map = countByRank(hand);
  const hasR = !!rocketFrom(map);
  const bombs = [...bombsFrom(map)].length;
  const twos = map.get(ORDER['2'])?.length ?? 0;
  const As = map.get(ORDER['A'])?.length ?? 0;
  let sc = 0;
  if (hasR) sc += 3.0;
  sc += 2.0 * bombs;
  sc += 0.8 * Math.max(0, twos);
  sc += 0.6 * Math.max(0, As-1);
  return sc;
}

function __estimateDeltaByMC(mySeat:number, myHand:Label[], bottom:Label[], landlordSeat:number, samples:number): number {
  const deckAll: Label[] = freshDeck();
  const mySet = new Set(myHand.concat(bottom));
  const unknown: Label[] = deckAll.filter(c => !mySet.has(c));
  let acc = 0, n = 0;
  for (let t=0;t<samples;t++) {
    const pool = shuffle(unknown.slice());
    const sampleLord = pool.slice(0,17);
    const S_before = evalRobScore(sampleLord);
    const S_after  = evalRobScore(sorted(sampleLord.concat(bottom)));
    acc += (S_after - S_before);
    n++;
  }
  return n ? acc/n : 0;
}

function __structureBoosted(before: Label[], after: Label[]): boolean {
  const mb = countByRank(before), ma = countByRank(after);
  const rb = !!rocketFrom(mb), ra = !!rocketFrom(ma);
  if (!rb && ra) return true;
  const bb = [...bombsFrom(mb)].length, ba = [...bombsFrom(ma)].length;
  if (ba - bb >= 1) return true;
  const twb = mb.get(ORDER['2'])?.length ?? 0, twa = ma.get(ORDER['2'])?.length ?? 0;
  if (twa - twb >= 2) return true;
  const Ab = mb.get(ORDER['A'])?.length ?? 0, Aa = ma.get(ORDER['A'])?.length ?? 0;
  if (Aa - Ab >= 2) return true;
  return false;
}

function __decideLandlordDouble(handBefore:Label[], handAfter:Label[]): {L:number, delta:number, reason:'threshold'|'structure'|'none'} {
  const S_before = evalRobScore(handBefore);
  const S_after  = evalRobScore(handAfter);
  const delta = S_after - S_before;
  if (delta >= __DOUBLE_CFG.landlordThreshold) return { L:1, delta, reason:'threshold' };
  if (__structureBoosted(handBefore, handAfter)) return { L:1, delta, reason:'structure' };
  return { L:0, delta, reason:'none' };
}

function __decideFarmerDoubleBase(myHand:Label[], bottom:Label[], samples:number): {F:number, dLhat:number, counter:number} {
  const dLhat = __estimateDeltaByMC(-1, myHand, bottom, landlord, samples);
  const counter = __counterScore(myHand, bottom);
  let F = 0;
  if ((dLhat <= 0 && counter >= __DOUBLE_CFG.counterLo) ||
      (dLhat >  0 && counter >= __DOUBLE_CFG.counterHi) ||
      (bombsFrom(countByRank(myHand)).next().value) || (!!rocketFrom(countByRank(myHand)))) {
    F = 1;
  }
  return { F, dLhat, counter };
}

const Lseat = landlord;
const Yseat = (landlord + 1) % 3;
const Bseat = (landlord + 2) % 3;

const __lordBefore = hands[Lseat].filter(c => !bottom.includes(c));
const lordDecision = __decideLandlordDouble(__lordBefore, hands[Lseat]);
const yBase = __decideFarmerDoubleBase(hands[Yseat], bottom, __DOUBLE_CFG.mcSamples);
let bBase = __decideFarmerDoubleBase(hands[Bseat], bottom, __DOUBLE_CFG.mcSamples);
let F_b = bBase.F;
if (bBase.F === 1 && (bBase.dLhat > 0 && Math.abs(bBase.counter - __DOUBLE_CFG.counterHi) <= 0.6)) {
  let effectiveHi = __DOUBLE_CFG.counterHi;
  if (lordDecision.L === 1) effectiveHi += __DOUBLE_CFG.bayes.landlordRaiseHi;
  if (yBase.F === 1) effectiveHi += __DOUBLE_CFG.bayes.teammateRaiseHi;
  F_b = (bBase.counter >= effectiveHi) ? 1 : 0;
}

const doubleSeen = bottom.slice();
const baseCounts = () => [hands[0].length, hands[1].length, hands[2].length] as [number,number,number];

const buildDoubleCtx = (seat:number, role:'landlord'|'farmer', recommended:boolean, info:any) => {
  const teammates = role === 'landlord' ? [] : [ seat === Yseat ? Bseat : Yseat ];
  const opponents = role === 'landlord' ? [Yseat, Bseat] : [landlord];
  const seenBySeat: Label[][] = [[],[],[]];
  if (role === 'landlord') { seenBySeat[landlord] = bottom.slice(); }
  return {
    hands: clone(hands[seat]),
    require: null,
    canPass: true,
    policy: { four2 },
    phase: 'double' as const,
    double: {
      baseMultiplier: multiplier,
      landlordSeat: landlord,
      role,
      recommended,
      info,
    },
    seat,
    landlord,
    leader: landlord,
    trick: 0,
    history: [],
    currentTrick: [],
    seen: doubleSeen.slice(),
    bottom: bottom.slice(),
    seenBySeat,
    handsCount: baseCounts(),
    role,
    teammates,
    opponents,
    counts: {
      handByRank: tallyByRank(hands[seat]),
      seenByRank: tallyByRank(doubleSeen),
      remainingByRank: remainingCountByRank(doubleSeen, hands[seat]),
    },
  };
};

const parseDoubleResult = (res:any): boolean | null => {
  if (!res) return null;
  const r: any = res;
  if (r.phase === 'double' && typeof r.double === 'boolean') return !!r.double;
  if (typeof r.double === 'boolean') return !!r.double;
  if (typeof r.bid === 'boolean') return !!r.bid;
  if (r.move === 'pass') return false;
  if (r.move === 'play') return true;
  return null;
};

let Lflag = lordDecision.L ? 1 : 0;
let farmerYFlag = yBase.F ? 1 : 0;
let farmerBFlag = F_b ? 1 : 0;

if (seatMeta[Lseat]?.phaseAware) {
  try {
    const ctx = buildDoubleCtx(Lseat, 'landlord', !!lordDecision.L, { landlord: { delta: lordDecision.delta, reason: lordDecision.reason } });
    const ctxForBot: any = clone(ctx);
    if (ctxForBot?.double) {
      const def = !!ctxForBot.double.recommended;
      ctxForBot.double.default = def;
      delete ctxForBot.double.recommended;
    }
    const res = await Promise.resolve(bots[Lseat](ctxForBot));
    const parsed = parseDoubleResult(res);
    if (parsed !== null) Lflag = parsed ? 1 : 0;
  } catch {}
}

if (seatMeta[Yseat]?.phaseAware) {
  try {
    const ctx = buildDoubleCtx(Yseat, 'farmer', !!yBase.F, { farmer: { dLhat: yBase.dLhat, counter: yBase.counter } });
    const ctxForBot: any = clone(ctx);
    if (ctxForBot?.double) {
      const def = !!ctxForBot.double.recommended;
      ctxForBot.double.default = def;
      delete ctxForBot.double.recommended;
    }
    const res = await Promise.resolve(bots[Yseat](ctxForBot));
    const parsed = parseDoubleResult(res);
    if (parsed !== null) farmerYFlag = parsed ? 1 : 0;
  } catch {}
}

if (seatMeta[Bseat]?.phaseAware) {
  try {
    const ctx = buildDoubleCtx(Bseat, 'farmer', !!F_b, { farmer: { dLhat: bBase.dLhat, counter: bBase.counter }, bayes:{ landlord: lordDecision.L, farmerY: yBase.F } });
    const ctxForBot: any = clone(ctx);
    if (ctxForBot?.double) {
      const def = !!ctxForBot.double.recommended;
      ctxForBot.double.default = def;
      delete ctxForBot.double.recommended;
    }
    const res = await Promise.resolve(bots[Bseat](ctxForBot));
    const parsed = parseDoubleResult(res);
    if (parsed !== null) farmerBFlag = parsed ? 1 : 0;
  } catch {}
}

try { yield { type:'event', kind:'double-decision', role:'landlord', seat:Lseat, double:!!Lflag, delta: lordDecision.delta, reason: lordDecision.reason }; } catch{}
try { yield { type:'event', kind:'double-decision', role:'farmer', seat:Yseat, double:!!farmerYFlag, dLhat:yBase.dLhat, counter:yBase.counter }; } catch{}
try { yield { type:'event', kind:'double-decision', role:'farmer', seat:Bseat, double:!!farmerBFlag, dLhat:bBase.dLhat, counter:bBase.counter, bayes:{ landlord: Lflag, farmerY: farmerYFlag } }; } catch{}

let __doubleMulY = (1 << Lflag) * (1 << farmerYFlag);
let __doubleMulB = (1 << Lflag) * (1 << farmerBFlag);

__doubleMulY = Math.min(__DOUBLE_CFG.cap, __doubleMulY * multiplier) / Math.max(1, multiplier);
__doubleMulB = Math.min(__DOUBLE_CFG.cap, __doubleMulB * multiplier) / Math.max(1, multiplier);

try { yield { type:'event', kind:'double-summary', landlord:Lseat, yi:Yseat, bing:Bseat, mulY: __doubleMulY, mulB: __doubleMulB, base: multiplier }; } catch{}


  // 初始化（带上地主）
  yield { type:'state', kind:'init', landlord, hands: hands.map(h => [...h]) };
  // 历史与记牌数据
  let trick = 0;                          // 轮次（从 0 开始）
  const history: PlayEvent[] = [];        // 全部出牌/过牌历史
  const seen: Label[] = [];               // 已公开的牌（底牌 + 历史出牌）

  // 亮底即公开
  seen.push(...bottom);

  const handsCount = (): [number,number,number] => [hands[0].length, hands[1].length, hands[2].length];


  // 防春天统计
  const playedCount = [0,0,0];

  // 回合变量
  let leader = landlord;       // 本轮首家
  let turn   = leader;
  let require: Combo | null = null;
  let passes = 0;
  let lastPlayed = landlord;

  // 炸弹/王炸计数
  let bombTimes = 0;

  // 游戏循环
  while (true) {
    const isLeader = (require == null && turn === leader);
    
// --- derive per-seat seen cards (history + bottom to landlord) ---
function __computeSeenBySeat(history: PlayEvent[], bottom: Label[], landlord: number): Label[][] {
  const arr: Label[][] = [[],[],[]];
  for (const ev of history) {
    if (ev && ev.move === 'play' && Array.isArray(ev.cards)) {
      try { arr[ev.seat]?.push(...(ev.cards as Label[])); } catch {}
    }
  }
  if (typeof landlord === 'number' && landlord >= 0) {
    try { arr[landlord]?.push(...(bottom as Label[])); } catch {}
  }
  return arr;
}
    const requireForBot = require ? describeFollowRequirement(require) : null;

    const ctx: BotCtx = {
      hands: hands[turn],
      require: requireForBot,
      canPass: !isLeader,
      policy: { four2 },
      seat: turn,
      landlord,
      leader,
      trick,
      history: clone(history),
      currentTrick: clone(history.filter(h => h.trick === trick)),
      seen: clone(seen),
      bottom: clone(bottom),
      seenBySeat: __computeSeenBySeat(history, bottom, landlord),
      handsCount: handsCount(),
      role: (turn === landlord ? 'landlord' : 'farmer'),
      teammates: (turn === landlord ? [] : [ (turn=== (landlord+1)%3 ? (landlord+2)%3 : (landlord+1)%3 ) ]),
      opponents: (turn === landlord ? [ (landlord+1)%3, (landlord+2)%3 ] : [ landlord ]),
      counts: {
        handByRank: tallyByRank(hands[turn]),
        seenByRank: tallyByRank(seen),
        remainingByRank: (function () {
          // 54张全集（只看点数计数），减去 seen 与自己的手牌
          const total: Record<string, number> = {};
          for (const r of RANKS) {
            total[r] = (r === 'x' || r === 'X') ? 1 : 4;
          }

          const minus = (obj:Record<string,number>, sub:Record<string,number>) => {
            const out: Record<string, number> = { ...obj };
            for (const r of RANKS) out[r] = (out[r]||0) - (sub[r]||0);
            return out;
          };

          const seenCnt = tallyByRank(seen);
          const handCnt = tallyByRank(hands[turn]);
          return minus(minus(total, seenCnt), handCnt);
        })(),
      },
    };

    const coopInfo = buildCoopInfo(ctx, history, landlord, coopEnabled);
    if (coopInfo) ctx.coop = coopInfo;

    const meta = seatMeta[turn];
    const ctxForBot = clone(ctx);
    if (ctxForBot?.coop && meta?.phaseAware && !String(meta.choice || '').startsWith('built-in')) {
      try {
        ctxForBot.coop = { ...ctxForBot.coop };
        delete (ctxForBot.coop as any).recommended;
      } catch {}
    }

    let mv = await Promise.resolve(bots[turn](ctxForBot));

    // 兜底：首家不许过，且 move 非法时强制打一张
    const forcePlayOne = () => [hands[turn][0]] as Label[];

    // 清洗 + 校验
    const pickFromHand = (xs?: Label[]) => {
      const rs: Label[] = [];
      if (!Array.isArray(xs)) return rs;
      const pool = [...hands[turn]];
      for (const c of xs) {
        const i = pool.indexOf(c);
        if (i >= 0) { rs.push(c); pool.splice(i,1); }
      }
      return rs;
    };

    const decidePlay = (): { kind: 'pass' } | { kind: 'play', pick: Label[], cc: Combo } => {
      if (mv?.move === 'pass') {
        if (!ctx.canPass) {
          const pick = forcePlayOne();
          const cc = classify(pick, four2)!;
          return { kind:'play', pick, cc };
        }
        // 可以过
        return { kind:'pass' };
      }

      const cleaned = pickFromHand((mv as any)?.cards);
      const cc = classify(cleaned, four2);

      // require 为空 => 只要是合法牌型即可
      if (require == null) {
        if (cc) return { kind:'play', pick: cleaned, cc };
        // 非法则强制打一张
        const pick = forcePlayOne();
        return { kind:'play', pick, cc: classify(pick, four2)! };
      }

      // require 非空 => 必须可压（或打炸弹/王炸）
      if (cc && beats(require, cc)) return { kind:'play', pick: cleaned, cc };

      // 不合法：尝试找第一手能压住的
      const legal = generateMoves(hands[turn], require, four2);
      if (legal.length) {
        const p = legal[0];
        return { kind:'play', pick: p, cc: classify(p, four2)! };
      }

      // 实在压不了：若能过则过；否则强制打一张（理论上不会到这里）
      if (ctx.canPass) return { kind:'pass' };
      const pick = forcePlayOne();
      return { kind:'play', pick, cc: classify(pick, four2)! };
    };

    const act = decidePlay();

    if (act.kind === 'pass') {
      yield { type:'event', kind:'play', seat: turn, move:'pass' };
      history.push({ seat: turn, move: 'pass', trick });

      if (require != null) {
        passes += 1;
        if (passes >= 2) {
          // 两家过，重开一轮
          yield { type:'event', kind:'trick-reset' };
          trick += 1;

          require = null;
          passes = 0;
          leader = lastPlayed; // 最后出牌者继续做首家
          turn = leader;
          if (opts.delayMs) await wait(opts.delayMs);
          continue;
        }
      }
    } else {
      const { pick, cc } = act;
      removeLabels(hands[turn], pick);
      playedCount[turn]++;

      if (cc.type === 'bomb' || cc.type === 'rocket') bombTimes++;

      yield {
        type:'event', kind:'play', seat: turn, move:'play',
        cards: pick, comboType: cc.type
      };
      history.push({ seat: turn, move:'play', cards: clone(pick), comboType: cc.type, trick });
      seen.push(...pick);


      require = cc;
      passes = 0;
      lastPlayed = turn;
      leader = turn;
    }

    // 胜负
    if (hands[turn].length === 0) {
      const winner = turn;
      // 春天判定
      const farmerPlayed = playedCount[(landlord+1)%3] + playedCount[(landlord+2)%3];
      const landlordPlayed = playedCount[landlord];

      let springMul = 1;
      if (winner === landlord && farmerPlayed === 0) springMul *= 2;          // 春天
      if (winner !== landlord && landlordPlayed <= 1) springMul *= 2;         // 反春天（地主仅首手或一次也没成）

      
      const finalBaseY = multiplier * __doubleMulY;
      const finalBaseB = multiplier * __doubleMulB;
      const finalYi   = finalBaseY * (1 << bombTimes) * springMul;
      const finalBing = finalBaseB * (1 << bombTimes) * springMul;

      const delta: [number, number, number] =
        winner === landlord
          ? [+(finalYi + finalBing), -finalYi, -finalBing]
          : [-(finalYi + finalBing), +finalYi, +finalBing];
      yield { type:'event', kind:'win', winner, multiplier: multiplier, multiplierYi: finalYi, multiplierBing: finalBing, deltaScores: delta };
      return;
    }

    // 下一家
    if (opts.delayMs) await wait(opts.delayMs);
    turn = (turn + 1) % 3;
  }
}