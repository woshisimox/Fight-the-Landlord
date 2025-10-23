// lib/bots/deepseek_bot.ts
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

export function DeepseekBot({ apiKey, model }: { apiKey?: string; model?: string }) {
  const endpoint = 'https://api.deepseek.com/v1/chat/completions';
  const mdl = (model && String(model).trim()) || 'deepseek-chat';

  return async function bot(ctx: BotCtx): Promise<BotMove> {
    try {
      if (!apiKey) throw new Error('DeepSeek API key 未配置');

      const phase = (ctx as any)?.phase || 'play';
      const handsStr = Array.isArray(ctx?.hands) ? ctx.hands.join('') : '';
      const seenBySeat = Array.isArray((ctx as any)?.seenBySeat) ? (ctx as any).seenBySeat : [[],[],[]];
      const seenArr = Array.isArray((ctx as any)?.seen) ? (ctx as any).seen : [];
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
          `这是第 ${attempt}/${total} 次尝试，请依据手牌结构、顺位与公开信息，自主判断是否抢地主，并给出简要理由。\n`+
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
          `请基于公开信息、手牌与对局进程，自主判断是否加倍并提供理由。\n`+
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

      const prompt = [
        { role: 'system', content: 'Only reply with a strict JSON object for the move.' },
        { role: 'user', content: userPrompt }
      ] as any[];

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: mdl, temperature: 0.2, messages: prompt, stream: false })
      });
      if (!resp.ok) throw new Error('HTTP '+resp.status+' '+(await resp.text()).slice(0,200));
      const j: any = await resp.json();
      const txt = j?.choices?.[0]?.message?.content || '';
      const parsed: any = extractFirstJsonObject(String(txt)) || {};
      if (phase === 'bid') {
        if (typeof parsed.bid === 'boolean') {
          return { phase: 'bid', bid: !!parsed.bid, reason: nonEmptyReason(parsed.reason, 'DeepSeek') };
        }
        if (parsed.move === 'pass') return { phase: 'bid', bid: false, reason: nonEmptyReason(parsed.reason, 'DeepSeek') };
        if (parsed.move === 'play') return { phase: 'bid', bid: true, reason: nonEmptyReason(parsed.reason, 'DeepSeek') };
        throw new Error('invalid bid response');
      }
      if (phase === 'double') {
        if (typeof parsed.double === 'boolean') {
          return { phase: 'double', double: !!parsed.double, reason: nonEmptyReason(parsed.reason, 'DeepSeek') };
        }
        if (typeof parsed.bid === 'boolean') {
          return { phase: 'double', double: !!parsed.bid, reason: nonEmptyReason(parsed.reason, 'DeepSeek') };
        }
        if (parsed.move === 'pass') return { phase: 'double', double: false, reason: nonEmptyReason(parsed.reason, 'DeepSeek') };
        if (parsed.move === 'play') return { phase: 'double', double: true, reason: nonEmptyReason(parsed.reason, 'DeepSeek') };
        throw new Error('invalid double response');
      }
      const mv = parsed.move === 'pass' ? 'pass' : 'play';
      const cards: string[] = Array.isArray(parsed.cards) ? parsed.cards : [];
      const reason = nonEmptyReason(parsed.reason, 'DeepSeek');

      if (mv === 'pass') return { phase:'play', move:'pass', reason };
      if (cards.length) return { phase:'play', move:'play', cards, reason };
      return fallbackMove(ctx, 'DeepSeek 返回不含有效 cards，已回退');
    } catch (e: any) {
      const reason = `DeepSeek 调用失败：${e?.message || e}，已回退`;
      return fallbackMove(ctx, reason);
    }
  };
}
