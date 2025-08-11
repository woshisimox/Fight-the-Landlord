import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { MoveSchema, buildPrompt, callProvider, Provider } from '@/lib/providers';
import { inferCombo, beats } from '@/lib/ddz';

const ReqSchema = z.object({
  provider: z.enum(['openai','kimi','grok']),
  apiKey: z.string().min(8),
  hand: z.array(z.string()),
  snapshot: z.any()
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { provider, apiKey, hand, snapshot } = ReqSchema.parse(req.body);
    const prompt = buildPrompt(hand, snapshot);
    const { text, raw } = await callProvider(provider as Provider, apiKey, prompt);

    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    const move = MoveSchema.parse(parsed);

    // server-side quick legality check: if illegal, return empty (PASS)
    const combo = inferCombo(move.cards);
    const last = snapshot?.lastCombo || null;
    if (!combo || (combo.type!=='PASS' && !beats(combo, last))) {
      return res.status(200).json({ ok:true, move:{ cards:[], reason:'server-fix: illegal -> PASS' }, rawSummary: summarizeRaw(raw) });
    }

    return res.status(200).json({ ok:true, move, rawSummary: summarizeRaw(raw) });
  } catch (e:any) {
    return res.status(200).json({ ok:false, error: e?.message || 'unknown' });
  }
}

function summarizeRaw(raw:any){
  try{
    const id = raw?.id; const model = raw?.model; const usage = raw?.usage;
    return { id, model, usage };
  }catch{ return null }
}
