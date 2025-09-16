// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/* ---------------- NDJSON 输出保障 ---------------- */
function startStream(res: NextApiResponse) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  // @ts-ignore
  if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();
}
function emit(res: NextApiResponse, obj: any) {
  try {
    res.write(JSON.stringify(obj) + '\n');
    // @ts-ignore
    if (typeof (res as any).flush === 'function') (res as any).flush();
  } catch (e) {
    console.error('[ndjson emit failed]', e);
  }
}

/* ---------------- 类型，与前端一致 ---------------- */
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
  seatDelayMs?: number[];
  enabled?: boolean;
  rob?: boolean;
  four2?: Four2Policy;
  seats: SeatSpec[];
  clientTraceId?: string;
  stopBelowZero?: boolean;
  farmerCoop?: boolean;
};

/* ---------------- 牌组/发牌（点数无花色） ---------------- */
const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
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
  for (let r = 0; r < 13; r++) deck.push(RANKS[r], RANKS[r], RANKS[r], RANKS[r]);
  deck.push('x', 'X');
  const cards = shuffled(deck);
  const hands = [cards.slice(0, 17), cards.slice(17, 34), cards.slice(34, 51)];
  const bottom = cards.slice(51);
  return { hands, bottom };
}

/* ---------------- 简化：只出单张的候选 ---------------- */
function generateLegalSingles(hand: string[], need?: { type?: string }) {
  // 仅示范：允许任意单张；若有跟牌规则可在此约束
  return hand.map((c) => [c]);
}
function removeFromHand(hand: string[], cards: string[]) {
  const h = hand.slice();
  for (const c of cards) {
    const i = h.indexOf(c);
    if (i >= 0) h.splice(i, 1);
  }
  return h;
}

/* ---------------- 内置策略 ---------------- */
const scoreCard = (c: string) => RANKS.indexOf(c);
function pickGreedy(legal: string[][], mode: 'max' | 'min') {
  if (!legal.length) return null;
  return mode === 'max'
    ? legal.reduce((best, cur) => (scoreCard(cur[0]) > scoreCard(best[0]) ? cur : best))
    : legal.reduce((best, cur) => (scoreCard(cur[0]) < scoreCard(best[0]) ? cur : best));
}
function pickRandom(legal: string[][]) {
  if (!legal.length) return null;
  return legal[(Math.random() * legal.length) | 0];
}

/* ---------------- 通用：对外协议与校验 ---------------- */
type AiDecision = { action: 'play' | 'pass'; cards?: string[] | null };
function validateDecision(dec: AiDecision, legal: string[][]): { move: 'play'|'pass'; cards?: string[] } {
  if (!dec || (dec.action !== 'play' && dec.action !== 'pass')) return { move: 'pass' };
  if (dec.action === 'pass') return { move: 'pass' };
  const want = Array.isArray(dec.cards) ? dec.cards : [];
  if (want.length === 0) return { move: 'pass' };
  // 允许：完全字符串匹配（按点数）；或长度=1 时只看第一张
  const legalStrs = legal.map(a => JSON.stringify(a));
  if (legalStrs.includes(JSON.stringify(want))) return { move: 'play', cards: want };
  // 宽松：若 want[0] 出现在某个候选里，取那一组（单张场景等价）
  const hit = legal.find(a => a[0] === want[0]);
  if (hit) return { move: 'play', cards: hit };
  return { move: 'pass' };
}

/* ---------------- 各提供方的实际调用 ---------------- */
async function callOpenAI(model: string, apiKey: string, payload: any) {
  const sys = `You are a DouDiZhu (Chinese Fighting the Landlord) playing engine. 
Given JSON state with {seat, role, landlord, hand, legal, need}, choose a legal move.
Return JSON ONLY as: {"action":"play"|"pass","cards":["..."]}. Do not include extra text.`;
  const user = JSON.stringify(payload);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content ?? '';
  return JSON.parse(txt);
}

async function callDeepSeek(model: string, apiKey: string, payload: any) {
  const sys = `You are a DouDiZhu playing engine. Choose a legal move. Output pure JSON.`;
  const user = JSON.stringify(payload);
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const j = await res.json();
  const txt = j?.choices?.[0]?.message?.content ?? '';
  return JSON.parse(txt);
}

async function callHttp(baseUrl: string, token: string | undefined, payload: any) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/* ---------------- Provider 决策 ---------------- */
async function decideByProvider(
  res: NextApiResponse,
  seat: number,
  spec: SeatSpec,
  hand: string[],
  legal: string[][],
  trickNeed: { type?: string } | undefined,
  landlord: number,
  seatDelayMs: number
): Promise<{ move: 'play' | 'pass'; cards?: string[]; reason?: string; tookMs: number; by: string; model?: string }> {
  const by = spec.choice;
  const model =
    (spec as any).model ||
    (spec.choice === 'ai:openai' ? 'gpt-4o-mini' :
     spec.choice === 'ai:deepseek' ? 'deepseek-chat' :
     spec.choice === 'http' ? (spec as any).model || 'http-bot' : '');

  emit(res, { type: 'event', kind: 'bot-call', seat, by, model, phase: 'play', need: trickNeed?.type || null });

  const payload = {
    seat,
    role: seat === landlord ? 'landlord' : 'farmer',
    landlord,
    hand,
    legal,     // 像 [["3"],["4"],...]
    need: trickNeed?.type || null,
    hint: 'Return JSON ONLY: {"action":"play"|"pass","cards":["..."]}',
  };

  const t0 = Date.now();
  let decision: AiDecision | null = null;
  try {
    if (by === 'ai:openai' && (spec as any).apiKey) {
      decision = await callOpenAI(model, (spec as any).apiKey!, payload);
    } else if (by === 'ai:deepseek' && (spec as any).apiKey) {
      decision = await callDeepSeek(model, (spec as any).apiKey!, payload);
    } else if (by === 'http' && (spec as any).baseUrl) {
      decision = await callHttp((spec as any).baseUrl!, (spec as any).token, payload);
    }
  } catch (e: any) {
    emit(res, { type: 'log', message: `AI 调用异常（${by}）：${e?.message || e}` });
  }

  // 统一注入“思考时间”
  if (seatDelayMs && seatDelayMs > 0) {
    await new Promise((r) => setTimeout(r, seatDelayMs));
  }
  const tookMs = Date.now() - t0;

  // 若无返回或非法，做兜底（随机/贪心等）
  let move: 'play' | 'pass' = 'pass';
  let cards: string[] | undefined;
  let reason = '';

  if (decision) {
    const norm = validateDecision(decision, legal);
    move = norm.move;
    cards = norm.cards;
    reason = `来自 ${by}${model ? `:${model}` : ''} 的决定`;
    if (move === 'pass') reason += '（或无效→pass）';
  } else {
    // 兜底策略：优先 Greedy-Min（锚定基线），否则随机
    const fallback = pickGreedy(legal, 'min') || pickRandom(legal);
    if (fallback) {
      move = 'play';
      cards = fallback;
      reason = '兜底：Greedy-Min/Random';
    } else {
      move = 'pass';
      reason = '兜底：无可出 → pass';
    }
  }

  emit(res, {
    type: 'event',
    kind: 'bot-done',
    seat,
    by,
    model,
    tookMs,
    reason: move === 'play' ? `出 ${cards!.join(' ')}` : 'pass',
  });

  return { move, cards, reason, tookMs, by, model };
}

/* ---------------- 统一决策入口（内置/AI/HTTP） ---------------- */
async function decideMove(
  res: NextApiResponse,
  seat: number,
  spec: SeatSpec,
  hand: string[],
  trickNeed: { type?: string } | undefined,
  landlord: number,
  seatDelayMs: number
) {
  const legal = generateLegalSingles(hand, trickNeed);

  if (spec.choice.startsWith('built-in')) {
    emit(res, { type: 'event', kind: 'bot-call', seat, by: spec.choice, model: undefined, phase: 'play', need: trickNeed?.type || null });
    const t0 = Date.now();
    if (seatDelayMs && seatDelayMs > 0) await new Promise((r) => setTimeout(r, seatDelayMs));
    const pick =
      spec.choice === 'built-in:greedy-max' ? pickGreedy(legal, 'max')
      : spec.choice === 'built-in:greedy-min' ? pickGreedy(legal, 'min')
      : pickRandom(legal);
    const tookMs = Date.now() - t0;
    const move: 'play' | 'pass' = pick ? 'play' : 'pass';
    emit(res, { type: 'event', kind: 'bot-done', seat, by: spec.choice, model: undefined, tookMs, reason: pick ? `选择 ${pick.join(' ')}` : '无合法 → pass' });
    return { move, cards: pick || undefined, reason: pick ? '内置策略' : '无牌可接', tookMs, by: spec.choice, model: undefined };
  }

  // AI / HTTP
  return decideByProvider(res, seat, spec, hand, legal, trickNeed, landlord, seatDelayMs);
}

/* ---------------- 战术画像（示范） ---------------- */
function perSeatStatsSample() {
  const clamp = (x: number) => +(Math.max(0, Math.min(5, x)).toFixed(2));
  const rnd = () => clamp(2.5 + (Math.random() - 0.5) * 1.2);
  return [0, 1, 2].map((s) => ({ seat: s, scaled: { coop: rnd(), agg: rnd(), cons: rnd(), eff: rnd(), rob: rnd() } }));
}

/* ---------------- 单局主循环 ---------------- */
async function runOneRound(
  res: NextApiResponse,
  roundIndex: number,
  cfg: Required<Pick<StartBody, 'seatDelayMs' | 'rob' | 'four2' | 'seats' | 'farmerCoop'>>,
  traceId?: string
) {
  emit(res, { type: 'event', kind: 'round-start', round: roundIndex + 1, traceId });

  // 发牌
  const { hands: rawHands, bottom } = dealHands();
  let landlord = 0;

  if (cfg.rob) {
    for (let s = 0; s < 3; s++) {
      const rob = Math.random() < 0.5;
      emit(res, { type: 'event', kind: 'rob', seat: s, rob });
      await new Promise((r) => setTimeout(r, 100));
      if (rob) { landlord = s; break; }
    }
  }
  const hands = rawHands.map((h, i) => (i === landlord ? h.concat(bottom) : h.slice()));
  emit(res, { hands, landlord });

  // 出牌循环（示范：仅单张）
  let cur = landlord;
  let need: { type?: string } | undefined = undefined;
  let trickCount = 0;
  let emittedStatsSince = 0;

  while (true) {
    const spec = cfg.seats[cur] || { choice: 'built-in:random-legal' as BotChoice };
    const delay = cfg.seatDelayMs[cur] ?? 0;

    const { move, cards, reason } = await decideMove(res, cur, spec as any, hands[cur], need, landlord, delay);

    if (move === 'pass') {
      emit(res, { type: 'event', kind: 'play', seat: cur, move: 'pass', reason });
      trickCount++;
    } else {
      const picked = (cards || []).slice();
      hands[cur] = removeFromHand(hands[cur], picked);
      emit(res, { type: 'event', kind: 'play', seat: cur, move: 'play', cards: picked, reason });
      need = { type: 'single' };
      trickCount++;
    }

    emittedStatsSince++;
    if (emittedStatsSince >= 3) {
      emit(res, { type: 'stats', perSeat: perSeatStatsSample() });
      emittedStatsSince = 0;
    }

    // 胜负
    if (hands[cur].length === 0) {
      const L = landlord;
      const winner = cur;

      // 简单计分（与前端对齐：deltaScores[0] 是地主的相对分，农民在 1/2）
      const deltaScores = [0, 0, 0] as [number, number, number];
      if (winner === L) {
        deltaScores[0] = +2; deltaScores[1] = -1; deltaScores[2] = -1;
      } else {
        deltaScores[0] = -2;
        const f1 = (L + 1) % 3, f2 = (L + 2) % 3;
        if (winner === f1) { deltaScores[1] = +2; deltaScores[2] = 0; }
        else { deltaScores[1] = 0; deltaScores[2] = +2; }
      }
      const multiplier = 1;

      emit(res, { type: 'result', winner, landlord: L, deltaScores, multiplier });
      emit(res, { type: 'event', kind: 'round-end', round: roundIndex + 1 });
      break;
    }

    if (trickCount % 3 === 0) {
      need = undefined;
      emit(res, { type: 'event', kind: 'trick-reset' });
    }

    cur = (cur + 1) % 3;
  }
}

/* ---------------- API 入口 ---------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = (req.body || {}) as StartBody;
  const rounds = Math.max(1, Math.floor(Number(body.rounds ?? 1)));
  const seatDelayMs: number[] = Array.isArray(body.seatDelayMs) && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0, 0, 0];
  const seats: SeatSpec[] = (Array.isArray(body.seats) ? body.seats : []).slice(0, 3) as any;
  const rob = Boolean(body.rob);
  const four2: Four2Policy = (body.four2 as any) || 'both';
  const farmerCoop = Boolean(body.farmerCoop);
  const enabled = body.enabled !== false;
  const traceId = body.clientTraceId || '';

  if (!enabled) return res.status(200).json({ ok: true, message: 'disabled' });

  startStream(res);
  emit(res, { type: 'log', message: `开始：共 ${rounds} 局｜trace=${traceId}｜rob=${rob}｜four2=${four2}｜coop=${farmerCoop}` });

  try {
    for (let i = 0; i < rounds; i++) {
      await runOneRound(res, i, {
        seatDelayMs,
        rob,
        four2,
        seats: (seats.length === 3 ? seats : [
          { choice: 'built-in:greedy-max' },
          { choice: 'built-in:greedy-min' },
          { choice: 'built-in:random-legal' },
        ]) as any,
        farmerCoop,
      }, traceId);
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (e: any) {
    emit(res, { type: 'log', message: `异常：${e?.message || e}` });
  } finally {
    emit(res, { type: 'log', message: '—— 流结束 ——' });
    res.end();
  }
}
