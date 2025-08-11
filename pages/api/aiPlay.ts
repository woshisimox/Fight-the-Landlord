
import type { NextApiRequest, NextApiResponse } from 'next';
import { callProvider, Provider } from '@/lib/providers';
import { genCombos, canBeat, parseCards, rankValue, type LastPlay } from '@/lib/doudizhuCore';

type Body = {
  provider: Provider;
  apiKey: string;
  model?: string;
  role: 'landlord'|'farmer';
  hand: string[];           // e.g., ["3","3","4","5","J","A","BJ"]
  lastPlay?: { type: 'single'|'pair'|'triple'|'bomb', count: number, rank: string } | null;
  snapshot?: any;           // arbitrary game state (scores, remaining cards, etc.)
};

type AIDecision = {
  cards: string[];
  reason: string;
  meta?: { usedApi: boolean; provider: string; detail: string };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body as Body;
  const { provider, apiKey, model, role } = body;
  const hand = body.hand?.map(s=>s.toUpperCase()) ?? [];
  const last: LastPlay = body.lastPlay
    ? { type: body.lastPlay.type, count: body.lastPlay.count, rankValue: rankValue(body.lastPlay.rank), isBomb: body.lastPlay.type==='bomb' }
    : null;

  try {
    if (!provider || !apiKey) return res.status(400).json({ error: 'provider/apiKey required' });
    if (!hand?.length) return res.status(400).json({ error: 'hand required' });

    const candidates = genCombos(hand).filter(c=>canBeat(c, last));
    const candidateStr = candidates.map(c=>`${c.type}:${c.cards.join(',')}`).join(' | ');

    const snap = JSON.stringify(body.snapshot||{}).slice(0, 1800);
    const prompt = `你是斗地主(${role})的出牌助手。手牌: ${hand.join(' ')}。对手上家出牌: ${
      last ? `${last.count}张 ${body.lastPlay?.type}（基准牌:${body.lastPlay?.rank}）` : '无/过'
    }。可行出牌候选(按规则筛选): ${candidateStr}。请从候选中选择一组牌，严格输出 JSON：{"cards":["<必须来自候选之一>"],"reason":"依据(简要)"}。禁止输出其他任何内容。局面信息: ${snap}`;

    let text = await callProvider({ provider, apiKey, model, prompt });

    // try to parse JSON safely
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* will fallback */ }

    let decision: AIDecision;
    if (!parsed || !Array.isArray(parsed.cards)) {
      // fallback: pick the weakest candidate
      const pick = candidates[0]?.cards ?? [hand[0]];
      decision = {
        cards: pick,
        reason: 'fallback (invalid JSON)',
        meta: { usedApi: true, provider, detail: 'parse failure' }
      };
    } else {
      // validate chosen cards against candidates
      const chosen = parsed.cards.map((s: string)=>s.toUpperCase());
      const ok = candidates.some(c=>arrayEq(c.cards, chosen));
      if (!ok) {
        const pick = candidates[0]?.cards ?? [hand[0]];
        decision = {
          cards: pick,
          reason: 'fallback (illegal move)',
          meta: { usedApi: true, provider, detail: 'candidate mismatch' }
        };
      } else {
        decision = {
          cards: chosen,
          reason: typeof parsed.reason==='string' ? parsed.reason : 'n/a',
          meta: { usedApi: true, provider, detail: 'ok' }
        };
      }
    }

    return res.status(200).json(decision);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
}

function arrayEq(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const aa = [...a].sort(); const bb = [...b].sort();
  return aa.every((x,i)=>x===bb[i]);
}
