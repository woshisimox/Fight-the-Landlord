// lib/bots/deepseek_bot.ts
export function DeepseekBot({ apiKey, model }: { apiKey?: string; model?: string }) {
  const endpoint = 'https://api.deepseek.com/v1/chat/completions';
  const mdl = (model && String(model).trim()) || 'deepseek-chat';

  function parseOut(txt: string): any {
    try {
      const m = txt.match(/\{[\s\S]*\}/);
      const obj = JSON.parse(m ? m[0] : txt);
      return obj && typeof obj === 'object' ? obj : null;
    } catch { return null; }
  }

  return async (ctx: any) => {
    try {
      if (!apiKey) {
        return { move: 'pass', reason: '外部AI(deepseek)未接入后端，已回退内建（GreedyMax）' };
      }
      const cands: any[] = ctx?.candidates ?? ctx?.legalMoves ?? ctx?.legal ?? [];
      const prompt = [
        { role: 'system', content: 'You are a Dou Dizhu assistant. Reply ONLY with strict JSON.' },
        { role: 'user', content:
`You are deciding ONE move for the Chinese card game Dou Dizhu (Fight the Landlord).
Game state (JSON):
${JSON.stringify({
  landlord: ctx?.landlord,
  seat: ctx?.seat,
  lead: ctx?.lead,
  lastTrick: ctx?.lastTrick ?? null,
  candidates: cands,
  seen: (Array.isArray((ctx as any).seen)?(ctx as any).seen:[]),
}).slice(0, 6000)}

Rules:
- Choose exactly ONE element from "candidates" as your action.
- If you cannot beat, choose {"move":"pass"}.
- If you play, respond as {"move":"play","cards":<the chosen candidate>,"reason":"short why"}.
- If pass, respond as {"move":"pass","reason":"short why"}.
Return JSON only.` }
      ];

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: mdl, messages: prompt, temperature: 0.3, stream: false })
      });
      const j = await resp.json();
      const txt = j?.choices?.[0]?.message?.content || '';
      const parsed = parseOut(txt) || {};
      const mv = (parsed.move || '').toLowerCase();

      if (mv === 'play' && Array.isArray(parsed.cards) && parsed.cards.length) {
        const cards = parsed.cards;
        return { move: 'play', cards, reason: parsed.reason || 'DeepSeek' };
      }
      return { move: 'pass', reason: parsed.reason || 'DeepSeek-pass' };
    } catch (err: any) {
      return { move: 'pass', reason: 'DeepSeek 调用失败：' + (err?.message || String(err)) };
    }
  };
}
