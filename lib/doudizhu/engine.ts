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


export const EndgameRush: BotFunc = (ctx) => {
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
  // Internal phase guard to avoid premature PLAY before doubling finishes
  seats: [BotFunc, BotFunc, BotFunc] | BotFunc[];
  delayMs?: number;
  bid?: boolean;                // true => 叫/抢
  four2?: Four2Policy;
}): AsyncGenerator<any, void, unknown> {
  // Internal phase guard to avoid premature PLAY before doubling finishes
  let __PHASE: 'deal' | 'bid' | 'double' | 'play' = 'deal';

  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const bots: BotFunc[] = Array.from(opts.seats as BotFunc[]);
  const four2 = opts.four2 || 'both';

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
if (opts.bid !== false) {
    let last = -1;
    
      __PHASE = 'bid';
  for (let __attempt=0; __attempt<5; __attempt++) {
  const __bidders: { seat:number; score:number; threshold:number; margin:number }[] = [];
  // 每次重试重置叫抢状态
  last = -1;
  bidMultiplier = 1;
  multiplier = 1;
for (let s=0;s<3;s++) {
      // 外置AI识别 + 决策（优先，不评分）
const __bot = (bots as any)[s];
const __tag = String(__bot?.choice || __bot?.provider || __bot?.name || __bot?.label || '').toLowerCase();
const __external = !!(__bot?.external === true || __bot?.isExternal === true || (__bot?.meta && (__bot.meta.source === 'external-ai' || __bot.meta.kind === 'external')) || /^(ai:|ai$|http)/.test(__tag) || /(openai|gpt|qwen|glm|deepseek|claude|anthropic|cohere|mistral|vertex|dashscope|external)/.test(__tag));
let __aiBid: null | boolean = null;
let __aiBidReason: string | null = null;
if (__external) {
  try {
    const ctxForBid:any = {
      phase:'bid', seat:s, role:'farmer',
      hands: hands[s], require: null, canPass: true,
      policy: { four2 },
      history: [], currentTrick: [], seen: [], bottom: [],
      handsCount: [hands[0].length, hands[1].length, hands[2].length],
      counts: {}, landlord: -1, leader: s, trick: 0,
      teammates: [], opponents: [],
      ruleId: (opts as any).ruleId, rule: (opts as any).rule,
      bidding: { round: 1 }
    };const mv = await Promise.resolve((bots as any)[s](ctxForBid));
const r:any = (mv||{});
const rraw = r.reason ?? r.explanation ?? r.rationale ?? r.why ?? r.comment ?? r.msg;
if (typeof rraw === 'string' && rraw.trim()) {
  // Heuristic filter: in bidding phase, ignore reasons that look like PLAY instructions
  const _rr = rraw.trim();
  const looksLikePlay = /(出牌|顺子|对子|炸弹|跟牌|压住|首家出牌|lead|follow|type=|打出)/.test(_rr);
  if (!looksLikePlay) __aiBidReason = _rr.slice(0, 800);
  else __aiBidReason = ''; // drop misleading play-style reason during bid
}if (typeof r.bid === 'boolean') __aiBid = r.bid; else
    if (typeof r.rob === 'boolean') __aiBid = r.rob; else
    if (typeof r.yes === 'boolean') __aiBid = r.yes; else
    if (typeof r.double === 'boolean') __aiBid = r.double; else
    if (typeof r.bid === 'number') __aiBid = r.bid !== 0; else
    if (typeof r.rob === 'number') __aiBid = r.rob !== 0; else
    if (typeof r.yes === 'number') __aiBid = r.yes !== 0; else
    if (typeof r.double === 'number') __aiBid = r.double !== 0; else {
      const act = String(r.action ?? r.move ?? r.decision ?? '').toLowerCase();
      if (['bid','rob','call','qiang','play','yes','y','true','1','叫','抢'].includes(act)) __aiBid = true;
      else if (['pass','skip','nobid','no','n','false','0','不叫','不抢'].includes(act)) __aiBid = false;
    }
  } catch {}
}
const sc = __external ? 0 : evalRobScore(hands[s]);
// thresholds for both built-ins && external choices (inline for scope)
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
      const __choice = String((bots as any)[s]?.choice || '').toLowerCase();
const __name   = String((bots as any)[s]?.name || (bots as any)[s]?.constructor?.name || '').toLowerCase();
const __th = (__thMapChoice[__choice] ?? __thMap[__name] ?? 1.8);
let bid: boolean = __external ? !!__aiBid : (sc >= __th);
// 记录本轮评估（即使未达到阈值也写日志/存档）
if (__external) { try { yield { type:'event', kind:'bid-eval', seat: s, source:'external-ai', decision: (bid ? 'bid' : 'pass'), reason: __aiBidReason, bidMult: bidMultiplier, mult: multiplier }; } catch{} } else { yield { type:'event', kind:'bid-eval', seat: s, score: sc, threshold: __th, decision: (bid ? 'bid' : 'pass'), bidMult: bidMultiplier, mult: multiplier }; }
if (bid) {
        __bidders.push({ seat: s, score: (__external? Number.NaN : sc), threshold: (__external? Number.NaN : __th), margin: (__external? 0 : (sc - __th)) });
        multiplier = Math.min(64, Math.max(1, (multiplier || 1) * 2));

        last = s;
yield { type:'event', kind:'bid', seat:s, bid, ...( __external ? { source:'external-ai', reason: __aiBidReason } : { score: sc } ), bidMult: bidMultiplier, mult: multiplier };
      }
      if (opts.delayMs) await wait(opts.delayMs);
    }
      // 第二轮：仅对第一轮“抢”的人（__bidders）按同样座次再过一遍，比较 margin；同分后手优先（>=）；每次再 ×2，封顶 64。
      if (__bidders.length > 0) {
        let bestSeat = -1;
        let bestMargin = -Infinity;
        for (let t = 0; t < 3; t++) {
          const hit = __bidders.find(b => b.seat === t);
          if (!hit) continue;
          bidMultiplier = Math.min(64, Math.max(1, (bidMultiplier || 1) * 2));
          multiplier = bidMultiplier;
          yield { type:'event', kind:'rob2', seat: t, score: hit.score, threshold: hit.threshold, margin: Number((hit.margin).toFixed(4)), bidMult: bidMultiplier, mult: multiplier };
          if (hit.margin >= bestMargin) { bestMargin = hit.margin; bestSeat = t; } // 同分后手优先
        }
        landlord = bestSeat;
      }
      
      
// 若无人抢，则记录并重发，随后重新叫牌
if (__bidders.length === 0) {
  try { yield { type:'event', kind:'bid-skip', reason:'no-bidders' }; } catch {}
  // 重新发牌
  deck = shuffle(freshDeck());
  hands = [[],[],[]] as any;
  for (let i=0;i<17;i++) for (let s=0;s<3;s++) hands[s].push(deck[i*3+s]);
  bottom = deck.slice(17*3);
  for (let s=0;s<3;s++) hands[s] = sorted(hands[s]);
  continue; // 回到下一轮尝试，重新进行叫抢（会继续产出 bid-eval）
}
yield { type:'event', kind:'multiplier-sync', multiplier: multiplier, bidMult: bidMultiplier };multiplier = bidMultiplier;
    if (last !== -1) landlord = last;
      break;
    }

  }
  // 亮底 & 地主收底
  __PHASE = 'double';
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

// 计算反制能力分（简版，可再调权重）
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

// 基于公开信息的蒙特卡洛：估计底牌带来的期望增益 Δ̂
function __estimateDeltaByMC(mySeat:number, myHand:Label[], bottom:Label[], landlordSeat:number, samples:number): number {
  // 未知牌：整副 54 去掉我的 17 与底牌 3
  const deckAll: Label[] = freshDeck();
  const mySet = new Set(myHand.concat(bottom));
  const unknown: Label[] = deckAll.filter(c => !mySet.has(c));
  let acc = 0, n = 0;
  for (let t=0;t<samples;t++) {
    // 随机洗牌后，取前34张：分配给（地主17，另一农民17）
    const pool = shuffle(unknown.slice());
    const sampleLord = pool.slice(0,17);
    // before
    const S_before = evalRobScore(sampleLord);
    // after: 并入底牌
    const S_after  = evalRobScore(sorted(sampleLord.concat(bottom)));
    acc += (S_after - S_before);
    n++;
  }
  return n ? acc/n : 0;
}

// 结构兜底：底牌是否带来明显强结构（王炸/炸弹/连对显著延长等）
function __structureBoosted(before: Label[], after: Label[]): boolean {
  const mb = countByRank(before), ma = countByRank(after);
  const rb = !!rocketFrom(mb), ra = !!rocketFrom(ma);
  if (!rb && ra) return true;
  const bb = [...bombsFrom(mb)].length, ba = [...bombsFrom(ma)].length;
  if (ba > bb) return true;
  // 高张数量显著提升（粗略兜底）
  const twb = mb.get(ORDER['2'])?.length ?? 0, twa = ma.get(ORDER['2'])?.length ?? 0;
  if (twa - twb >= 2) return true;
  const Ab = mb.get(ORDER['A'])?.length ?? 0, Aa = ma.get(ORDER['A'])?.length ?? 0;
  if (Aa - Ab >= 2) return true;
  return false;
}

// 地主加倍判定（阈值优先，未达阈值时结构兜底；仅一次）
function __decideLandlordDouble(handBefore:Label[], handAfter:Label[]): {L:number, delta:number, reason:'threshold'|'structure'|'none'} {
  const S_before = evalRobScore(handBefore);
  const S_after  = evalRobScore(handAfter);
  const delta = S_after - S_before;
  if (delta >= __DOUBLE_CFG.landlordThreshold) return { L:1, delta, reason:'threshold' };
  if (__structureBoosted(handBefore, handAfter)) return { L:1, delta, reason:'structure' };
  return { L:0, delta, reason:'none' };
}

// 农民加倍基础规则（不含贝叶斯微调）
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

// —— 执行顺序：地主 → 乙(下家) → 丙(上家) ——
const Lseat = landlord;
const Yseat = (landlord + 1) % 3;
const Bseat = (landlord + 2) % 3;

// 地主：基于 before/after 的 Δ 与结构兜底
const __lordBefore = hands[Lseat].filter(c => !bottom.includes(c)); // 理论上就是并入前
const lordDecision = __decideLandlordDouble(__lordBefore, hands[Lseat]);
const Lflag = lordDecision.L;
try { yield { type:'event', kind:'double-decision', role:'landlord', seat:Lseat, double:!!Lflag, delta: lordDecision.delta, reason: lordDecision.reason }; } catch{}

// 乙（下家）：蒙特卡洛 + 反制能力
const yBase = __decideFarmerDoubleBase(hands[Yseat], bottom, __DOUBLE_CFG.mcSamples);
try { yield { type:'event', kind:'double-decision', role:'farmer', seat:Yseat, double:!!yBase.F, dLhat:yBase.dLhat, counter:yBase.counter }; } catch{}

// 丙（上家）：在边缘情况下做贝叶斯式调节
let bBase = __decideFarmerDoubleBase(hands[Bseat], bottom, __DOUBLE_CFG.mcSamples);
let F_b = bBase.F;
if (bBase.F === 1 && (bBase.dLhat > 0 && Math.abs(bBase.counter - __DOUBLE_CFG.counterHi) <= 0.6)) {
  // 若地主或乙已加倍，提高门槛（更保守）
  let effectiveHi = __DOUBLE_CFG.counterHi;
  if (Lflag === 1) effectiveHi += __DOUBLE_CFG.bayes.landlordRaiseHi;
  if (yBase.F === 1) effectiveHi += __DOUBLE_CFG.bayes.teammateRaiseHi;
  F_b = (bBase.counter >= effectiveHi) ? 1 : 0;
}
try { yield { type:'event', kind:'double-decision', role:'farmer', seat:Bseat, double:!!F_b, dLhat:bBase.dLhat, counter:bBase.counter, bayes:{ landlord:Lflag, farmerY:yBase.F } }; } catch{}

// 记录对位加倍倍数（不含炸弹/春天）
let __doubleMulY = (1 << Lflag) * (1 << yBase.F);
let __doubleMulB = (1 << Lflag) * (1 << F_b);

// 上限裁剪到 8（含叫抢）
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
    const ctx: BotCtx = {
      hands: hands[turn],
      require,
      canPass: !isLeader,
      policy: { four2 },
      seat: turn,
      landlord,
      leader,
      trick,
      
  __PHASE = 'play';
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