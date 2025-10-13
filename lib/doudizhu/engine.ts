
// engine.ts — external-AI bidding via optional bot.bid(ctx); v5 fixes literal union for `kind`

export type Label = string;

export type BidDecision =
  | { kind: 'bid'; score?: number; threshold?: number; reason?: string }
  | { kind: 'pass'; score?: number; threshold?: number; reason?: string };

export type BotMove =
  | { move: 'pass'; reason?: string }
  | { move: 'play'; cards: Label[]; reason?: string };

export type BidCtx = {
  hand: Label[];
  position: number; // 0/1/2
  roundNo?: number;
  isFirstBidder?: boolean;
  previousBids: { seat: number; decision: 'bid' | 'pass'; score?: number }[];
  phase: 'first-round' | 'second-round';
  currentMultiplier: number;
};

export type BotCtx = {
  hand: Label[];
  position: number;
};

export type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

export type ExternalBidder = {
  bid?: (ctx: BidCtx) => Promise<BidDecision> | BidDecision;
  name?: string;
  choice?: string;
};

export type EventInit = { type:'event', kind:'init', hands: Label[][] };
export type EventBidEval = { type:'event', kind:'bid-eval', seat:number, score:number, threshold?:number, decision:'bid'|'pass', reason?:string };
export type EventBid = { type:'event', kind:'bid', seat:number, bid:boolean, score:number, bidMult:number, mult:number, reason?:string };
export type EventAssign = { type:'event', kind:'assign-lord', seat:number, bottom: Label[], mult:number };
export type EventPlay = { type:'event', kind:'play', seat:number, move:'pass'|'play', cards?:Label[], reason?:string };
export type EventResult = { type:'event', kind:'result', winner:'lord'|'farmer', mult:number };

export type EngineEvent = EventInit | EventBidEval | EventBid | EventAssign | EventPlay | EventResult;

const wait = (ms:number) => new Promise(res => setTimeout(res, ms));

export function sorted(labels: Label[]): Label[] {
  const order = '34567890JQKA2wW';
  const rank = (l:Label) => {
    const c = l[0];
    const i = order.indexOf(c);
    return i < 0 ? 0 : i;
  };
  return labels.slice().sort((a,b) => rank(a) - rank(b));
}

function countMap<T>(arr:T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of arr) m.set(x, (m.get(x)||0) + 1);
  return m;
}

export function hasBomb(hand: Label[]): boolean {
  const cm = countMap(hand.map(s => s[0] as any));
  for (const v of cm.values()) if (v >= 4) return true;
  const j = hand.filter(c => c[0] === 'w' || c[0] === 'W').length;
  if (j === 2) return true;
  return false;
}

export function evalRobScore(hand: Label[]): number {
  let score = 0;
  for (const c of hand) {
    const v = c[0];
    if (v === 'A') score += 0.6;
    else if (v === 'K' || v === 'Q' || v === 'J') score += 0.35;
    else if (v === '2') score += 0.8;
    else if (v === 'W' || v === 'w') score += 1.0;
  }
  if (hasBomb(hand)) score += 1.6;
  return +score.toFixed(2);
}

export type EngineOptions = {
  roundNo?: number;
  isFirstBidder?: boolean;
  delayMs?: number;
  ruleId?: string;
  thresholdChoice?: Record<string, number>;
  thresholdName?: Record<string, number>;
};

export type Deal = {
  hands: [Label[], Label[], Label[]];
  bottom: Label[];
};

export function dealStandard(): Deal {
  const deck = [
    '3a','3b','3c','3d','4a','4b','4c','4d','5a','5b','5c','5d',
    '6a','6b','6c','6d','7a','7b','7c','7d','8a','8b','8c','8d',
    '9a','9b','9c','9d','0a','0b','0c','0d','Ja','Jb','Jc','Jd',
    'Qa','Qb','Qc','Qd','Ka','Kb','Kc','Kd','Aa','Ab','Ac','Ad',
    '2a','2b','2c','2d','w','W'
  ];
  const arr = deck.slice();
  for (let i=arr.length-1;i>0;i--) { const j=(i*9301+49297)%233280 % (i+1); const t=arr[i]; arr[i]=arr[j]; arr[j]=t; }
  const h0:Label[] = []; const h1:Label[]=[]; const h2:Label[]=[]; const bottom:Label[]=[];
  for (let i=0;i<51;i++) {
    if (i%3===0) h0.push(arr[i]);
    else if (i%3===1) h1.push(arr[i]);
    else h2.push(arr[i]);
  }
  bottom.push(arr[51], arr[52], arr[53]);
  return { hands: [sorted(h0), sorted(h1), sorted(h2)], bottom };
}

export async function* playOneGame(bots: BotFunc[], options: EngineOptions = {}): AsyncGenerator<EngineEvent> {
  const { delayMs=0, roundNo=0, isFirstBidder=true } = options;

  const { hands, bottom } = dealStandard();
  yield { type:'event', kind:'init', hands } as EventInit;
  if (delayMs) await wait(delayMs);

  let multiplier = 1;
  const bidMultiplier = 1;
  const bidders: { seat:number; score:number; threshold:number; margin:number }[] = [];
  const order: number[] = isFirstBidder ? [0,1,2] : [1,2,0];
  let lordSeat = -1;

  async function decideBid(seat:number, phase:'first-round'|'second-round'): Promise<{decision:'bid'|'pass', score:number, threshold:number, reason?:string}> {
    const hand = hands[seat];
    const bidCtx: BidCtx = {
      hand,
      position: seat,
      roundNo,
      isFirstBidder: (phase==='first-round' ? (order[0]===seat) : undefined),
      previousBids: bidders.map(b => ({ seat: b.seat, decision: (b.margin>=0?'bid':'pass'), score: b.score })),
      phase,
      currentMultiplier: multiplier
    };

    let decisionFromExternal: BidDecision | null = null;
    let sc = evalRobScore(hand);
    let usedThreshold: number | undefined = undefined;
    let reason: string | undefined = undefined;

    try {
      const botAny = bots[seat] as BotFunc & ExternalBidder;
      if (botAny && typeof (botAny as any).bid === 'function') {
        const maybe = await Promise.resolve((botAny as any).bid(bidCtx));
        if (maybe && typeof maybe === 'object' && ('kind' in (maybe as any)) && ((maybe as any).kind==='bid' || (maybe as any).kind==='pass')) {
          decisionFromExternal = maybe as BidDecision;
          if (typeof decisionFromExternal.score === 'number') sc = decisionFromExternal.score as number;
          if (typeof decisionFromExternal.threshold === 'number') usedThreshold = decisionFromExternal.threshold as number;
          reason = decisionFromExternal.reason;
        }
      }
    } catch (e) {
      console.warn('[engine] external bid error seat', seat, e);
      const botAny = bots[seat] as Partial<ExternalBidder>;
      const label =
        (botAny?.name && String(botAny.name).trim()) ||
        (botAny?.choice && String(botAny.choice).trim()) ||
        '';
      const prefix = label ? `[${label}] ` : '';
      const message = (() => {
        if (!e) return 'external bidder exception';
        if (typeof e === 'string') return e;
        const maybe = (e as any).message;
        if (typeof maybe === 'string' && maybe.trim()) return maybe;
        try {
          return JSON.stringify(e);
        } catch (_err) {
          return String(e);
        }
      })();
      reason = `${prefix}${message}，已回退`;
    }

    if (usedThreshold === undefined) {
      const thChoice = options.thresholdChoice || { '': 1.8 };
      const thName   = options.thresholdName   || { '': 1.8 };
      const anyBot = bots[seat] as Partial<ExternalBidder>;
      const choice = String(anyBot?.choice || '').toLowerCase();
      const name   = String(anyBot?.name   || '').toLowerCase();
      usedThreshold = (thChoice as any)[choice] ?? (thName as any)[name] ?? 1.8;
    }

    const decision: 'bid'|'pass' = decisionFromExternal ? decisionFromExternal.kind : (sc >= (usedThreshold || 0) ? 'bid' : 'pass');
    return { decision, score: sc, threshold: usedThreshold || 0, reason };
  }

  // round 1
  for (const s of order) {
    const r = await decideBid(s, 'first-round');
    yield { type:'event', kind:'bid-eval', seat: s, score: r.score, threshold: r.threshold, decision: r.decision, reason: r.reason } as EventBidEval;
    if (delayMs) await wait(delayMs);

    if (r.decision === 'bid') {
      bidders.push({ seat: s, score: r.score, threshold: r.threshold, margin: r.score - r.threshold });
      multiplier = Math.min(64, Math.max(1, multiplier * 2));
    }
    yield { type:'event', kind:'bid', seat: s, bid: r.decision==='bid', score: r.score, bidMult: bidMultiplier, mult: multiplier, reason: r.reason } as EventBid;
    if (delayMs) await wait(delayMs);
  }

  if (bidders.length === 1) {
    lordSeat = bidders[0].seat;
  } else if (bidders.length >= 2) {
    const secondOrder = order.filter(s => bidders.find(b => b.seat === s));
    const bidders2: { seat:number; score:number; threshold:number; margin:number }[] = [];
    for (const s of secondOrder) {
      const r2 = await decideBid(s, 'second-round');
      yield { type:'event', kind:'bid-eval', seat: s, score: r2.score, threshold: r2.threshold, decision: r2.decision, reason: r2.reason } as EventBidEval;
      if (delayMs) await wait(delayMs);

      if (r2.decision === 'bid') {
        bidders2.push({ seat: s, score: r2.score, threshold: r2.threshold, margin: r2.score - r2.threshold });
        multiplier = Math.min(64, Math.max(1, multiplier * 2));
      }
      yield { type:'event', kind:'bid', seat: s, bid: r2.decision==='bid', score: r2.score, bidMult: bidMultiplier, mult: multiplier, reason: r2.reason } as EventBid;
      if (delayMs) await wait(delayMs);
    }
    const pool = (bidders2.length>0? bidders2 : bidders);
    pool.sort((a,b)=> (b.margin - a.margin) || (b.score - a.score));
    lordSeat = pool[0].seat;
  } else {
    lordSeat = order[0];
  }

  const lordHand = hands[lordSeat].concat(bottom);
  hands[lordSeat] = sorted(lordHand);
  yield { type:'event', kind:'assign-lord', seat: lordSeat, bottom, mult: multiplier } as EventAssign;
  if (delayMs) await wait(delayMs);

  // --- play stub ---
  for (let turn = 0; turn < 3; turn++) {
    const s = (lordSeat + turn) % 3;
    const bot = bots[s];
    const mv = await Promise.resolve(bot({ hand: hands[s], position: s }));
    if (mv && mv.move === 'play') {
      yield { type:'event', kind:'play', seat: s, move:'play', cards: mv.cards, reason: mv.reason } as EventPlay;
    } else {
      yield { type:'event', kind:'play', seat: s, move:'pass', reason: mv?.reason || 'stub' } as EventPlay;
    }
    if (delayMs) await wait(delayMs);
  }

  yield { type:'event', kind:'result', winner:'lord', mult: multiplier } as EventResult;
}

// Example bots
export const exampleExternalAIBot: BotFunc & ExternalBidder = Object.assign(
  (async (ctx: BotCtx): Promise<BotMove> => {
    const mv: BotMove = { move: 'pass', reason: 'demo external bot' } as const;
    return mv;
  }) as BotFunc,
  {
    bid: async (ctx: BidCtx): Promise<BidDecision> => {
      const score = evalRobScore(ctx.hand);
      const threshold = 2.0;
      const kd: 'bid'|'pass' = (score >= threshold || hasBomb(ctx.hand)) ? 'bid' : 'pass';
      return { kind: kd, score, threshold, reason: kd==='bid'
        ? `外部AI：score=${score.toFixed(2)} >= ${threshold} 或存在炸弹`
        : `外部AI：score=${score.toFixed(2)} < ${threshold}`
      };
    },
    name: 'exampleExternalAIBot',
    choice: 'external-llm'
  }
);

export const simpleRuleBot: BotFunc & ExternalBidder = Object.assign(
  (async (ctx: BotCtx): Promise<BotMove> => {
    const mv: BotMove = { move: 'pass' } as const;
    return mv;
  }) as BotFunc,
  {
    bid: async (ctx: BidCtx): Promise<BidDecision> => {
      const score = evalRobScore(ctx.hand);
      const th = 1.8;
      const decision: 'bid'|'pass' = (score >= th) ? 'bid' : 'pass';
      return { kind: decision, score, threshold: th, reason: 'simple rule' };
    },
    name: 'simpleRule',
    choice: 'rule'
  }
);


// ---- Compatibility shims ----

// Run the game to completion and collect all events (compat with legacy `runOneGame` API)
export async function runOneGame(bots: BotFunc[], options: EngineOptions = {}): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for await (const ev of playOneGame(bots, options)) {
    events.push(ev);
  }
  return events;
}

// Common bot aliases for compatibility with previous imports
export const GreedyMax  = exampleExternalAIBot;
export const GreedyMin  = simpleRuleBot;
export const RandomLegal = simpleRuleBot;

const aliasBot = (
  base: BotFunc & ExternalBidder,
  meta: Partial<ExternalBidder>
): BotFunc & ExternalBidder =>
  Object.assign(
    (async (ctx: BotCtx): Promise<BotMove> => base(ctx)) as BotFunc,
    { ...base, ...meta }
  );

export const AllySupport = aliasBot(simpleRuleBot, {
  name: 'allySupport',
  choice: 'ally-support'
});

export const EndgameRush = aliasBot(simpleRuleBot, {
  name: 'endgameRush',
  choice: 'endgame-rush'
});


// ---- Legacy type compatibility ----
export type Four2Policy =
  | 'both'           // 双方都可使用“四带二”
  | 'lord-only'      // 仅地主
  | 'farmer-only'    // 仅农民
  | 'none'           // 禁用
  | 'first'          // 旧项目里的别名，等价于允许
  | 'second'         // 旧项目里的别名
  | 'all';           // 旧项目里的别名
