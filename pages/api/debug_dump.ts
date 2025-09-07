import type { NextApiRequest, NextApiResponse } from 'next';
export default function handler(req: NextApiRequest, res: NextApiResponse){
  res.status(200).json({ ok:true, now:new Date().toISOString(), note: 'This is a placeholder. Point the Debug panel to your real backend /api/debug_dump if you have one.' });
}
