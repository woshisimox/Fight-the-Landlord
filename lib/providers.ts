import { z } from 'zod';

export type Provider = 'openai'|'kimi'|'grok';

export const MoveSchema = z.object({
  cards: z.array(z.string()).default([]),
  reason: z.string().default(''),
});
export type Move = z.infer<typeof MoveSchema>;

export function buildPrompt(hand: string[], snapshot: any){
  const snap = JSON.stringify(snapshot||{}).slice(0, 1800);
  return `你是斗地主出牌助手。
你的手牌(以空格分隔): ${hand.join(' ')}
局面(不可丢失关键信息，JSON): ${snap}
任务: 
1) 在【SINGLE/PAIR/TRIPLE/TRIPLE_WITH_SINGLE/TRIPLE_WITH_PAIR/STRAIGHT/CONSECUTIVE_PAIRS/AIRPLANE/AIRPLANE_SINGLE/AIRPLANE_PAIR/BOMB】这些类型内选择，必须来自你的手牌。
2) 必须要能压过上一手(若有)；若无法压过，返回空数组表示PASS。
3) 严格输出 JSON（不要多余文字）: {"cards":["<从手牌中选择>"],"reason":"<10~40字简要依据>"}`;
}

export async function callProvider(provider: Provider, key: string, prompt: string): Promise<{ text: string; raw: any }>{ 
  if (!key) throw new Error('Missing API key');
  if (provider==='openai') {
    const resp = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST', headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.2,
        messages:[{role:'system', content:'Only respond with JSON.'},{role:'user', content:prompt}] })
    });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
    return { text, raw: data };
  }
  if (provider==='kimi') {
    const resp = await fetch('https://api.moonshot.cn/v1/chat/completions',{
      method:'POST', headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'moonshot-v1-8k', temperature:0.2,
        messages:[{role:'system', content:'Only respond with JSON.'},{role:'user', content:prompt}] })
    });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
    return { text, raw: data };
  }
  if (provider==='grok') {
    const resp = await fetch('https://api.x.ai/v1/chat/completions',{
      method:'POST', headers:{ 'Authorization':`Bearer ${key}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ model:'grok-2-mini', temperature:0.2,
        messages:[{role:'system', content:'Only respond with JSON.'},{role:'user', content:prompt}] })
    });
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
    return { text, raw: data };
  }
  throw new Error('Unknown provider');
}
