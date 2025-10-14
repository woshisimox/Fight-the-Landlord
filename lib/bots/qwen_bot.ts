// lib/bots/qwen_bot.ts
import { extractFirstJsonObject, nonEmptyReason } from './util';

type BotMove =
  | { move: 'pass'; reason?: string }
  | { move: 'play'; cards: string[]; reason?: string };
type BotCtx = { hands: string[]; require?: any; canPass: boolean; policy?: any };
type BotFunc = (ctx: BotCtx) => Promise<BotMove> | BotMove;

// 简易兜底（当上游 API 出错时）：
// - 若允许过牌：直接过牌
// - 否则：打出第一张手牌（可能不是最优，但可让引擎继续运行）
function fallbackMove(ctx: BotCtx, reason: string): BotMove {
  if (ctx && ctx.canPass) return { move: 'pass', reason };
  const first = Array.isArray(ctx?.hands) && ctx.hands.length ? ctx.hands[0] : '3';
  return { move: 'play', cards: [first], reason };
}


const toMessageString = (content: any): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (typeof part === 'object' && typeof part.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof (content as any).text === 'string') return (content as any).text;
    if (typeof (content as any).content === 'string') return (content as any).content;
  }
  return '';
};

export const QwenBot=(o:{apiKey:string,model?:string}):BotFunc=>async (ctx:BotCtx)=>{
  try{
    if(!o.apiKey) throw new Error('Missing Qwen API Key');
    const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    const r = await fetch(url, {
      method:'POST',
      headers:{'content-type':'application/json', authorization:`Bearer ${o.apiKey}`},
      body: JSON.stringify({
        model:o.model||'qwen-plus',
        temperature:0.2,
        stream:false,
        response_format:{ type:'json_object' },
        messages:[
          {role:'system',content:'Only reply with a strict JSON object for the move.'},
          {role:'user',content:
            `你是斗地主出牌助手。必须只输出一个 JSON 对象：\n`+
            `{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }\n\n`+
            `手牌：${ctx.hands.join('')}\n`+
            `需跟：${ctx.require?JSON.stringify(ctx.require):'null'}\n`+
            `可过：${ctx.canPass?'true':'false'}\n`+
            `策略：${ctx.policy}\n`+
              `座位：我=${(ctx as any).seat} 地主=${(ctx as any).landlord} 首家=${(ctx as any).leader} 轮次=${(ctx as any).trick}\n`+
              `按座位已出牌：S0=${(Array.isArray((ctx as any).seenBySeat) && (ctx as any).seenBySeat[0]?.join('')) || ''} | S1=${(Array.isArray((ctx as any).seenBySeat) && (ctx as any).seenBySeat[1]?.join('')) || ''} | S2=${(Array.isArray((ctx as any).seenBySeat) && (ctx as any).seenBySeat[2]?.join('')) || ''}\n`+

            `已出牌：${(Array.isArray((ctx as any).seen) && (ctx as any).seen.length) ? (ctx as any).seen.join('') : '无'}\n`+
            
            `只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。请仅返回严格的 JSON：{"move":"play"|"pass","cards":string[],"reason":string}。`
          }
        ]
      })
    });
    if(!r.ok) throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,200));
    const j:any = await r.json();
    const t = toMessageString(j?.choices?.[0]?.message?.content);
    const p:any = extractFirstJsonObject(String(t)) || {};
    const m = p.move==='pass' ? 'pass' : 'play';
    const cds:string[] = Array.isArray(p.cards)?p.cards:[];
    const reason = nonEmptyReason(p.reason,'Qwen');
    if(m==='pass') return {move:'pass',reason};
    if(cds.length===0){
      return fallbackMove(ctx, 'Qwen 返回不含有效 cards，已回退');
    }
    return {move:'play',cards:cds,reason};
  }catch(e:any){
    const reason=`Qwen 调用失败：${e?.message||e}，已回退`;
    return fallbackMove(ctx, reason);
  }
};
