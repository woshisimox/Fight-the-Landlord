// lib/doudizhu/engine.ts
// ⚠️ 这是一个“最小可编译”占位实现，用于修复你意外覆盖导致的编译错误。
// 目的是先让项目恢复运行与 UI 调试；之后你可以再替换为完整斗地主引擎。

export type Four2Policy = 'both' | '2singles' | '2pairs';
export type Label = string;
export type BotMove =
  | { move: 'pass'; reason?: string }
  | { move: 'play'; cards: Label[]; reason?: string };
export type BotCtx = { hands: Label[]; require?: any; canPass: boolean; policy?: any };
export type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

// 简易 bot：能过就过，否则打出第一张（保证流程继续）
export const RandomLegal: BotFunc = (ctx) =>
  ctx.canPass ? { move: 'pass' } : { move: 'play', cards: [ctx.hands[0] || '3'] };
export const GreedyMax: BotFunc = RandomLegal;
export const GreedyMin: BotFunc = RandomLegal;

// 一个极简的发牌：把一副小牌均匀分给 3 家（仅为 UI 调试，不是完整规则）
function dealSimple(): Label[][] {
  const deck: Label[] = [
    '3','3','4','4','5','5','6','6','7','7','8','8','9','9','10','10',
    'J','J','Q','Q','K','K','A','A','2','2','x','X'
  ];
  const hands: Label[][] = [[], [], []];
  let p = 0;
  for (const c of deck) { hands[p].push(c); p = (p + 1) % 3; }
  return hands;
}

// 运行一局（极简版）：发牌 → 轮流出单牌/过 → 给出胜者与积分
export async function* runOneGame(opts: {
  seats: [BotFunc, BotFunc, BotFunc] | BotFunc[];
  delayMs?: number;
  rob?: boolean;
  four2?: Four2Policy;
}): AsyncGenerator<any, void, unknown> {
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const bots: BotFunc[] = Array.from(opts.seats as BotFunc[]);
  const hands = dealSimple();
  const landlord = 0;

  // 初始化（前端会据此实时显示手牌与花色）
  yield { type:'state', kind:'init', landlord, hands };

  // 简单轮流出牌 12 次（仅演示用）
  let turn = 0;
  for (let step = 0; step < 12; step++) {
    const ctx: BotCtx = { hands: hands[turn], require: null, canPass: true, policy: {} };
    const res = await Promise.resolve(bots[turn](ctx));

    if (res.move === 'play' && Array.isArray(res.cards) && res.cards.length) {
      // 扣牌
      for (const c of res.cards) {
        const i = hands[turn].indexOf(c);
        if (i >= 0) hands[turn].splice(i, 1);
      }
      yield { type:'event', kind:'play', seat: turn, move:'play', cards: res.cards, comboType: 'single' };
    } else {
      yield { type:'event', kind:'play', seat: turn, move:'pass', reason: res.reason };
    }

    if (opts.delayMs && opts.delayMs > 0) await wait(opts.delayMs);
    turn = (turn + 1) % 3;
  }

  // 结束（演示用积分变化）
  const delta: [number, number, number] = [ +10, -5, -5 ];
  yield { type:'event', kind:'win', winner: landlord, multiplier: 1, deltaScores: delta };
}
