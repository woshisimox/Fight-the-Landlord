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

type ComboRuleDoc = {
  label: string;
  summary: string;
  minCards: number;
  maxCards?: number;
  chain?: {
    minGroups: number;
    groupSize: number;
    maxRankSymbol: string;
    maxRankLabel?: string;
    example?: string;
  };
  notes?: string;
  examples?: string[];
};

export type RulesReference = {
  rankOrder: string[];
  rankOrderLabel: string[];
  orderHint: string;
  orderHintLabel: string;
  chainMin: { straight: number; pair_seq: number; plane: number };
  combos: Record<string, ComboRuleDoc>;
};

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

  rules?: RulesReference;

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

// ========== 机器学习辅助（逻辑回归 / GBDT） ==========
type FeatureSnapshot = Record<string, number>;

type LogisticModel = {
  intercept: number;
  weights: Record<string, number>;
};

type GBDTNode =
  | { value: number }
  | { feature: string; threshold: number; left: GBDTNode; right: GBDTNode };

type GBDTModel = {
  baseScore: number;
  trees: Array<{ weight: number; root: GBDTNode }>;
};

type RandomForestNode =
  | { value: number }
  | { feature: string; threshold: number; left: RandomForestNode; right: RandomForestNode };

type RandomForestModel = {
  trees: Array<{ weight?: number; root: RandomForestNode }>;
};

const BID_LOGISTIC_MODEL: LogisticModel = {
  intercept: -2.35,
  weights: {
    robScore: 1.25,
    bombCount: 0.55,
    rocket: 1.1,
    twos: 0.38,
    aces: 0.22,
    handCount: -0.04,
  },
};

const DOUBLE_LANDLORD_MODEL: LogisticModel = {
  intercept: -1.4,
  weights: {
    robScore: 0.95,
    bombCount: 0.45,
    rocket: 0.75,
    twos: 0.32,
    aces: 0.25,
  },
};

const DOUBLE_FARMER_MODEL: LogisticModel = {
  intercept: -0.9,
  weights: {
    robScore: 0.6,
    counterScore: 0.35,
    bombCount: 0.35,
    rocket: 0.6,
    twos: 0.25,
    aces: 0.12,
  },
};

const FOLLOW_LOGISTIC_MODEL: LogisticModel = {
  intercept: -0.35,
  weights: {
    robScore: 0.32,
    bombCount: 0.2,
    rocket: 0.4,
    twos: 0.18,
    aces: 0.08,
    handCount: -0.05,
    requireGap: 0.3,
    teammateRelay: 0.4,
    oppBeat: -0.45,
  },
};

const PLAY_GBDT_MODEL: GBDTModel = {
  baseScore: 0.1,
  trees: [
    {
      weight: 0.7,
      root: {
        feature: 'shapeScore',
        threshold: 1.2,
        left: { value: -0.25 },
        right: {
          feature: 'bombRetention',
          threshold: 0.6,
          left: { value: 0.1 },
          right: { value: 0.45 },
        },
      },
    },
    {
      weight: 0.45,
      root: {
        feature: 'teammateRelay',
        threshold: 0.35,
        left: { value: -0.1 },
        right: { value: 0.3 },
      },
    },
    {
      weight: 0.35,
      root: {
        feature: 'oppBeat',
        threshold: 0.4,
        left: { value: 0.15 },
        right: { value: -0.3 },
      },
    },
  ],
};

const FOLLOW_FOREST_MODEL: RandomForestModel = {
  trees: [
    {
      root: {
        feature: 'oppBeat',
        threshold: 0.35,
        left: { value: 0.68 },
        right: { value: 0.18 },
      },
    },
    {
      root: {
        feature: 'teammateRelay',
        threshold: 0.45,
        left: {
          feature: 'shapeScore',
          threshold: 0.45,
          left: { value: 0.22 },
          right: {
            feature: 'bombRetention',
            threshold: 0.25,
            left: { value: 0.48 },
            right: { value: 0.62 },
          },
        },
        right: {
          feature: 'bombRetention',
          threshold: 0.3,
          left: { value: 0.66 },
          right: { value: 0.78 },
        },
      },
    },
    {
      root: {
        feature: 'requireGap',
        threshold: 0.5,
        left: {
          feature: 'handCount',
          threshold: 8,
          left: { value: 0.41 },
          right: { value: 0.32 },
        },
        right: { value: 0.19 },
      },
    },
  ],
};

function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function logisticPredict(model: LogisticModel, features: FeatureSnapshot): number {
  let z = model.intercept;
  for (const [name, weight] of Object.entries(model.weights)) {
    z += weight * (features[name] ?? 0);
  }
  return sigmoid(z);
}

function evalGBDTNode(node: GBDTNode, features: FeatureSnapshot): number {
  if ('value' in node) return node.value;
  const value = features[node.feature] ?? 0;
  return value <= node.threshold
    ? evalGBDTNode(node.left, features)
    : evalGBDTNode(node.right, features);
}

function evalGBDT(model: GBDTModel, features: FeatureSnapshot): number {
  let acc = model.baseScore;
  for (const tree of model.trees) {
    acc += tree.weight * evalGBDTNode(tree.root, features);
  }
  return acc;
}

function evalForestNode(node: RandomForestNode, features: FeatureSnapshot): number {
  if ('value' in node) return node.value;
  const value = features[node.feature] ?? 0;
  return value <= node.threshold
    ? evalForestNode(node.left, features)
    : evalForestNode(node.right, features);
}

function evalRandomForest(model: RandomForestModel, features: FeatureSnapshot): number {
  if (!model.trees.length) return 0;
  let acc = 0;
  let weightSum = 0;
  for (const tree of model.trees) {
    const weight = tree.weight ?? 1;
    acc += weight * evalForestNode(tree.root, features);
    weightSum += weight;
  }
  return weightSum === 0 ? 0 : acc / weightSum;
}

function handStatsFromCounts(hand: Label[]): FeatureSnapshot {
  const stats: FeatureSnapshot = {
    handCount: hand.length,
    robScore: evalRobScore(hand),
    bombCount: 0,
    rocket: 0,
    twos: 0,
    aces: 0,
  };
  const map = countByRank(hand);
  for (const [rv, arr] of map.entries()) {
    if (arr.length === 4) stats.bombCount += 1;
  }
  if (map.get(ORDER['x'])?.length && map.get(ORDER['X'])?.length) stats.rocket = 1;
  stats.twos = map.get(ORDER['2'])?.length ?? 0;
  stats.aces = map.get(ORDER['A'])?.length ?? 0;
  return stats;
}

function mixFeatures(base: FeatureSnapshot, extra: FeatureSnapshot): FeatureSnapshot {
  const merged: FeatureSnapshot = { ...base };
  for (const [k, v] of Object.entries(extra)) merged[k] = v;
  return merged;
}

function followFeatures(
  ctx: BotCtx,
  move: Label[] | null,
  teammateRelay: number,
  oppBeat: number,
  shapeScore: number,
  bombRetention: number,
): FeatureSnapshot {
  const base = handStatsFromCounts(ctx.hands);
  const features: FeatureSnapshot = {
    ...base,
    teammateRelay,
    oppBeat,
    shapeScore,
    bombRetention,
  };
  if (move && ctx.require) {
    try {
      const info = ctx.require;
      const chosen = classify(move, ctx?.policy?.four2 || 'both');
      if (info && chosen) {
        features.requireGap = (chosen.rank ?? 0) - (info.rank ?? 0);
      }
    } catch {}
  }
  return features;
}

type FollowModelScores = {
  logistic: number;
  gbdt: number;
  forest: number;
  blended: number;
};

function scoreFollowModels(features: FeatureSnapshot): FollowModelScores {
  const logistic = logisticPredict(FOLLOW_LOGISTIC_MODEL, features);
  const gbdt = evalGBDT(PLAY_GBDT_MODEL, features);
  const forest = evalRandomForest(FOLLOW_FOREST_MODEL, features);
  const blended = logistic * 0.6 + forest * 0.4;
  return { logistic, gbdt, forest, blended };
}

function removeLabelsClone(hand: Label[], pick: Label[]): Label[] {
  const clone = hand.slice();
  removeLabels(clone, pick);
  return clone;
}

// ========== 粒子滤波（手牌采样） ==========
type ParticleResult = {
  assignments: Label[][][];
  marginals: Array<Record<string, number>>;
};

function createRng(seed?: number) {
  let state = (seed ?? Date.now()) >>> 0;
  const step = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  return { next: step };
}

function shuffleWith<T>(arr: T[], rng: { next: () => number }): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sampleOpponentHands(
  ctx: BotCtx,
  samples = 240,
  seed?: number,
): ParticleResult {
  const counts = Array.isArray(ctx.handsCount) ? ctx.handsCount.slice() : [0, 0, 0];
  const assignments: Label[][][] = [];
  const marginals = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  const rng = createRng(seed);
  const deck = freshDeck();
  const known = new Set<string>([...ctx.hands, ...ctx.seen].map(String));
  const unknownBase = deck.filter(card => !known.has(String(card)));
  const seat = ctx.seat ?? 0;
  const otherSeats = [0, 1, 2].filter(s => s !== seat);

  const needTotal = otherSeats.reduce((acc, s) => acc + Math.max(0, counts[s] ?? 0), 0);
  if (unknownBase.length < needTotal) {
    return { assignments: [], marginals: marginals.map(() => ({})) };
  }

  for (let i = 0; i < samples; i++) {
    const perm = shuffleWith(unknownBase.slice(), rng);
    let cursor = 0;
    const sampleHands: Label[][] = [[], [], []];
    let ok = true;
    for (const s of otherSeats) {
      const want = Math.max(0, counts[s] ?? 0);
      if (cursor + want > perm.length) {
        ok = false;
        break;
      }
      sampleHands[s] = perm.slice(cursor, cursor + want);
      cursor += want;
    }
    if (!ok) break;
    sampleHands[seat] = ctx.hands.slice();
    assignments.push(sampleHands.map(h => h.slice()));
    for (let s = 0; s < 3; s++) {
      const table = marginals[s];
      for (const card of sampleHands[s]) {
        const key = String(card);
        table.set(key, (table.get(key) ?? 0) + 1);
      }
    }
  }

  const denom = assignments.length || 1;
  const marginalsOut = marginals.map((map) => {
    const obj: Record<string, number> = {};
    for (const [card, count] of map.entries()) {
      obj[card] = count / denom;
    }
    return obj;
  });

  return { assignments, marginals: marginalsOut };
}

function probabilitySeatCanBeat(
  assignments: Label[][][],
  seat: number,
  move: Label[],
  four2: Four2Policy,
  require: Combo | null,
  actorSeat: number,
): number {
  if (!assignments.length) return 0;
  let success = 0;
  let total = 0;
  const target = classify(move, four2);
  if (!target) return 0;
  for (const sample of assignments) {
    const hands = sample.map(hand => hand.slice());
    if (hands[actorSeat]) removeLabels(hands[actorSeat], move);
    const legal = generateMoves(hands[seat] || [], target, four2);
    if (require == null) {
      // 领先情况：可跟同型或炸弹
      if (legal.length > 0) success++;
      else {
        const bombs = generateMoves(hands[seat] || [], null, four2).filter(mv => {
          const cc = classify(mv, four2);
          return cc && (cc.type === 'bomb' || cc.type === 'rocket');
        });
        if (bombs.length > 0) success++;
      }
    } else if (legal.length > 0) {
      success++;
    }
    total++;
  }
  return total ? success / total : 0;
}

function handStepEstimate(hand: Label[]): number {
  const cnt = countByRank(hand);
  let singles = 0;
  let pairs = 0;
  let triples = 0;
  let bombs = 0;
  for (const arr of cnt.values()) {
    if (arr.length === 1) singles += 1;
    else if (arr.length === 2) pairs += 1;
    else if (arr.length === 3) triples += 1;
    else if (arr.length === 4) bombs += 1;
  }
  const coreSteps = bombs + triples + pairs + singles;
  return coreSteps;
}

function simpleShapeScore(before: Label[], picked: Label[]): number {
  const after = removeLabelsClone(before, picked);
  const beforeSteps = handStepEstimate(before);
  const afterSteps = handStepEstimate(after);
  const delta = beforeSteps - afterSteps;
  const removal = picked.length * 0.35;
  const finishBonus = after.length === 0 ? 5 : 0;
  return delta + removal + finishBonus;
}

function bombRetentionScore(before: Label[], after: Label[]): number {
  const count = (cards: Label[]) => {
    const map = countByRank(cards);
    let bombs = 0;
    let rocket = 0;
    for (const [rv, arr] of map.entries()) {
      if (arr.length === 4) bombs += 1;
    }
    if ((map.get(ORDER['x'])?.length ?? 0) && (map.get(ORDER['X'])?.length ?? 0)) rocket = 1;
    return bombs + rocket;
  };
  const beforeCount = count(before);
  const afterCount = count(after);
  if (beforeCount === 0) return 0;
  return afterCount / beforeCount;
}

type BeamNode = {
  hands: Label[];
  score: number;
  path: Label[][];
  depth: number;
};

function enumerateSimpleMoves(hand: Label[], four2: Four2Policy): Label[][] {
  const all = generateMoves(hand, null, four2);
  return all.filter(mv => {
    const info = classify(mv, four2);
    if (!info) return false;
    return info.type === 'single' || info.type === 'pair' || info.type === 'straight';
  });
}

function beamSearchDecision(
  ctx: BotCtx,
  legal: Label[][],
  assignments: Label[][][],
  options: { width: number; depth: number },
): {
  move: Label[];
  score: number;
  follow: number;
  logistic: number;
  forest: number;
  gbdt: number;
  teammateRelay: number;
  oppBeat: number;
} | null {
  if (!legal.length) return null;
  const four2 = ctx?.policy?.four2 || 'both';
  const width = Math.max(1, options.width);
  const depthLimit = Math.max(1, options.depth);
  const initial: BeamNode = { hands: ctx.hands.slice(), score: 0, path: [], depth: 0 };
  let frontier: BeamNode[] = [initial];

  const expand = (node: BeamNode, moves: Label[][], require: Combo | null) => {
    const next: BeamNode[] = [];
    for (const mv of moves) {
      const after = removeLabelsClone(node.hands, mv);
      const teammateSeat = ctx.teammates?.[0] ?? null;
      const teammateRelay = typeof teammateSeat === 'number'
        ? probabilitySeatCanBeat(assignments, teammateSeat, mv, four2, require, ctx.seat)
        : 0;
      const oppSeat = (ctx.seat + 1) % 3;
      const oppBeat = probabilitySeatCanBeat(assignments, oppSeat, mv, four2, require, ctx.seat);
      const shapeScore = simpleShapeScore(node.hands, mv);
      const bombRetention = bombRetentionScore(node.hands, after);
      const fakeCtx: BotCtx = { ...ctx, hands: node.hands.slice(), require: require };
      const features = followFeatures(fakeCtx, mv, teammateRelay, oppBeat, shapeScore, bombRetention);
      const scores = scoreFollowModels(features);
      const remaining = handStepEstimate(after);
      const stepScore = -remaining * 0.35;
      const totalScore = node.score + scores.blended * 1.4 + scores.gbdt + stepScore + bombRetention * 0.3;
      next.push({ hands: after, score: totalScore, path: [...node.path, mv], depth: node.depth + 1 });
    }
    next.sort((a, b) => b.score - a.score);
    return next.slice(0, width);
  };

  let bestNode: BeamNode | null = null;
  let bestMeta: { scores: FollowModelScores; teammateRelay: number; oppBeat: number } | null = null;

  for (let depth = 0; depth < depthLimit; depth++) {
    const newFrontier: BeamNode[] = [];
    for (const node of frontier) {
      const require = depth === 0 ? ctx.require : null;
      const moves = depth === 0
        ? legal
        : enumerateSimpleMoves(node.hands, four2);
      const expanded = expand(node, moves, require);
      newFrontier.push(...expanded);
    }
    frontier = newFrontier.slice(0, width);
    if (!frontier.length) break;
    const candidate = frontier[0];
    if (!candidate.path.length) continue;
    const mv = candidate.path[0];
    const after = removeLabelsClone(ctx.hands, mv);
    const teammateSeat = ctx.teammates?.[0] ?? null;
    const teammateRelay = typeof teammateSeat === 'number'
      ? probabilitySeatCanBeat(assignments, teammateSeat, mv, four2, ctx.require, ctx.seat)
      : 0;
    const oppSeat = (ctx.seat + 1) % 3;
    const oppBeat = probabilitySeatCanBeat(assignments, oppSeat, mv, four2, ctx.require, ctx.seat);
    const shapeScore = simpleShapeScore(ctx.hands, mv);
    const bombRetention = bombRetentionScore(ctx.hands, after);
    const fakeCtx: BotCtx = { ...ctx };
    const features = followFeatures(fakeCtx, mv, teammateRelay, oppBeat, shapeScore, bombRetention);
    const scores = scoreFollowModels(features);
    if (!bestNode || candidate.score > bestNode.score) {
      bestNode = candidate;
      bestMeta = { scores, teammateRelay, oppBeat };
    }
  }

  if (!bestNode || !bestNode.path.length || !bestMeta) return null;
  return {
    move: bestNode.path[0],
    score: bestNode.score,
    follow: bestMeta.scores.blended,
    logistic: bestMeta.scores.logistic,
    forest: bestMeta.scores.forest,
    gbdt: bestMeta.scores.gbdt,
    teammateRelay: bestMeta.teammateRelay,
    oppBeat: bestMeta.oppBeat,
  };
}

function trailingPasses(trick: PlayEvent[]): number {
  if (!Array.isArray(trick) || !trick.length) return 0;
  let count = 0;
  for (let i = trick.length - 1; i >= 0; i--) {
    if (trick[i].move === 'pass') count += 1;
    else break;
  }
  return count;
}

function lastPlayedSeat(trick: PlayEvent[], fallback: number): number {
  if (Array.isArray(trick)) {
    for (let i = trick.length - 1; i >= 0; i--) {
      if (trick[i].move === 'play') return trick[i].seat;
    }
  }
  return fallback;
}

type EndgameState = {
  hands: Label[][];
  seat: number;
  leader: number;
  lastPlayed: number;
  require: Combo | null;
  passes: number;
  landlord: number;
  four2: Four2Policy;
};

type EndgameMemo = Map<string, number>;

function encodeEndgameState(state: EndgameState): string {
  const handKey = state.hands.map(h => sorted(h).join(',')).join('#');
  const requireKey = state.require
    ? `${state.require.type}:${state.require.rank}:${state.require.len ?? 0}`
    : 'none';
  return [state.seat, state.leader, state.lastPlayed, state.passes, requireKey, state.landlord, handKey].join('|');
}

function endgameDFS(state: EndgameState, memo: EndgameMemo): number {
  const key = encodeEndgameState(state);
  if (memo.has(key)) return memo.get(key)!;

  const { hands, seat, leader, lastPlayed: lp, require, passes, landlord, four2 } = state;
  if (hands[landlord].length === 0) {
    memo.set(key, 1);
    return 1;
  }
  for (let s = 0; s < 3; s++) {
    if (s !== landlord && hands[s].length === 0) {
      memo.set(key, -1);
      return -1;
    }
  }

  const currentHand = hands[seat];
  const legal = generateMoves(currentHand, require, four2);
  const leaderTurn = require == null || seat === leader;
  const canPass = require != null && !(leaderTurn && passes === 0);

  const actions: Array<{ kind: 'play'; move: Label[]; combo: Combo } | { kind: 'pass' }> = [];
  for (const mv of legal) {
    const combo = classify(mv, four2);
    if (combo) actions.push({ kind: 'play', move: mv, combo });
  }
  if (canPass || actions.length === 0) actions.push({ kind: 'pass' });

  const isLandlord = seat === landlord;
  let best = isLandlord ? -Infinity : Infinity;

  for (const action of actions) {
    if (action.kind === 'pass') {
      if (!canPass) continue;
      const nextState: EndgameState = {
        hands: hands.map(h => h.slice()),
        seat: (seat + 1) % 3,
        leader,
        lastPlayed: lp,
        require,
        passes: passes + 1,
        landlord,
        four2,
      };
      if (require == null) {
        continue;
      }
      if (nextState.passes >= 2) {
        nextState.seat = lp;
        nextState.leader = lp;
        nextState.require = null;
        nextState.passes = 0;
      }
      const val = endgameDFS(nextState, memo);
      if (isLandlord) {
        if (val > best) best = val;
      } else if (val < best) {
        best = val;
      }
      continue;
    }

    const nextHands = hands.map(h => h.slice());
    removeLabels(nextHands[seat], action.move);
    if (nextHands[seat].length === 0) {
      const immediate = isLandlord ? 1 : -1;
      memo.set(key, immediate);
      return immediate;
    }
    const nextState: EndgameState = {
      hands: nextHands,
      seat: (seat + 1) % 3,
      leader: seat,
      lastPlayed: seat,
      require: action.combo,
      passes: 0,
      landlord,
      four2,
    };
    const val = endgameDFS(nextState, memo);
    if (isLandlord) {
      if (val > best) best = val;
    } else if (val < best) {
      best = val;
    }
  }

  if (best === Infinity) best = 1;
  if (best === -Infinity) best = -1;
  memo.set(key, best);
  return best;
}

function approximateEndgameMove(
  ctx: BotCtx,
  legal: Label[][],
  assignments: Label[][][],
): { move: Label[] | null; value: number; follow: number; logistic: number; forest: number } | null {
  if (!assignments.length) return null;
  const four2 = ctx?.policy?.four2 || 'both';
  const allowPass = ctx.require != null && ctx.canPass;
  const options: Array<{ move: Label[] | null; combo: Combo | null }> = [];
  for (const mv of legal) {
    const combo = classify(mv, four2);
    if (combo) options.push({ move: mv, combo });
  }
  if (allowPass) options.push({ move: null, combo: null });

  const passCount = trailingPasses(ctx.currentTrick || []);
  const lastSeat = lastPlayedSeat(ctx.currentTrick || [], ctx.leader);

  let bestMove: Label[] | null = null;
  let bestValue = ctx.role === 'landlord' ? -Infinity : Infinity;
  let bestScores: FollowModelScores | null = null;
  let bestFollow = 0;

  for (const opt of options) {
    let acc = 0;
    let seen = 0;
    for (const sample of assignments) {
      const hands = sample.map(hand => hand.slice());
      hands[ctx.seat] = ctx.hands.slice();
      const baseState: EndgameState = {
        hands,
        seat: ctx.seat,
        leader: ctx.leader,
        lastPlayed: lastSeat,
        require: ctx.require,
        passes: passCount,
        landlord: ctx.landlord,
        four2,
      };
      const memo: EndgameMemo = new Map();
      let val: number;
      if (!opt.move) {
        if (!allowPass || ctx.require == null) continue;
        const nextState: EndgameState = { ...baseState, seat: (ctx.seat + 1) % 3, passes: passCount + 1 };
        if (ctx.require != null && nextState.passes >= 2) {
          nextState.seat = lastSeat;
          nextState.leader = lastSeat;
          nextState.require = null;
          nextState.passes = 0;
        }
        val = endgameDFS(nextState, memo);
      } else {
        const combo = classify(opt.move, four2);
        if (!combo) continue;
        removeLabels(baseState.hands[ctx.seat], opt.move);
        if (baseState.hands[ctx.seat].length === 0) {
          val = ctx.role === 'landlord' ? 1 : -1;
        } else {
          const nextState: EndgameState = {
            hands: baseState.hands,
            seat: (ctx.seat + 1) % 3,
            leader: ctx.seat,
            lastPlayed: ctx.seat,
            require: combo,
            passes: 0,
            landlord: ctx.landlord,
            four2,
          };
          val = endgameDFS(nextState, memo);
        }
      }
      acc += val;
      seen += 1;
    }
    if (!seen) continue;
    const avg = acc / seen;
    const better = ctx.role === 'landlord' ? avg > bestValue : avg < bestValue;
    if (better) {
      bestValue = avg;
      bestMove = opt.move ? opt.move.slice() : null;
      const fakeCtx: BotCtx = { ...ctx };
      const mv = opt.move ? opt.move.slice() : [];
      const teammateSeat = ctx.teammates?.[0] ?? null;
      const teammateRelay = opt.move && typeof teammateSeat === 'number'
        ? probabilitySeatCanBeat(assignments, teammateSeat, mv, four2, ctx.require, ctx.seat)
        : 0;
      const oppSeat = (ctx.seat + 1) % 3;
      const oppBeat = opt.move
        ? probabilitySeatCanBeat(assignments, oppSeat, mv, four2, ctx.require, ctx.seat)
        : 0;
      const shapeScore = opt.move ? simpleShapeScore(ctx.hands, mv) : 0;
      const bombRetention = opt.move ? bombRetentionScore(ctx.hands, removeLabelsClone(ctx.hands, mv)) : 0;
      const features = followFeatures(fakeCtx, opt.move, teammateRelay, oppBeat, shapeScore, bombRetention);
      const scores = scoreFollowModels(features);
      bestScores = scores;
      bestFollow = scores.blended;
    }
  }

  if (bestMove === null && !allowPass) return null;
  return {
    move: bestMove,
    value: bestValue,
    follow: bestFollow,
    logistic: bestScores?.logistic ?? 0,
    forest: bestScores?.forest ?? 0,
  };
}




// ========== 牌面与工具 ==========
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const ASCII_SUITS: Record<string, typeof SUITS[number]> = { S: '♠', H: '♥', D: '♦', C: '♣' };
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
  const rec = coop.recommended;
  if (!rec) return null;

  const via = rec.via ? `(${rec.via})` : '';
  const baseReason = rec.reason || `FarmerCoop${via}`;

  if (rec.move === 'pass') {
    if (!ctx.canPass) return null;
    return { move: 'pass', reason: baseReason };
  }

  if (rec.move === 'play') {
    const cards = Array.isArray(rec.cards) ? rec.cards.slice() : [];
    if (!cards.length) return null;

    const pool = ctx.hands.slice();
    for (const label of cards) {
      const idx = pool.indexOf(label);
      if (idx < 0) return null;
      pool.splice(idx, 1);
    }

    const four2 = ctx?.policy?.four2 || 'both';
    const combo = classify(cards, four2);
    if (!combo) return null;
    if (ctx.require && !beats(ctx.require, combo)) return null;

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

function suitOf(label: Label): typeof SUITS[number] | null {
  if (!label) return null;
  const ch = String(label)[0];
  return SUITS.includes(ch as any) ? (ch as typeof SUITS[number]) : null;
}

const SUIT_KEYWORDS: Array<{ suit: typeof SUITS[number]; hints: string[] }> = [
  { suit: '♠', hints: ['♠', '♤', '黑桃', 'spade'] },
  { suit: '♥', hints: ['♥', '♡', '红桃', 'heart'] },
  { suit: '♦', hints: ['♦', '♢', '方块', 'diamond'] },
  { suit: '♣', hints: ['♣', '♧', '梅花', 'club'] },
];

const RANK_CHINESE_HINTS: Array<{ regex: RegExp; rank: string }> = [
  { regex: /三|叁/, rank: '3' },
  { regex: /四|肆/, rank: '4' },
  { regex: /五|伍/, rank: '5' },
  { regex: /六|陆/, rank: '6' },
  { regex: /七|柒/, rank: '7' },
  { regex: /八|捌/, rank: '8' },
  { regex: /九|玖/, rank: '9' },
  { regex: /十|拾/, rank: 'T' },
  { regex: /杰|勾|騎|骑/, rank: 'J' },
  { regex: /后|皇|娘|妃/, rank: 'Q' },
  { regex: /国王|国|王/, rank: 'K' },
  { regex: /二|贰|两|俩/, rank: '2' },
  { regex: /Ａ|Ａ牌/, rank: 'A' },
];

function stripCardToken(raw: string): string {
  return String(raw ?? '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/[\s_\-]+/g, '')
    .trim();
}

function detectSuitFromToken(raw: string): typeof SUITS[number] | null {
  if (!raw) return null;
  const compact = stripCardToken(raw);
  if (!compact) return null;
  const firstKey = compact[0] ? compact[0].toUpperCase() : undefined;
  if (firstKey && Object.prototype.hasOwnProperty.call(ASCII_SUITS, firstKey)) {
    return ASCII_SUITS[firstKey];
  }
  const lastChar = compact[compact.length - 1];
  const lastKey = lastChar ? lastChar.toUpperCase() : undefined;
  if (lastKey && Object.prototype.hasOwnProperty.call(ASCII_SUITS, lastKey)) {
    return ASCII_SUITS[lastKey];
  }
  const lower = compact.toLowerCase();
  for (const { suit, hints } of SUIT_KEYWORDS) {
    if (hints.some(hint => lower.includes(hint))) {
      return suit;
    }
  }
  return null;
}

function detectRankFromToken(raw: string): string | null {
  if (!raw) return null;
  const compact = stripCardToken(raw);
  if (!compact) return null;
  const lower = compact.toLowerCase();
  if (compact.startsWith('🃏')) {
    const tail = compact.slice(1);
    if (!tail) return 'X';
    if (/^[xX]$/.test(tail)) return 'x';
    if (/^[yY]$/.test(tail)) return 'X';
  }
  if (/^pass$/i.test(compact)) return null;
  const smallJokerHint = lower.includes('小王') || lower.includes('小joker') || lower.includes('jokerx') || (lower.includes('joker') && (lower.includes('small') || lower.includes('little') || lower.includes('lower')));
  const bigJokerHint = lower.includes('大王') || lower.includes('大joker') || lower.includes('jokery') || (lower.includes('joker') && (lower.includes('big') || lower.includes('large') || lower.includes('upper')));
  if (smallJokerHint || compact === 'x') {
    return 'x';
  }
  if (bigJokerHint || compact === 'X') {
    return 'X';
  }
  if (lower === 'joker') {
    return 'X';
  }
  let cleaned = compact
    .replace(/[♠♤♣♧♥♡♦♢]/g, '')
    .replace(/黑桃|红桃|方块|梅花|spades?|hearts?|diamonds?|clubs?/gi, '');
  cleaned = cleaned.replace(/^[SHDC]/i, '');
  cleaned = cleaned.replace(/[SHDC]$/i, '');
  if (/10/.test(cleaned)) return 'T';
  for (const ch of cleaned) {
    if (ch === 'x') return 'x';
    if (ch === 'X') return 'X';
    const up = ch.toUpperCase();
    if (RANKS.includes(up as any)) {
      return up === '0' ? 'T' : up;
    }
  }
  for (const { regex, rank } of RANK_CHINESE_HINTS) {
    if (regex.test(cleaned)) return rank;
  }
  return null;
}

function consumeCardToken(raw: any, pool: Label[]): Label | null {
  if (raw == null) return null;
  const rawStr = String(raw);
  const trimmed = stripCardToken(rawStr);
  const directCandidates = [rawStr.trim(), trimmed];
  for (const cand of directCandidates) {
    if (!cand) continue;
    const idx = pool.indexOf(cand as Label);
    if (idx >= 0) {
      const [card] = pool.splice(idx, 1);
      return card;
    }
  }
  const rank = detectRankFromToken(trimmed);
  if (!rank) return null;
  const suit = detectSuitFromToken(trimmed);
  let idx = -1;
  if (suit) {
    idx = pool.findIndex(card => suitOf(card) === suit && rankOf(card) === rank);
  }
  if (idx < 0) {
    idx = pool.findIndex(card => rankOf(card) === rank);
  }
  if (idx >= 0) {
    const [card] = pool.splice(idx, 1);
    return card;
  }
  return null;
}

type AttachmentHint = 'triple_one' | 'triple_pair' | 'plane_single' | 'plane_pair';

function inferMultiplicityFromTokens(tokens: any[]): number | null {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  const normalized = tokens
    .map(t => stripCardToken(String(t ?? '')))
    .filter(Boolean);
  if (!normalized.length) return null;
  const normalizedLower = normalized.map(tok => tok.toLowerCase());
  const joined = normalizedLower.join(' ');

  const matchFrom = (patterns: RegExp[]) =>
    patterns.some(rx => rx.test(joined) || normalizedLower.some(tok => rx.test(tok)));

  const quadruplePatterns = [
    /四张|四個|四个|四枚|四連|四连|炸弹|炸彈|bomb|quad|four\s*of|fourkind|fourcard|四带|四帶/i,
  ];
  if (matchFrom(quadruplePatterns)) return 4;

  const triplePatterns = [
    /三张|三張|三个|三個|三枚|三連|trip|triple|three\s*of|threekind|三带|三帶/i, // triplet hints
  ];
  if (matchFrom(triplePatterns)) return 3;

  const pairPatterns = [
    /对子|對子|一对|一對|pair|double|两个|兩個|两张|兩張|俩|倆|pair\s*of/i,
    /对([3-9TJQKA2xX]|三|四|五|六|七|八|九|十|杰|勾|骑|國|王|二)?$/i,
  ];
  if (matchFrom(pairPatterns)) return 2;

  return null;
}

function inferAttachmentHintFromTokens(tokens: any[]): AttachmentHint | null {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  const normalized = tokens
    .map(t => String(t ?? '').toLowerCase())
    .filter(Boolean);
  if (!normalized.length) return null;
  const joined = normalized.join(' ');

  const matchesAny = (patterns: RegExp[]) =>
    patterns.some(rx => rx.test(joined) || normalized.some(tok => rx.test(tok)));

  const planePairPatterns = [
    /飞机带对|飞机带两对|飞机带双|plane\s*(with|and)\s*(pairs?|double)|plane\s*pairs?|pair\s*wings|带对翼|双对翼|带两对|带对牌/i,
  ];
  if (matchesAny(planePairPatterns)) return 'plane_pair';

  const planeSinglePatterns = [
    /飞机带|飞机拖|plane\s*(with|and)|带翅|带翼|带单|带一张|带两个单|带两张牌|带两张小牌|with\s*wings|single\s*wings|wing\s*cards/i,
  ];
  if (matchesAny(planeSinglePatterns)) return 'plane_single';

  const triplePairPatterns = [
    /三带对|三带二|三带俩|three\s*(with|and)\s*(pairs?|double)|triple\s*(with|and)\s*(pairs?|double)|带一对|带一雙|带一雙牌|带两张相同/i,
  ];
  if (matchesAny(triplePairPatterns)) return 'triple_pair';

  const tripleSinglePatterns = [
    /三带一|三带单|三带一张|three\s*(with|and)\s*(one|single)|triple\s*(with|and)\s*(one|single)|带单牌|带一张牌/i,
  ];
  if (matchesAny(tripleSinglePatterns)) return 'triple_one';

  return null;
}

function drainByRank(pool: Label[], rank: string, count: number): Label[] {
  const taken: Label[] = [];
  while (count-- > 0) {
    const idx = pool.findIndex(card => rankOf(card) === rank);
    if (idx < 0) break;
    const [card] = pool.splice(idx, 1);
    taken.push(card);
  }
  return taken;
}

function cardsByRank(labels: Label[]): Map<string, Label[]> {
  const map = new Map<string, Label[]>();
  for (const card of labels) {
    const rk = rankOf(card);
    const arr = map.get(rk);
    if (arr) {
      arr.push(card);
    } else {
      map.set(rk, [card]);
    }
  }
  for (const arr of map.values()) arr.sort(byValueAsc);
  return map;
}

function takeSingles(map: Map<string, Label[]>, count: number, banned: Set<string>): Label[] | null {
  if (count <= 0) return [];
  const ranks = Array.from(map.keys()).sort((a, b) => (ORDER[a] ?? 0) - (ORDER[b] ?? 0));
  const result: Label[] = [];
  for (const rk of ranks) {
    if (banned.has(rk)) continue;
    const arr = map.get(rk);
    if (!arr?.length) continue;
    while (arr.length && result.length < count) {
      result.push(arr.shift()!);
    }
    if (!arr.length) map.delete(rk);
    if (result.length >= count) break;
  }
  return result.length >= count ? result : null;
}

function takePairs(map: Map<string, Label[]>, count: number, banned: Set<string>): Label[] | null {
  if (count <= 0) return [];
  const ranks = Array.from(map.keys()).sort((a, b) => (ORDER[a] ?? 0) - (ORDER[b] ?? 0));
  const result: Label[] = [];
  let used = 0;
  for (const rk of ranks) {
    if (banned.has(rk)) continue;
    const arr = map.get(rk);
    if (!arr?.length) continue;
    while (arr.length >= 2 && used < count) {
      result.push(arr.shift()!, arr.shift()!);
      used += 1;
    }
    if (!arr.length) map.delete(rk);
    if (used >= count) break;
  }
  return used >= count ? result : null;
}

function augmentWithAttachments(picked: Label[], leftover: Label[], hint: AttachmentHint): { cards: Label[]; ok: boolean } {
  const rankMap = cardsByRank(picked);
  const tripleEntries = Array.from(rankMap.entries())
    .filter(([, arr]) => arr.length >= 3)
    .map(([rank, arr]) => ({ rank, count: arr.length }))
    .sort((a, b) => (ORDER[a.rank] ?? 0) - (ORDER[b.rank] ?? 0));

  if (!tripleEntries.length) {
    return { cards: picked, ok: false };
  }

  let anchorRanks: string[] = [];
  let wingSlots = 0;
  let wingSize = 1;

  switch (hint) {
    case 'triple_one':
      anchorRanks = [tripleEntries[0].rank];
      wingSlots = anchorRanks.length ? 1 : 0;
      wingSize = 1;
      break;
    case 'triple_pair':
      anchorRanks = [tripleEntries[0].rank];
      wingSlots = anchorRanks.length ? 1 : 0;
      wingSize = 2;
      break;
    case 'plane_single':
      if (tripleEntries.length < 2) return { cards: picked, ok: false };
      anchorRanks = tripleEntries.map(t => t.rank);
      wingSlots = anchorRanks.length;
      wingSize = 1;
      break;
    case 'plane_pair':
      if (tripleEntries.length < 2) return { cards: picked, ok: false };
      anchorRanks = tripleEntries.map(t => t.rank);
      wingSlots = anchorRanks.length;
      wingSize = 2;
      break;
    default:
      return { cards: picked, ok: false };
  }

  if (!anchorRanks.length || wingSlots <= 0) {
    return { cards: picked, ok: false };
  }

  const tripleCardCount = anchorRanks.reduce((sum, rk) => sum + Math.min(3, rankMap.get(rk)?.length ?? 0), 0);
  const requiredWingCards = wingSlots * wingSize;
  const expectedTotal = tripleCardCount + requiredWingCards;
  if (picked.length >= expectedTotal) {
    return { cards: picked, ok: true };
  }

  const banned = new Set(anchorRanks);
  const leftoverMap = cardsByRank(leftover);
  let wings: Label[] | null = null;
  if (wingSize === 1) {
    wings = takeSingles(leftoverMap, wingSlots, banned);
  } else {
    wings = takePairs(leftoverMap, wingSlots, banned);
  }

  if (!wings) {
    return { cards: picked, ok: false };
  }

  return { cards: sorted([...picked, ...wings]), ok: true };
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


function nextSeatIndex(seat: number): number {
  return (seat + 1) % 3;
}

function isOpponentSeat(ctx: BotCtx | null | undefined, seat: number): boolean {
  if (!ctx) return false;
  const opponents = Array.isArray(ctx.opponents) ? ctx.opponents : [];
  return opponents.includes(seat);
}

function handCountForSeat(ctx: BotCtx | null | undefined, seat: number): number | null {
  if (!ctx) return null;
  const counts = Array.isArray(ctx.handsCount) ? ctx.handsCount : null;
  if (!counts || seat < 0 || seat >= counts.length) return null;
  const value = counts[seat];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function singleDangerPenalty(ctx: BotCtx, move: Label[], four2: Four2Policy): number {
  try {
    if (!ctx || !Array.isArray(move) || move.length !== 1) return 0;
    if (ctx.require != null) return 0;
    const myHandSize = Array.isArray(ctx.hands) ? ctx.hands.length : 0;
    if (myHandSize === move.length) return 0;
    const nextSeat = nextSeatIndex(ctx.seat ?? 0);
    if (!isOpponentSeat(ctx, nextSeat)) return 0;
    const nextCount = handCountForSeat(ctx, nextSeat);
    if (nextCount !== 1) return 0;
    const info = classify(move, four2);
    if (!info || info.type !== 'single') return 0;
    if (info.rank === ORDER['X']) return 0;
    return 6;
  } catch {
    return 0;
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

export function classify(cards: Label[], four2: Four2Policy = 'both'): Combo | null {
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

function buildRulesReference(): RulesReference {
  const maxSeqSymbol = rankSymbolOf(MAX_SEQ_VALUE) ?? 'A';
  const maxSeqLabel = readableRank(maxSeqSymbol) ?? maxSeqSymbol;
  const combos: Record<string, ComboRuleDoc> = {
    single: {
      label: '单张',
      summary: '任意一张牌，可含 3 至 大王 的任意点数。',
      minCards: 1,
      examples: ['♠3'],
    },
    pair: {
      label: '对子',
      summary: '两张点数相同的牌，大小王不能配成对子。',
      minCards: 2,
      examples: ['♠3 ♣3'],
    },
    triple: {
      label: '三张',
      summary: '三张点数相同的牌。',
      minCards: 3,
      examples: ['♠3 ♣3 ♥3'],
    },
    triple_one: {
      label: '三带一',
      summary: '三张相同点数 + 任意一张单牌。',
      minCards: 4,
      examples: ['♠3 ♣3 ♥3 ♠9'],
    },
    triple_pair: {
      label: '三带一对',
      summary: '三张相同点数 + 任意一对牌。',
      minCards: 5,
      examples: ['♠3 ♣3 ♥3 ♠9 ♣9'],
    },
    straight: {
      label: '顺子',
      summary: '点数连续的单牌序列，不含 2 与大小王。',
      minCards: CHAIN_MIN.straight,
      chain: {
        minGroups: CHAIN_MIN.straight,
        groupSize: 1,
        maxRankSymbol: maxSeqSymbol,
        maxRankLabel: maxSeqLabel,
      },
      examples: ['♠3 ♣4 ♦5 ♠6 ♣7'],
      notes: '长度至少 5 张，例如 3-4-5-6-7。',
    },
    pair_seq: {
      label: '连对',
      summary: '由 N 个点数连续的对子组成，至少 3 对，不含 2 与大小王。',
      minCards: CHAIN_MIN.pair_seq * 2,
      chain: {
        minGroups: CHAIN_MIN.pair_seq,
        groupSize: 2,
        maxRankSymbol: maxSeqSymbol,
        maxRankLabel: maxSeqLabel,
        example: '♠3 ♣3 ♠4 ♣4 ♠5 ♣5',
      },
      notes: '常见示例：对3、对4、对5 组成的三连对。',
    },
    plane: {
      label: '飞机',
      summary: '由 N 组三张连续点数组成，不含 2 与大小王。',
      minCards: CHAIN_MIN.plane * 3,
      chain: {
        minGroups: CHAIN_MIN.plane,
        groupSize: 3,
        maxRankSymbol: maxSeqSymbol,
        maxRankLabel: maxSeqLabel,
        example: '♠3 ♣3 ♥3 ♠4 ♣4 ♥4',
      },
      notes: '基础飞机不带翅膀，每组三张。',
    },
    plane_single: {
      label: '飞机带单',
      summary: '连续三张组 + 同数量的单牌翅膀。',
      minCards: CHAIN_MIN.plane * 4,
      chain: {
        minGroups: CHAIN_MIN.plane,
        groupSize: 3,
        maxRankSymbol: maxSeqSymbol,
        maxRankLabel: maxSeqLabel,
      },
      notes: '每组三张需配一张额外单牌。',
    },
    plane_pair: {
      label: '飞机带对',
      summary: '连续三张组 + 同数量的对子翅膀。',
      minCards: CHAIN_MIN.plane * 5,
      chain: {
        minGroups: CHAIN_MIN.plane,
        groupSize: 3,
        maxRankSymbol: maxSeqSymbol,
        maxRankLabel: maxSeqLabel,
      },
      notes: '每组三张需配一个对子。',
    },
    four_two_singles: {
      label: '四带两单',
      summary: '四张相同点数 + 任意两张单牌。',
      minCards: 6,
    },
    four_two_pairs: {
      label: '四带两对',
      summary: '四张相同点数 + 两个对子。',
      minCards: 8,
    },
    bomb: {
      label: '炸弹',
      summary: '四张点数相同的牌，可压制除更大炸弹与王炸外的任何组合。',
      minCards: 4,
    },
    rocket: {
      label: '王炸',
      summary: '大小王组合，为全场最大牌型。',
      minCards: 2,
      examples: ['🃏x 🃏X'],
    },
  };

  return {
    rankOrder: [...RANKS],
    rankOrderLabel: RANKS.map(r => readableRank(r) ?? r),
    orderHint: ORDER_HINT_RAW,
    orderHintLabel: ORDER_HINT_LABEL,
    chainMin: { ...CHAIN_MIN },
    combos,
  };
}

const RULES_REFERENCE = buildRulesReference();

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

export function generateMoves(hand: Label[], require: Combo | null, four2: Four2Policy): Label[][] {
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
    return sShape + sRisk * 0.35 - singleDangerPenalty(ctx, mv, four2);
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
    return sShape + sRisk * 0.35 + bias - singleDangerPenalty(ctx, mv, four2);
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
    return sShape + sRisk * riskWeight - singleDangerPenalty(ctx, mv, four2);
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
    return sShape + sRisk * riskW - singleDangerPenalty(ctx, mv, four2);
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


export const AdvancedHybrid: BotFunc = async (ctx) => {
  const coopMove = maybeFollowCoop(ctx);
  if (coopMove) return coopMove;

  const four2 = ctx?.policy?.four2 || 'both';
  const legal = generateMoves(ctx.hands, ctx.require, four2);
  if (ctx.require && ctx.canPass && !legal.length) {
    return { move: 'pass', reason: 'AdvancedHybrid: 需跟无可接' };
  }

  const particles = sampleOpponentHands(ctx, 320);
  const assignments = particles.assignments;

  if (assignments.length && ctx.require && ctx.canPass && legal.length) {
    let bestFollow = 0;
    let bestLogistic = 0;
    let bestForest = 0;
    for (const mv of legal) {
      const after = removeLabelsClone(ctx.hands, mv);
      const teammateSeat = ctx.teammates?.[0] ?? null;
      const teammateRelay = typeof teammateSeat === 'number'
        ? probabilitySeatCanBeat(assignments, teammateSeat, mv, four2, ctx.require, ctx.seat)
        : 0;
      const oppSeat = (ctx.seat + 1) % 3;
      const oppBeat = probabilitySeatCanBeat(assignments, oppSeat, mv, four2, ctx.require, ctx.seat);
      const shapeScore = simpleShapeScore(ctx.hands, mv);
      const bombRetention = bombRetentionScore(ctx.hands, after);
      const features = followFeatures(ctx, mv, teammateRelay, oppBeat, shapeScore, bombRetention);
      const scores = scoreFollowModels(features);
      if (scores.blended > bestFollow) {
        bestFollow = scores.blended;
        bestLogistic = scores.logistic;
        bestForest = scores.forest;
      }
    }
    if (bestFollow < 0.35) {
      return {
        move: 'pass',
        reason: `AdvancedHybrid: followBlend=${bestFollow.toFixed(2)} logit=${bestLogistic.toFixed(2)} rf=${bestForest.toFixed(2)} → pass`,
      };
    }
  }

  if (ctx.handsCount?.every(cnt => cnt <= 7)) {
    const endgame = approximateEndgameMove(ctx, legal, assignments);
    if (endgame) {
      if (endgame.move === null) {
        return {
          move: 'pass',
          reason: `AdvancedHybrid:endgame value=${endgame.value.toFixed(2)} follow=${endgame.follow.toFixed(2)} logit=${endgame.logistic.toFixed(2)} rf=${endgame.forest.toFixed(2)}`,
        };
      }
      return {
        move: 'play',
        cards: endgame.move,
        reason: `AdvancedHybrid:endgame value=${endgame.value.toFixed(2)} follow=${endgame.follow.toFixed(2)} logit=${endgame.logistic.toFixed(2)} rf=${endgame.forest.toFixed(2)}`,
      };
    }
  }

  if (!legal.length) {
    return ctx.canPass
      ? { move: 'pass', reason: 'AdvancedHybrid: 无合法可出' }
      : { move: 'play', cards: [ctx.hands[0] ?? '♠3'], reason: 'AdvancedHybrid: 强制兜底' };
  }

  const beam = beamSearchDecision(ctx, legal, assignments, { width: 4, depth: 3 });
  if (beam) {
    const reason = [
      'AdvancedHybrid',
      `beamScore=${beam.score.toFixed(2)}`,
      `followBlend=${beam.follow.toFixed(2)}`,
      `logit=${beam.logistic.toFixed(2)}`,
      `rf=${beam.forest.toFixed(2)}`,
      `gbdt=${beam.gbdt.toFixed(2)}`,
      `relay=${beam.teammateRelay.toFixed(2)}`,
      `opp=${beam.oppBeat.toFixed(2)}`,
    ].join(' | ');
    return { move: 'play', cards: beam.move, reason };
  }

  const fallback = await Promise.resolve(GreedyMin(ctx));
  if (fallback.move === 'play') {
    fallback.reason = (fallback.reason ? `${fallback.reason} | ` : '') + 'AdvancedHybrid:fallback';
  } else {
    fallback.reason = (fallback.reason ? `${fallback.reason} | ` : '') + 'AdvancedHybrid:fallback';
  }
  return fallback;
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
  const seatLabels = ['甲', '乙', '丙'];

  const logHandsToConsole = (stage: string, snapshot: Label[][], landlordSeat: number, bottomCards?: Label[]) => {
    if (typeof console === 'undefined' || typeof console.log !== 'function') return;
    if (!Array.isArray(snapshot) || snapshot.length !== 3) return;

    const label = stage === 'pre-play'
      ? '开局手牌'
      : stage === 'post-game'
        ? '结算余牌'
        : stage;

    const seatLines = snapshot.map((hand, idx) => {
      const base = seatLabels[idx] ?? `Seat${idx}`;
      const role = idx === landlordSeat ? '地主' : '农民';
      const cards = Array.isArray(hand) && hand.length ? hand.join(' ') : '（无）';
      return `  ${base}(${role})：${cards}`;
    });

    const bottomLine = Array.isArray(bottomCards) && bottomCards.length
      ? `  底牌：${bottomCards.join(' ')}`
      : null;

    const lines = bottomLine && stage === 'pre-play'
      ? [...seatLines, bottomLine]
      : seatLines;

    try {
      console.log(`[DDZ][${label}]\n${lines.join('\n')}`);
    } catch {}
  };

  // 发牌
  let deck = shuffle(freshDeck());
  let hands: Label[][] = [[],[],[]];
  for (let i=0;i<17;i++) for (let s=0;s<3;s++) hands[s].push(deck[i*3+s]);
  let bottom = deck.slice(17*3); // 3 张
  for (let s=0;s<3;s++) hands[s] = sorted(hands[s]);

  // 抢地主流程（简单实现）
  let landlord = -1;
  let multiplier = 1;
  let bidMultiplier = 1;
  const seatMeta = bots.map((bot:any)=>({
    phaseAware: !!((bot as any)?.phaseAware),
    choice: String((bot as any)?.choice || '').toLowerCase(),
    name: String((bot as any)?.name || (bot as any)?.constructor?.name || '').toLowerCase(),
  }));

  const MAX_BID_ATTEMPTS = 5;

  // —— 在进入叫抢流程前，把初始手牌与底牌推送出去，便于前端立即展示 ——
  try {
    yield {
      type: 'state',
      kind: 'init',
      landlord: null,
      landlordIdx: null,
      hands: hands.map(h => [...h]),
      bottom: [],
    };
  } catch {}

  if (opts.bid !== false) {
    let last = -1;

    for (let attempt = 0; attempt < MAX_BID_ATTEMPTS; attempt++) {
      const bidderMap = new Map<number, { seat:number; score:number; threshold:number; margin:number; doubled:boolean }>();
      const bidHistory: { seat:number; score:number; threshold:number; margin:number; doubled:boolean }[] = [];
      last = -1;
      bidMultiplier = 1;
      multiplier = 1;
      let passesSinceLastBid = 0;
      let passesNoBid = 0;
      let actions = 0;
      const perSeatBidCount: [number, number, number] = [0, 0, 0];
      let hasAnyBid = false;
      const firstRoundPass: [boolean, boolean, boolean] = [false, false, false];
      const roundOrder = [0, 1, 2] as const;
      let activeOrder: readonly number[] = roundOrder;
      let round = 1;
      let seatIdx = 0;

      while (true) {
        const seat = activeOrder[seatIdx];
        const sc = evalRobScore(hands[seat]);

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
          'human':                 2.2,
          'external':              2.2,
          'external:ai':           2.2,
          'external:http':         2.2,
          'ai':                    2.2,
          'http':                  2.2,
          'openai':                2.2,
          'gpt':                   2.2,
          'claude':                2.2,
        };
        const meta = seatMeta[seat];
        const threshold = (__thMapChoice[meta.choice] ?? __thMap[meta.name] ?? 1.8);
        const bidFeatures = handStatsFromCounts(hands[seat]);
        const bidMlProb = logisticPredict(BID_LOGISTIC_MODEL, bidFeatures);
        const recommended = (sc >= threshold) || (bidMlProb >= 0.5);

        const prevBidders = Array.from(bidderMap.values()).map(b => ({ seat:b.seat, score:b.score, threshold:b.threshold, margin:b.margin, doubled:b.doubled }));
        const forcedPass = perSeatBidCount[seat] >= 2;
        const bidCtx: any = {
          hands: clone(hands[seat]),
          require: null,
          canPass: true,
          policy: { four2 },
          rules: RULES_REFERENCE,
          phase: 'bid',
          bid: {
            score: sc,
            threshold,
            multiplier,
            bidMultiplier,
            recommended,
            forcedPass,
            attempt,
            maxAttempts: MAX_BID_ATTEMPTS,
            bidders: prevBidders,
            mlProbability: bidMlProb,
          },
          seat,
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
          opponents: [ (seat+1)%3, (seat+2)%3 ],
          counts: {
            handByRank: tallyByRank(hands[seat]),
            seenByRank: tallyByRank([]),
            remainingByRank: remainingCountByRank([], hands[seat]),
          },
        };

        let decision = forcedPass ? false : recommended;
        if (!forcedPass && meta.phaseAware) {
          const ctxForBot: any = clone(bidCtx);
          if (ctxForBot?.bid) {
            const def = !!ctxForBot.bid.recommended;
            ctxForBot.bid.default = def;
            delete ctxForBot.bid.recommended;
            delete ctxForBot.bid.threshold;
          }
          try {
            const result = await Promise.resolve(bots[seat](ctxForBot));
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

        const decisionLabel = decision ? 'bid' : 'pass';
        yield { type:'event', kind:'bid-eval', seat, score: sc, threshold, decision: decisionLabel, bidMult: bidMultiplier, mult: multiplier, forced: forcedPass, bidCount: perSeatBidCount[seat], maxBidCount: 2, mlProbability: bidMlProb };

        if (decision) {
          const margin = sc - threshold;
          perSeatBidCount[seat] = Math.min(2, perSeatBidCount[seat] + 1);
          const isRob = hasAnyBid;
          const rec = { seat, score: sc, threshold, margin, doubled: isRob };
          bidderMap.set(seat, rec);
          bidHistory.push(rec);
          if (isRob) {
            multiplier = Math.min(64, Math.max(1, (multiplier || 1) * 2));
          } else {
            multiplier = Math.max(1, multiplier || 1);
          }
          bidMultiplier = multiplier;
          if (round === 1) firstRoundPass[seat] = false;
          last = seat;
          passesSinceLastBid = 0;
          passesNoBid = 0;
          hasAnyBid = true;
          yield { type:'event', kind:'bid', seat, bid:true, score: sc, bidMult: bidMultiplier, mult: multiplier, doubled: isRob, bidCount: perSeatBidCount[seat] };
        } else {
          if (round === 1) firstRoundPass[seat] = true;
          if (last === -1) {
            passesNoBid++;
          } else {
            passesSinceLastBid++;
          }
        }

        if (opts.delayMs) await wait(opts.delayMs);

        const reachedActionCap = (++actions) >= 12;
        const everyonePassed = (last === -1 && passesNoBid >= roundOrder.length);
        const biddingSettled = (last !== -1 && passesSinceLastBid >= 2);
        if (reachedActionCap || everyonePassed || biddingSettled) {
          break;
        }

        if (round === 1 && seatIdx + 1 >= activeOrder.length) {
          const eligible = roundOrder.filter(s => !firstRoundPass[s]);
          if (eligible.length <= 1) {
            break;
          }
          activeOrder = eligible;
          round = 2;
          seatIdx = 0;
          continue;
        }

        if (round === 2 && seatIdx + 1 >= activeOrder.length) {
          break;
        }

        seatIdx = (seatIdx + 1) % activeOrder.length;
      }

      if (bidHistory.length > 0) {
        bidMultiplier = 1;
        multiplier = 1;
        for (const hit of bidHistory) {
          if (hit.doubled) {
            bidMultiplier = Math.min(64, Math.max(1, (bidMultiplier || 1) * 2));
          }
          multiplier = bidMultiplier;
          yield { type:'event', kind:'rob2', seat: hit.seat, score: hit.score, threshold: hit.threshold, margin: Number((hit.margin).toFixed(4)), bidMult: bidMultiplier, mult: multiplier, doubled: hit.doubled };
        }
        landlord = last;
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
  if (landlord < 0) landlord = 0;
  // 亮底 & 地主收底
  yield { type:'event', kind:'reveal', landlord, landlordIdx: landlord, bottom: bottom.slice() };
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
const lordMlProb = logisticPredict(DOUBLE_LANDLORD_MODEL, handStatsFromCounts(hands[Lseat]));
const farmerYMlProb = logisticPredict(DOUBLE_FARMER_MODEL, mixFeatures(handStatsFromCounts(hands[Yseat]), { counterScore: yBase.counter }));
const farmerBMlProb = logisticPredict(DOUBLE_FARMER_MODEL, mixFeatures(handStatsFromCounts(hands[Bseat]), { counterScore: bBase.counter }));
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
    rules: RULES_REFERENCE,
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
if (!Lflag && lordMlProb >= 0.55) Lflag = 1;
if (!farmerYFlag && farmerYMlProb >= 0.55) farmerYFlag = 1;
if (!farmerBFlag && farmerBMlProb >= 0.55) farmerBFlag = 1;

if (seatMeta[Lseat]?.phaseAware) {
  try {
    const ctx = buildDoubleCtx(Lseat, 'landlord', !!Lflag, { landlord: { delta: lordDecision.delta, reason: lordDecision.reason, ml: lordMlProb } });
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
    const ctx = buildDoubleCtx(Yseat, 'farmer', !!farmerYFlag, { farmer: { dLhat: yBase.dLhat, counter: yBase.counter, ml: farmerYMlProb } });
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
    const ctx = buildDoubleCtx(Bseat, 'farmer', !!farmerBFlag, { farmer: { dLhat: bBase.dLhat, counter: bBase.counter, ml: farmerBMlProb }, bayes:{ landlord: lordDecision.L, farmerY: yBase.F } });
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

try { yield { type:'event', kind:'double-decision', role:'landlord', seat:Lseat, double:!!Lflag, delta: lordDecision.delta, reason: lordDecision.reason, mlProbability: lordMlProb }; } catch{}
try { yield { type:'event', kind:'double-decision', role:'farmer', seat:Yseat, double:!!farmerYFlag, dLhat:yBase.dLhat, counter:yBase.counter, mlProbability: farmerYMlProb }; } catch{}
try { yield { type:'event', kind:'double-decision', role:'farmer', seat:Bseat, double:!!farmerBFlag, dLhat:bBase.dLhat, counter:bBase.counter, bayes:{ landlord: Lflag, farmerY: farmerYFlag }, mlProbability: farmerBMlProb }; } catch{}

let __doubleMulY = (1 << Lflag) * (1 << farmerYFlag);
let __doubleMulB = (1 << Lflag) * (1 << farmerBFlag);

__doubleMulY = Math.min(__DOUBLE_CFG.cap, __doubleMulY * multiplier) / Math.max(1, multiplier);
__doubleMulB = Math.min(__DOUBLE_CFG.cap, __doubleMulB * multiplier) / Math.max(1, multiplier);

try { yield { type:'event', kind:'double-summary', landlord:Lseat, yi:Yseat, bing:Bseat, mulY: __doubleMulY, mulB: __doubleMulB, base: multiplier }; } catch{}

  try {
    yield {
      type: 'event',
      kind: 'hand-snapshot',
      stage: 'pre-play',
      hands: hands.map(h => h.slice()),
      landlord,
    };
  } catch {}
  logHandsToConsole('pre-play', hands, landlord, bottom);


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
      rules: RULES_REFERENCE,
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
      const pool = [...hands[turn]];
      if (!Array.isArray(xs)) {
        return { picked: [] as Label[], leftover: pool, missing: false };
      }
      const picked: Label[] = [];
      for (const token of xs) {
        const match = consumeCardToken(token, pool);
        if (match) picked.push(match);
      }

      const implied = inferMultiplicityFromTokens(xs);
      const joinAll = xs.map(t => String(t ?? '')).join(' ');
      const rankCandidates: string[] = [];
      if (picked.length) rankCandidates.push(rankOf(picked[0]));
      const joinRank = detectRankFromToken(joinAll);
      if (joinRank) rankCandidates.push(joinRank);
      for (const token of xs) {
        const rawRank = detectRankFromToken(String(token ?? ''));
        if (rawRank) rankCandidates.push(rawRank);
        const strippedRank = detectRankFromToken(stripCardToken(String(token ?? '')));
        if (strippedRank) rankCandidates.push(strippedRank);
      }
      const rankHintOrder = Array.from(new Set(rankCandidates.filter(Boolean)));

      let missing = false;
      if (implied && picked.length < implied) {
        for (const rank of rankHintOrder) {
          if (!rank) continue;
          const extra = drainByRank(pool, rank, implied - picked.length);
          picked.push(...extra);
          if (picked.length >= implied) break;
        }
        if (picked.length < implied) {
          missing = true;
        }
      }

      return { picked, leftover: pool, missing };
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

      const tokens = (mv as any)?.cards;
      const { picked, leftover, missing } = pickFromHand(tokens);

      let cleaned = picked;
      if (missing) {
        cleaned = [];
      } else {
        const attachmentHint = inferAttachmentHintFromTokens(tokens);
        if (attachmentHint) {
          const augmented = augmentWithAttachments(picked, leftover, attachmentHint);
          if (augmented.ok) {
            cleaned = augmented.cards;
          } else {
            cleaned = [];
          }
        }
      }

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

      const isBomb = (cc.type === 'bomb' || cc.type === 'rocket');
      if (isBomb) bombTimes++;

      yield {
        type:'event', kind:'play', seat: turn, move:'play',
        cards: pick, comboType: cc.type
      };
      history.push({ seat: turn, move:'play', cards: clone(pick), comboType: cc.type, trick });
      seen.push(...pick);

      if (isBomb) {
        const bombScale = Math.pow(2, bombTimes);
        const multBase = Math.max(1, multiplier * bombScale);
        const multYi   = Math.max(1, multiplier * __doubleMulY * bombScale);
        const multBing = Math.max(1, multiplier * __doubleMulB * bombScale);
        try {
          yield {
            type:'event',
            kind:'multiplier-sync',
            multiplier: multBase,
            multiplierYi: multYi,
            multiplierBing: multBing,
            bombTimes,
            source: cc.type
          };
        } catch {}
      }


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

      const humanSeats = seatMeta
        .map((meta, idx) => (meta.choice === 'human' ? idx : -1))
        .filter(idx => idx >= 0);
      const hasHuman = humanSeats.length > 0;
      const remainingHands = hands.map(h => h.slice());
      const humanWon = hasHuman ? humanSeats.includes(winner) : false;
      const revealTargets = hasHuman
        ? (humanWon
          ? [0, 1, 2].filter(seat => !humanSeats.includes(seat))
          : [0, 1, 2].filter(seat => !humanSeats.includes(seat) && remainingHands[seat].length > 0))
        : [];
      const revealDurationMs = revealTargets.length ? 5000 : 0;
      try {
        yield {
          type: 'event',
          kind: 'hand-snapshot',
          stage: 'post-game',
          hands: remainingHands,
          landlord,
          winner,
          revealSeats: revealTargets,
          revealDurationMs,
        };
      } catch {}
      logHandsToConsole('post-game', remainingHands, landlord);
      if (revealDurationMs > 0) {
        try { await wait(revealDurationMs); } catch {}
      }

      return;
    }

    // 下一家
    if (opts.delayMs) await wait(opts.delayMs);
    turn = (turn + 1) % 3;
  }
}
