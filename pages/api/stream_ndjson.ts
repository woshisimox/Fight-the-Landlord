// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/* ---------------------- 工具：NDJSON 输出保障 ---------------------- */
function startStream(res: NextApiResponse) {
  // 明确告知是流式 NDJSON
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 一些代理/平台会基于 Transfer-Encoding: chunked 自动分块
  });
  // @ts-ignore
  if (typeof (res as any).flushHeaders === 'function') {
    // @ts-ignore
    (res as any).flushHeaders();
  }
}

/** 统一写出：始终在每个 JSON 后追加 '\n'，并尽量 flush */
function emit(res: NextApiResponse, obj: any) {
  try {
    const line = JSON.stringify(obj) + '\n';
    res.write(line);
    // @ts-ignore
    if (typeof (res as any).flush === 'function') (res as any).flush();
  } catch (e) {
    // 静默处理写出异常，避免中断服务
    console.error('[ndjson emit failed]', e);
  }
}

/* ---------------------- 类型定义（与前端对齐） ---------------------- */
type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai'
  | 'ai:gemini'
  | 'ai:grok'
  | 'ai:kimi'
  | 'ai:qwen'
  | 'ai:deepseek'
  | 'http';

type SeatSpec =
  | { choice: 'built-in:greedy-max' | 'built-in:greedy-min' | 'built-in:random-legal' }
  | { choice: 'ai:openai'; model: string; apiKey?: string }
  | { choice: 'ai:gemini'; model: string; apiKey?: string }
  | { choice: 'ai:grok'; model: string; apiKey?: string }
  | { choice: 'ai:kimi'; model: string; apiKey?: string }
  | { choice: 'ai:qwen'; model: string; apiKey?: string }
  | { choice: 'ai:deepseek'; model: string; apiKey?: string }
  | { choice: 'http'; model?: string; baseUrl?: string; token?: string };

type StartBody = {
  rounds?: number;
  startScore?: number;
  seatDelayMs?: number[]; // 3 个座位延时
  enabled?: boolean;
  rob?: boolean;
  four2?: Four2Policy;
  seats: SeatSpec[]; // 3 个
  clientTraceId?: string;
  stopBelowZero?: boolean;
  farmerCoop?: boolean;
};

/* ---------------------- 简易牌面/发牌（维持与前端的“无花色”约定） ---------------------- */
const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X']; // x: 小王, X: 大王

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealHands() {
  const deck: string[] = [];
  // 4 副花色的 3~A 与 2（计 4 张），但我们前端会自动“加花色装饰”，
  // 这里就只放点数（重复 4 次），外加大小王各 1。
  for (let r = 0; r < 13; r++) {
    deck.push(RANKS[r], RANKS[r], RANKS[r], RANKS[r]);
  }
  deck.push('x', 'X');
  const cards = shuffled(deck);
  // 经典斗地主：发 17 张 * 3，底牌 3 张，加给地主
  const hands = [cards.slice(0, 17), cards.slice(17, 34), cards.slice(34, 51)];
  const bottom = cards.slice(51);
  return { hands, bottom };
}

/* ---------------------- 合法动作（非常简化：仅示范兼容 NDJSON） ---------------------- */
function generateLegalSingles(hand: string[], need?: { type?: string }): string[][] {
  // 仅示范：如果需要跟牌且类型是 single，就从手里找任一单张；否则首出最小单张。
  const singles = hand.map((c) => [c]);
  return singles.length ? singles : [];
}

function removeFromHand(hand: string[], cards: string[]): string[] {
  const h = hand.slice();
  for (const c of cards) {
    const i = h.indexOf(c);
    if (i >= 0) h.splice(i, 1);
  }
  return h;
}

/* ---------------------- 内置策略（示范）：Greedy Max / Min / Random ---------------------- */
function chooseByGreedy(hand: string[], legal: string[][], mode: 'max' | 'min') {
  if (!legal.length) return null;
  // 简化：max 选“点数大”的一张（按照 RANKS 顺序），min 选“点数小”的一张
  const score = (card: string) => RANKS.indexOf(card);
  const pick = mode === 'max'
    ? legal.reduce((best, cur) => (score(cur[0]) > score(best[0]) ? cur : best))
    : legal.reduce((best, cur) => (score(cur[0]) < score(best[0]) ? cur : best));
  return pick;
}
function chooseByRandom(legal: string[][]) {
  if (!legal.length) return null;
  return legal[(Math.random() * legal.length) | 0];
}

/* ---------------------- AI/HTTP 占位（事件完整，便于前端日志/耗时显示） ---------------------- */
async function decideByProvider(
  seat: number,
  spec: SeatSpec,
  hand: string[],
  trickNeed: { type?: string } | undefined,
  legal: string[][],
  seatDelayMs: number,
  emitLog: (obj: any) => void
): Promise<{ move: 'play' | 'pass'; cards?: string[]; reason?: string; tookMs: number; by: string; model?: string }> {
  const by = spec.choice;
  const model =
    (spec as any).model ||
    (spec.choice === 'ai:openai' ? 'gpt-4o-mini' :
     spec.choice === 'ai:gemini' ? 'gemini-1.5-flash' :
     spec.choice === 'ai:grok' ? 'grok-2' :
     spec.choice === 'ai:kimi' ? 'kimi-k2' :
     spec.choice === 'ai:qwen' ? 'qwen-plus' :
     spec.choice === 'ai:deepseek' ? 'deepseek-chat' :
     spec.choice === 'http' ? (spec as any).model || 'http-bot' : '');

  // 发出调用事件
  emitLog({
    type: 'event',
    kind: 'bot-call',
    seat,
    by,
    model,
    phase: 'play',
    need: trickNeed?.type || null,
  });

  const t0 = Date.now();

  // —— 这里可以接你现有的 LLM/HTTP 推理 —— //
  // 为了保证无钥匙也能跑通，默认退化为“合法中随机 + 延时 seatDelayMs”
  await new Promise((r) => setTimeout(r, Math.max(0, seatDelayMs || 0)));

  let cards: string[] | undefined;
  if (legal.length) {
    cards = chooseByRandom(legal) || undefined;
  } else {
    cards = undefined;
  }

  const tookMs = Date.now() - t0;

  // 完成事件（含理由）
  emitLog({
    type: 'event',
    kind: 'bot-done',
    seat,
    by,
    model,
    tookMs,
    reason: cards ? `选出 ${cards.join(' ')}` : '无合法可出，过',
  });

  return { move: cards ? 'play' : 'pass', cards, reason: cards ? '随机可行解' : '无牌可接', tookMs, by, model };
}

/* ---------------------- 统一决策入口：内置 / AI / HTTP ---------------------- */
async function decideMove(
  seat: number,
  spec: SeatSpec,
  hand: string[],
  trickNeed: { type?: string } | undefined,
  seatDelayMs: number,
  emitLog: (obj: any) => void
): Promise<{ move: 'play' | 'pass'; cards?: string[]; reason?: string; tookMs: number; by: string; model?: string }> {
  const legal = generateLegalSingles(hand, trickNeed);

  if (spec.choice === 'built-in:greedy-max' || spec.choice === 'built-in:greedy-min' || spec.choice === 'built-in:random-legal') {
    // 内置也走“bot-call/bot-done”事件，并尊重 seatDelayMs，避免显示为 0ms
    emitLog({ type: 'event', kind: 'bot-call', seat, by: spec.choice, model: undefined, phase: 'play', need: trickNeed?.type || null });
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, Math.max(0, seatDelayMs || 0)));
    let pick: string[] | null = null;
    if (spec.choice === 'built-in:greedy-max') pick = chooseByGreedy(hand, legal, 'max');
    else if (spec.choice === 'built-in:greedy-min') pick = chooseByGreedy(hand, legal, 'min');
    else pick = chooseByRandom(legal);
    const tookMs = Date.now() - t0;
    const move: 'play' | 'pass' = pick ? 'play' : 'pass';
    emitLog({
      type: 'event',
      kind: 'bot-done',
      seat,
      by: spec.choice,
      model: undefined,
      tookMs,
      reason: pick ? `选择 ${pick.join(' ')}` : '无合法可出，过',
    });
    return { move, cards: pick || undefined, reason: pick ? '内置策略' : '无牌可接', tookMs, by: spec.choice, model: undefined };
  }

  // AI / HTTP
  return decideByProvider(seat, spec, hand, trickNeed, legal, seatDelayMs, emitLog);
}

/* ---------------------- 战术画像（示范） ---------------------- */
function perSeatStatsSample(): { seat: number; scaled: { coop: number; agg: number; cons: number; eff: number; rob: number } }[] {
  const rnd = () => +(Math.max(0, Math.min(5, 2.5 + (Math.random() - 0.5) * 1.2)).toFixed(2));
  return [0, 1, 2].map((s) => ({ seat: s, scaled: { coop: rnd(), agg: rnd(), cons: rnd(), eff: rnd(), rob: rnd() } }));
}

/* ---------------------- 主流程：一局（极简兼容形状） ---------------------- */
async function runOneRound(
  res: NextApiResponse,
  roundIndex: number,
  cfg: Required<Pick<StartBody, 'seatDelayMs' | 'rob' | 'four2' | 'seats' | 'farmerCoop'>>,
  totals: number[],
  traceId?: string
) {
  emit(res, { type: 'event', kind: 'round-start', round: roundIndex + 1, traceId });

  // 发牌
  const { hands: rawHands, bottom } = dealHands();
  let landlord = 0;

  if (cfg.rob) {
    // 简易“抢地主”示意：顺序询问，遇到第一位“抢”则定地主；其余均“不抢”
    for (let s = 0; s < 3; s++) {
      const rob = Math.random() < 0.5;
      emit(res, { type: 'event', kind: 'rob', seat: s, rob });
      await new Promise((r) => setTimeout(r, 120));
      if (rob) {
        landlord = s;
        break;
      }
    }
  }

  // 地主拿底牌
  const hands = rawHands.map((h, i) => (i === landlord ? h.concat(bottom) : h.slice()));
  emit(res, { hands, landlord });

  // 出牌循环（示范：仅出单张，直到有人出完）
  let cur = landlord; // 地主先手
  let need: { type?: string } | undefined = undefined;
  let trickCount = 0;
  let emittedStatsSince = 0;

  // 帮助 emit：封装以保持 \n
  const log = (obj: any) => emit(res, obj);

  while (true) {
    const spec = cfg.seats[cur] || { choice: 'built-in:random-legal' as BotChoice };
    const tookCfg = cfg.seatDelayMs[cur] ?? 0;

    const { move, cards, reason } = await decideMove(cur, spec as any, hands[cur], need, tookCfg, log);

    if (move === 'pass') {
      emit(res, { type: 'event', kind: 'play', seat: cur, move: 'pass', reason });
      trickCount++;
    } else {
      // 真正把牌从手里移除
      const picked = (cards || []).slice();
      hands[cur] = removeFromHand(hands[cur], picked);
      emit(res, { type: 'event', kind: 'play', seat: cur, move: 'play', cards: picked, reason });
      need = { type: 'single' }; // 简化：本示例只有单张
      trickCount++;
    }

    // 每 3 次行动给一次战术画像（兼容前端“多 AI 参赛”节流逻辑）
    emittedStatsSince++;
    if (emittedStatsSince >= 3) {
      emit(res, { type: 'stats', perSeat: perSeatStatsSample() });
      emittedStatsSince = 0;
    }

    // 有人打光 -> 结束
    if (hands[cur].length === 0) {
      const winner = cur;
      // 简单的计分：地主胜则地主 +2，农民各 -1；农民胜则相反
      const deltaScores = [0, 0, 0];
      const L = landlord;
      if (winner === L) {
        deltaScores[0] = +2; // 以 L 为 0 位置的“相对”写法，前端会旋转
        deltaScores[1] = -1;
        deltaScores[2] = -1;
      } else {
        deltaScores[0] = -2;
        // 胜者是哪位农民：给胜者 +2，另一位 0（便于前端看差异）
        const f1 = (L + 1) % 3;
        const f2 = (L + 2) % 3;
        if (winner === f1) {
          deltaScores[1] = +2;
          deltaScores[2] = 0;
        } else {
          deltaScores[1] = 0;
          deltaScores[2] = +2;
        }
      }
      const multiplier = 1; // 可扩展炸弹、春天等倍数
      emit(res, {
        type: 'result',
        winner,
        landlord: L,
        deltaScores,
        multiplier,
      });
      emit(res, { type: 'event', kind: 'round-end', round: roundIndex + 1 });
      break;
    }

    // 简易“一轮”拆分：每 3 次行动视作一轮（演示 trick-reset）
    if (trickCount % 3 === 0) {
      need = undefined;
      emit(res, { type: 'event', kind: 'trick-reset' });
    }

    // 换下一位
    cur = (cur + 1) % 3;
  }
}

/* ---------------------- API 入口 ---------------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = (req.body || {}) as StartBody;

  // 基本参数
  const rounds = Math.max(1, Math.floor(Number(body.rounds ?? 1)));
  const seatDelayMs: number[] = Array.isArray(body.seatDelayMs) && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0, 0, 0];
  const seats: SeatSpec[] = (Array.isArray(body.seats) ? body.seats : []).slice(0, 3) as any;
  const rob = Boolean(body.rob);
  const four2: Four2Policy = (body.four2 as any) || 'both';
  const farmerCoop = Boolean(body.farmerCoop);
  const enabled = body.enabled !== false;
  const traceId = body.clientTraceId || '';

  if (!enabled) {
    return res.status(200).json({ ok: true, message: 'disabled' });
  }

  startStream(res);

  // 头部日志（便于排查）
  emit(res, {
    type: 'log',
    message: `开始：共 ${rounds} 局｜trace=${traceId}｜rob=${rob}｜four2=${four2}｜coop=${farmerCoop}`,
  });

  try {
    const totals = [Number(body.startScore || 0), Number(body.startScore || 0), Number(body.startScore || 0)];
    for (let i = 0; i < rounds; i++) {
      await runOneRound(
        res,
        i,
        {
          seatDelayMs,
          rob,
          four2,
          seats: (seats.length === 3 ? seats : [{ choice: 'built-in:greedy-max' }, { choice: 'built-in:greedy-min' }, { choice: 'built-in:random-legal' }]) as any,
          farmerCoop,
        },
        totals,
        traceId
      );
      // 轮间小停顿：更像真实流
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (e: any) {
    emit(res, { type: 'log', message: `异常：${e?.message || e}` });
  } finally {
    // 结束标记（可选）
    emit(res, { type: 'log', message: '—— 流结束 ——' });
    res.end(); // 关闭连接
  }
}
