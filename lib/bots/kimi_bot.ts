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

export const KimiBot=(o:{apiKey:string,model?:string,baseUrl?:string}):BotFunc=>async (ctx:BotCtx)=>{
  try{
    if(!o.apiKey) throw new Error('Missing Kimi API Key');
    await throttle();
    const url = (o.baseUrl||'https://api.moonshot.cn').replace(/\/$/, '') + '/v1/chat/completions';
    const phase = (ctx as any)?.phase || 'play';
    const handsStr = Array.isArray(ctx?.hands) ? ctx.hands.join('') : '';
    const seenArr = Array.isArray((ctx as any)?.seen) ? (ctx as any).seen : [];
    const seenBySeat = Array.isArray((ctx as any)?.seenBySeat) ? (ctx as any).seenBySeat : [[],[],[]];
    const seatLine = `座位：我=${(ctx as any).seat} 地主=${(ctx as any).landlord} 首家=${(ctx as any).leader} 轮次=${(ctx as any).trick}`;
    let userPrompt = '';
    if (phase === 'bid') {
      const info = (ctx as any)?.bid || {};
      const score = typeof info.score === 'number' ? info.score.toFixed(2) : '未知';
      const mult = typeof info.multiplier === 'number' ? info.multiplier : (typeof info.bidMultiplier === 'number' ? info.bidMultiplier : 1);
      const attempt = typeof info.attempt === 'number' ? info.attempt + 1 : 1;
      const total = typeof info.maxAttempts === 'number' ? info.maxAttempts : 5;
      const bidders = Array.isArray(info.bidders) ? info.bidders.map((b:any)=>`S${b.seat}`).join(',') : '无';
      userPrompt =
        `你是斗地主决策助手，目前阶段是抢地主。必须只输出一个 JSON 对象：{"phase":"bid","bid":true|false,"reason":"简要说明"}。\n`+
        `手牌：${handsStr}\n`+
        `启发分参考：${score}｜当前倍数：${mult}｜已抢座位：${bidders}\n`+
        `这是第 ${attempt}/${total} 次尝试，请结合手牌、顺位与公共信息，自主判断是否抢地主，并给出简要理由。\n`+
        `${seatLine}\n`+
        `回答必须是严格的 JSON，bid=true 表示抢地主，false 表示不抢。`;
    } else if (phase === 'double') {
      const info = (ctx as any)?.double || {};
      const role = info?.role || 'farmer';
      const base = typeof info?.baseMultiplier === 'number' ? info.baseMultiplier : 1;
      const farmerInfo = info?.info?.farmer || {};
      const landlordInfo = info?.info?.landlord || {};
      const dLhat = typeof farmerInfo.dLhat === 'number' ? farmerInfo.dLhat.toFixed(2) : '未知';
      const counter = typeof farmerInfo.counter === 'number' ? farmerInfo.counter.toFixed(2) : '未知';
      const delta = typeof landlordInfo.delta === 'number' ? landlordInfo.delta.toFixed(2) : undefined;
      userPrompt =
        `你是斗地主决策助手，目前阶段是明牌后的加倍决策。必须只输出一个 JSON 对象：{"phase":"double","double":true|false,"reason":"简要说明"}。\n`+
        `角色：${role}｜基础倍数：${base}\n`+
        (role==='landlord' && delta ? `地主底牌增益Δ≈${delta}\n` : '')+
        (role!=='landlord' ? `估计Δ̂=${dLhat}｜counter=${counter}\n` : '')+
        `请结合公开信息与手牌，自主判断是否加倍，并给出简要理由。\n`+
        `${seatLine}\n`+
        `回答必须是严格的 JSON，double=true 表示加倍，false 表示不加倍。`;
    } else {
      userPrompt =
        `你是斗地主出牌助手。必须只输出一个 JSON 对象：\n`+
        `{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }\n\n`+
        `手牌：${handsStr}\n`+
        `需跟：${ctx.require?JSON.stringify(ctx.require):'null'}\n`+
        `点数大小：3<4<5<6<7<8<9<T<J<Q<K<A<2<x<X（2 大于 K）\n`+
        `可过：${ctx.canPass?'true':'false'}\n`+
        `策略：${ctx.policy}\n`+
        `${seatLine}\n`+
        `按座位已出牌：S0=${(seenBySeat[0]?.join('')) || ''} | S1=${(seenBySeat[1]?.join('')) || ''} | S2=${(seenBySeat[2]?.join('')) || ''}\n`+
        `已出牌：${seenArr.length ? seenArr.join('') : '无'}\n`+
        `只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。请仅返回严格的 JSON：{"move":"play"|"pass","cards":string[],"reason":string}。`;
    }

    const r = await fetch(url, {
      method:'POST',
      headers:{'content-type':'application/json', authorization:`Bearer ${o.apiKey}`},
      body: JSON.stringify({
        model:o.model||'moonshot-v1-8k',
        temperature:0.2,
        messages:[
          {role:'system',content:'Only reply with a strict JSON object for the move.'},
          {role:'user',content:userPrompt}
        ]
      })
    });
    if(!r.ok) throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,200));
    const j:any = await r.json();
    const usage = parseUsage(j?.usage);
    const t = j?.choices?.[0]?.message?.content || '';
    const p:any = extractFirstJsonObject(String(t)) || {};
    if (phase === 'bid') {
      if (typeof p.bid === 'boolean') {
        return attachUsage({ phase: 'bid', bid: !!p.bid, reason: nonEmptyReason(p.reason,'Kimi') }, usage);
      }
      if (p.move === 'pass') return attachUsage({ phase: 'bid', bid: false, reason: nonEmptyReason(p.reason,'Kimi') }, usage);
      if (p.move === 'play') return attachUsage({ phase: 'bid', bid: true, reason: nonEmptyReason(p.reason,'Kimi') }, usage);
      throw new Error('invalid bid response');
    }
    if (phase === 'double') {
      if (typeof p.double === 'boolean') {
        return attachUsage({ phase: 'double', double: !!p.double, reason: nonEmptyReason(p.reason,'Kimi') }, usage);
      }
      if (typeof p.bid === 'boolean') {
        return attachUsage({ phase: 'double', double: !!p.bid, reason: nonEmptyReason(p.reason,'Kimi') }, usage);
      }
      if (p.move === 'pass') return attachUsage({ phase: 'double', double: false, reason: nonEmptyReason(p.reason,'Kimi') }, usage);
      if (p.move === 'play') return attachUsage({ phase: 'double', double: true, reason: nonEmptyReason(p.reason,'Kimi') }, usage);
      throw new Error('invalid double response');
    }
    const m = p.move==='pass' ? 'pass' : 'play';
    const cds:string[] = Array.isArray(p.cards)?p.cards:[];
    const reason = nonEmptyReason(p.reason,'Kimi');
    return attachUsage(
      m==='pass'
        ? {phase:'play',move:'pass',reason}
        : {phase:'play',move:'play',cards:cds,reason},
      usage
    );
  }catch(e:any){
    const reason=`Kimi 调用失败：${e?.message||e}，已回退`;
    return fallbackMove(ctx, reason);
  }
};
