// lib/doudizhu/engine.ts

/* === Inject: bid-eval helper (bidding debug) === */

// === External Bid Bridge (action-first) ===
type LandlordAction = 'call'|'rob'|'pass';
type DecideLandlordRequest = {
  version: 'ddz.v1';
  task: 'decide_landlord';
  meta: { game_id?: string; round_id?: number; deadline_ms?: number; lang?: 'zh'|'en' };
  seat: number;
  visibility: {
    hand: string[];
    history: Array<{seat:number; action: LandlordAction}>;
    start_seat: number;
    bid_round: number;
  };
  rules: any;
  provider_hints?: { temperature?: number; deterministic?: boolean };
};
type DecideLandlordResponse = {
  version?: string;
  action: LandlordAction;
  confidence?: number;
  rationale?: string;
  telemetry?: { p_win_estimate?: number; latency_ms?: number; [k:string]: any };
};

async function __callExternalBid(bots:any[], seat:number, payload: DecideLandlordRequest, timeoutMs=1200): Promise<DecideLandlordResponse|null> {
  try {
    const bot = (bots as any)[seat];
    const base = (bot && (bot.base || bot.baseUrl)) ? String(bot.base || bot.baseUrl).replace(/\/$/,'') : '';
    if (!base) return null;
    const token = bot.token || bot.apiKey || '';
    const endpoints = [`${base}/decide_landlord`, `${base}/bid`];
    const ctrl = new AbortController();
    const to = setTimeout(()=>ctrl.abort(), Math.max(500, timeoutMs));
    try {
      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type':'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) },
            body: JSON.stringify(payload),
            signal: (ctrl as any).signal,
          } as any);
          if (!(res as any).ok) continue;
          const j = await (res as any).json();
          if (j && (j.action==='call'||j.action==='rob'||j.action==='pass')) { clearTimeout(to); return j as DecideLandlordResponse; }
        } catch {}
      }
    } finally { clearTimeout(to); }
  } catch {}
  return null;
}


function __scoreToAction(sc:number, choiceName:string): { action: LandlordAction; threshold: number } {
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
  const th = (__thMapChoice[choiceName] ?? __thMap[choiceName] ?? 1.8);
  const action: LandlordAction = (sc >= th) ? 'rob' : 'pass';
  return { action, threshold: th };
}

let decision: LandlordAction = 'pass'; let threshold: number|undefined; let confidence: number|undefined; let pwin: number|undefined;
{
  const fb = __scoreToAction(sc, __choice || __name || 'external');
  decision = fb.action;
  threshold = fb.threshold;
  // confidence/pwin left undefined in fallback
}
const bid = (decision === 'call' || decision === 'rob');

// —— 记录评估（含行动/可选置信/可选胜率） —— //
try {
  yield { type:'event', kind:'bid-eval', seat: s, score: sc, threshold, decision, confidence, pwin, bidMult: bidMultiplier, mult: multiplier };
} catch {}

if (bid) {
  __bidders.push({ seat: s, score: sc, threshold: (typeof threshold==='number'?threshold: (threshold as any)), margin: (typeof threshold==='number'?(sc - (threshold as number)): 0) });
  multiplier = Math.min(64, Math.max(1, (multiplier || 1) * 2));
  last = s;
  yield { type:'event', kind:'bid', seat:s, bid:true, score: sc, bidMult: bidMultiplier, mult: multiplier, decision };
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