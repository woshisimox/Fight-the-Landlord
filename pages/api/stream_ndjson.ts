// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/* ========== 入参与类型 ========== */
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
  seats?: SeatSpec[];
  clientTraceId?: string;
  smoke?: boolean;
};

type Ndjson = Record<string, any>;

/* ========== 基础工具 ========== */
function write(res: NextApiResponse, obj: Ndjson) {
  res.write(JSON.stringify(obj) + '\n');
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

/* ========== TrueSkill（1v2 两队） ========== */
type Rating = { mu: number; sigma: number };
const TS_DEFAULT: Rating = { mu: 25, sigma: 25 / 3 };
const TS_BETA = 25 / 6;
const TS_TAU = 25 / 300;
const SQRT2 = Math.sqrt(2);
function erf(x: number) {
  const s = Math.sign(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return s * y;
}
function phi(x: number) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
function Phi(x: number) { return 0.5 * (1 + erf(x / SQRT2)); }
function V_exceeds(t: number) { const d = Math.max(1e-12, Phi(t)); return phi(t) / d; }
function W_exceeds(t: number) { const v = V_exceeds(t); return v * (v + t); }
function tsUpdateTwoTeams(r: Rating[], teamA: number[], teamB: number[]) {
  const varA = teamA.reduce((s,i)=>s+r[i].sigma**2,0), varB = teamB.reduce((s,i)=>s+r[i].sigma**2,0);
  const muA  = teamA.reduce((s,i)=>s+r[i].mu,0),     muB  = teamB.reduce((s,i)=>s+r[i].mu,0);
  const c2   = varA + varB + 2*TS_BETA*TS_BETA;
  const c    = Math.sqrt(c2);
  const t    = (muA - muB) / c;
  const v = V_exceeds(t), w = W_exceeds(t);
  for (const i of teamA) { const sig2=r[i].sigma**2; const mult=sig2/c, mult2=sig2/c2;
    r[i].mu += mult*v; r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU); }
  for (const i of teamB) { const sig2=r[i].sigma**2; const mult=sig2/c, mult2=sig2/c2;
    r[i].mu -= mult*v; r[i].sigma = Math.sqrt(Math.max(1e-6, sig2*(1 - w*mult2)) + TS_TAU*TS_TAU); }
}

/* ========== 启发式（理由） ========== */
const SUITS = ['♠','♥','♦','♣'];
function rankKey(card: string): string {
  if (!card) return '';
  if (card === 'x' || card === 'X' || card.startsWith('🃏')) return card.replace('🃏','');
  if (SUITS.includes(card[0])) return card.slice(1).replace(/10/i,'T').toUpperCase();
  return card.replace(/10/i,'T').toUpperCase();
}
function isJoker(card: string) { return card === 'x' || card === 'X' || card.startsWith('🃏'); }
function removeOneCardFromHand(hand: string[], played: string) {
  let k = hand.indexOf(played); if (k>=0){ hand.splice(k,1); return true; }
  const rk = rankKey(played);
  if (isJoker(played)) { const i = hand.findIndex(c=>isJoker(c)&&rankKey(c)===rk); if (i>=0){ hand.splice(i,1); return true; } }
  else { const i = hand.findIndex(c=>!isJoker(c)&&rankKey(c)===rk); if (i>=0){ hand.splice(i,1); return true; } }
  return false;
}
function isTeammate(a:number,b:number, landlord:number|null){ if(landlord==null) return false; return (a===landlord) === (b===landlord); }

function evalHandStrength(hand?: string[]) {
  if (!hand || hand.length === 0) return 0.5;
  const m = new Map<string,number>(); let jokers=0,bombs=0,pairs=0,triples=0,high=0;
  for (const c of hand) { const rk = /🃏/.test(c) ? (c.endsWith('X')?'X':'Y') : rankKey(c); m.set(rk,(m.get(rk)||0)+1); }
  m.forEach((cnt,rk)=>{ if(rk==='X'||rk==='Y')jokers+=cnt; if(cnt>=4)bombs++; if(cnt===3)triples++; if(cnt===2)pairs++; if(['A','2','X','Y'].includes(rk)) high+=cnt; });
  const hasRocket = jokers>=2 ? 1 : 0;
  const s = 0.20 + hasRocket*0.40 + Math.min(0.50,bombs*0.25) + Math.min(0.30,(high/Math.max(1,hand.length))*0.60) + Math.min(0.15, triples*0.05 + pairs*0.02);
  return Math.max(0, Math.min(1, s));
}
function buildRobReason(seat:number, rob:boolean, landlord:number|null, hand?:string[]){
  const s = evalHandStrength(hand), pct = `${Math.round(s*100)}%`;
  if (rob) return s>=0.75 ? `手牌强度高（≈${pct}），争取地主以掌控节奏。` : s>=0.55 ? `手牌质量尚可（≈${pct}），尝试抢地主获取主动权。` : `信息有限但期待底牌改善牌力，选择试探性抢地主。`;
  return s>=0.75 ? `虽有一定牌力（≈${pct}），权衡风险后暂不抢地主。` : s>=0.55 ? `牌力中等（≈${pct}），避免勉强上手，留待队友协同。` : `牌力偏弱（≈${pct}），不抢以降低风险并保持灵活。`;
}
type TrickCtx = { leaderSeat:number|null; lastSeat:number|null; lastComboType:string|null; lastCards:string[]|null; };
function humanCombo(ct?:string, cards?:string[]){ if(!ct) return '未知牌型'; const size=cards?.length||0; const map:Record<string,string>={rocket:'火箭',bomb:'炸弹',pair:'对子',single:'单张',straight:'顺子',straight_pair:'连对',triple:'三张',triple_pair:'三带二',airplane:'飞机'}; return `${map[ct]??ct}${size?`（${size}张）`:''}`; }
function buildPlayReason(move:'play'|'pass', cards:string[]|undefined, comboType:string|undefined, seat:number, landlord:number|null, multiplier:number, trick:TrickCtx, before:number, after:number){
  const role = seat===landlord ? '地主' : '农民';
  const phase = (trick.leaderSeat===null || trick.lastComboType===null) ? 'lead' : 'response';
  const vs = phase==='lead' ? 'none' : (trick.lastSeat!=null && isTeammate(trick.lastSeat, seat, landlord) ? 'teammate' : 'opponent');
  if (move==='pass') {
    if (phase==='lead') return `选择过：无需起手，观察局势（${role}）。`;
    if (vs==='teammate') return `选择过：让队友继续推进（${role}），保留关键资源以承接。`;
    return `选择过：当前不与对手硬拼，保留高牌/炸弹（${role}，倍数 x${multiplier}）。`;
  }
  const ct = comboType||'unknown', pretty = humanCombo(ct,cards), tail = after<=2?`｜剩余 ${after} 张，准备冲锋。`:''; 
  if (phase==='lead') {
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
    if (vs==='teammate') {
      if (ct==='rocket') return `队友领先但需强力接管，打出 ${pretty} 锁定牌权。${tail}`;
      if (ct==='bomb') return `在队友领先情况下以炸弹接力，确保我方节奏（权衡翻倍）。${tail}`;
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

/* ========== API 入口 ========== */
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // —— 1) 立刻写首包，设置长连与分块 —— //
  const q = req.query || {};
  const nowId = (Math.random().toString(36).slice(2));
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  (res.socket as any)?.setTimeout?.(0);
  (res.socket as any)?.setNoDelay?.(true);

  write(res, { type: 'log', message: `[server] stream enter | method=${req.method} trace=${nowId}` });

  // 简易心跳，避免代理层超时
  const hb = setInterval(() => {
    try { write(res, { type: 'ping', t: Date.now() }); } catch {}
  }, 10000);
  res.on('close', () => clearInterval(hb));

  // —— 2) 解析参数（GET/POST 兼容） —— //
  let body: Body = {} as any;
  if (req.method === 'POST') {
    body = (req.body || {}) as Body;
  } else {
    // 允许 GET 用于 smoke 调试
    body = {
      rounds: q.rounds ? Number(q.rounds) : 1,
      enabled: q.enabled !== '0',
      rob: q.rob !== '0',
      four2: (q.four2 as Four2Policy) || 'both',
      seats: [],
      clientTraceId: (q.trace as string) || nowId,
      smoke: q.smoke === '1',
    };
  }

  const {
    rounds = 1,
    seats = [],
    enabled = true,
    rob = true,
    four2 = 'both',
    startScore = 0,
    clientTraceId = nowId,
    smoke = false,
  } = body;

  write(res, { type: 'log', message: `[server] parsed body | smoke=${!!smoke} rounds=${rounds} seats.len=${seats?.length ?? -1}` });

  // —— 3) SMOKE 模式：只验证前端能否收到流 —— //
  if (smoke) {
    for (let i = 1; i <= 5; i++) {
      write(res, { type: 'log', message: `[smoke] step ${i}/5` });
      await sleep(250);
    }
    write(res, { type: 'event', kind: 'round-end', round: 0, smoke: true });
    res.end();
    return;
  }

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

  // TrueSkill 初始化
  const tsRatings: Rating[] = [{ mu: 25, sigma: 25/3 }, { mu: 25, sigma: 25/3 }, { mu: 25, sigma: 25/3 }];

  let finished = 0;
  const MAX_EVENTS_PER_ROUND = 20000;

  while (finished < rounds) {
    // 局上下文
    let landlord: number | null = null;
    let multiplier = 1;
    let hands: string[][] = [[], [], []];
    const count = [0, 0, 0];
    let trick: TrickCtx = { leaderSeat: null, lastSeat: null, lastComboType: null, lastCards: null };

    // 局前 TS
    write(res, {
      type: 'ts', where: 'before-round', round: finished + 1,
      ratings: tsRatings.map(r => ({ mu: r.mu, sigma: r.sigma, cr: r.mu - 3*r.sigma })),
    });

    // 仅传引擎认识的字段
    const opts: any = { seats, rob, four2, startScore };
    write(res, { type: 'log', message: `[server] runOneGame start | keys=${Object.keys(opts).join(',')}` });

    let iter: any;
    try {
      iter = engine.runOneGame(opts);
      const asyncish = !!(iter && typeof iter[Symbol.asyncIterator] === 'function');
      const syncish  = !!(iter && typeof iter[Symbol.iterator] === 'function');
      write(res, { type: 'log', message: `[server] iterable | async=${asyncish} sync=${syncish}` });
      if (!asyncish && !syncish) {
        write(res, { type: 'log', message: '[server] non-iterable from engine, abort this round' });
        break;
      }
    } catch (e: any) {
      write(res, { type: 'log', message: `[server] runOneGame throw: ${e?.stack || e?.message || e}` });
      break;
    }

    let sawAnyEvent = false;
    let eventCount = 0;

    try {
      const asyncIter: AsyncIterable<any> = (iter && typeof iter[Symbol.asyncIterator] === 'function')
        ? iter
        : (async function*(){ for (const x of iter as Iterable<any>) yield x; })();

      for await (const ev of asyncIter) {
        eventCount++;
        if (eventCount > MAX_EVENTS_PER_ROUND) {
          write(res, { type: 'log', message: `[server] guard cut at ${MAX_EVENTS_PER_ROUND}` });
          break;
        }

        // 原样透传
        write(res, ev);
        if (ev?.type === 'state' || ev?.type === 'event') sawAnyEvent = true;

        // 维护上下文
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

        // 抢/不抢 → 追加理由
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

        // 出牌/过牌 → 追加理由
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

          const reason = buildPlayReason(move, cards, comboType, seat, landlord, multiplier, trick, before, after);

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

        // 结算 → 更新 TS
        if (ev?.type === 'event' && ev.kind === 'win') {
          const winSeat: number = ev.winner;
          if (typeof winSeat === 'number' && landlord != null) {
            const farmers = [0,1,2].filter(s => s !== landlord);
            if (winSeat === landlord) tsUpdateTwoTeams(tsRatings, [landlord], farmers);
            else tsUpdateTwoTeams(tsRatings, farmers, [landlord]);
            write(res, {
              type: 'ts',
              where: 'after-round',
              round: finished + 1,
              ratings: tsRatings.map(r => ({ mu: r.mu, sigma: r.sigma, cr: r.mu - 3*r.sigma })),
            });
          }
          finished += 1;
          if (finished >= rounds) break;
        }
      }
    } catch (e: any) {
      write(res, { type: 'log', message: `[server] stream error: ${e?.stack || e?.message || e}` });
    }

    // 只有真的看到事件才发 round-end；否则给诊断日志
    if (finished > 0) {
      write(res, { type: 'event', kind: 'round-end', round: finished });
    } else {
      write(res, { type: 'log', message: `[server] warn: no events from engine in this round` });
    }

    if (finished >= rounds) break;
  }

  res.end();
}
