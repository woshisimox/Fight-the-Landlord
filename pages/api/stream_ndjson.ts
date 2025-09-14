// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/* =========================
 * 入参与类型
 * ========================= */
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
};

type Ndjson = Record<string, any>;

/* =========================
 * 工具：写 NDJSON & 引擎装载
 * ========================= */
function write(res: NextApiResponse, obj: Ndjson) {
  res.write(JSON.stringify(obj) + '\n');
}
function tryLoadEngine() {
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
function toAsyncIterable(x: any): AsyncIterable<any> {
  if (x && typeof x[Symbol.asyncIterator] === 'function') return x as AsyncIterable<any>;
  if (x && typeof x[Symbol.iterator] === 'function') {
    return (async function* () {
      for (const it of x as Iterable<any>) yield it;
    })();
  }
  throw new Error('runOneGame() must return (async) iterable');
}

/* =========================
 * TrueSkill（1v2 两队）
 * ========================= */
type Rating = { mu: number; sigma: number };
const TS_DEFAULT: Rating = { mu: 25, sigma: 25 / 3 };
const TS_BETA = 25 / 6; // 技能差尺度
const TS_TAU = 25 / 300; // 漂移
const SQRT2 = Math.sqrt(2);
function erf(x: number) {
  const s = Math.sign(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return s * y;
}
function phi(x: number) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); } // PDF
function Phi(x: number) { return 0.5 * (1 + erf(x / SQRT2)); } // CDF
function V_exceeds(t: number) { const d = Math.max(1e-12, Phi(t)); return phi(t) / d; }
function W_exceeds(t: number) { const v = V_exceeds(t); return v * (v + t); }

function trueskillUpdateTwoTeams(ratings: Rating[], teamA: number[], teamB: number[]) {
  const varA = teamA.reduce((s, i) => s + ratings[i].sigma ** 2, 0);
  const varB = teamB.reduce((s, i) => s + ratings[i].sigma ** 2, 0);
  const muA = teamA.reduce((s, i) => s + ratings[i].mu, 0);
  const muB = teamB.reduce((s, i) => s + ratings[i].mu, 0);
  const c2 = varA + varB + 2 * TS_BETA * TS_BETA;
  const c = Math.sqrt(c2);
  const t = (muA - muB) / c;
  const v = V_exceeds(t);
  const w = W_exceeds(t);

  for (const i of teamA) {
    const r = ratings[i];
    const sig2 = r.sigma * r.sigma;
    const mult = sig2 / c;
    const mult2 = sig2 / c2;
    r.mu = r.mu + mult * v;
    r.sigma = Math.sqrt(Math.max(1e-6, sig2 * (1 - w * mult2)) + TS_TAU * TS_TAU);
  }
  for (const i of teamB) {
    const r = ratings[i];
    const sig2 = r.sigma * r.sigma;
    const mult = sig2 / c;
    const mult2 = sig2 / c2;
    r.mu = r.mu - mult * v;
    r.sigma = Math.sqrt(Math.max(1e-6, sig2 * (1 - w * mult2)) + TS_TAU * TS_TAU);
  }
}

/* =========================
 * 启发式（理由生成）
 * ========================= */
const SUITS = ['♠', '♥', '♦', '♣'];
function rankKey(card: string): string {
  if (!card) return '';
  if (card === 'x' || card === 'X' || card.startsWith('🃏')) return card.replace('🃏', '');
  if (SUITS.includes(card[0])) return card.slice(1).replace(/10/i, 'T').toUpperCase();
  return card.replace(/10/i, 'T').toUpperCase();
}
function isJoker(card: string) { return card === 'x' || card === 'X' || card.startsWith('🃏'); }
function removeOneCardFromHand(hand: string[], played: string) {
  let k = hand.indexOf(played);
  if (k >= 0) { hand.splice(k, 1); return true; }
  const rk = rankKey(played);
  if (isJoker(played)) {
    const i = hand.findIndex(c => isJoker(c) && rankKey(c) === rk);
    if (i >= 0) { hand.splice(i, 1); return true; }
  } else {
    const i = hand.findIndex(c => !isJoker(c) && rankKey(c) === rk);
    if (i >= 0) { hand.splice(i, 1); return true; }
  }
  return false;
}
function isTeammate(a: number, b: number, landlord: number | null) {
  if (landlord == null) return false;
  return (a === landlord) === (b === landlord);
}

function evalHandStrength(hand?: string[]) {
  if (!hand || hand.length === 0) return 0.5;
  const m = new Map<string, number>(); let jokers = 0, bombs = 0, pairs = 0, triples = 0, high = 0;
  for (const c of hand) { const rk = /🃏/.test(c) ? (c.endsWith('X') ? 'X' : 'Y') : rankKey(c); m.set(rk, (m.get(rk) || 0) + 1); }
  m.forEach((cnt, rk) => {
    if (rk === 'X' || rk === 'Y') jokers += cnt;
    if (cnt >= 4) bombs += 1;
    if (cnt === 3) triples += 1;
    if (cnt === 2) pairs += 1;
    if (rk === 'A' || rk === '2' || rk === 'X' || rk === 'Y') high += cnt;
  });
  const hasRocket = jokers >= 2 ? 1 : 0;
  const s = 0.20 + hasRocket * 0.40 + Math.min(0.50, bombs * 0.25)
    + Math.min(0.30, (high / Math.max(1, hand.length)) * 0.60)
    + Math.min(0.15, triples * 0.05 + pairs * 0.02);
  return Math.max(0, Math.min(1, s));
}

function buildRobReason(seat: number, rob: boolean, landlord: number | null, hand?: string[]) {
  const s = evalHandStrength(hand), pct = `${Math.round(s * 100)}%`;
  if (rob) {
    if (s >= 0.75) return `手牌强度高（≈${pct}），争取地主以掌控节奏。`;
    if (s >= 0.55) return `手牌质量尚可（≈${pct}），尝试抢地主获取主动权。`;
    return `信息有限但期待底牌改善牌力，选择试探性抢地主。`;
  } else {
    if (s >= 0.75) return `虽有一定牌力（≈${pct}），权衡风险后暂不抢地主。`;
    if (s >= 0.55) return `牌力中等（≈${pct}），避免勉强上手，留待队友协同。`;
    return `牌力偏弱（≈${pct}），不抢以降低风险并保持灵活。`;
  }
}

type TrickCtx = { leaderSeat: number | null; lastSeat: number | null; lastComboType: string | null; lastCards: string[] | null; };
function humanCombo(ct?: string, cards?: string[]) {
  if (!ct) return '未知牌型';
  const size = cards?.length || 0;
  const map: Record<string, string> = {
    rocket: '火箭', bomb: '炸弹', pair: '对子', single: '单张',
    straight: '顺子', straight_pair: '连对', triple: '三张',
    triple_pair: '三带二', airplane: '飞机',
  };
  return `${map[ct] ?? ct}${size ? `（${size}张）` : ''}`;
}
function buildPlayReason(
  move: 'play' | 'pass',
  cards: string[] | undefined,
  comboType: string | undefined,
  seat: number,
  landlord: number | null,
  multiplier: number,
  trick: TrickCtx,
  beforeCount: number,
  afterCount: number
) {
  const role = seat === landlord ? '地主' : '农民';
  const phase = (trick.leaderSeat === null || trick.lastComboType === null) ? 'lead' : 'response';
  const vs = phase === 'lead' ? 'none' : (trick.lastSeat != null && isTeammate(trick.lastSeat, seat, landlord) ? 'teammate' : 'opponent');

  if (move === 'pass') {
    if (phase === 'lead') return `选择过：无需起手，观察局势（${role}）。`;
    if (vs === 'teammate') return `选择过：让队友继续推进（${role}），保留关键资源以承接。`;
    return `选择过：当前不与对手硬拼，保留高牌/炸弹（${role}，倍数 x${multiplier}）。`;
  }

  const ct = comboType || 'unknown';
  const pretty = humanCombo(ct, cards);
  const tail = afterCount <= 2 ? `｜剩余 ${afterCount} 张，准备冲锋。` : '';

  if (phase === 'lead') {
    switch (ct) {
      case 'rocket': return `主动出 ${pretty} 强行确立牌权，可控翻倍（x${multiplier}）。${tail}`;
      case 'bomb': return `以炸弹起手提高倍数并建立牌权，压缩对手选择。${tail}`;
      case 'straight':
      case 'straight_pair': return `起手走 ${pretty}，快速降低手牌复杂度，提高出完节奏。${tail}`;
      case 'triple_pair':
      case 'airplane': return `起手 ${pretty}，兼顾推进与控场，构筑持续压力。${tail}`;
      case 'pair': return `以 ${pretty} 起手做基础交换，保留高张/炸弹待后手。${tail}`;
      default: return `以 ${pretty} 试探性起手，先拿牌权再观察各家反应。${tail}`;
    }
  } else {
    if (vs === 'teammate') {
      if (ct === 'rocket') return `队友领先但需强力接管，打出 ${pretty} 锁定牌权。${tail}`;
      if (ct === 'bomb') return `在队友领先情况下以炸弹接力，确保我方节奏（权衡翻倍）。${tail}`;
      return `在队友出牌后以 ${pretty} 接力，优化我方走牌顺序。${tail}`;
    } else {
      switch (ct) {
        case 'rocket': return `对手强势，我方以 ${pretty} 强行夺回牌权（x${multiplier}）。${tail}`;
        case 'bomb': return `对手节奏较好，使用炸弹反制并抬高博弈成本。${tail}`;
        case 'straight':
        case 'straight_pair': return `按需跟出 ${pretty} 压制对手，保持我方走牌速度。${tail}`;
        case 'triple_pair':
        case 'airplane': return `以 ${pretty} 压制对手，兼顾推进与资源消耗。${tail}`;
        case 'pair': return `以 ${pretty} 压住对手基础节奏，避免用更大资源。${tail}`;
        default: return `跟出 ${pretty} 压制对手，确保牌权连续。${tail}`;
      }
    }
  }
}

/* =========================
 * API 入口
 * ========================= */
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

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
  if (!enabled) { write(res, { type: 'log', message: '[server] disabled' }); return res.end(); }

  const engine = tryLoadEngine();
  if (!engine?.runOneGame) {
    write(res, { type: 'log', message: '[server] engine_not_found: 需要 lib/engine 或 lib/doudizhu/engine 提供 runOneGame()' });
    return res.end();
  }

  // TrueSkill：三人初始
  const tsRatings: Rating[] = [{ ...TS_DEFAULT }, { ...TS_DEFAULT }, { ...TS_DEFAULT }];

  let finished = 0;
  while (finished < rounds) {
    // —— 单局上下文 —— //
    let landlord: number | null = null;
    let multiplier = 1;
    let hands: string[][] = [[], [], []];
    const count = [0, 0, 0];
    let trick: TrickCtx = { leaderSeat: null, lastSeat: null, lastComboType: null, lastCards: null };

    // 局前 TrueSkill 推送
    write(res, {
      type: 'ts',
      where: 'before-round',
      round: finished + 1,
      ratings: tsRatings.map(r => ({ mu: r.mu, sigma: r.sigma, cr: r.mu - 3 * r.sigma })),
    });

    // 只传引擎支持的字段（避免 TS 报错）
    const opts: any = { seats, rob, four2, startScore };

    let iter: any;
    try {
      iter = engine.runOneGame(opts);
    } catch (e: any) {
      write(res, { type: 'log', message: `[server] runOneGame error: ${e?.message || e}` });
      break;
    }

    try {
      for await (const ev of toAsyncIterable(iter)) {
        // 1) 原样透传
        write(res, ev);

        // 2) 维护上下文
        if (ev?.type === 'state' && (ev.kind === 'init' || ev.kind === 'reinit')) {
          landlord = typeof ev.landlord === 'number' ? ev.landlord : landlord;
          if (Array.isArray(ev.hands) && ev.hands.length === 3) {
            hands = [[...ev.hands[0]], [...ev.hands[1]], [...ev.hands[2]]];
            count[0] = hands[0].length; count[1] = hands[1].length; count[2] = hands[2].length;
          }
        }
        if (ev?.type === 'event' && ev.kind === 'multiplier' && typeof ev.multiplier === 'number') {
          multiplier = ev.multiplier;
        }
        if (ev?.type === 'event' && ev.kind === 'trick-reset') {
          trick = { leaderSeat: null, lastSeat: null, lastComboType: null, lastCards: null };
        }

        // 3) 抢/不抢 → 追加理由
        if (ev?.type === 'event' && ev.kind === 'rob') {
          const seat: number = ev.seat ?? -1;
          const reason = buildRobReason(seat, !!ev.rob, landlord, hands?.[seat]);
          write(res, {
            type: 'event',
            kind: 'bot-done',
            phase: 'rob',
            seat,
            by: 'server/heuristic',
            model: '',
            tookMs: 0,
            reason,
            strategy: {
              phase: 'rob',
              role: landlord == null ? 'unknown' : (seat === landlord ? 'landlord' : 'farmer'),
              decision: ev.rob ? 'rob' : 'no-rob',
              estimatedStrength: evalHandStrength(hands?.[seat]),
            },
          });
        }

        // 4) 出牌/过牌 → 追加理由
        if (ev?.type === 'event' && ev.kind === 'play') {
          const seat: number = ev.seat ?? -1;
          const move: 'play' | 'pass' = ev.move;
          const comboType: string | undefined = ev.comboType;
          const cards: string[] | undefined = ev.cards;

          const before = count[seat] || (hands[seat]?.length ?? 0);
          let after = before;
          if (move === 'play' && Array.isArray(cards)) {
            const h = hands[seat] ?? [];
            for (const c of cards) removeOneCardFromHand(h, c);
            hands[seat] = h;
            after = h.length;
            count[seat] = after;
          }

          if (trick.leaderSeat === null) trick.leaderSeat = seat;
          if (move === 'play') {
            trick.lastSeat = seat;
            trick.lastComboType = comboType || trick.lastComboType;
            trick.lastCards = cards || trick.lastCards;
          }

          const reason = buildPlayReason(
            move, cards, comboType, seat, landlord, multiplier, trick, before, after
          );

          write(res, {
            type: 'event',
            kind: 'bot-done',
            phase: trick.leaderSeat === seat && move === 'play' ? 'lead' : (trick.leaderSeat === null ? 'lead' : 'response'),
            seat,
            by: 'server/heuristic',
            model: '',
            tookMs: 0,
            reason,
            strategy: {
              phase: trick.leaderSeat === seat && move === 'play' ? 'lead' : (trick.leaderSeat === null ? 'lead' : 'response'),
              role: seat === landlord ? 'landlord' : 'farmer',
              vs: trick.lastSeat == null ? 'none' : (isTeammate(trick.lastSeat, seat, landlord) ? 'teammate' : 'opponent'),
              need: trick.lastComboType || null,
              comboType: comboType || (move === 'pass' ? 'none' : 'unknown'),
              cards,
              beforeCount: before,
              afterCount: after,
              multiplier,
            },
          });
        }

        // 5) 结算 → 更新 TS 并推送
        if (ev?.type === 'event' && ev.kind === 'win') {
          const winSeat: number = ev.winner;
          if (typeof winSeat === 'number' && landlord != null) {
            const farmers = [0, 1, 2].filter(s => s !== landlord);
            if (winSeat === landlord) {
              trueskillUpdateTwoTeams(tsRatings, [landlord], farmers);
            } else {
              trueskillUpdateTwoTeams(tsRatings, farmers, [landlord]);
            }
            write(res, {
              type: 'ts',
              where: 'after-round',
              round: finished + 1,
              ratings: tsRatings.map(r => ({ mu: r.mu, sigma: r.sigma, cr: r.mu - 3 * r.sigma })),
            });
          }
          finished += 1;
          if (finished >= rounds) break;
        }
      }
    } catch (e: any) {
      write(res, { type: 'log', message: `[server] stream error: ${e?.message || e}` });
    }

    // 6) 保险：补一个 round-end
    write(res, { type: 'event', kind: 'round-end', round: finished });
    if (finished >= rounds) break;
  }

  res.end();
}
