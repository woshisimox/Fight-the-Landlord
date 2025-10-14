// lib/bots/openai_bot.ts
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
    const rec = !!((ctx as any)?.bid?.recommended);
    return { phase: 'bid', bid: rec, reason: nonEmptyReason(reason, 'OpenAI') };
  }
  if ((ctx as any)?.phase === 'double') {
    const rec = !!((ctx as any)?.double?.recommended);
    return { phase: 'double', double: rec, reason: nonEmptyReason(reason, 'OpenAI') };
  }
  if (ctx && ctx.canPass) return { move: 'pass', reason };
  const first = Array.isArray(ctx?.hands) && ctx.hands.length ? ctx.hands[0] : '3';
  return { phase: 'play', move: 'play', cards: [first], reason };
}


export const OpenAIBot = (o: { apiKey: string; model?: string }): BotFunc =>
  async (ctx: BotCtx) => {
    try {
      if (!o.apiKey) throw new Error('Missing OpenAI API Key');
      const url = 'https://api.openai.com/v1/chat/completions';
      const phase = (ctx as any)?.phase || 'play';
      const handsStr = Array.isArray(ctx?.hands) ? ctx.hands.join('') : '';
      const seenBySeat = Array.isArray((ctx as any)?.seenBySeat) ? (ctx as any).seenBySeat : [[],[],[]];
      const seatLine = `座位：我=${(ctx as any).seat} 地主=${(ctx as any).landlord} 首家=${(ctx as any).leader} 轮次=${(ctx as any).trick}`;
      let messages: { role:'system'|'user'; content:string }[] = [];

      if (phase === 'bid') {
        const info = (ctx as any)?.bid || {};
        const score = typeof info.score === 'number' ? info.score.toFixed(2) : '未知';
        const th = typeof info.threshold === 'number' ? info.threshold.toFixed(2) : '未知';
        const mult = typeof info.multiplier === 'number' ? info.multiplier : (typeof info.bidMultiplier === 'number' ? info.bidMultiplier : 1);
        const bidders = Array.isArray(info.bidders) ? info.bidders.map((b:any)=>`S${b.seat}`).join(',') : '无';
        messages = [
          { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
          { role: 'user', content:
            `你是斗地主决策助手，目前阶段是抢地主。\n`+
            `请仅返回一个 JSON 对象：{"phase":"bid","bid":true|false,"reason":"简要说明"}。\n`+
            `手牌：${handsStr}\n`+
            `启发分：${score}｜阈值：${th}｜当前倍数：${mult}｜默认建议：${info.recommended ? '抢' : '不抢'}\n`+
            `已抢座位：${bidders}\n`+
            `${seatLine}\n`+
            `回答必须是严格的 JSON，bid=true 表示抢地主，false 表示不抢。`
          }
        ];
      } else if (phase === 'double') {
        const info = (ctx as any)?.double || {};
        const role = info?.role || 'farmer';
        const base = typeof info?.baseMultiplier === 'number' ? info.baseMultiplier : 1;
        const rec = info?.recommended ? '加倍' : '不加倍';
        const farmerInfo = info?.info?.farmer || {};
        const landlordInfo = info?.info?.landlord || {};
        const dLhat = typeof farmerInfo.dLhat === 'number' ? farmerInfo.dLhat.toFixed(2) : '未知';
        const counter = typeof farmerInfo.counter === 'number' ? farmerInfo.counter.toFixed(2) : '未知';
        const delta = typeof landlordInfo.delta === 'number' ? landlordInfo.delta.toFixed(2) : undefined;
        messages = [
          { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
          { role: 'user', content:
            `你是斗地主决策助手，目前阶段是明牌后的加倍决策。\n`+
            `请仅返回一个 JSON 对象：{"phase":"double","double":true|false,"reason":"简要说明"}。\n`+
            `角色：${role}｜基础倍数：${base}｜默认建议：${rec}\n`+
            (role==='landlord' && delta ? `地主底牌增益Δ≈${delta}\n` : '')+
            (role!=='landlord' ? `估计Δ̂=${dLhat}｜counter=${counter}\n` : '')+
            `${seatLine}\n`+
            `回答必须是严格的 JSON，double=true 表示加倍，false 表示不加倍。`
          }
        ];
      } else {
        messages = [
          { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
          { role: 'user', content:
            `你是斗地主出牌助手。必须只输出一个 JSON 对象：\n`+
            `{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }\n\n`+
            `手牌：${handsStr}\n`+
            `需跟：${ctx.require?JSON.stringify(ctx.require):'null'}\n`+
            `可过：${ctx.canPass?'true':'false'}\n`+
            `策略：${ctx.policy}\n`+
            `${seatLine}\n`+
            `按座位已出牌：S0=${(seenBySeat[0]?.join('')) || ''} | S1=${(seenBySeat[1]?.join('')) || ''} | S2=${(seenBySeat[2]?.join('')) || ''}\n`+
            `只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。请仅返回严格的 JSON：{"move":"play"|"pass","cards":string[],"reason":string}。`
          }
        ];
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model || 'gpt-4o-mini',
          temperature: 0.2,
          messages
        })
      });
      if (!r.ok) throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,200));
      const j:any = await r.json();
      const t = j?.choices?.[0]?.message?.content ?? '';
      const p:any = extractFirstJsonObject(String(t)) || {};
      if (phase === 'bid') {
        if (typeof p.bid === 'boolean') {
          return { phase: 'bid', bid: !!p.bid, reason: nonEmptyReason(p.reason, 'OpenAI') };
        }
        if (p.move === 'pass') return { phase: 'bid', bid: false, reason: nonEmptyReason(p.reason, 'OpenAI') };
        if (p.move === 'play') return { phase: 'bid', bid: true, reason: nonEmptyReason(p.reason, 'OpenAI') };
        throw new Error('invalid bid response');
      }
      if (phase === 'double') {
        if (typeof p.double === 'boolean') {
          return { phase: 'double', double: !!p.double, reason: nonEmptyReason(p.reason, 'OpenAI') };
        }
        if (typeof p.bid === 'boolean') {
          return { phase: 'double', double: !!p.bid, reason: nonEmptyReason(p.reason, 'OpenAI') };
        }
        if (p.move === 'pass') return { phase: 'double', double: false, reason: nonEmptyReason(p.reason, 'OpenAI') };
        if (p.move === 'play') return { phase: 'double', double: true, reason: nonEmptyReason(p.reason, 'OpenAI') };
        throw new Error('invalid double response');
      }
      const m = p.move==='pass' ? 'pass' : 'play';
      const cds:string[] = Array.isArray(p.cards)?p.cards:[];
      const reason = nonEmptyReason(p.reason,'OpenAI');
      return m==='pass'?{phase:'play',move:'pass',reason}:{phase:'play',move:'play',cards:cds,reason};
    } catch(e:any) {
      const reason=`OpenAI 调用失败：${e?.message||e}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
