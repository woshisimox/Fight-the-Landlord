// lib/doudizhu/engine.ts
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


export type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

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
  if (ctx.canPass && ctx.require) return { move: 'pass' };
  const four2 = ctx?.policy?.four2 || 'both';
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (legal.length) return { move: 'play', cards: legal[0] };
  // 兜底：首家且无 require 或 bot 乱回
  const c = ctx.hands[0] ?? '♠3';
  return { move: 'play', cards: [c] };
};

export const GreedyMin: BotFunc = (ctx) => {
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


export const GreedyMax: BotFunc = (ctx) => {
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
  rob?: boolean;                // true => 叫/抢
  four2?: Four2Policy;
}): AsyncGenerator<any, void, unknown> {
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const bots: BotFunc[] = Array.from(opts.seats as BotFunc[]);
  const four2 = opts.four2 || 'both';

  // 发牌
  const deck = shuffle(freshDeck());
  const hands: Label[][] = [[],[],[]];
  for (let i=0;i<17;i++) for (let s=0;s<3;s++) hands[s].push(deck[i*3+s]);
  const bottom = deck.slice(17*3); // 3 张
  for (let s=0;s<3;s++) hands[s] = sorted(hands[s]);

  // 抢地主流程（简单实现）
  let landlord = 0;
  let multiplier = 1;
  if (opts.rob !== false) {
    let last = -1;
    for (let s=0;s<3;s++) {
      const rob = wantRob(hands[s]);
      yield { type:'event', kind:'rob', seat:s, rob };
      if (rob) {
        if (last === -1) {
          last = s; // 叫
        } else {
          last = s; multiplier *= 2; // 抢 ×2
        }
      }
      if (opts.delayMs) await wait(opts.delayMs);
    }
    if (last !== -1) landlord = last;
  }
  // 亮底 & 地主收底
  yield { type:'event', kind:'reveal', bottom: bottom.slice() };
  hands[landlord].push(...bottom);
  hands[landlord] = sorted(hands[landlord]);

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
    const ctx: BotCtx = {
      hands: hands[turn],
      require,
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

    let mv = await Promise.resolve(bots[turn](clone(ctx)));

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

      const finalMultiplier = multiplier * (1 << bombTimes) * springMul;      // 炸弹/王炸：每次×2

      const delta: [number, number, number] =
        winner === landlord
          ? [+2*finalMultiplier, -finalMultiplier, -finalMultiplier]
          : [-2*finalMultiplier, +finalMultiplier, +finalMultiplier];

      yield { type:'event', kind:'win', winner, multiplier: finalMultiplier, deltaScores: delta };
      return;
    }

    // 下一家
    if (opts.delayMs) await wait(opts.delayMs);
    turn = (turn + 1) % 3;
  }
}