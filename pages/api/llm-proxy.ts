import type { NextApiRequest, NextApiResponse } from 'next';

type Provider = 'openai' | 'kimi' | 'grok' | 'gemini';

interface Cfg {
  provider: Provider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string,string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 16000;

// -------- helpers --------
function sanitizeError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err || 'unknown'));
  // 脱敏：隐藏 token 之类敏感信息
  return msg
    .replace(/Bearer\s+[A-Za-z0-9_\-]{10,}/g, 'Bearer ***')
    .replace(/\b(sk|xai|gk|gm|moonshot|ms)-[A-Za-z0-9_\-]{8,}\b/gi, '***')
    .replace(/authorization"?\s*:\s*"[^"]+"/gi, 'authorization:"***"');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), Math.max(1000, timeoutMs || DEFAULT_TIMEOUT_MS));
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    clearTimeout(id);
    return r;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const { cfg, payload } = req.body as { cfg: Cfg; payload: any };
  if (!cfg || !cfg.provider) {
    res.status(400).json({ error: 'bad_request: missing cfg.provider' });
    return;
  }

  const provider = cfg.provider;
  const model = cfg.model || (
    provider === 'openai' ? 'gpt-4o-mini' :
    provider === 'kimi'   ? 'moonshot-v1-8k' :
    provider === 'grok'   ? 'grok-beta' :
    'gemini-1.5-flash'
  );
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 统一的 messages 输入
  const messages = (payload && payload.messages) ? payload.messages : [
    { role: 'system', content: payload?.system ?? 'You are a helpful AI.' },
    { role: 'user',   content: payload?.prompt ?? JSON.stringify(payload ?? {}) }
  ];

  try {
    if (provider === 'openai' || provider === 'grok' || provider === 'kimi') {
      // OpenAI 兼容型 /chat/completions
      const defaultBase = provider === 'openai'
        ? 'https://api.openai.com/v1'
        : provider === 'grok'
          ? 'https://api.x.ai/v1'
          : 'https://api.moonshot.cn/v1';

      const base = (cfg.baseUrl || defaultBase).replace(/\/$/, '');
      const url = base + '/chat/completions';

      const headers: Record<string,string> = {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { 'authorization': `Bearer ${cfg.apiKey}` } : {}),
        ...(cfg.headers || {})
      };

      const body = JSON.stringify({
        model,
        messages,
        temperature: payload?.temperature ?? 0.2,
        stream: false
      });

      const resp = await fetchWithTimeout(url, { method: 'POST', headers, body }, timeoutMs);
      const txt = await resp.text();
      let j: any = {};
      try { j = JSON.parse(txt); } catch { /* keep as text */ }

      if (!resp.ok) {
        res.status(resp.status).json({ error: sanitizeError(j?.error?.message || txt || 'upstream_error'), raw: j });
        return;
      }
      const text = j?.choices?.[0]?.message?.content ?? '';
      res.status(200).json({ text, raw: j });
      return;
    }

    if (provider === 'gemini') {
      // Gemini generateContent
      const key = cfg.apiKey || '';
      const base = (cfg.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
      const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

      // 转换 messages -> parts
      const parts: any[] = [];
      for (const m of messages) {
        if (m?.content) {
          parts.push({ text: String(m.content) });
        }
      }
      const body = JSON.stringify({ contents: [{ parts }] });

      const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers || {}) },
        body
      }, timeoutMs);

      const txt = await resp.text();
      let j: any = {};
      try { j = JSON.parse(txt); } catch { /* noop */ }

      if (!resp.ok) {
        res.status(resp.status).json({ error: sanitizeError(j?.error?.message || txt || 'upstream_error'), raw: j });
        return;
      }
      const text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
      res.status(200).json({ text, raw: j });
      return;
    }

    res.status(400).json({ error: 'unsupported_provider' });
  } catch (e) {
    res.status(500).json({ error: sanitizeError(e) });
  }
}
