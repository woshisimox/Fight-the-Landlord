export const DEFAULT_TIMEOUT_MS = 16000;

export type Provider = 'openai' | 'kimi' | 'grok' | 'gemini';

export interface LLMClientCfg {
  provider: Provider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string,string>;
  timeoutMs?: number;
}

/** 调用后端代理，返回 { text?, error? } */
export async function callLLM(cfg: LLMClientCfg, payload: any): Promise<{ text?: string; error?: string; raw?: any }> {
  const resp = await fetch('/api/llm-proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cfg, payload })
  });
  let data: any = {};
  try { data = await resp.json(); } catch (e) { data = { error: 'bad_json_from_api' }; }
  return data;
}

/** 将错误信息（已脱敏）拼进备用文案，可作为“pass”或“随机策略”的说明 */
export function buildFallbackReason(error: string | undefined, base: string, asPass = false) {
  const prefix = asPass ? '无法跟上，选择过' : base || '随机出牌';
  if (!error) return prefix;
  const msg = maskSecrets(error);
  return `${prefix}（LLM无效/超时：${msg}）`;
}

/** 简单的 Key 脱敏（极端情况也会兜底） */
export function maskSecrets(s: string) {
  try {
    let t = String(s);
    // 屏蔽 Bearer 后面的长 token
    t = t.replace(/Bearer\s+[A-Za-z0-9_\-]{10,}/g, 'Bearer ***');
    // 屏蔽类似 sk-***、xai-***
    t = t.replace(/\b(sk|xai|gk|gm|moonshot|ms)-[A-Za-z0-9_\-]{8,}\b/gi, '***');
    // 删除 header 中的 Authorization 值
    t = t.replace(/authorization"?\s*:\s*"[^"]+"/gi, 'authorization:"***"');
    return t;
  } catch { return 'error'; }
}
