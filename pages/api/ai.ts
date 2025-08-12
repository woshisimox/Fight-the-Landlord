import type { NextApiRequest, NextApiResponse } from 'next';
const SYS_JSON = 'Only respond with strict JSON: {"tiles":["<codes>"], "reason":"short"}';

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  try{
    const { provider, snapshot, keys } = req.body || {};
    if (!provider || !snapshot) return res.status(400).json({ error: 'bad request' });
    const apiKey: string | undefined = keys?.apiKey;

    if (provider==='openai' && apiKey){ return res.status(200).json(await callOpenAI(apiKey, snapshot)); }
    if (provider==='kimi'   && apiKey){ return res.status(200).json(await callKimi(apiKey, snapshot)); }
    if (provider==='grok'   && apiKey){ return res.status(200).json(await callGrok(apiKey, snapshot)); }

    return res.status(200).json({ tileCodes: [], reason:'no key → pass', meta:{ usedApi:false, provider:'fallback' } });
  }catch(e:any){
    res.status(200).json({ tileCodes: [], reason:'proxy error → pass', meta:{ usedApi:true, provider:'fallback', detail: e?.message || 'error' } });
  }
}

function buildPrompt(snapshot: any): string {
  return `你是斗地主出牌助手。\n我的手牌(编码): ${snapshot.hand.join(' ')}\n牌桌历史(最近在后): ${snapshot.history.map((h:any)=>`S${h.seat}:${h.combo}`).join(' | ') || '无'}\n任务: 输出严格JSON {"tiles":["编码..."],"reason":"简要"}。\n要求: 若无法压过上一手则出[]表示过牌。不解释规则，不加多余字段。`;
}
function extractFirstJson(s: string): any | null { try{ const m=s.match(/\{[\s\S]*\}/); if (!m) return null; return JSON.parse(m[0]); } catch { return null; } }

async function callOpenAI(key: string, snapshot: any){
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model:'gpt-4o-mini', temperature:0.2, messages:[{role:'system',content:SYS_JSON},{role:'user',content:buildPrompt(snapshot)}] })
  }); const data:any = await resp.json(); const text = data?.choices?.[0]?.message?.content || ''; const j = extractFirstJson(text);
  if (!j) return { tileCodes: [], reason: 'invalid json → pass', meta:{ usedApi:true, provider:'openai', detail: text?.slice(0,200) } };
  return { tileCodes: Array.isArray(j.tiles)? j.tiles: [], reason: j.reason||'', meta:{ usedApi:true, provider:'openai' } };
}
async function callKimi(key: string, snapshot: any){
  const resp = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model:'kimi-2.1-mini', temperature:0.2, messages:[{role:'system',content:SYS_JSON},{role:'user',content:buildPrompt(snapshot)}] })
  }); const data:any = await resp.json(); const text = data?.choices?.[0]?.message?.content || ''; const j = extractFirstJson(text);
  if (!j) return { tileCodes: [], reason: 'invalid json → pass', meta:{ usedApi:true, provider:'kimi', detail: text?.slice(0,200) } };
  return { tileCodes: Array.isArray(j.tiles)? j.tiles: [], reason: j.reason||'', meta:{ usedApi:true, provider:'kimi' } };
}
async function callGrok(key: string, snapshot: any){
  const resp = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model:'grok-2-mini', temperature:0.2, messages:[{role:'system',content:SYS_JSON},{role:'user',content:buildPrompt(snapshot)}] })
  }); const data:any = await resp.json(); const text = data?.choices?.[0]?.message?.content || ''; const j = extractFirstJson(text);
  if (!j) return { tileCodes: [], reason: 'invalid json → pass', meta:{ usedApi:true, provider:'grok', detail: text?.slice(0,200) } };
  return { tileCodes: Array.isArray(j.tiles)? j.tiles: [], reason: j.reason||'', meta:{ usedApi:true, provider:'grok' } };
}
