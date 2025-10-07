// pages/api/stream_ndjson.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { runOneGame, GreedyMax, GreedyMin, RandomLegal, AllySupport, EndgameRush } from '../../lib/doudizhu/engine';
import { OpenAIBot } from '../../lib/bots/openai_bot';
import { GeminiBot } from '../../lib/bots/gemini_bot';
import { GrokBot } from '../../lib/bots/grok_bot';
import { HttpBot } from '../../lib/bots/http_bot';
import { KimiBot } from '../../lib/bots/kimi_bot';
import { QwenBot } from '../../lib/bots/qwen_bot';
// 如果你的仓库没有 DeepseekBot，可以删除本行和 asBot 里的分支
import { DeepseekBot } from '../../lib/bots/deepseek_bot';


/* ========== 已出牌缓存（仅当前请求作用域） ========== */
declare global {
  var __DDZ_SEEN: string[] | undefined;
  var __DDZ_SEEN_BY_SEAT: string[][] | undefined;



}
(globalThis as any).__DDZ_SEEN ??= [];
(globalThis as any).__DDZ_SEEN_BY_SEAT ??= [[],[],[]];
/* ========== 统一打分（与内置算法口径一致） ========== */
const __SEQ = ['3','4','5','6','7','8','9','T','J','Q','K','A'];
const __POS: Record<string, number> = Object.fromEntries(__SEQ.map((r,i)=>[r,i])) as any;
const __ORDER = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
const __POSALL: Record<string, number> = Object.fromEntries(__ORDER.map((r,i)=>[r,i])) as any;
const __rank = (c:string)=>(c==='x'||c==='X')?c:c.slice(-1);
const __count = (cs:string[])=>{ const m=new Map<string,number>(); for(const c of cs){const r=__rank(c); m.set(r,(m.get(r)||0)+1);} return m; };
const __remove=(h:string[],p:string[])=>{const a=h.slice(); for(const c of p){const i=a.indexOf(c); if(i>=0) a.splice(i,1);} return a; };
const __isStraight = (cnt:Map<string,number>)=>{
  const rs = Array.from(cnt.entries()).filter(([r,n])=>n===1 && r!=='2' && r!=='x' && r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  if (rs.length<5) return false;
  for (let i=1;i<rs.length;i++){ if ((__POS[rs[i]]??-1)!==(__POS[rs[i-1]]??-2)+1) return false; }
  return true;
};
const __isPairSeq = (cnt:Map<string,number>)=>{
  const rs = Array.from(cnt.entries()).filter(([r,n])=>n===2 && r!=='2' && r!=='x' && r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  if (rs.length<3) return false;
  for (let i=1;i<rs.length;i++){ if ((__POS[rs[i]]??-1)!==(__POS[rs[i-1]]??-2)+1) return false; }
  return true;
};
const __isPlane = (cnt:Map<string,number>)=>{
  const rs = Array.from(cnt.entries()).filter(([r,n])=>n===3 && r!=='2' && r!=='x' && r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  if (rs.length<2) return false;
  for (let i=1;i<rs.length;i++){ if ((__POS[rs[i]]??-1)!==(__POS[rs[i-1]]??-2)+1) return false; }
  return true;
};
const __keyRank = (mv:string[])=>{
  const cnt = __count(mv);
  if ((cnt.get('x')||0)>=1 && (cnt.get('X')||0)>=1 && mv.length===2) return 'X';
  for (const [r,n] of cnt.entries()) if (n===4) return r;
  let best:string|null=null, bp=-1;
  for (const [r,n] of cnt.entries()) if (n>=3 && (__POS[r]??-1)>bp){ best=r; bp=__POS[r]??-1; }
  if (best) return best;
  for (const [r,n] of cnt.entries()) if (n>=2 && (__POS[r]??-1)>bp){ best=r; bp=__POS[r]??-1; }
  if (best) return best;
  if (__isStraight(cnt) || __isPairSeq(cnt) || __isPlane(cnt)) {
    for (const r of Array.from(cnt.keys())) {
      if (r!=='2' && r!=='x' && r!=='X' && (__POS[r]??-1)>bp) { best=r; bp=__POS[r]??-1; }
    }
    if (best) return best;
  }
  for (const r of Array.from(cnt.keys())) {
    const p = __POSALL[r]??-1;
    if (p>bp){ best=r; bp=p; }
  }
  return best || '3';
};
const __longestSingleChain=(cs:string[])=>{
  const cnt=__count(cs);
  const rs=Array.from(cnt.keys()).filter(r=>r!=='2'&&r!=='x'&&r!=='X').sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  let best=0,i=0; while(i<rs.length){ let j=i; while(j+1<rs.length && (__POS[rs[j+1]]??-1)===(__POS[rs[j]]??-2)+1) j++; best=Math.max(best,j-i+1); i=j+1; } return best;
};
const __longestPairChain=(cs:string[])=>{
  const cnt=__count(cs);
  const rs=Array.from(cnt.entries()).filter(([r,n])=>n>=2&&r!=='2'&&r!=='x'&&r!=='X').map(([r])=>r).sort((a,b)=>(__POS[a]??-1)-(__POS[b]??-1));
  let best=0,i=0; while(i<rs.length){ let j=i; while(j+1<rs.length && (__POS[rs[j+1]]??-1)===(__POS[rs[j]]??-2)+1) j++; best=Math.max(best,j-i+1); i=j+1; } return best;
};
function unifiedScore(ctx:any, mv:string[]): number {
  if (!Array.isArray(mv) || mv.length===0) return -999;
  const BASE:Record<string,number> = Object.fromEntries(__ORDER.map(r=>[r,(r==='x'||r==='X')?1:4])) as any;
  const seenAll:string[] = (globalThis as any).__DDZ_SEEN ?? [];
  const unseen = new Map<string,number>(Object.entries(BASE) as any);
  const sub=(arr:string[])=>{ for(const c of arr){ const r=__rank(c); unseen.set(r, Math.max(0,(unseen.get(r)||0)-1)); } };
  sub(ctx.hands||[]); sub(seenAll);
  const cnt = __count(mv);
  const isRocket = (cnt.get('x')||0)>=1 && (cnt.get('X')||0)>=1 && mv.length===2;
  const isBomb = Array.from(cnt.values()).some(n=>n===4);
  const kmax = Math.max( ...Array.from(cnt.values()) );
  const keyR = __keyRank(mv);
  const kp = __POSALL[keyR] ?? -1;
  let risk = 1;
  if (isRocket) risk = 0;
  else if (isBomb) {
    const rx = (unseen.get('x')||0)>0 && (unseen.get('X')||0)>0 ? 1 : 0;
    let hb=0; for (const r of __ORDER){ const p=__POSALL[r]??-1; if (p>kp && (unseen.get(r)||0)===4) hb++; }
    risk = hb*1.5 + (rx?2:0);
  } else if (__isPairSeq(cnt) || __isStraight(cnt) || __isPlane(cnt)) {
    let hm=0; for (const r of __SEQ){ const p=__POSALL[r]??-1; if (p>kp) hm += (unseen.get(r)||0); }
    risk = hm*0.1 + 0.6;
  } else if (kmax>=3) {
    let ht=0; for (const r of __ORDER){ const p=__POSALL[r]??-1; if (p>kp && (unseen.get(r)||0)>=3) ht++; }
    risk = ht + 0.5;
  } else if (kmax===2) {
    let hp=0; for (const r of __ORDER){ const p=__POSALL[r]??-1; if (p>kp && (unseen.get(r)||0)>=2) hp++; }
    const rx = (unseen.get('x')||0)>0 && (unseen.get('X')||0)>0 ? 0.5 : 0;
    risk = hp + rx;
  } else {
    let h=0; for (const r of __ORDER){ if ((__POSALL[r]??-1)>kp) h += (unseen.get(r)||0); }
    const rx = (unseen.get('x')||0)>0 && (unseen.get('X')||0)>0 ? 0.5 : 0;
    risk = h*0.2 + rx;
  }
  const afterSeats=[(ctx.seat+1)%3,(ctx.seat+2)%3];
  const isOpp=(s:number)=> (ctx.seat===ctx.landlord) ? true : (s===ctx.landlord);
  const numOppAfter=afterSeats.filter(isOpp).length;
  const numAllyAfter=afterSeats.length - numOppAfter;
  const seatRiskFactor=(numOppAfter + 0.25*numAllyAfter)/2;
  const before=ctx.hands||[];
  const after=__remove(before, mv);
  const pre=__count(before), post=__count(after);
  let singles=0,lowSingles=0,pairs=0,triples=0,bombs=0,jokers=0;
  for (const [r,n] of post.entries()) {
    if (n===1){ singles++; if(r!=='2'&&r!=='x'&&r!=='X') lowSingles++; }
    else if (n===2) pairs++;
    else if (n===3) triples++;
    else if (n===4) bombs++;
    if (r==='x'||r==='X') jokers+=n;
  }
  let breakPenalty=0; const used=__count(mv);
  for (const [r,k] of used.entries()) {
    const preN=pre.get(r)||0;
    if (preN>=2 && k<preN) breakPenalty += (preN===2?1.0:preN===3?0.8:1.2);
  }
  const chain=__longestSingleChain(after), pairSeq=__longestPairChain(after);
  const bombPenalty = isBomb || isRocket ? 1.2 : 0;
  const outReward = mv.length * 0.4;
  const shape = outReward - singles*1.0 - lowSingles*0.3 + pairs*0.4 + triples*0.5 + bombs*0.6 + jokers*0.2 + chain*0.25 + pairSeq*0.25 - breakPenalty - bombPenalty;
  const score = shape + (-risk * seatRiskFactor) * 0.35;
  return score;
}
/* ========== 小工具 ========== */
const clamp = (v:number, lo=0, hi=5)=> Math.max(lo, Math.min(hi, v));
const writeLine = (res: NextApiResponse, obj: any) => { (res as any).write(JSON.stringify(obj) + '\n'); };

function stringifyMove(m:any){
  if (!m || m.move==='pass') return 'pass';
  const type = m.type ? `${m.type} ` : '';
  const cards = Array.isArray(m.cards) ? m.cards.join('') : String(m.cards||'');
  return `${type}${cards}`;
}

/** 解析每座位思考超时（毫秒） */
function parseTurnTimeoutMsArr(req: NextApiRequest): [number,number,number] {
  const fromQuery = (k:string) => {
    const v = (req.query as any)?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const body:any = (req as any).body || {};
  const secs = body.turnTimeoutSecs ?? body.turnTimeoutSec ?? body.__tt ?? body.tt;
  const clampMs = (x:number)=> Math.max(1000, Math.floor(Number(x||0)*1000));

  if (Array.isArray(secs) && secs.length) {
    const a = clampMs(secs[0] ?? 30);
    const b = clampMs(secs[1] ?? secs[0] ?? 30);
    const c = clampMs(secs[2] ?? secs[1] ?? secs[0] ?? 30);
    return [a,b,c];
  }
  if (typeof secs === 'number') {
    const ms = clampMs(secs);
    return [ms,ms,ms];
  }
  const raw = fromQuery('__tt') ?? fromQuery('tt') ?? fromQuery('turnTimeoutSec') ?? fromQuery('turnTimeoutSecs');
  if (typeof raw === 'string' && raw.trim()) {
    const parts = raw.split(/[\s,\/]+/).filter(Boolean).map(x=>clampMs(Number(x)));
    const a = parts[0] ?? 30000;
    const b = parts[1] ?? a;
    const c = parts[2] ?? b;
    return [a,b,c];
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = clampMs(raw as any);
    return [ms,ms,ms];
  }
  return [30000,30000,30000];
}

/* ========== 类型 ========== */
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'built-in:ally-support'
  | 'built-in:endgame-rush'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

type SeatSpec = {
  choice: BotChoice;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  token?: string;
};

type RunBody = {
  rounds: number;
  four2?: 'both'|'2singles'|'2pairs';
  seats: SeatSpec[];
  seatDelayMs?: number[];
  farmerCoop?: boolean;
  startScore?: number;
  turnTimeoutSecs?: number[];  // [s0,s1,s2]
  turnTimeoutSec?: number | number[];
  rob?: boolean;
  bidStartSeat?: number;
  debug?: any;
};

/* ========== Bot 工厂 ========== */
function providerLabel(choice: BotChoice) {
  switch (choice) {
    case 'built-in:greedy-max': return 'GreedyMax';
    case 'built-in:greedy-min': return 'GreedyMin';
    case 'built-in:random-legal': return 'RandomLegal';
    case 'built-in:ally-support': return 'AllySupport';
    case 'built-in:endgame-rush': return 'EndgameRush';
    case 'ai:openai': return 'OpenAI';
    case 'ai:gemini': return 'Gemini';
    case 'ai:grok': return 'Grok';
    case 'ai:kimi': return 'Kimi';
    case 'ai:qwen': return 'Qwen';
    case 'ai:deepseek': return 'DeepSeek';
    case 'http': return 'HTTP';
  }
}

function asBot(choice: BotChoice, spec?: SeatSpec) {
  switch (choice) {
    case 'built-in:greedy-max': return GreedyMax;
    case 'built-in:greedy-min': return GreedyMin;
    case 'built-in:random-legal': return RandomLegal;
    case 'built-in:ally-support': return AllySupport;
    case 'built-in:endgame-rush': return EndgameRush;
    case 'ai:openai':  return OpenAIBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gpt-4o-mini' });
    case 'ai:gemini':  return GeminiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'gemini-1.5-pro' });
    case 'ai:grok':    return GrokBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'grok-2' });
    case 'ai:kimi':    return KimiBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'kimi-k2-0905-preview' });
    case 'ai:qwen':    return QwenBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'qwen-plus' });
    case 'ai:deepseek':return DeepseekBot({ apiKey: spec?.apiKey || '', model: spec?.model || 'deepseek-chat' });
    case 'http':       return HttpBot({ base: (spec?.baseUrl||'').replace(/\/$/,''), token: spec?.token || '' });
    default:           return GreedyMax;
  }
}

/* ========== Trace 包装（记录 reason + 限时 + 调用事件） ========== */
function traceWrap(
  choice: BotChoice,
  spec: SeatSpec|undefined,
  bot: (ctx:any)=>any,
  res: NextApiResponse,
  onReason: (seat:number, reason?:string)=>void,
  onScore: (seat:number, sc?:number)=>void,
  turnTimeoutMs: number,
  startDelayMs: number,
  seatIndex: number
){
  const label = providerLabel(choice);
  return async (ctx:any) => {
    if (startDelayMs && startDelayMs>0) {
      await new Promise(r => setTimeout(r, Math.min(60_000, startDelayMs)));
    }
    try { writeLine(res, { type:'event', kind:'bot-call', seat: seatIndex, by: label, model: spec?.model||'', phase: ctx?.phase || 'play' }); } catch {}

    const timeout = new Promise((resolve)=> {
      setTimeout(()=> resolve({ move:'pass', reason:`timeout@${Math.round(turnTimeoutMs/1000)}s` }), Math.max(1000, turnTimeoutMs));
    });

    let result:any;
    const t0 = Date.now();
    try {
      const ctxWithSeen = { ...ctx, seen: (globalThis as any).__DDZ_SEEN ?? [], seenBySeat: (globalThis as any).__DDZ_SEEN_BY_SEAT ?? [[],[],[]] };
      try { console.debug('[CTX]', `seat=${ctxWithSeen.seat}`, `landlord=${ctxWithSeen.landlord}`, `leader=${ctxWithSeen.leader}`, `trick=${ctxWithSeen.trick}`, `seen=${ctxWithSeen.seen?.length||0}`, `seatSeen=${(ctxWithSeen.seenBySeat||[]).map((a:any)=>Array.isArray(a)?a.length:0).join('/')}`); } catch {}
      result = await Promise.race([ Promise.resolve(bot(ctxWithSeen)), timeout ]);
    } catch (e:any) {
      result = { move:'pass', reason:`error:${e?.message||String(e)}` };
    }

const unified = (result?.move==='play' && Array.isArray(result?.cards))
      ? unifiedScore(ctx, result.cards)
      : undefined;
    const scoreTag = (typeof unified === 'number') ? ` | score=${unified.toFixed(2)}` : '';
    const reason =
      (result && typeof result.reason === 'string')
        ? `[${label}] ${result.reason}${scoreTag}`
        : `[${label}] ${(result?.move==='play' ? stringifyMove(result) : 'pass')}${scoreTag}`
    try { const cstr = Array.isArray(result?.cards)?result.cards.join(''):''; console.debug('[DECISION]', `seat=${seatIndex}`, `move=${result?.move}`, `cards=${cstr}`, (typeof unified==='number'?`score=${unified.toFixed(2)}`:'') , `reason=${reason}`); } catch {}
    onReason(seatIndex, reason);
    try { onScore(seatIndex, unified as any); } catch {}
    try { writeLine(res, { type:'event', kind:'bot-done', seat: seatIndex, by: label, model: spec?.model||'', tookMs: Date.now()-t0, reason, score: unified }); } catch {}

    return result;
  };
}

/* ========== 单局执行（NDJSON 输出 + 画像统计） ========== */
async function runOneRoundWithGuard(
  { seats, four2, lastReason, lastScore, rob, bidStartSeat }:
  { seats: ((ctx:any)=>Promise<any>)[]; four2: 'both'|'2singles'|'2pairs'; lastReason: (string|null)[]; lastScore: (number|null)[]; rob?: boolean; bidStartSeat?: number },
  res: NextApiResponse,
  round: number
){
  
// True-redeal wrapper
let startSeat = (typeof bidStartSeat==='number' && isFinite(bidStartSeat)) ? ((bidStartSeat%3)+3)%3 : ((round-1)%3);
let tried = 0;
while (true) {
  tried++;

  const iter = runOneGame({ seats, four2 } as any);
  let sentInit = false;

  // 画像统计
  let landlordIdx: number = -1;
  const stats = [0,1,2].map(()=>({
    plays: 0,
    passes: 0,
    cardsPlayed: 0,
    bombs: 0,
    rockets: 0
  }));

  const countPlay = (seat: number, cc: string[]) => {
    try {
      if (Array.isArray(cc) && cc.length) {
        stats[seat].plays++;
        stats[seat].cardsPlayed += cc.length;
        const isRocket = cc.length === 2 && cc.includes('x') && cc.includes('X');
        const isBomb   = !isRocket && cc.length === 4 && (new Set(cc)).size === 1;
        if (isBomb)   stats[seat].bombs++;
        if (isRocket) stats[seat].rockets++;
      } else {
        stats[seat].passes++;
      }
    } catch {}
  };

  let keepThisDeal = false;

  for await (const ev of (iter as any)) {
    // 初始发牌/地主
    if (!sentInit && ev?.type==='init') {
      // run bidding on this deal (based on init.hands & bottom)
      const hands3 = Array.isArray(ev.hands)? ev.hands : [[],[],[]];
      const bottom3 = Array.isArray(ev.bottom)? ev.bottom : [];

      if (rob) {
        // Bidding
        const normRank = (c)=>{ const r=c.replace(/[♠♥♦♣]/g,'').replace(/10/i,'T').toUpperCase(); return (c.startsWith('🃏')?'X':r); };
        const countRanks = (arr)=>{ const m={}; for(const c of arr){ const r=normRank(c); m[r]=(m[r]||0)+1; } return m; };
        const scoreFor = (hand, bottom)=>{ const all=[...hand,...bottom]; const cnt=countRanks(all); let s=0; const W={'X':9,'2':6,'A':5,'K':4,'Q':3,'J':2,'T':1}; for(const r in cnt)s+=(W[r]||0)*cnt[r]; for(const r in cnt){const c=cnt[r]; if(c>=4)s+=6; else if(c===3)s+=4; else if(c===2)s+=2;} return s; };

        writeLine(res, { type:'bottom', cards: bottom3 });
        writeLine(res, { type:'bid-start', startSeat });

        const passed = new Set();
        let calledSeat = null;
        let bestSeat = null;
        let robCount = 0;
        const nextActive = (x)=>{ for(let k=1;k<=3;k++){ const y=(x+k)%3; if(!passed.has(y)) return y; } return x; };
        let cur = startSeat;
        let steps = 0;
        while (steps < 12) {
          steps++;
          if (passed.has(cur)) { cur = nextActive(cur); continue; }
          const canCall = (calledSeat==null);
          const canRob  = (calledSeat!=null);
          const sc = scoreFor(hands3[cur]||[], bottom3);
          let action = 'pass';
          if (canCall) action = (sc>=20 ? 'call':'pass'); else action = (sc>=24 ? 'rob':'pass');
          writeLine(res, { type:'bid', seat:cur, action });
          if (action==='call') { calledSeat = cur; bestSeat = cur; }
          else if (action==='rob') { if (bestSeat !== cur) { bestSeat = cur; robCount++; writeLine(res, { type:'event', kind:'rob', rob:true, seat:cur }); } }
          else { passed.add(cur); }
          if (calledSeat!=null) { const active=[0,1,2].filter(i=>!passed.has(i)); if (active.length<=1) break; }
          else if (passed.size>=3) break;
          cur = nextActive(cur);
        }

        if (calledSeat==null) {
          // all pass => abandon deal, rotate starter, and restart outer loop
          startSeat = (startSeat + 1) % 3;
          writeLine(res, { type:'redeal', tried, reason:'nobody-called', nextStart:startSeat });
          keepThisDeal = false;
          break; // exit for-await
        } else {
          writeLine(res, { type:'bid-result', landlord: (bestSeat), tried, robCount });
          // keep the deal; now forward init and continue streaming
          sentInit = true;
          landlordIdx = (ev.landlordIdx ?? ev.landlord ?? -1);
          writeLine(res, { type:'init', landlordIdx, landlord: (typeof ev.landlord !== 'undefined' ? ev.landlord : undefined), hands: ev.hands, bottom: ev.bottom });
          keepThisDeal = true;
          continue;
        }
      } else {
        // no bidding mode
        sentInit = true;
        landlordIdx = (ev.landlordIdx ?? ev.landlord ?? -1);
        writeLine(res, { type:'init', landlordIdx, landlord: (typeof ev.landlord !== 'undefined' ? ev.landlord : undefined), hands: ev.hands, bottom: ev.bottom });
        keepThisDeal = true;
        continue;
      }
    }

    if (!sentInit) {
      // ignore any pre-init noise
      continue;
    }

    // 转发普通事件
    if (ev?.type==='event') {
      if (ev?.kind==='play' && Array.isArray(ev?.cards) && typeof ev?.seat==='number') {
        countPlay(ev.seat, ev.cards);
      }
      writeLine(res, ev);
    } else if (ev?.type==='log' && typeof ev?.message==='string') {
      writeLine(res, ev);
    } else if (ev?.type==='result') {
      writeLine(res, ev);
    } else {
      writeLine(res, ev);
    }
  } // end for-await iter

  if (keepThisDeal) {
    break; // streamed this round
  }
} // end while(true)

}

/* ========== HTTP 处理 ========== */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
  } catch {}

  const keepAlive = setInterval(() => { try { (res as any).write('\n'); } catch {} }, 15000);

  try {
    const body: RunBody = (req as any).body as any;
    const rounds = Math.max(1, Math.floor(Number(body.rounds || 1)));
    const four2  = (body.four2 || 'both') as 'both'|'2singles'|'2pairs';

    const turnTimeoutMsArr = parseTurnTimeoutMsArr(req);
    const seatSpecs = (body.seats || []).slice(0,3) as SeatSpec[];
    const baseBots = seatSpecs.map((s) => asBot(s.choice, s));
    const delays = ((body.seatDelayMs || []) as number[]);

    writeLine(res, { type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` });

    for (let round = 1; round <= rounds; round++) {
      writeLine(res, { type:'log', message:`—— 第 ${round} 局开始 ——` });
      writeLine(res, { type:'event', kind:'round-start', round });





      // —— per-request buffers for reason/score ——
      const lastReason: (string|null)[] = [null, null, null];
      const lastScore:  (number|null)[] = [null, null, null];
      const onReason = (seat:number, text?:string)=>{ if (seat>=0 && seat<3) lastReason[seat] = text || null; };
      const onScore  = (seat:number, sc?:number)=>{ if (seat>=0 && seat<3) lastScore[seat] = (typeof sc==='number'? sc: null); };
      const wrapped = baseBots.map((bot, i) =>
        traceWrap(seatSpecs[i]?.choice as BotChoice, seatSpecs[i], bot as any, res, onReason, onScore,
                  turnTimeoutMsArr[i] ?? turnTimeoutMsArr[0],
                  Math.max(0, Math.floor(delays[i] ?? 0)),
                  i)
      );

      await runOneRoundWithGuard({ seats: wrapped as any, four2, lastReason, lastScore, rob: !!body.rob, bidStartSeat: Number.isFinite((body as any).bidStartSeat) ? (Number((body as any).bidStartSeat)%3+3)%3 : ((round-1)%3) }, res, round);
writeLine(res, { type:'event', kind:'round-end', round });
      if (round < rounds) writeLine(res, { type:'log', message:`—— 第 ${round} 局结束 ——` });
    }
  } catch (e:any) {
    writeLine(res, { type:'log', message:`后端错误：${e?.message || String(e)}` });
  } finally {
    try{ clearInterval(keepAlive as any);}catch{};
    try{ (res as any).end(); }catch{}
  }
}