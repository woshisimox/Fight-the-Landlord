// lib/bots/deepseek_bot.ts
import { buildDouPrompts, extractFirstJsonObject, nonEmptyReason, PromptMode } from './util';

type BotMove =
  | { phase?: 'play'; move: 'pass'; reason?: string }
  | { phase?: 'play'; move: 'play'; cards: string[]; reason?: string }
  | { phase: 'bid'; bid: boolean; reason?: string }
  | { phase: 'double'; double: boolean; reason?: string };
type BotCtx = { hands: string[]; require?: any; canPass: boolean; policy?: any; phase?: 'play'|'bid'|'double'; bid?: any; double?: any };
type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

function fallbackMove(ctx: BotCtx, reason: string): BotMove {
  if ((ctx as any)?.phase === 'bid') {
    const info: any = (ctx as any)?.bid || {};
    const rec = (typeof info.recommended === 'boolean') ? !!info.recommended : !!info.default;
    return { phase: 'bid', bid: rec, reason: nonEmptyReason(reason, 'DeepSeek') };
  }
  if ((ctx as any)?.phase === 'double') {
    const info: any = (ctx as any)?.double || {};
    const rec = (typeof info.recommended === 'boolean') ? !!info.recommended : !!info.default;
    return { phase: 'double', double: rec, reason: nonEmptyReason(reason, 'DeepSeek') };
  }
  if (ctx && ctx.canPass) return { move: 'pass', reason };
  const first = Array.isArray(ctx?.hands) && ctx.hands.length ? ctx.hands[0] : '3';
  return { phase: 'play', move: 'play', cards: [first], reason };
}

const BASE_DELAY_MS = 2000;
const DELAY_JITTER_MS = 700;
const RISK_DELAY_MULTIPLIER = 2;
const HIGH_RISK_BACKOFF_MS = 11000;
const RATE_LIMIT_BACKOFF_MS = 7000;
const HIGH_RISK_WINDOW_MS = 4 * 60 * 1000;

let _next = 0;
let _cooldownUntil = 0;
let _riskModeUntil = 0;

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function throttle() {
  const now = Date.now();
  const wait = Math.max(_next - now, _cooldownUntil - now);
  if (wait > 0) await sleep(wait);
  const jitter = DELAY_JITTER_MS > 0 ? Math.floor(Math.random() * DELAY_JITTER_MS) : 0;
  const base = Date.now() < _riskModeUntil ? BASE_DELAY_MS * RISK_DELAY_MULTIPLIER : BASE_DELAY_MS;
  _next = Date.now() + base + jitter;
}

type RetryKind = 'safety' | 'rate-limit';

function classifyError(error: any): RetryKind | null {
  const message = String(error?.message || error || '').toLowerCase();
  const body = typeof error?.body === 'string' ? error.body.toLowerCase() : '';
  if (/rate limit|too many requests|429/.test(message) || /rate limit|too many requests|429/.test(body)) {
    return 'rate-limit';
  }
  if (
    /content[_-]?filter|safety|risk|policy|sensitive/.test(message) ||
    /content[_-]?filter|safety|risk|policy|sensitive/.test(body)
  ) {
    return 'safety';
  }
  return null;
}

async function requestDeepseek(
  o: { apiKey: string; model?: string },
  ctx: BotCtx,
  phase: 'bid' | 'double' | 'play',
  mode: PromptMode
) {
  await throttle();
  const endpoint = 'https://api.deepseek.com/v1/chat/completions';
  const { system, user } = buildDouPrompts(ctx, phase, mode);
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${o.apiKey}`
    },
    body: JSON.stringify({
      model: (o.model && String(o.model).trim()) || 'deepseek-chat',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      stream: false
    })
  });
  if (!resp.ok) {
    const text = await resp.text();
    const err: any = new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
    err.status = resp.status;
    err.body = text;
    throw err;
  }
  const j: any = await resp.json();
  const txt = j?.choices?.[0]?.message?.content || '';
  const parsed: any = extractFirstJsonObject(String(txt)) || {};
  return { payload: parsed };
}

export function DeepseekBot({ apiKey, model }: { apiKey?: string; model?: string }) {
  return async function bot(ctx: BotCtx): Promise<BotMove> {
    let flagged: RetryKind | null = null;
    let usedMode: PromptMode = 'normal';
    try {
      if (!apiKey) throw new Error('DeepSeek API key 未配置');
      const phase = ((ctx as any)?.phase || 'play') as 'bid' | 'double' | 'play';
      const exec = (mode: PromptMode) => requestDeepseek({ apiKey, model }, ctx, phase, mode);
      const preferSafe = Date.now() < _riskModeUntil;
      const attempts: PromptMode[] = preferSafe ? ['safe', 'minimal'] : ['normal', 'safe', 'minimal'];
      let lastErr: any;
      let result: { payload: any } | undefined;
      for (const mode of attempts) {
        try {
          const r = await exec(mode);
          usedMode = mode;
          result = r;
          break;
        } catch (err) {
          const kind = classifyError(err);
          if (kind) {
            flagged = kind;
            lastErr = err;
            const now = Date.now();
            const backoff = kind === 'rate-limit' ? RATE_LIMIT_BACKOFF_MS : HIGH_RISK_BACKOFF_MS;
            _cooldownUntil = Math.max(_cooldownUntil, now + backoff);
            _riskModeUntil = Math.max(_riskModeUntil, now + HIGH_RISK_WINDOW_MS);
            continue;
          }
          throw err;
        }
      }
      if (!result) throw lastErr || new Error('DeepSeek 请求失败');

      const p = result.payload;
      if (phase === 'bid') {
        if (typeof p.bid === 'boolean') {
          return { phase: 'bid', bid: !!p.bid, reason: nonEmptyReason(p.reason, 'DeepSeek') };
        }
        if (p.move === 'pass') return { phase: 'bid', bid: false, reason: nonEmptyReason(p.reason, 'DeepSeek') };
        if (p.move === 'play') return { phase: 'bid', bid: true, reason: nonEmptyReason(p.reason, 'DeepSeek') };
        throw new Error('invalid bid response');
      }
      if (phase === 'double') {
        if (typeof p.double === 'boolean') {
          return { phase: 'double', double: !!p.double, reason: nonEmptyReason(p.reason, 'DeepSeek') };
        }
        if (typeof p.bid === 'boolean') {
          return { phase: 'double', double: !!p.bid, reason: nonEmptyReason(p.reason, 'DeepSeek') };
        }
        if (p.move === 'pass') return { phase: 'double', double: false, reason: nonEmptyReason(p.reason, 'DeepSeek') };
        if (p.move === 'play') return { phase: 'double', double: true, reason: nonEmptyReason(p.reason, 'DeepSeek') };
        throw new Error('invalid double response');
      }
      const mv = p.move === 'pass' ? 'pass' : 'play';
      const cards: string[] = Array.isArray(p.cards) ? p.cards : [];
      const reason = nonEmptyReason(p.reason, 'DeepSeek');
      const move = mv === 'pass'
        ? { phase: 'play', move: 'pass', reason }
        : { phase: 'play', move: 'play', cards, reason };
      if (flagged) {
        (move as any).warning = flagged === 'rate-limit' ? 'deepseek-rate-limit' : 'deepseek-safety';
        if (usedMode !== 'normal') (move as any).promptMode = usedMode;
      }
      return move as BotMove;
    } catch (e: any) {
      const message = e?.message || e;
      const note = flagged ? (flagged === 'rate-limit' ? '（触发限流后重试仍失败）' : '（触发安全审查后重试仍失败）') : '';
      const reason = `DeepSeek 调用失败${note}：${message}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
}
