// lib/bots/mininet_bot.ts
// 轻量内置AI：MiniNet（纯TS两层MLP对候选出牌打分）
// 依赖：无。可在 Node 与 Browser 跑。
// 说明：默认内置一套“启发式初始化权重”，开箱即用；以后可替换为你离线训练好的权重。

type Card = string; // '3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'
type Move = { kind: 'play'|'pass'; cards?: Card[] };
type BotMove = { move: 'play' | 'pass'; cards?: Card[]; reason?: string };

const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X']; // 15
const MOVE_TYPES = [
  'pass','single','pair','triple','straight','pair-straight','plane',
  'triple-with-single','triple-with-pair','four-with-two','bomb','rocket'
] as const;
type MoveType = typeof MOVE_TYPES[number];

function rankIndex(c: Card): number {
  const i = RANKS.indexOf(c);
  return i >= 0 ? i : 0;
}

function hist15(cards: Card[]|undefined): number[] {
  const h = new Array(15).fill(0);
  if (cards) for (const c of cards) h[rankIndex(c)]++;
  return h;
}

// —— 这里给一个非常粗略的牌型判断（只覆盖常见；模型训练后影响不大，主要用于特征）——
function classifyMove(cards?: Card[]): MoveType {
  if (!cards || cards.length === 0) return 'pass';
  const n = cards.length;
  const h = hist15(cards);
  const uniq = h.filter(x=>x>0).length;

  const isBomb = uniq === 1 && n === 4 && !cards.includes('x') && !cards.includes('X');
  const isRocket = cards.length === 2 && cards.includes('x') && cards.includes('X');
  if (isRocket) return 'rocket';
  if (isBomb) return 'bomb';

  if (n === 1) return 'single';
  if (n === 2 && uniq === 1) return 'pair';
  if (n === 3 && uniq === 1) return 'triple';

  // 粗糙 straight 判定（同点数=1，连续段>=5）
  const run = h.map(v=>v>0?1:0);
  let best=0, cur=0;
  for (let i=0;i<12;i++){ // 到 'A'，排除 '2','x','X'
    cur = run[i]?cur+1:0; best = Math.max(best, cur);
  }
  if (best>=5 && uniq===n) return 'straight';

  return 'single'; // 兜底
}

// —— 局面与候选的特征 ——
// 输入：state（尽量只用你现有 ctx 里稳妥字段），move（候选牌）
type MiniState = {
  role: 0|1|2;              // 0=甲,1=乙,2=丙（无需精确，只要一致）
  landlord: 0|1|2;
  lastMove?: Move;
  myHand?: Card[];
  counts?: [number,number,number]; // 余牌数
  bombsUsed?: number;              // 已经出现的炸弹数（没有就 0）
};

function stateFeat(s: MiniState): number[] {
  const roleOneHot = [0,0,0]; roleOneHot[s.role] = 1;
  const lordOneHot = [0,0,0]; lordOneHot[s.landlord] = 1;
  const counts = (s.counts ?? [17,17,17]).map(x => Math.min(20, x)/20);
  const bombs = [(s.bombsUsed ?? 0)/6];

  const lastType = classifyMove(s.lastMove?.cards);
  const lastOneHot = MOVE_TYPES.map(t => t===lastType ? 1 : 0);

  const handH = hist15(s.myHand ?? []).map(x=>Math.min(4,x)/4);

  // 拼出一个固定长度向量（尽量小，便于小网学习）
  return [
    ...roleOneHot, ...lordOneHot, ...counts, ...bombs,
    ...lastOneHot, ...handH
  ]; // 3+3+3+1 + 12 + 15 = 37 维
}

function moveFeat(cards?: Card[]): number[] {
  const t = classifyMove(cards);
  const onehot = MOVE_TYPES.map(x => x===t ? 1 : 0);    // 12
  const n = (cards?.length ?? 0)/20;                    // 1
  let hi = 0;
  if (cards && cards.length>0) {
    hi = cards.map(rankIndex).reduce((a,b)=>Math.max(a,b),0)/14; // 1
  }
  return [...onehot, n, hi]; // 14 维
}

// 把 stateFeat(37) + moveFeat(14) 组成 51 维，pad 到 64 维方便矩阵优化
function buildX(s: MiniState, m?: Card[]): number[] {
  const a = stateFeat(s);
  const b = moveFeat(m);
  const v = [...a, ...b];
  while (v.length < 64) v.push(0);
  return v;
}

// —— 一个极简两层 MLP（64 -> 48 -> 1），纯 JS 推理 ——
// 权重可换成你训练完导出的 JSON；这里给个“启发式初始化”可即用。
type Dense = { W: number[][]; b: number[] };
type MLP = { l1: Dense; l2: Dense };

function relu(x:number){ return x>0?x:0; }
function matVec(W:number[][], x:number[], b:number[]): number[] {
  const y = new Array(W.length).fill(0);
  for (let i=0;i<W.length;i++){
    let sum = b[i] || 0;
    const row = W[i];
    for (let j=0;j<row.length;j++) sum += row[j]*x[j];
    y[i] = sum;
  }
  return y;
}

// —— 简单启发式初始化（非随机，便于可重复）：保对连续、低点牌倾向出，保留炸弹与大小王 ——
// 真实使用建议离线训练后替换。
function initHeuristicMLP(): MLP {
  const inDim=64, h=48, out=1;
  const z1 = Array.from({length:h}, (_,i)=> Array.from({length:inDim}, (__,j)=> {
    // 给“手牌直方图低位段、顺子/长度特征”一点正权重，给“炸弹/火箭”一点负权重
    const isHandHist = (j>= (3+3+3+1+12)) && (j < (3+3+3+1+12+15));
    const handIdx = j - (3+3+3+1+12);
    const isMoveTypeStart = (j>= (3+3+3+1)) && (j < (3+3+3+1+12));
    const moveTypeIdx = j - (3+3+3+1);

    if (isHandHist) {
      // 低点数更正（鼓励出 3~7）
      if (handIdx <= 4) return 0.05;
      // 2/x/X 稍微负
      if (handIdx >= 12) return -0.03;
      return 0.01;
    }
    if (isMoveTypeStart) {
      // 炸弹/火箭适当负，顺子正
      if (MOVE_TYPES[moveTypeIdx]==='bomb') return -0.06;
      if (MOVE_TYPES[moveTypeIdx]==='rocket') return -0.08;
      if (MOVE_TYPES[moveTypeIdx]==='straight') return 0.06;
    }
    // 其他小权重
    return 0.0;
  }));
  const b1 = new Array(h).fill(0);
  const z2 = [ Array.from({length:h}, (_,j)=> (j<8?0.1:0.02)) ];
  const b2 = [0];
  return { l1:{W:z1,b:b1}, l2:{W:z2,b:b2} };
}

const M = initHeuristicMLP();

function mlpScore(x:number[]): number {
  const h1 = matVec(M.l1.W, x, M.l1.b).map(relu);
  const y  = matVec(M.l2.W, h1, M.l2.b)[0];
  return y;
}

// —— 主体：对候选出牌打分 ——
// ctx 需要提供：
//   ctx.legalMoves?: Card[][]      // 所有可出的牌（不含“过”）；没有就当作只有“过”
//   ctx.role, ctx.landlord, ctx.lastMove, ctx.myHand, ctx.counts, ctx.stats?.bombs
export async function MiniNetBot(ctx:any): Promise<BotMove> {
  const state: MiniState = {
    role: Number(ctx?.role ?? 0) as 0|1|2,
    landlord: Number(ctx?.landlord ?? 0) as 0|1|2,
    lastMove: ctx?.lastMove,
    myHand: ctx?.hand ?? ctx?.myHand,
    counts: ctx?.counts,
    bombsUsed: ctx?.stats?.bombs ?? ctx?.bombsUsed ?? 0,
  };

  const moves: Card[][] = Array.isArray(ctx?.legalMoves) ? ctx.legalMoves : [];
  if (!moves.length) {
    // 没候选可出，就只能过
    return { move: 'pass', reason: 'MiniNet: no legal move' };
  }

  let best = moves[0];
  let bestScore = -1e9;
  for (const m of moves) {
    const x = buildX(state, m);
    let score = mlpScore(x);
    // 少量 ε 随机以免死板
    score += (Math.random()-0.5)*0.01;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return { move:'play', cards: best, reason:`MiniNet (score=${bestScore.toFixed(3)})` };
}

// —— 提供一个载入你训练好权重的入口（可选） ——
// 形状要求：l1.W[h][64], l1.b[h], l2.W[1][h], l2.b[1]
export function loadMiniNetWeights(json: MLP) {
  M.l1.W = json.l1.W; M.l1.b = json.l1.b;
  M.l2.W = json.l2.W; M.l2.b = json.l2.b;
}
