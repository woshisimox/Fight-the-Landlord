
export type Provider = 'openai'|'kimi'|'grok';

export type AIRequest = {
  provider: Provider;
  apiKey: string;
  model?: string;
  prompt: string;
};

export async function callProvider({provider, apiKey, model, prompt}: AIRequest): Promise<string> {
  const payload = {
    model: model || defaultModel(provider),
    messages: [
      { role: "system", content: "Only respond with JSON. 不要输出任何解释文字。" },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  };

  const {url, authHeader} = endpoint(provider, apiKey);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  // OpenAI-compatible shape
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  return text;
}

function endpoint(provider: Provider, apiKey: string): {url: string, authHeader: string} {
  if (provider==='openai') {
    return { url: 'https://api.openai.com/v1/chat/completions', authHeader: `Bearer ${apiKey}` };
  }
  if (provider==='kimi') {
    // Moonshot / Kimi uses OpenAI-compatible API
    return { url: 'https://api.moonshot.cn/v1/chat/completions', authHeader: `Bearer ${apiKey}` };
  }
  // grok (xAI) OpenAI-compatible chat endpoint (adjust if your account differs)
  return { url: 'https://api.x.ai/v1/chat/completions', authHeader: `Bearer ${apiKey}` };
}

function defaultModel(provider: Provider): string {
  if (provider==='openai') return 'gpt-4o-mini';
  if (provider==='kimi') return 'moonshot-v1-8k';
  return 'grok-2-latest';
}
