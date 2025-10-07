


// === Bid-by-threshold (Plan B): shared bidScore + per-bot thresholds ===
// 统一用 evalRobScore(hand) 评估（不含底牌），不同算法用不同阈值决定是否抢

// 按 choice 字符串的阈值（stream 层常见的 choice）
const BID_THRESHOLDS: Record<string, number> = {
  'built-in:greedy-max':   1.6,
  'built-in:ally-support': 1.8,
  'built-in:random-legal': 2.0,
  'built-in:endgame-rush': 2.1,
  'built-in:mininet':      2.2,
  'built-in:greedy-min':   2.4,
};

// 按函数名/构造名的阈值（engine 里通常只能拿到 bot 函数本体）
const NAME_THRESHOLDS: Record<string, number> = {
  'greedymax':   1.6,
  'allysupport': 1.8,
  'randomlegal': 2.0,
  'endgamerush': 2.1,
  'mininet':     2.2,
  'greedymin':   2.4,
};

function __bidThresholdFor(botOrChoice: any): number {
  try {
    // 1) 若能拿到 choice 字符串，优先按 choice 查表
    const choice = typeof botOrChoice === 'string'
      ? botOrChoice
      : (botOrChoice?.choice || botOrChoice?.name || '');
    if (choice) {
      const key = String(choice).toLowerCase();
      if (BID_THRESHOLDS[key] != null) return BID_THRESHOLDS[key] as number;
    }

    // 2) 引擎层通常拿到的是 bot 函数，回退用 name/constructor.name
    const nm = String(botOrChoice?.name || botOrChoice?.constructor?.name || '').toLowerCase();
    if (nm && NAME_THRESHOLDS[nm] != null) return NAME_THRESHOLDS[nm] as number;
  } catch {}
  return 1.8; // 默认兜底
}

export function __decideRobByThreshold(bot: any, hand: any[]): { rob: boolean; score: number } {
  const score = evalRobScore(hand);            // 统一口径的 bidScore（不含底牌）
  const th = __bidThresholdFor(bot);
  const rob = Number.isFinite(score) ? (score >= th) : false;
  return { rob, score };
}

