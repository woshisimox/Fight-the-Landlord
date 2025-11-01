// lib/bots/kimi_bot.ts
import { extractFirstJsonObject, nonEmptyReason } from './util';

type BotMove =
  | { phase?: 'play'; move: 'pass'; reason?: string }
  | { phase?: 'play'; move: 'play'; cards: string[]; reason?: string }
  | { phase: 'bid'; bid: boolean; reason?: string }
  | { phase: 'double'; double: boolean; reason?: string };
type BotCtx = { hands: string[]; require?: any; canPass: boolean; policy?: any; phase?: 'play'|'bid'|'double'; bid?: any; double?: any };
type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

// 简易兜底（当上游 API 出错时）：
// - 若允许过牌：直接过牌
// - 否则：打出第一张手牌（可能不是最优，但可让引擎继续运行）
function fallbackMove(ctx: BotCtx, reason: string): BotMove {
  if ((ctx as any)?.phase === 'bid') {
    const info: any = (ctx as any)?.bid || {};
    const rec = (typeof info.recommended === 'boolean') ? !!info.recommended : !!info.default;
    return { phase: 'bid', bid: rec, reason: nonEmptyReason(reason, 'Kimi') };
  }
  if ((ctx as any)?.phase === 'double') {
    const info: any = (ctx as any)?.double || {};
    const rec = (typeof info.recommended === 'boolean') ? !!info.recommended : !!info.default;
    return { phase: 'double', double: rec, reason: nonEmptyReason(reason, 'Kimi') };
  }
  if (ctx && ctx.canPass) return { move: 'pass', reason };
  const first = Array.isArray(ctx?.hands) && ctx.hands.length ? ctx.hands[0] : '3';
  return { phase: 'play', move: 'play', cards: [first], reason };
}


type UsagePayload = { totalTokens: number; promptTokens?: number; completionTokens?: number };

let _next = 0;
const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));
async function throttle(){
  const now = Date.now();
  const wait = _next - now;
  if (wait > 0) await sleep(wait);
  _next = Date.now() + 2200;
}

function parseUsage(raw: any): UsagePayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const total = Number((raw.total_tokens ?? raw.totalTokens ?? NaN));
  if (!Number.isFinite(total) || total <= 0) return undefined;
  const prompt = Number((raw.prompt_tokens ?? raw.promptTokens ?? NaN));
  const completion = Number((raw.completion_tokens ?? raw.completionTokens ?? NaN));
  const usage: UsagePayload = { totalTokens: total };
  if (Number.isFinite(prompt) && prompt >= 0) usage.promptTokens = prompt;
  if (Number.isFinite(completion) && completion >= 0) usage.completionTokens = completion;
  return usage;
}

const attachUsage = <T extends BotMove>(move: T, usage?: UsagePayload): T => {
  if (usage) (move as any).usage = usage;
  return move;
};

type PromptMode = 'normal' | 'safe';

const trimSeen = (value: string[], max = 180) => {
  if (!Array.isArray(value) || !value.length) return '无';
  const joined = value.join('');
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
};

function buildUserPrompt(
  ctx: BotCtx,
  phase: 'bid' | 'double' | 'play',
  mode: PromptMode
): string {
  const handsStr = Array.isArray(ctx?.hands) ? ctx.hands.join('') : '';
  const seenArr = Array.isArray((ctx as any)?.seen) ? (ctx as any).seen : [];
  const seenBySeat = Array.isArray((ctx as any)?.seenBySeat) ? (ctx as any).seenBySeat : [[], [], []];
  const seatLineNormal = `座位：我=${(ctx as any).seat} 地主=${(ctx as any).landlord} 首家=${(ctx as any).leader} 轮次=${(ctx as any).trick}`;
  const seatLineSafe = `Seat info: self=${(ctx as any).seat} landlord=${(ctx as any).landlord} lead=${(ctx as any).leader} turn=${(ctx as any).trick}`;
  const seatLine = mode === 'safe' ? seatLineSafe : seatLineNormal;

  if (phase === 'bid') {
    const info = (ctx as any)?.bid || {};
    const score = typeof info.score === 'number' ? info.score.toFixed(2) : (mode === 'safe' ? 'unknown' : '未知');
    const mult = typeof info.multiplier === 'number' ? info.multiplier : (typeof info.bidMultiplier === 'number' ? info.bidMultiplier : 1);
    const attempt = typeof info.attempt === 'number' ? info.attempt + 1 : 1;
    const total = typeof info.maxAttempts === 'number' ? info.maxAttempts : 5;
    const bidders = Array.isArray(info.bidders)
      ? info.bidders.map((b: any) => `S${b.seat}`).join(',')
      : (mode === 'safe' ? 'none' : '无');
    if (mode === 'safe') {
      return [
        'You are a harmless assistant for the Dou Dizhu card game. Reply with a strict JSON object only.',
        '{"phase":"bid","bid":true|false,"reason":"short note"}',
        `Hand: ${handsStr}`,
        `HeuristicScore: ${score}｜Multiplier: ${mult}｜Bidders: ${bidders}`,
        `Attempt: ${attempt}/${total}`,
        seatLine,
        'Answer with JSON only. bid=true means take the landlord role.'
      ].join('\n');
    }
    return [
      '你是斗地主决策助手，目前阶段是抢地主。必须只输出一个 JSON 对象：{"phase":"bid","bid":true|false,"reason":"简要说明"}。',
      `手牌：${handsStr}`,
      `启发分参考：${score}｜当前倍数：${mult}｜已抢座位：${bidders}`,
      `这是第 ${attempt}/${total} 次尝试，请结合手牌、顺位与公共信息，自主判断是否抢地主，并给出简要理由。`,
      seatLine,
      '回答必须是严格的 JSON，bid=true 表示抢地主，false 表示不抢。'
    ].join('\n');
  }

  if (phase === 'double') {
    const info = (ctx as any)?.double || {};
    const role = info?.role || (mode === 'safe' ? 'farmer' : 'farmer');
    const base = typeof info?.baseMultiplier === 'number' ? info.baseMultiplier : 1;
    const farmerInfo = info?.info?.farmer || {};
    const landlordInfo = info?.info?.landlord || {};
    const dLhat = typeof farmerInfo.dLhat === 'number' ? farmerInfo.dLhat.toFixed(2) : (mode === 'safe' ? 'unknown' : '未知');
    const counter = typeof farmerInfo.counter === 'number' ? farmerInfo.counter.toFixed(2) : (mode === 'safe' ? 'unknown' : '未知');
    const delta = typeof landlordInfo.delta === 'number' ? landlordInfo.delta.toFixed(2) : undefined;
    if (mode === 'safe') {
      return [
        'You are a harmless assistant for the Dou Dizhu card game. Reply with JSON only.',
        '{"phase":"double","double":true|false,"reason":"short note"}',
        `Role: ${role}｜BaseMultiplier: ${base}`,
        (role !== 'landlord' ? `Farmer heuristics Δ̂=${dLhat}｜counter=${counter}` : ''),
        (role === 'landlord' && delta ? `Landlord bonus delta≈${delta}` : ''),
        seatLine,
        'Return strict JSON. double=true means double the multiplier.'
      ].filter(Boolean).join('\n');
    }
    return [
      '你是斗地主决策助手，目前阶段是明牌后的加倍决策。必须只输出一个 JSON 对象：{"phase":"double","double":true|false,"reason":"简要说明"}。',
      `角色：${role}｜基础倍数：${base}`,
      role === 'landlord' && delta ? `地主底牌增益Δ≈${delta}` : '',
      role !== 'landlord' ? `估计Δ̂=${dLhat}｜counter=${counter}` : '',
      '请结合公开信息与手牌，自主判断是否加倍，并给出简要理由。',
      seatLine,
      '回答必须是严格的 JSON，double=true 表示加倍，false 表示不加倍。'
    ].filter(Boolean).join('\n');
  }

  const requirement = ctx.require ? JSON.stringify(ctx.require) : 'null';
  const seen0 = trimSeen(seenBySeat[0] || []);
  const seen1 = trimSeen(seenBySeat[1] || []);
  const seen2 = trimSeen(seenBySeat[2] || []);
  if (mode === 'safe') {
    return [
      'You are helping with the Chinese card game Dou Dizhu. Keep responses safe and only output JSON.',
      '{"move":"play|pass","cards":["A","A"],"reason":"short note"}',
      `Hand: ${handsStr}`,
      `RequiredPlay: ${requirement}`,
      `MayPass: ${ctx.canPass ? 'true' : 'false'}`,
      `PolicyHint: ${ctx.policy}`,
      seatLine,
      `SeenBySeat: S0=${seen0} | S1=${seen1} | S2=${seen2}`,
      `SeenAll: ${trimSeen(seenArr)}`,
      'Choose only legal combinations. Reply with strict JSON and stay within the family-friendly context of this card game.'
    ].join('\n');
  }
  return [
    '你是斗地主出牌助手。必须只输出一个 JSON 对象：',
    '{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }',
    `手牌：${handsStr}`,
    `需跟：${requirement}`,
    '点数大小：3<4<5<6<7<8<9<T<J<Q<K<A<2<x<X（2 大于 K）',
    `可过：${ctx.canPass ? 'true' : 'false'}`,
    `策略：${ctx.policy}`,
    seatLine,
    `按座位已出牌：S0=${seen0} | S1=${seen1} | S2=${seen2}`,
    `已出牌：${trimSeen(seenArr)}`,
    '只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。请仅返回严格的 JSON：{"move":"play"|"pass","cards":string[],"reason":string}。'
  ].join('\n');
}

const isContentFilterError = (error: any): boolean => {
  const message = String(error?.message || error || '').toLowerCase();
  const body = typeof error?.body === 'string' ? error.body.toLowerCase() : '';
  return /content[_-]?filter/.test(message) || /high risk/.test(message) || /content[_-]?filter/.test(body) || /high risk/.test(body);
};

async function requestKimi(
  o: { apiKey: string; model?: string; baseUrl?: string },
  ctx: BotCtx,
  phase: 'bid' | 'double' | 'play',
  mode: PromptMode
) {
  await throttle();
  const url = (o.baseUrl || 'https://api.moonshot.cn').replace(/\/$/, '') + '/v1/chat/completions';
  const userPrompt = buildUserPrompt(ctx, phase, mode);
  const systemPrompt =
    mode === 'safe'
      ? 'You are a safe assistant for a friendly Dou Dizhu card game. Only reply with a strict JSON object describing the move.'
      : 'Only reply with a strict JSON object for the move.';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model || 'moonshot-v1-8k',
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  if (!r.ok) {
    const text = await r.text();
    const err: any = new Error(`HTTP ${r.status} ${text.slice(0, 200)}`);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  const j: any = await r.json();
  const usage = parseUsage(j?.usage);
  const t = j?.choices?.[0]?.message?.content || '';
  const p: any = extractFirstJsonObject(String(t)) || {};
  return { payload: p, usage };
}

export const KimiBot = (o: { apiKey: string; model?: string; baseUrl?: string }): BotFunc => async (ctx: BotCtx) => {
  let flagged = false;
  try {
    if (!o.apiKey) throw new Error('Missing Kimi API Key');
    const phase = ((ctx as any)?.phase || 'play') as 'bid' | 'double' | 'play';

    const exec = async (mode: PromptMode) => requestKimi(o, ctx, phase, mode);

    let result;
    try {
      result = await exec('normal');
    } catch (err) {
      if (isContentFilterError(err)) {
        flagged = true;
        result = await exec('safe');
      } else {
        throw err;
      }
    }

    const { payload: p, usage } = result;

    if (phase === 'bid') {
      if (typeof p.bid === 'boolean') {
        return attachUsage({ phase: 'bid', bid: !!p.bid, reason: nonEmptyReason(p.reason, 'Kimi') }, usage);
      }
      if (p.move === 'pass') return attachUsage({ phase: 'bid', bid: false, reason: nonEmptyReason(p.reason, 'Kimi') }, usage);
      if (p.move === 'play') return attachUsage({ phase: 'bid', bid: true, reason: nonEmptyReason(p.reason, 'Kimi') }, usage);
      throw new Error('invalid bid response');
    }
    if (phase === 'double') {
      if (typeof p.double === 'boolean') {
        return attachUsage({ phase: 'double', double: !!p.double, reason: nonEmptyReason(p.reason, 'Kimi') }, usage);
      }
      if (typeof p.bid === 'boolean') {
        return attachUsage({ phase: 'double', double: !!p.bid, reason: nonEmptyReason(p.reason, 'Kimi') }, usage);
      }
      if (p.move === 'pass') return attachUsage({ phase: 'double', double: false, reason: nonEmptyReason(p.reason, 'Kimi') }, usage);
      if (p.move === 'play') return attachUsage({ phase: 'double', double: true, reason: nonEmptyReason(p.reason, 'Kimi') }, usage);
      throw new Error('invalid double response');
    }
    const m = p.move === 'pass' ? 'pass' : 'play';
    const cds: string[] = Array.isArray(p.cards) ? p.cards : [];
    const reason = nonEmptyReason(p.reason, 'Kimi');
    const move =
      m === 'pass'
        ? { phase: 'play', move: 'pass', reason }
        : { phase: 'play', move: 'play', cards: cds, reason };
    if (flagged) (move as any).warning = 'content-filter-retry';
    return attachUsage(move as any, usage);
  } catch (e: any) {
    const message = e?.message || e;
    const note = flagged
      ? '（触发内容审查后重试仍失败）'
      : '';
    const reason = `Kimi 调用失败${note}：${message}，已回退`;
    return fallbackMove(ctx, reason);
  }
};
