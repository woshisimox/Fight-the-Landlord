// lib/bots/kimi_bot.ts
import { buildDouPrompts, extractFirstJsonObject, nonEmptyReason, PromptMode } from './util';

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
  const wait = Math.max(_next - now, _cooldownUntil - now);
  if (wait > 0) await sleep(wait);
  const jitter = DELAY_JITTER_MS > 0 ? Math.floor(Math.random() * DELAY_JITTER_MS) : 0;
  const base = Date.now() < _riskModeUntil ? BASE_DELAY_MS * RISK_DELAY_MULTIPLIER : BASE_DELAY_MS;
  _next = Date.now() + base + jitter;
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

const isContentFilterError = (error: any): boolean => {
  const message = String(error?.message || error || '').toLowerCase();
  const body = typeof error?.body === 'string' ? error.body.toLowerCase() : '';
  return /content[_-]?filter/.test(message) || /high risk/.test(message) || /content[_-]?filter/.test(body) || /high risk/.test(body);
};

const BASE_DELAY_MS = 2200;
const DELAY_JITTER_MS = 800;
const RISK_DELAY_MULTIPLIER = 2;
const HIGH_RISK_BACKOFF_MS = 12000;
const HIGH_RISK_WINDOW_MS = 5 * 60 * 1000;

let _cooldownUntil = 0;
let _riskModeUntil = 0;

async function requestKimi(
  o: { apiKey: string; model?: string; baseUrl?: string },
  ctx: BotCtx,
  phase: 'bid' | 'double' | 'play',
  mode: PromptMode
) {
  await throttle();
  const url = (o.baseUrl || 'https://api.moonshot.cn').replace(/\/$/, '') + '/v1/chat/completions';
  const { system, user } = buildDouPrompts(ctx, phase, mode);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model || 'moonshot-v1-8k',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
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
  let usedMode: PromptMode = 'normal';
  try {
    if (!o.apiKey) throw new Error('Missing Kimi API Key');
    const phase = ((ctx as any)?.phase || 'play') as 'bid' | 'double' | 'play';

    const exec = async (mode: PromptMode) => requestKimi(o, ctx, phase, mode);

    const preferSafe = Date.now() < _riskModeUntil;
    const attempts: PromptMode[] = preferSafe ? ['safe', 'minimal'] : ['normal', 'safe', 'minimal'];
    let lastErr: any;
    let result;
    for (const mode of attempts) {
      try {
        const r = await exec(mode);
        usedMode = mode;
        result = r;
        break;
      } catch (err) {
        if (isContentFilterError(err)) {
          flagged = true;
          lastErr = err;
          const now = Date.now();
          _cooldownUntil = Math.max(_cooldownUntil, now + HIGH_RISK_BACKOFF_MS);
          _riskModeUntil = Math.max(_riskModeUntil, now + HIGH_RISK_WINDOW_MS);
          continue;
        }
        throw err;
      }
    }
    if (!result) throw lastErr || new Error('Kimi 请求失败');

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
    if (flagged) {
      const warn = usedMode === 'safe' ? 'content-filter-safe' : usedMode === 'minimal' ? 'content-filter-minimal' : 'content-filter-retry';
      (move as any).warning = warn;
    }
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
