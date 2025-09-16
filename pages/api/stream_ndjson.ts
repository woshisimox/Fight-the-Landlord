// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/** ===== 工具 & 流写入（改动点 1：写完尝试 flush()） ===== */
function writeLine(res: NextApiResponse, obj: any) {
  (res as any).write(JSON.stringify(obj) + '\n');
  try {
    (res as any).flush?.(); // <— 改动点 1：强制把缓冲推给客户端，降低乱序/延迟
  } catch {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** ===== 牌面生成（无需严谨发牌，只要能驱动前端展示即可） ===== */
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'] as const;
// 小/大王按前端习惯：🃏X / 🃏Y
function buildDeck(): string[] {
  const d: string[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(`${s}${r}`);
  d.push('🃏X', '🃏Y'); // 54 张
  return d;
}
function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function deal(): { hands: string[][]; bottom: string[] } {
  const deck = buildDeck();
  shuffle(deck);
  const hands = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)];
  const bottom = deck.slice(51);
  return { hands, bottom };
}

/** ===== 统计分（雷达图 5 维），范围 0~5 ===== */
type Score5 = { coop: number; agg: number; cons: number; eff: number; rob: number };
const clamp5 = (x: number) => Math.max(0, Math.min(5, x));
function toScaledScore(rec: { play: number; pass: number }, role: 'landlord' | 'farmer'): Score5 {
  const total = Math.max(1, rec.play + rec.pass);
  const passRate = rec.pass / total;
  // 简单启发：农民配合看过牌适度、地主侵略性稍高、效率随出牌数增加等
  const base = role === 'landlord'
    ? { coop: 2.4, agg: 3.4, cons: 2.6, eff: 2.8, rob: 3.2 }
    : { coop: 3.2, agg: 2.6, cons: 3.0, eff: 2.6, rob: 2.2 };
  return {
    coop: clamp5(base.coop + (role === 'farmer' ? 1.0 * (0.5 - Math.abs(passRate - 0.35)) : -0.3 * passRate)),
    agg : clamp5(base.agg  + (rec.play * 0.05) - passRate * 0.6),
    cons: clamp5(base.cons + (passRate * 1.2) - rec.play * 0.02),
    eff : clamp5(base.eff  + (rec.play * 0.03) + (Math.random() * 0.4 - 0.2)),
    rob : clamp5(base.rob  + (role === 'landlord' ? 0.6 : -0.4) + (Math.random() * 0.3 - 0.15)),
  };
}

/** ===== 一局的 NDJSON 模拟器 ===== */
type SeatSpec =
  | { choice: 'built-in:greedy-max' | 'built-in:greedy-min' | 'built-in:random-legal' }
  | { choice: 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'; model?: string; apiKey?: string }
  | { choice: 'http'; model?: string; baseUrl?: string; token?: string };

async function playOneRound(opts: {
  res: NextApiResponse;
  roundNo: number;
  seatDelayMs?: number[];
  seats: SeatSpec[];
  farmerCoop: boolean;
}) {
  const { res, roundNo, seatDelayMs = [200, 200, 200], seats, farmerCoop } = opts;

  writeLine(res, { type: 'event', kind: 'round-start', round: roundNo });

  // 发牌
  const { hands, bottom } = deal();
  const landlord = randInt(0, 2);
  writeLine(res, { type: 'log', message: `开始第 ${roundNo} 局（模拟）` });
  writeLine(res, {
    type: 'log',
    message: `发牌完成，${['甲','乙','丙'][landlord]} 为地主；底牌：${bottom.join(' ')}`,
  });
  writeLine(res, { type: 'event', kind: 'rob', seat: landlord, rob: true });
  writeLine(res, { type: 'event', kind: 'rob', seat: (landlord + 1) % 3, rob: false });
  writeLine(res, { type: 'event', kind: 'rob', seat: (landlord + 2) % 3, rob: false });

  // 把底牌给地主
  hands[landlord].push(...bottom);
  writeLine(res, { type: 'hands', landlord, hands });

  // 行动计数，用于“每 3 次行动发一条 stats”
  const rec = [
    { play: 0, pass: 0 },
    { play: 0, pass: 0 },
    { play: 0, pass: 0 },
  ];

  // —— 局内 stats 发送器（改动点 2：tick/trick-reset 时也发） —— //
  const emitStatsLite = (source: string) => {
    const perSeat = [0, 1, 2].map((i) => {
      const role = i === landlord ? 'landlord' : 'farmer';
      return { seat: i, scaled: toScaledScore(rec[i], role as any) };
    });
    writeLine(res, {
      type: 'event',
      kind: 'stats',
      round: roundNo,
      landlord,
      source,
      perSeat,
    });
  };

  // 轮流出牌 / 过牌，模拟 20~48 步；偶尔 trick-reset
  let cur = landlord;
  let actions = randInt(20, 48);
  for (let step = 0; step < actions; step++) {
    // —— 可选：模拟“一个圈结束”，触发 trick-reset —— //
    if (Math.random() < 0.12 && step > 0) {
      writeLine(res, { type: 'event', kind: 'trick-reset' });
      emitStatsLite('stats-lite/coop-v3(trick-reset)'); // 改动点 2B：trick-reset 也来一条
    }

    const seat = cur;

    // （插槽）真实 AI/HTTP 调用，可在此处按 seats[seat] 接入；这里保持事件节奏即可
    writeLine(res, {
      type: 'event',
      kind: 'bot-call',
      seat,
      by: seats[seat]?.choice || 'built-in:greedy-min',
      model: (seats[seat] as any)?.model || '',
      phase: 'play',
      need: 'choose-move',
    });

    // 用 seatDelayMs 模拟“思考耗时”
    const think = Math.max(0, Number(seatDelayMs[seat]) || 0);
    await sleep(think);

    // 简单动作：70% 出牌、30% 过
    const doPlay = Math.random() < 0.7 && hands[seat].length > 0;
    if (doPlay) {
      // 出 1~3 张（随机），尽量从手里移除
      const k = Math.min(hands[seat].length, pick([1, 1, 1, 2, 2, 3]));
      const idxs = new Set<number>();
      while (idxs.size < k) idxs.add(randInt(0, hands[seat].length - 1));
      const cards = [...idxs].map((i) => hands[seat][i]);
      // 从手里删掉
      const removeSet = new Set(cards);
      const rest: string[] = [];
      let removed = 0;
      for (const c of hands[seat]) {
        if (removeSet.has(c) && removed < cards.length) {
          removed++;
        } else rest.push(c);
      }
      hands[seat] = rest;

      writeLine(res, { type: 'event', kind: 'play', seat, move: 'play', cards, reason: '模拟:贪心可行解' });
      rec[seat].play++;
    } else {
      writeLine(res, { type: 'event', kind: 'play', seat, move: 'pass', reason: '模拟:无更优牌' });
      rec[seat].pass++;
    }

    // “AI 完成”事件（带耗时）
    writeLine(res, {
      type: 'event',
      kind: 'bot-done',
      seat,
      by: seats[seat]?.choice || 'built-in:greedy-min',
      model: (seats[seat] as any)?.model || '',
      tookMs: think,
      phase: 'play',
      reason: doPlay ? 'found-legal' : 'skip',
    });

    // —— 改动点 2A：每 3 次行动必发一条 tick stats，确保前端见到 —— //
    const totalActs = rec[0].play + rec[0].pass + rec[1].play + rec[1].pass + rec[2].play + rec[2].pass;
    if (totalActs % 3 === 0) {
      emitStatsLite('stats-lite/coop-v3(tick)');
    }

    // 若某家出完牌则提前结束
    if (hands[seat].length === 0) break;

    cur = (cur + 1) % 3;
  }

  // —— 判定胜负 & 结算 —— //
  // 胜者：谁的牌最少；若并列，优先地主
  const sizes = hands.map((h) => h.length);
  let winner = landlord;
  for (let i = 0; i < 3; i++) if (sizes[i] < sizes[winner]) winner = i;

  // 倍数
  const multiplier = pick([1, 1, 2, 2, 3]);

  // deltaScores（相对“地主视角”的顺序：0=地主，1=农民A，2=农民B）
  const farmers = [0, 1, 2].filter((x) => x !== landlord);
  const landlordWin = winner === landlord;
  let deltaScores: [number, number, number];
  if (landlordWin) deltaScores = [2 * multiplier, -1 * multiplier, -1 * multiplier];
  else deltaScores = [-2 * multiplier, 1 * multiplier, 1 * multiplier];

  // 局末最终 stats（带 scaled 5 维）：前端会拿这条做累计
  emitStatsLite('stats-lite/coop-v3(final)');

  // 胜负 & round-end
  writeLine(res, {
    type: 'result',
    round: roundNo,
    winner,
    landlord,
    multiplier,
    deltaScores,
  });
  writeLine(res, { type: 'event', kind: 'round-end', round: roundNo });
}

/** ===== API Handler ===== */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 关闭缓存，保持流式输出
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // @ts-ignore
  res.flushHeaders?.();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const {
      rounds = 1,
      startScore = 0,
      seatDelayMs = [200, 200, 200],
      enabled = true,
      rob = true,              // 未用，但保留接口
      four2 = 'both',          // 未用，但保留接口
      seats = [{ choice: 'built-in:greedy-min' }, { choice: 'built-in:greedy-max' }, { choice: 'built-in:random-legal' }] as SeatSpec[],
      clientTraceId = '',
      stopBelowZero = false,   // 未用，但保留接口
      farmerCoop = true,
    } = body;

    writeLine(res, { type: 'log', message: `接收请求：rounds=${rounds} startScore=${startScore} trace=${clientTraceId}` });

    if (!enabled) {
      writeLine(res, { type: 'log', message: '未启用对局，退出。' });
      res.end();
      return;
    }

    for (let i = 0; i < rounds; i++) {
      await playOneRound({
        res,
        roundNo: i + 1,
        seatDelayMs,
        seats,
        farmerCoop,
      });
    }
  } catch (err: any) {
    writeLine(res, { type: 'log', message: `服务端错误：${err?.message || err}` });
  } finally {
    try {
      res.end();
    } catch {}
  }
}
