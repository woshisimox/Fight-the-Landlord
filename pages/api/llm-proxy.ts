import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { mode, payload } = req.body || {};
  try {
    if (mode==='bid') {
      const ranks: string[] = payload?.ranks || [];
      const strong = ranks.filter(r=> r==='BJ' || r==='SJ' || r==='2' || r==='A' || r==='K');
      const action = strong.length>=2 ? 2 : (strong.length>=1 ? 1 : 'pass');
      res.status(200).json({ action, reason: 'proxy-heuristic' }); return;
    }
    if (mode==='play') {
      const legal = payload?.legal || [];
      if (!Array.isArray(legal) || legal.length===0) {
        res.status(200).json({ move:'pass', reason:'no-legal' }); return;
      }
      const typeOrder = ['pair','triple','single','bomb','rocket'];
      legal.sort((a:any,b:any)=> (typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type)) || (a.mainRank - b.mainRank));
      const pick = legal[0];
      res.status(200).json({ move:'play', combo: pick, reason: 'proxy-heuristic' }); return;
    }
    res.status(400).json({ error: 'bad mode' });
  } catch (e:any) {
    res.status(200).json({ move:'pass', reason:`proxy-error: ${String(e?.message||e)}` });
  }
}
