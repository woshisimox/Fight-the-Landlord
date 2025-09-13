// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type SeatSpec = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  token?: string;
};

type StartPayload = {
  seats: SeatSpec[];                     // 3 items
  seatDelayMs?: number[];
  rounds?: number;
  rob?: boolean;
  four2?: 'both' | '2singles' | '2pairs';
  stopBelowZero?: boolean;               // 默认 true
  startScore?: number;
  clientTraceId?: string;
  farmerCoop?: boolean;                  // 农民配合外层包装
};

function writeLine(res: NextApiResponse, obj: any) {
  try { (res as any).write(JSON.stringify(obj) + '\n'); } catch {}
}

function providerOf(choice?: BotChoice): string {
  if (!choice) return 'unknown';
  if (choice.startsWith('ai:')) return choice.split(':')[1];
  if (choice.startsWith('built-in')) return 'built-in';
  if (choice === 'http') return 'http';
  return 'unknown';
}

function asBot(choice: BotChoice, spec?: SeatSpec): (ctx:any)=>Promise<any>|any {
  switch (choice) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'ai:openai': return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini': return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-flash' });
    case 'ai:grok':   return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':   return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':   return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'http':      return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:          return GreedyMax;
  }
}

/* ----------------- 统计工具 ----------------- */
const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
const RVAL: Record<string, number> = Object.fromEntries(RANKS.map((r,i)=>[r,i]));
function normRankLabel(c: string): string {
  if (!c) return '';
  const u = String(c).toUpperCase();
  if (u === '10') return 'T';
  if (u === 'X') return 'X';
  if (u === 'X') return 'X';
  if (u === 'x') return 'x';
  return u;
}
function sig(cards: string[]) {
  const cs = (cards||[]).map(normRankLabel);
  if (cs.length === 2 && new Set(cs).size === 2 && cs.includes('x') && cs.includes('X')) {
    return { kind:'rocket' as const, len:2, rank:null };
  }
  const allSame = cs.length>0 && cs.every(x=>x===cs[0]);
  if (cs.length === 4 && allSame) return { kind:'bomb' as const, len:4, rank:RVAL[cs[0]] ?? null };
  if (cs.length === 1) return { kind:'single' as const, len:1, rank:RVAL[cs[0]] ?? null };
  if (cs.length === 2 && allSame) return { kind:'pair' as const, len:2, rank:RVAL[cs[0]] ?? null };
  if (cs.length === 3 && allSame) return { kind:'triple' as const, len:3, rank:RVAL[cs[0]] ?? null };
  return { kind:'other' as const, len:cs.length, rank:null };
}
function comparable(a: ReturnType<typeof sig>, b: ReturnType<typeof sig>): boolean {
  if (!a || !b) return false;
  if (a.kind==='single' || a.kind==='pair' || a.kind==='triple') {
    return a.kind===b.kind && a.len===b.len && a.rank!=null && b.rank!=null;
  }
  return false;
}
function clamp01(x:number){ return x<0?0:x>1?1:x; }
function to5(x:number){ return Math.round(clamp01(x)*5*10)/10; } // 保留1位小数

type SeatStats = {
  leadCount: number;
  trickActCount: number;
  trickLeaderSuccess: number;
  bombCount: number;
  rocketCount: number;
  overMargins: number[];
  followTotal: number;
  followPass: number;
  followLeaderTeammateTotal: number;
  followLeaderTeammatePass: number;
  followLeaderLandlordTotal: number;
  followLeaderLandlordPlay: number;
  feedTotal: number;
  feedCount: number;
  robAttempt: number;
  closeOut: number;
};

function emptySeatStats(): SeatStats {
  return {
    leadCount:0, trickActCount:0, trickLeaderSuccess:0,
    bombCount:0, rocketCount:0, overMargins:[],
    followTotal:0, followPass:0,
    followLeaderTeammateTotal:0, followLeaderTeammatePass:0,
    followLeaderLandlordTotal:0, followLeaderLandlordPlay:0,
    feedTotal:0, feedCount:0,
    robAttempt:0, closeOut:0,
  };
}

function computeScores(params:{
  L:number, winner:number, robEnabled:boolean,
  handCountsEnd:number[], // 最终手牌数
  per: SeatStats[],
}){
  const { L, winner, robEnabled, handCountsEnd, per } = params;
  const totalTricks = per.reduce((s,x)=>s+x.leadCount,0);

  return per.map((st, seat) => {
    const isFarmer = seat !== L;

    // 子项比率
    const TLPR = isFarmer && st.followLeaderTeammateTotal>0
      ? st.followLeaderTeammatePass / st.followLeaderTeammateTotal : (isFarmer?0.5:0.5);
    const DLR  = isFarmer && st.followLeaderLandlordTotal>0
      ? st.followLeaderLandlordPlay / st.followLeaderLandlordTotal : (isFarmer?0.5:0.5);
    const FR   = isFarmer && st.feedTotal>0
      ? st.feedCount / st.feedTotal : (isFarmer?0.5:0.5);

    const LF   = st.trickActCount>0 ? st.leadCount / Math.max(1, st.trickActCount) : 0.5;
    const BR   = totalTricks>0 ? (st.bombCount + st.rocketCount) / totalTricks : 0;
    const OM   = st.overMargins.length>0 ? st.overMargins.reduce((a,b)=>a+b,0)/st.overMargins.length : 0.5;

    const PRF  = st.followTotal>0 ? st.followPass / st.followTotal : 0.5;
    const InvOM= 1-OM;

    const TWR  = st.leadCount>0 ? st.trickLeaderSuccess / st.leadCount : 0.5;
    const CE   = (winner===seat) ? (handCountsEnd[seat]===0 ? 1 : 0) : 0;

    const RR   = robEnabled ? (st.robAttempt>0 ? 1 : 0) : 0;
    const RSR  = robEnabled ? ((seat===L && winner===L) ? 1 : 0) : 0;

    // 汇总得分（0..1）
    const Coop = isFarmer ? (0.4*TLPR + 0.3*DLR + 0.3*FR) : 0.5;
    const Agg  = 0.4*LF + 0.4*BR + 0.2*OM;
    const Cons = 0.6*PRF + 0.4*InvOM;
    const Eff  = 0.7*TWR + 0.3*CE;
    const RobS = 0.6*RR + 0.4*RSR;

    return {
      seat,
      role: isFarmer ? 'farmer' : 'landlord',
      scaled: {
        coop: to5(Coop),
        agg : to5(Agg),
        cons: to5(Cons),
        eff : to5(Eff),
        rob : to5(RobS),
      },
      raw: { TLPR, DLR, FR, LF, BR, OM, PRF, InvOM, TWR, CE, RR, RSR }
    };
  });
}

/* ----------------- 农民配合包装 ----------------- */
function extractReason(raw: any): string | undefined {
  try {
    let r =
      (typeof raw?.reason === 'string' && raw.reason) ||
      (typeof raw?.explanation === 'string' && raw.explanation) ||
      (typeof raw?.analysis === 'string' && raw.analysis) ||
      (typeof raw === 'string' ? raw : '');
    if (!r) return undefined;
    r = String(r).replace(/\s+/g, ' ').trim();
    const MAX = 400;
    if (r.length > MAX) r = r.slice(0, MAX) + '…';
    return r;
  } catch { return undefined; }
}
function labelOf(choice: BotChoice) {
  switch (choice) {
    case 'built-in:greedy-max': return 'GreedyMax';
    case 'built-in:greedy-min': return 'GreedyMin';
    case 'built-in:random-legal': return 'RandomLegal';
    default: return 'built-in';
  }
}
function makeBuiltInReason(choice: BotChoice, ctx: any, out: any): string {
  const strat = labelOf(choice);
  const need  = ctx?.require?.type || ctx?.require?.kind || null;
  const isPass = out === 'pass' || out?.move === 'pass' || out?.type === 'pass';
  const handSize =
    (Array.isArray(ctx?.hand) && ctx.hand.length) ||
    (Array.isArray(ctx?.hands) && typeof ctx?.seat === 'number' && Array.isArray(ctx.hands[ctx.seat]) && ctx.hands[ctx.seat].length) ||
    undefined;
  const bias =
    choice === 'built-in:greedy-max' ? '倾向出大牌' :
    choice === 'built-in:greedy-min' ? '倾向出小牌' : '随机合法';
  if (isPass) {
    return `内置:${strat}｜${need ? `无法压牌(${need})` : '策略选择过'}｜${bias}${handSize!=null?`｜余牌${handSize}`:''}`;
  } else {
    const mode = need ? '跟牌' : '主动出牌';
    return `内置:${strat}｜${mode}｜${handSize!=null?`余牌${handSize}`:''}｜${bias}`;
  }
}

function landlordFromCtx(ctx:any): number | null {
  return (typeof ctx?.landlord === 'number') ? ctx.landlord
    : (typeof ctx?.state?.landlord === 'number') ? ctx.state.landlord
    : (typeof ctx?.init?.landlord === 'number') ? ctx.init.landlord
    : null;
}
function leaderFromCtx(ctx:any): number | null {
  return (typeof ctx?.leader === 'number') ? ctx.leader
    : (typeof ctx?.require?.leader === 'number') ? ctx.require.leader
    : null;
}
function handCountsFromCtx(ctx:any): number[] | null {
  try {
    if (Array.isArray(ctx?.hands) && Array.isArray(ctx.hands[0])) {
      return ctx.hands.map((h:any)=>Array.isArray(h)?h.length:0);
    }
  } catch {}
  return null;
}
function isPassMove(out:any):boolean {
  return out === 'pass' || out?.move === 'pass' || out?.type === 'pass';
}
function coopJoin(base?:string, coopNote?:string): string | undefined {
  if (base && coopNote) return `${base}｜协作：${coopNote}`;
  if (coopNote) return `协作：${coopNote}`;
  return base;
}
function wrapWithFarmerCoop(bot:(ctx:any)=>any|Promise<any>, choice: BotChoice, enabled:boolean) {
  return async (ctx:any) => {
    const seat = (typeof ctx?.seat === 'number') ? ctx.seat : null;
    const L = landlordFromCtx(ctx);
    const counts = handCountsFromCtx(ctx);
    const leader = leaderFromCtx(ctx);
    const isFollowing = !!ctx?.require;
    const isFarmer = (seat!=null && L!=null) ? (seat !== L) : false;
    const teammate = (seat!=null && L!=null)
      ? [0,1,2].find(s => s !== seat && s !== L)!
      : null;

    const coopHints = {
      enabled,
      role: (seat!=null && L!=null) ? (seat === L ? 'landlord' : 'farmer') : 'unknown',
      teammateSeat: teammate,
      landlordSeat: L,
      leaderSeat: leader,
      isFollowing,
      counts,
      guideline: '若为农民且队友领先，通常过牌保顺；但地主余牌≤2时优先防止放跑。'
    };
    const ctx2 = { ...ctx, coop: coopHints };

    let out = await bot(ctx2);

    let baseReason = extractReason(out);
    if (!baseReason && choice.startsWith('built-in')) {
      try { baseReason = makeBuiltInReason(choice, ctx, out); } catch {}
    }

    let coopNote: string | undefined;
    if (enabled && isFarmer && isFollowing && teammate!=null && leader === teammate) {
      const landlordCount = (typeof L === 'number' && counts) ? counts[L] : undefined;
      if (landlordCount != null && landlordCount <= 2) {
        coopNote = `队友领先但地主余牌≤2，避免放跑，保持原策略`;
      } else {
        if (!isPassMove(out)) {
          out = { move:'pass' };
          coopNote = `队友领先，过牌协作（覆盖原动作）`;
        } else {
          coopNote = `队友领先，选择过牌协作`;
        }
      }
    } else if (enabled && isFarmer && isFollowing && leader === L) {
      coopNote = `地主领先，优先考虑压牌（保持原策略）`;
    }

    (out as any).__farmerCoopReason__ = coopJoin(baseReason, coopNote);
    return out;
  };
}

/* ----------------- 单局 runner + 统计 ----------------- */
async function runOneRoundWithGuard(
  opts: {
    seats: any[];
    four2?: 'both'|'2singles'|'2pairs';
    delayMs?: number;
    seatMeta?: SeatSpec[];
    robEnabled?: boolean;
  },
  res: NextApiResponse,
  roundNo: number
): Promise<{ rotatedDelta: [number,number,number] | null }> {
  const MAX_EVENTS = 4000;
  const MAX_REPEATED_HEARTBEAT = 200;
  const iter: AsyncIterator<any> = (runOneGame as any)({ seats: opts.seats, four2: opts.four2, delayMs: opts.delayMs });

  let evCount = 0;
  let landlord = -1;
  let trick = 0;
  let lastSignature = '';
  let repeated = 0;
  let rotatedDelta: [number,number,number] | null = null;

  // 统计状态
  let handCount = [0,0,0];
  const st: SeatStats[] = [emptySeatStats(), emptySeatStats(), emptySeatStats()];
  let trickActive = false;
  let trickLeader: number | null = null;
  let trickTopSeat: number | null = null;
  let trickTopSig: ReturnType<typeof sig> | null = null;

  const rotateByLandlord = (ds: number[], L: number): [number,number,number] => {
    const a = (idx:number) => ds[(idx - L + 3) % 3] || 0;
    return [a(0), a(1), a(2)];
  };

  while (true) {
    const { value, done } = await (iter.next() as any);
    if (done) break;
    evCount++;

    writeLine(res, value);

    // —— 统计采样 —— //
    try {
      if (value?.kind === 'init' && Array.isArray(value?.hands)) {
        landlord = typeof value?.landlord === 'number' ? value.landlord : -1;
        handCount = value.hands.map((h:any)=>Array.isArray(h)?h.length:0);
        trickActive = false; trickLeader = null; trickTopSeat = null; trickTopSig = null;
      }

      if (value?.type==='event' && value?.kind==='rob' && typeof value?.seat==='number') {
        if (value.rob) st[value.seat].robAttempt = 1;
      }

      if (value?.type==='event' && value?.kind==='play') {
        const seat:number = value.seat|0;
        const mv = value.move;
        st[seat].trickActCount += 1;

        if (mv === 'pass') {
          if (trickActive && trickLeader!=null && seat!==trickLeader) {
            st[seat].followTotal += 1;
            if (landlord>=0) {
              const teammate = [0,1,2].find(s => s !== seat && s !== landlord)!;
              if (trickLeader === teammate) {
                // TLPR 分母：若地主余牌<=2则跳过
                if (handCount[landlord] > 2) {
                  st[seat].followLeaderTeammateTotal += 1;
                  st[seat].followLeaderTeammatePass  += 1;
                }
              } else if (trickLeader === landlord) {
                st[seat].followLeaderLandlordTotal += 1;
                // pass 不加 play 计数
              }
            }
          }
        } else {
          const cards: string[] = value.cards || [];
          const S = sig(cards);

          // 炸弹/王炸使用
          if (S.kind === 'bomb') st[seat].bombCount += 1;
          if (S.kind === 'rocket') st[seat].rocketCount += 1;

          if (!trickActive) {
            // 新一墩开始
            trickActive = true; trickLeader = seat; trickTopSeat = seat; trickTopSig = S;
            st[seat].leadCount += 1;

            // 喂牌（队友<=2 且出小单/小对）
            if (landlord>=0) {
              const teammate = [0,1,2].find(s => s !== seat && s !== landlord)!;
              if (handCount[teammate] <= 2) {
                st[seat].feedTotal += 1;
                if ((S.kind==='single' || S.kind==='pair') && S.rank!=null && S.rank <= RVAL['9']) {
                  st[seat].feedCount += 1;
                }
              }
            }
          } else {
            // 跟牌
            if (trickLeader != null && seat !== trickLeader) {
              st[seat].followTotal += 1;
              if (landlord>=0) {
                const teammate = [0,1,2].find(s => s !== seat && s !== landlord)!;
                if (trickLeader === teammate && handCount[landlord] > 2) {
                  st[seat].followLeaderTeammateTotal += 1;
                } else if (trickLeader === landlord) {
                  st[seat].followLeaderLandlordTotal += 1;
                  st[seat].followLeaderLandlordPlay  += 1; // 对地主出牌进行限制
                }
              }
            }

            // 可比时，记录富余度
            if (trickTopSig && comparable(trickTopSig, S) && trickTopSig.rank!=null && S.rank!=null) {
              const margin = clamp01((S.rank - trickTopSig.rank)/14);
              st[seat].overMargins.push(margin);
              trickTopSeat = seat; trickTopSig = S;
            } else {
              // 更新当前顶
              trickTopSeat = seat; trickTopSig = S;
            }
          }

          // 扣牌张数 & 收官
          handCount[seat] = Math.max(0, handCount[seat] - cards.length);
          if (handCount[seat] === 0) st[seat].closeOut += 1;
        }
      }

      if (value?.type==='event' && value?.kind==='trick-reset') {
        if (trickActive && trickLeader!=null && trickTopSeat===trickLeader) {
          st[trickLeader].trickLeaderSuccess += 1;
        }
        trickActive = false; trickLeader = null; trickTopSeat = null; trickTopSig = null;
        trick += 1;
      }

      if (value?.type==='event' && value?.kind==='win') {
        // 若最后一墩未触发 trick-reset，也做一次收尾判断
        if (trickActive && trickLeader!=null && trickTopSeat===trickLeader) {
          st[trickLeader].trickLeaderSuccess += 1;
        }

        const L = landlord;
        const winner = value.winner|0;
        const ds = Array.isArray(value?.deltaScores) ? value.deltaScores as number[] : [0,0,0];
        rotatedDelta = rotateByLandlord(ds, Math.max(0, landlord));

        // 生成并输出 stats 事件
        const perSeat = computeScores({
          L, winner,
          robEnabled: !!opts.robEnabled,
          handCountsEnd: handCount,
          per: st
        });

        writeLine(res, {
          type:'event', kind:'stats', round: roundNo,
          landlord: L, winner,
          perSeat
        });
      }
    } catch {}

    // —— 安全阈值 —— //
    const sigline = JSON.stringify({
      kind: value?.kind,
      seat: value?.seat,
      move: value?.move,
      leader: value?.leader,
      trick
    });
    if (sigline === lastSignature) repeated++; else repeated = 0;
    lastSignature = sigline;

    if (evCount > MAX_EVENTS || repeated > MAX_REPEATED_HEARTBEAT) {
      writeLine(res, { type:'log', message:`[防卡死] 触发安全阈值：${evCount} events, repeated=${repeated}。本局强制结束（判地主胜）。`});
      try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined); } catch {}
      const winner = landlord >= 0 ? landlord : 0;
      const dsRel = (winner === landlord) ? [+2, -1, -1] : [-2, +1, +1];
      const rot = rotateByLandlord(dsRel, Math.max(0, landlord));
      rotatedDelta = rot;
      writeLine(res, { type:'event', kind:'win', winner, multiplier: 1, deltaScores: dsRel });
      // 仍然给出一个空心 stats，避免前端缺失
      writeLine(res, {
        type:'event', kind:'stats', round: roundNo,
        landlord, winner,
        perSeat: [0,1,2].map(seat=>({
          seat, role: seat===landlord?'landlord':'farmer',
          scaled:{coop:2.5, agg:2.5, cons:2.5, eff:2.5, rob:2.5},
          raw:{}
        }))
      });
      return { rotatedDelta };
    }
  }

  return { rotatedDelta };
}

/* ----------------- 入口 ----------------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let __lastWrite = Date.now();
  const writeLineKA = (obj:any) => { try{ (res as any).write(JSON.stringify(obj)+'\n'); __lastWrite = Date.now(); }catch{} };
  const __ka = setInterval(()=>{ try{
    if((res as any).writableEnded){ clearInterval(__ka as any); return; }
    if(Date.now()-__lastWrite>2500){ writeLineKA({ type:'ka', ts: new Date().toISOString() }); }
  }catch{} }, 2500);

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10);
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1));
    const four2 = body.four2 || 'both';
    const delays = body.seatDelayMs && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0];
    const startScore = Number(body.startScore ?? 0) || 0;
    const stopBelowZero = body.stopBelowZero ?? true;
    const farmerCoop = body.farmerCoop ?? true;

    const seatBots = (body.seats || []).slice(0,3).map((s) => asBot(s.choice, s));
    const seatMeta  = (body.seats || []).slice(0,3);

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}，coop=${farmerCoop?'on':'off'}）…` });

    let scores: [number,number,number] = [startScore, startScore, startScore];

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });

      const delayedSeats = seatBots.map((rawBot, idx) => {
        const meta = seatMeta[idx];
        const bot = wrapWithFarmerCoop(rawBot, meta.choice, farmerCoop);
        return async (ctx:any) => {
          const ms = delays[idx] || 0;
          if (ms) await new Promise(r => setTimeout(r, ms));

          const by = providerOf(meta?.choice);
          const model = meta?.model || '';
          const phase = ctx?.phase || (ctx?.require ? 'play' : undefined) || 'unknown';
          const need  = (ctx?.require && (ctx?.require.type || ctx?.require.kind)) || null;

          writeLine(res, { type:'event', kind:'bot-call', seat: idx, by, model, phase, need });
          const t0 = Date.now();
          const out = await bot(ctx);
          const tookMs = Date.now() - t0;

          let reason = extractReason(out);
          if (!reason && meta?.choice && meta.choice.startsWith('built-in')) {
            try { reason = makeBuiltInReason(meta.choice as BotChoice, ctx, out); } catch {}
          }
          if (typeof (out as any).__farmerCoopReason__ === 'string') {
            reason = (out as any).__farmerCoopReason__;
          }

          writeLine(res, { type:'event', kind:'bot-done', seat: idx, by, model, tookMs, ...(reason ? { reason } : {}) });
          return out;
        };
      });

      const { rotatedDelta } = await runOneRoundWithGuard(
        { seats: delayedSeats, four2, delayMs: 0, seatMeta, robEnabled: !!body.rob },
        res,
        round
      );

      if (rotatedDelta) {
        scores = [
          scores[0] + rotatedDelta[0],
          scores[1] + rotatedDelta[1],
          scores[2] + rotatedDelta[2],
        ];
      }

      if (stopBelowZero && (scores[0] < 0 || scores[1] < 0 || scores[2] < 0)) {
        writeLine(res, { type:'log', message:`某方积分 < 0，提前终止。当前总分（座位顺序）：${scores.join(' / ')}` });
        break;
      }

      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }

    try{ clearInterval(__ka as any);}catch{}; try{ (res as any).end(); }catch{}
  } catch (e: any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || e}` });
    try{ clearInterval(__ka as any);}catch{}; try{ (res as any).end(); }catch{}
  }
}
