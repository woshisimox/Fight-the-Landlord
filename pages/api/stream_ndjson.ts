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
};

type Ndjson = Record<string, any>;

/* -------------------------- 小工具 -------------------------- */
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
const SUITS = ['♠', '♥', '♦', '♣'];
function rankKey(card: string): string {
  if (!card) return '';
  // 兼容 x/X/🃏X/🃏Y
  if (card === 'x' || card === 'X' || card.startsWith('🃏')) return card.replace('🃏', '');
  // ♠A / ♥10 等
  if (SUITS.includes(card[0])) {
    const r = card.slice(1).replace(/10/i, 'T').toUpperCase();
    return r;
  }
  // A / 10 / 2 这种（一般不会出现）
  return card.replace(/10/i, 'T').toUpperCase();
}
function isJoker(card: string) {
  return card === 'x' || card === 'X' || card.startsWith('🃏');
}
function removeOneCardFromHand(hand: string[], played: string) {
  // 先尝试精确匹配
  let k = hand.indexOf(played);
  if (k >= 0) {
    hand.splice(k, 1);
    return true;
  }
  // 再按点数匹配（忽略花色），x/X/🃏单独处理
  const rk = rankKey(played);
  if (isJoker(played)) {
    const alt = hand.findIndex((c) => isJoker(c) && rankKey(c) === rk);
    if (alt >= 0) {
      hand.splice(alt, 1);
      return true;
    }
  } else {
    const alt = hand.findIndex((c) => !isJoker(c) && rankKey(c) === rk);
    if (alt >= 0) {
      hand.splice(alt, 1);
      return true;
    }
  }
  return false;
}
function teamOf(seat: number, landlord: number | null) {
  if (landlord == null) return 'unknown';
  return seat === landlord ? 'landlord' : 'farmer';
}
function isTeammate(a: number, b: number, landlord: number | null) {
  if (landlord == null) return false;
  const ta = teamOf(a, landlord);
  const tb = teamOf(b, landlord);
  return ta === tb;
}
function countRanks(hand: string[]) {
  const m = new Map<string, number>();
  for (const c of hand) {
    const rk = isJoker(c) ? rankKey(c) : rankKey(c);
    m.set(rk, (m.get(rk) || 0) + 1);
  }
  return m;
}
function features(hand: string[]) {
  const m = countRanks(hand);
  let bombs = 0;
  let pairs = 0;
  let triples = 0;
  let jokers = 0;
  let high = 0; // A/2/🃏
  m.forEach((cnt, rk) => {
    if (rk === 'X' || rk === 'Y' || rk === 'x') jokers += cnt;
    if (cnt >= 4) bombs += 1;
    if (cnt === 2) pairs += 1;
    if (cnt === 3) triples += 1;
    if (rk === 'A' || rk === '2' || rk === 'X' || rk === 'Y' || rk === 'x') high += cnt;
  });
  return { bombs, pairs, triples, jokers, high };
}
function strengthForRob(hand?: string[]) {
  if (!hand || hand.length === 0) return 0.5;
  const f = features(hand);
  // 非严格：火箭≈+0.4，炸弹≈+0.25，高牌比重≈+0.15，三带/对子略加分
  const hasRocket = f.jokers >= 2 ? 1 : 0;
  const s =
    0.2 +
    hasRocket * 0.4 +
    Math.min(0.5, f.bombs * 0.25) +
    Math.min(0.3, (f.high / Math.max(1, hand.length)) * 0.6) +
    Math.min(0.15, f.triples * 0.05 + f.pairs * 0.02);
  return Math.max(0, Math.min(1, s));
}

/* -------------------------- 启发式理由生成 -------------------------- */
type TrickCtx = {
  leaderSeat: number | null;      // 本轮第一个出牌人
  lastSeat: number | null;        // 上一个有效出牌（非过牌）的人
  lastComboType: string | null;   // 上一个有效出牌类型
  lastCards: string[] | null;     // 上一个有效出牌的牌面
};

function humanCombo(ct?: string, cards?: string[]) {
  if (!ct) return '未知牌型';
  const size = cards?.length || 0;
  const map: Record<string, string> = {
    rocket: '火箭',
    bomb: '炸弹',
    pair: '对子',
    single: '单张',
    straight: '顺子',
    straight_pair: '连对',
    triple: '三张',
    triple_pair: '三带二',
    airplane: '飞机',
  };
  return `${map[ct] ?? ct}${size ? `（${size}张）` : ''}`;
}

function reasonForRob(seat: number, rob: boolean, landlord: number | null, hand?: string[]) {
  const role = landlord == null ? '未知角色' : seat === landlord ? '地主候选' : '农民候选';
  const s = strengthForRob(hand);

  if (rob) {
    if (s >= 0.75) return `手牌强度较高（估计值 ${(s * 100).toFixed(0)}%），倾向争取地主以掌控节奏。`;
    if (s >= 0.55) return `手牌质量尚可（估计值 ${(s * 100).toFixed(0)}%），尝试抢地主争取主动。`;
    return `在信息有限情况下尝试抢地主，期望底牌改善整体牌力。`;
  } else {
    if (s >= 0.75) return `虽有一定牌力（估计值 ${(s * 100).toFixed(0)}%），但为降低风险选择不抢。`;
    if (s >= 0.55) return `牌力中等（估计值 ${(s * 100).toFixed(0)}%），避免勉强上手，倾向与队友配合。`;
    return `牌力偏弱（估计值 ${(s * 100).toFixed(0)}%），不抢以等待更好的协同出牌。`;
  }
}

function reasonForPlay(
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
  const role = landlord === seat ? '地主' : '农民';
  const phase = trick.leaderSeat === null || trick.lastComboType === null ? 'lead' : 'response';
  const vs =
    phase === 'lead'
      ? 'none'
      : trick.lastSeat != null && isTeammate(trick.lastSeat, seat, landlord)
      ? 'teammate'
      : 'opponent';

  // 过牌
  if (move === 'pass') {
    if (phase === 'lead') {
      return `选择过：无需起手，观察局势（${role}）。`;
    }
    if (vs === 'teammate') return `让队友继续推进（${role}），保留关键牌力以便后续承接。`;
    return `不与对手硬拼，避免用大牌压制，保留资源（${role}，倍数 x${multiplier}）。`;
  }

  // 出牌理由（按多维信号组合）
  const ct = comboType || 'unknown';
  const pretty = humanCombo(ct, cards);
  const tail = afterCount <= 2 ? `｜剩余 ${afterCount} 张，准备冲锋。` : '';

  if (phase === 'lead') {
    switch (ct) {
      case 'rocket':
        return `主动出 ${pretty} 以强行确立牌权，必要时可控翻倍（当前倍数 x${multiplier}）。${tail}`;
      case 'bomb':
        return `以炸弹起手提高倍数并建立牌权，压缩对手选择空间。${tail}`;
      case 'straight':
      case 'straight_pair':
        return `起手走 ${pretty}，快速降低手牌复杂度并提高出完的节奏。${tail}`;
      case 'triple_pair':
      case 'airplane':
        return `起手 ${pretty}，兼顾推进与控场，给对手施压。${tail}`;
      case 'pair':
        return `以 ${pretty} 起手做基础交换，尽量保留高张和炸弹。${tail}`;
      default:
        // single / triple / 其它
        return `以 ${pretty} 试探性起手，观察对手反应，避免暴露组合资源。${tail}`;
    }
  } else {
    // response
    if (vs === 'teammate') {
      // 压自己人：一般只在更优/必需时
      if (ct === 'rocket') return `队友领先但需要强力接管，打出 ${pretty} 以锁定牌权。${tail}`;
      if (ct === 'bomb')
        return `在队友领先情况下使用炸弹接力，确保我方节奏（权衡翻倍风险）。${tail}`;
      return `在队友出牌后以 ${pretty} 接力，优化我方出牌顺序。${tail}`;
    } else {
      // 压对手
      switch (ct) {
        case 'rocket':
          return `对手强势，我方以 ${pretty} 强行夺回牌权（倍数 x${multiplier}）。${tail}`;
        case 'bomb':
          return `对手节奏较好，使用炸弹反制并抬高博弈成本。${tail}`;
        case 'straight':
        case 'straight_pair':
          return `按需跟出 ${pretty} 并压住对手，保持我方走牌速度。${tail}`;
        case 'triple_pair':
        case 'airplane':
          return `以 ${pretty} 压制对手，兼顾推进与资源消耗。${tail}`;
        case 'pair':
          return `以 ${pretty} 压住对手基础节奏，避免消耗更大资源。${tail}`;
        default:
          return `跟出 ${pretty} 压制对手，确保牌权连续。${tail}`;
      }
    }
  }
}

/* -------------------------- API 入口 -------------------------- */
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

  if (!enabled) {
    write(res, { type: 'log', message: '[server] disabled' });
    return res.end();
  }

  const engine = tryLoadEngine();
  if (!engine?.runOneGame) {
    write(res, { type: 'log', message: '[server] engine_not_found: 需要 lib/engine 或 lib/doudizhu/engine 提供 runOneGame()' });
    return res.end();
  }

  let finished = 0;

  while (finished < rounds) {
    // —— 每局上下文 —— //
    const trick: TrickCtx = { leaderSeat: null, lastSeat: null, lastComboType: null, lastCards: null };
    let landlord: number | null = null;
    let multiplier = 1;
    let hands: string[][] = [[], [], []]; // 三家手牌
    const count = [0, 0, 0];

    // *可选*：把“开局前的 TS”塞给前端占位（如无需要可去掉这一行）
    write(res, { type: 'ts', where: 'before-round', round: finished + 1, ratings: [
      { mu: 25, sigma: 25/3, cr: 0 },
      { mu: 25, sigma: 25/3, cr: 0 },
      { mu: 25, sigma: 25/3, cr: 0 },
    ]});

    // 仅传引擎支持的字段
    const opts: any = { seats, rob, four2, startScore };

    let iter: AsyncIterable<any> | Iterable<any>;
    try {
      iter = engine.runOneGame(opts);
    } catch (e: any) {
      write(res, { type: 'log', message: `[server] runOneGame error: ${e?.message || e}` });
      break;
    }

    for await (const ev of iter as any) {
      // 原样透传
      write(res, ev);

      // 维护上下文
      if (ev?.type === 'event' && ev.kind === 'rob') {
        // 抢地主理由（此时通常还未发手牌，hand 可能为空）
        const seat: number = ev.seat ?? -1;
        const h = hands[seat] && hands[seat].length > 0 ? hands[seat] : undefined;
        const reason = reasonForRob(seat, !!ev.rob, landlord, h);
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
            role: landlord == null ? 'unknown' : seat === landlord ? 'landlord' : 'farmer',
            decision: ev.rob ? 'rob' : 'no-rob',
            estimatedStrength: h ? strengthForRob(h) : null,
          },
        });
        continue;
      }

      if (ev?.type === 'event' && ev.kind === 'reveal' && Array.isArray(ev.bottom)) {
        // 底牌翻开：不处理
      }

      if (ev?.type === 'state' && (ev.kind === 'init' || ev.kind === 'reinit')) {
        landlord = typeof ev.landlord === 'number' ? ev.landlord : landlord;
        if (Array.isArray(ev.hands) && ev.hands.length === 3) {
          hands = [ [...ev.hands[0]], [...ev.hands[1]], [...ev.hands[2]] ];
          count[0] = hands[0].length;
          count[1] = hands[1].length;
          count[2] = hands[2].length;
        }
      }

      if (ev?.type === 'event' && ev.kind === 'trick-reset') {
        trick.leaderSeat = null;
        trick.lastSeat = null;
        trick.lastComboType = null;
        trick.lastCards = null;
      }

      if (ev?.type === 'event' && ev.kind === 'play') {
        const seat: number = ev.seat ?? -1;
        const move: 'play' | 'pass' = ev.move;
        const comboType: string | undefined = ev.comboType;
        const cards: string[] | undefined = ev.cards;

        const before = count[seat] || (hands[seat]?.length ?? 0);
        let after = before;
        if (move === 'play' && Array.isArray(cards)) {
          // 从手牌中移除
          const h = hands[seat] ?? [];
          for (const c of cards) removeOneCardFromHand(h, c);
          hands[seat] = h;
          after = h.length;
          count[seat] = after;
        }

        if (trick.leaderSeat === null) trick.leaderSeat = seat;

        // 有效出牌才更新“上家”
        if (move === 'play') {
          trick.lastSeat = seat;
          trick.lastComboType = comboType || trick.lastComboType;
          trick.lastCards = cards || trick.lastCards;
        }

        const reason = reasonForPlay(
          move,
          cards,
          comboType,
          seat,
          landlord,
          multiplier,
          trick,
          before,
          after
        );

        // 追加“bot-done”解释
        write(res, {
          type: 'event',
          kind: 'bot-done',
          phase: trick.leaderSeat === seat && move === 'play' ? 'lead' : 'response',
          seat,
          by: 'server/heuristic',
          model: '',
          tookMs: 0,
          reason,
          strategy: {
            phase: trick.leaderSeat === seat && move === 'play' ? 'lead' : (trick.leaderSeat === null ? 'lead' : 'response'),
            role: teamOf(seat, landlord),
            vs: trick.lastSeat == null ? 'none' : (isTeammate(trick.lastSeat, seat, landlord) ? 'teammate' : 'opponent'),
            need: trick.lastComboType || null,
            comboType: comboType || (move === 'pass' ? 'none' : 'unknown'),
            cards,
            beforeCount: before,
            afterCount: after,
          },
        });
      }

      if (ev?.type === 'event' && ev.kind === 'multiplier' && typeof ev.multiplier === 'number') {
        multiplier = ev.multiplier;
      }

      if (ev?.type === 'event' && ev.kind === 'win') {
        finished += 1;
        if (finished >= rounds) break;
      }
    }

    // 保险：补充 round-end 边界事件
    write(res, { type: 'event', kind: 'round-end', round: finished });
    if (finished >= rounds) break;
  }

  res.end();
}
