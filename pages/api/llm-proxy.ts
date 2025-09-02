import type { NextApiRequest, NextApiResponse } from 'next';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { provider, action, payload } = req.body || {};
    if (action === 'bid') {
      const hand: string[] = payload?.hand || []; let score = 1;
      const has2 = hand.some(x=>x.endsWith('2')); const hasBJ = hand.includes('BJ'); const hasSJ = hand.includes('SJ');
      if ((has2 && hasSJ) || hasBJ) score = 3; else if (has2 || hasSJ) score = 2; return res.json({ bid: score });
    }
    if (action === 'play') {
      const legal = Array.isArray(payload?.legal) ? payload.legal : []; const lead = !!payload?.lead;
      if (!legal.length) return res.json({ move:'pass', reason:'无路可走' });
      const singles = legal.filter((c:any)=>c.type==='single').sort((a:any,b:any)=>a.mainRank-b.mainRank);
      const pairs = legal.filter((c:any)=>c.type==='pair').sort((a:any,b:any)=>a.mainRank-b.mainRank);
      const bombs = legal.filter((c:any)=>c.type==='bomb').sort((a:any,b:any)=>a.mainRank-b.mainRank);
      const rockets = legal.filter((c:any)=>c.type==='rocket');
      let pick:any = null;
      if (lead) { pick = rockets[0] || bombs[0] || pairs[0] || singles[0] || legal[0]; return res.json({ move:'play', combo: pick, reason:'规则化策略：优先强牌领出' }); }
      pick = legal.sort((a:any,b:any)=>a.mainRank-b.mainRank)[0]; return res.json({ move:'play', combo: pick, reason:'规则化策略：能压就最小能压' });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e:any) {
    return res.status(200).json({ move:'pass', reason:`LLM-Proxy异常：${String(e?.message || e).slice(0,120)}` });
  }
}