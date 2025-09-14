// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Four2Policy = 'both' | '2singles' | '2pairs';

type SeatSpec =
  | { choice: 'built-in:greedy-max' | 'built-in:greedy-min' | 'built-in:random-legal' }
  | { choice: 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'; model?: string; apiKey?: string }
  | { choice: 'http'; model?: string; baseUrl?: string; token?: string }
  | { choice: string; [k: string]: any };

type Body = {
  rounds?: number;
  startScore?: number;
  enabled?: boolean;
  rob?: boolean;
  four2?: Four2Policy;
  seats: SeatSpec[];
  clientTraceId?: string;
  seatDelayMs?: number[]; // 不必传给引擎（有的引擎不支持）；前端自己做节流即可
  stopBelowZero?: boolean;
  // farmerCoop?: boolean; // ❌ 不传给 runOneGame，避免类型不匹配编译错误
};

type Ndjson = Record<string, any>;

function write(res: NextApiResponse, obj: Ndjson) {
  res.write(JSON.stringify(obj) + '\n');
}

function tryLoadEngine() {
  // 动态兜底：谁存在就用谁
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const e = require('../../lib/engine');
    if (e?.runOneGame) return e;
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const e = require('../../lib/doudizhu/engine');
    if (e?.runOneGame) return e;
  } catch {}
  return null;
}

/** —— 简易“理由生成器”：根据上下文给出可读解释 —— */
type TrickCtx = {
  leaderSeat: number | null;
  lastComboType: string | null;
  lastCards: string[] | null;
};
function reasonForMove(
  move: 'play' | 'pass',
  cards: string[] | undefined,
  comboType: string | undefined,
  seat: number,
  landlord: number | null,
  multiplier: number,
  trick: TrickCtx
) {
  const role = landlord === seat ? '地主' : '农民';
  const phase = trick.leaderSeat === null || trick.lastComboType === null ? 'lead' : 'response';

  if (move === 'pass') {
    if (phase === 'lead') {
      return `选择过：无须跟压（${role}），保留手牌等待更好进攻时机。`;
    }
    return `选择过：当前无法在不炸的前提下压住上家，保留关键牌型（${role}，倍数x${multiplier}）。`;
  }

  // 出牌
  const ct = comboType || 'unknown';
  const size = cards?.length ?? 0;
  const head =
    phase === 'lead'
      ? `主动出牌（${role}）`
      : `跟牌压制${trick.lastComboType ? `（上家：${trick.lastComboType}）` : ''}`;

  let detail = '';
  if (ct === 'rocket') detail = '火箭必然最大，用于强制取得主动。';
  else if (ct === 'bomb') detail = '炸弹可控翻倍并改写牌权。';
  else if (ct.includes('straight')) detail = '顺子/连对有助于快速走牌，减少手牌长度。';
  else if (ct.includes('triple')) detail = '三带结构牌力稳定，兼顾进攻与过牌压力。';
  else if (ct === 'pair') detail = '对子做基础交换，保持手型连贯。';
  else if (ct === 'single') detail = '单张探路/消耗牌权，避免暴露强牌。';
  else detail = '按同类牌型压制，保持牌权连续性。';

  return `${head}：出 ${ct}${size ? `（${size}张）` : ''}。${detail}`;
}

/** —— very lite 的“画像统计”：只做占位，前端就能更新雷达图 —— */
function makeRoundStats(perSeatCount: { bombs: number; rockets: number; passes: number; leads: number }[]) {
  return {
    type: 'event',
    kind: 'stats',
    perSeat: perSeatCount.map((c, seat) => {
      const scaled = {
        // 0~5：随意做个单调映射（可按需替换成真实统计）
        coop: Math.min(5, 2.5 + Math.max(0, 2 - c.passes) * 0.4),
        agg: Math.min(5, 2.0 + (c.bombs * 0.9 + c.rockets * 1.2)),
        cons: Math.min(5, 3.0 + Math.max(0, c.passes - 1) * 0.6),
        eff: Math.min(5, 2.5 + c.leads * 0.3),
        rob: Math.min(5, 2.5), // 这里不基于抢地主计，保持中性
      };
      return { seat, scaled };
    }),
  };
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body: Body = (req.body || {}) as Body;
  const {
    rounds = 1,
    seats = [],
    enabled = true,
    rob = true,
    four2 = 'both',
    startScore = 0,
    clientTraceId = Math.random().toString(36).slice(2),
  } = body;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.status(200);

  write(res, { type: 'log', message: `[server] stream open | trace=${clientTraceId}` });

  if (!enabled) {
    write(res, { type: 'log', message: '[server] disabled' });
    res.end();
    return;
  }

  const engine = tryLoadEngine();
  if (!engine?.runOneGame) {
    write(res, { type: 'log', message: '[server] engine_not_found: 需要 lib/engine 或 lib/doudizhu/engine 提供 runOneGame()' });
    res.end();
    return;
  }

  let finished = 0;

  // —— TrueSkill（可选：若你的引擎已经会发 ts 事件，这里仅透传；否则这里也可以自己发 before/after）——
  let tsRatings = [
    { mu: 25, sigma: 25 / 3, cr: 0 },
    { mu: 25, sigma: 25 / 3, cr: 0 },
    { mu: 25, sigma: 25 / 3, cr: 0 },
  ];

  outer: while (finished < rounds) {
    // 每局的上下文，用于产生解释与画像
    const trick: TrickCtx = { leaderSeat: null, lastComboType: null, lastCards: null };
    let landlord: number | null = null;
    let multiplier = 1;
    const perSeatCount = [
      { bombs: 0, rockets: 0, passes: 0, leads: 0 },
      { bombs: 0, rockets: 0, passes: 0, leads: 0 },
      { bombs: 0, rockets: 0, passes: 0, leads: 0 },
    ];

    // ——（可选）在开局前把当前 TS 发给前端（你的前端会显示）——
    write(res, { type: 'ts', where: 'before-round', round: finished + 1, ratings: tsRatings });

    // 注意：只传**引擎支持的字段**，避免 TS 报 “Object literal may only specify known properties”
    const opts: any = {
      seats, // 你现有后端就是用 seats 规格自行构造 bot；这里**不包一层**，保持兼容
      rob,
      four2,
      // 不再传 farmerCoop/seatDelayMs 等未在类型里的字段
    };

    let iter: AsyncIterable<any> | Iterable<any>;
    try {
      iter = engine.runOneGame(opts);
    } catch (e: any) {
      write(res, { type: 'log', message: `[server] runOneGame error: ${e?.message || e}` });
      break;
    }

    for await (const ev of iter as any) {
      // 1) 原样透传引擎事件
      write(res, ev);

      // 2) 维护少量上下文
      if (ev?.type === 'state' && (ev.kind === 'init' || ev.kind === 'reinit')) {
        landlord = typeof ev.landlord === 'number' ? ev.landlord : landlord;
      }
      if (ev?.type === 'event' && ev.kind === 'rob' && ev.multiplier) {
        multiplier = ev.multiplier;
      }
      if (ev?.type === 'event' && ev.kind === 'trick-reset') {
        trick.leaderSeat = null;
        trick.lastComboType = null;
        trick.lastCards = null;
      }
      if (ev?.type === 'event' && ev.kind === 'play') {
        const seat = ev.seat as number;
        const move = ev.move as 'play' | 'pass';
        const comboType: string | undefined = ev.comboType;
        const cards: string[] | undefined = ev.cards;

        if (trick.leaderSeat === null) {
          trick.leaderSeat = seat;
          if (move === 'play') perSeatCount[seat].leads += 1;
        }

        if (move === 'play') {
          if (comboType === 'bomb') perSeatCount[seat].bombs += 1;
          if (comboType === 'rocket') perSeatCount[seat].rockets += 1;
          trick.lastComboType = comboType || trick.lastComboType;
          trick.lastCards = cards || trick.lastCards;
        } else {
          perSeatCount[seat].passes += 1;
        }

        // 3) ✨ 注入“策略理由”事件（前端会展示）
        const reason = reasonForMove(move, cards, comboType, seat, landlord, multiplier, trick);
        const strategy = {
          phase: trick.leaderSeat === seat ? 'lead' : trick.leaderSeat === null ? 'lead' : 'response',
          role: landlord === seat ? 'landlord' : 'farmer',
          comboType: comboType || (move === 'pass' ? 'none' : 'unknown'),
          cards,
          observed: {
            lastComboType: trick.lastComboType,
            lastCards: trick.lastCards,
            landlord,
            multiplier,
          },
        };
        write(res, {
          type: 'event',
          kind: 'bot-done',
          seat,
          by: 'server/reasoner',
          model: 'post-hoc/heuristic@1',
          tookMs: 0,
          reason,
          strategy,
        });
      }

      // 4) 终局
      if (ev?.type === 'event' && ev.kind === 'win') {
        // —— 可选占位画像（让你的雷达图每局都能动起来）
        write(res, makeRoundStats(perSeatCount));

        finished += 1;
        // ——（可选）这里也可以根据 ev.winner/角色做 TrueSkill 更新，然后写入一条 after-round 的 ts 事件

        if (finished >= rounds) break;
        // 继续 for-await 直到迭代器自然结束（通常 win 后就结束）
      }
    }

    // 保险：一局迭代自然结束
    write(res, { type: 'event', kind: 'round-end', round: finished, seenWin: true, seenStats: true });

    if (finished >= rounds) break outer;
  }

  res.end();
}
