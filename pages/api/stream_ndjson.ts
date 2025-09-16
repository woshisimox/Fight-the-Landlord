// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/** ===== 工具 & 流写入（包含 flush()） ===== */
function writeLine(res: NextApiResponse, obj: any) {
  (res as any).write(JSON.stringify(obj) + '\n');
  try {
    (res as any).flush?.();
  } catch {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randInt = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** ===== 牌面生成 ===== */
const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'] as const;
function buildDeck(): string[] {
  const d: string[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(`${s}${r}`);
  d.push('🃏X', '🃏Y'); // 54
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

/** ===== 雷达图统计分（0~5） ===== */
type Score5 = { coop: number; agg: number; cons: number; eff: number; rob: number };
const clamp5 = (x: number) => Math.max(0, Math.min(5, x));
function toScaledScore(rec: { play: number; pass: number }, role: 'landlord' | 'farmer'): Score5 {
  const total = Math.max(1, rec.play + rec.pass);
  const passRate = rec.pass / total;
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

/** ===== Seat 规格（包含 DeepSeek） ===== */
type SeatSpec =
  | { choice: 'built-in:greedy-max' | 'built-in:greedy-min' | 'built-in:random-legal' }
  | { choice: 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'; model?: string; apiKey?: string }
  | { choice: 'http'; model?: string; baseUrl?: string; token?: string };

/** ===== 一局模拟 ===== */
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

  hands[landlord].push(...bottom);
  writeLine(res, { type: 'hands', landlord, hands });

  // 行动计数 & 局内 stats 发送器
  const rec = [
    { play: 0, pass: 0 },
    { play: 0, pass: 0 },
    { play: 0, pass: 0 },
  ];
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

  // 轮流出牌 / 过牌
  let cur = landlord;
  let actions = randInt(20, 48);
  for (let step = 0; step < actions; step++) {
    if (Math.random() < 0.12 && step > 0) {
      writeLine(res, { type: 'event', kind: 'trick-reset' });
      emitStatsLite('stats-lite/coop-v3(trick-reset)');
    }

    const seat = cur;

    writeLine(res, {
      type: 'event',
      kind: 'bot-call',
      seat,
      by: seats[seat]?.choice || 'built-in:greedy-min',
      model: (seats[seat] as any)?.model || '',
      phase: 'play',
      need: 'choose-move',
    });

    const think = Math.max(0, Number(seatDelayMs[seat]) || 0);
    await sleep(think);

    const doPlay = Math.random() < 0.7 && hands[seat].length > 0;
    if (doPlay) {
      const k = Math.min(hands[seat].length, pick([1, 1, 1, 2, 2, 3]));
      const idxs = new Set<number>();
      while (idxs.size < k) idxs.add(randInt(0, hands[seat].length - 1));
      const cards = [...idxs].map((i) => hands[seat][i]);
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

    const totalActs = rec[0].play + rec[0].pass + rec[1].play + rec[1].pass + rec[2].play + rec[2].pass;
    if (totalActs % 3 === 0) {
      emitStatsLite('stats-lite/coop-v3(tick)');
    }

    if (hands[seat].length === 0) break;
    cur = (cur + 1) % 3;
  }

  // 结算
  const sizes = hands.map((h) => h.length);
  let winner = landlord;
  for (let i = 0; i < 3; i++) if (sizes[i] < sizes[winner]) winner = i;

  const multiplier = pick([1, 1, 2, 2, 3]);

  const farmers = [0, 1, 2].filter((x) => x !== landlord);
  const landlordWin = winner === landlord;
  let deltaScores: [number, number, number];
  if (landlordWin) deltaScores = [2 * multiplier, -1 * multiplier, -1 * multiplier];
  else deltaScores = [-2 * multiplier, 1 * multiplier, 1 * multiplier];

  emitStatsLite('stats-lite/coop-v3(final)');

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
      rob = true,
      four2 = 'both',
      seats = [{ choice: 'built-in:greedy-min' }, { choice: 'built-in:greedy-max' }, { choice: 'built-in:random-legal' }] as SeatSpec[],
      clientTraceId = '',
      stopBelowZero = false,
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
