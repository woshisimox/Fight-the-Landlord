// pages/api/llm-proxy.ts
// 统一的服务端代理：把浏览器端的 LLM 请求转发到第三方，以规避 CORS，
// 并在错误时返回可写入日志的（已脱敏）文本。
import type { NextApiRequest, NextApiResponse } from 'next';

const MASK = (s: string) => (s || '').replace(/(sk|pk|Bearer)\s+[A-Za-z0-9._-]+/gi, '$1 ***');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ data: null, error: 'Method Not Allowed' });
  }

  try {
    const { provider, baseURL, model, apiKey, body, timeoutMs } = (req.body || {});

    // 允许调用方传完整 URL；否则按 provider 推断一个默认前缀
    const buildUrl = () => {
      if (baseURL && /^https?:\/\//i.test(baseURL)) {
        // 兼容使用者直接给出 /chat/completions 等路径（排除多余 /）
        return String(baseURL).replace(/\/$/, '');
      }
      const p = String(provider || '').toLowerCase();
      if (p === 'gemini') {
        // 这里仅给出公共前缀；最终路径由前端 body 决定（例如 :generateContent）
        return 'https://generativelanguage.googleapis.com';
      }
      // openai / kimi(moonshot) / grok(xai) 都是 openai 风格
      return 'https://api.openai.com/v1';
    };

    // 如果是 OpenAI 风格接口，默认拼 /chat/completions；
    // 如果调用方给的是完整 URL（以 /v1/... 结尾），就按原样发。
    const isFullPath = (u: string) => /\/v1\/[^/]+/.test(u);
    let url = buildUrl();
    if (!isFullPath(url)) {
      const p = String(provider || '').toLowerCase();
      if (p === 'gemini') {
        // 由 body 自行携带正确的 :generateContent 路径，这里不追加
        // 例如 bodyPath: '/v1beta/models/gemini-1.5-pro:generateContent'
        if (body && typeof body.bodyPath === 'string') {
          url = url.replace(/\/$/, '') + String(body.bodyPath);
        } else {
          return res.status(200).json({ data: null, error: 'Gemini 需要在 body.bodyPath 指定完整路径，例如 /v1beta/models/gemini-1.5-pro:generateContent' });
        }
      } else {
        // OpenAI 兼容风格
        url = url.replace(/\/$/, '') + '/chat/completions';
      }
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

    const ac = new AbortController();
    const to = Math.max(1000, Number(timeoutMs || 15000));
    const id = setTimeout(() => ac.abort(), to);

    let respText = '';
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(id);

      respText = await r.text();

      if (!r.ok) {
        // 把第三方的错误正文一并返回（已脱敏），方便写入事件日志
        return res.status(200).json({ data: null, error: `HTTP ${r.status} ${r.statusText} ${MASK(respText)}` });
      }

      try {
        const data = JSON.parse(respText);
        return res.status(200).json({ data });
      } catch {
        return res.status(200).json({ data: null, error: `JSON 解析失败：${MASK(respText.slice(0, 800))}` });
      }
    } catch (e: any) {
      clearTimeout(id);
      const msg = (e?.name ? (e.name + ': ') : '') + (e?.message || String(e));
      return res.status(200).json({ data: null, error: `网络或超时错误：${MASK(msg)}` });
    }
  } catch (e: any) {
    return res.status(200).json({ data: null, error: `处理失败：${e?.message || e}` });
  }
}
