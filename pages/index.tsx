import { useState } from 'react';
import { callLLM, buildFallbackReason, LLMClientCfg } from '../lib/providers';

export default function Home() {
  const [provider, setProvider] = useState<LLMClientCfg['provider']>('openai');
  const [model, setModel] = useState('gpt-4o-mini');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(16000);
  const [prompt, setPrompt] = useState('给一条斗地主出牌理由示例，20字内。');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);

  function pushLog(s: string) {
    setLogs(prev => [...prev, s].slice(-200));
  }

  async function onRun() {
    setResult('');
    setError('');
    const cfg: LLMClientCfg = { provider, model, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined, timeoutMs };
    const payload = { messages: [{ role: 'user', content: prompt }] };
    const r = await callLLM(cfg, payload);
    if (r.error) {
      const reason = buildFallbackReason(r.error, '随机出牌', false);
      setError(reason);
      pushLog(`[error] ${reason}`);
    } else {
      setResult(r.text || '');
      pushLog(`[ok] ${r.text}`);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}>
      <h2>LLM 统一代理 Demo</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 920 }}>
        <label>Provider
          <select value={provider} onChange={e=>{
            const v = e.target.value as LLMClientCfg['provider'];
            setProvider(v);
            if (v === 'openai') setModel('gpt-4o-mini');
            if (v === 'kimi') setModel('moonshot-v1-8k');
            if (v === 'grok') setModel('grok-beta');
            if (v === 'gemini') setModel('gemini-1.5-flash');
          }} style={{ marginLeft: 8 }}>
            <option value="openai">OpenAI</option>
            <option value="kimi">Kimi (Moonshot)</option>
            <option value="grok">Grok (x.ai)</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>

        <label>Model
          <input value={model} onChange={e=>setModel(e.target.value)} style={{ width: '100%', marginLeft: 8 }}/>
        </label>

        <label>Base URL (可选)
          <input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="默认使用官方地址" style={{ width: '100%', marginLeft: 8 }}/>
        </label>

        <label>API Key (不会持久化)
          <input value={apiKey} onChange={e=>setApiKey(e.target.value)} style={{ width: '100%', marginLeft: 8 }} />
        </label>

        <label>Timeout (ms)
          <input type="number" value={timeoutMs} onChange={e=>setTimeoutMs(Number(e.target.value))} style={{ width: '100%', marginLeft: 8 }}/>
        </label>

        <div />
      </div>

      <div style={{ marginTop: 12 }}>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={4} style={{ width: '100%', maxWidth: 920 }} />
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={onRun}>调用</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16, maxWidth: 920 }}>
        <div>
          <h3>结果</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{result}</pre>
          {error && (<><h3>回退文案</h3><pre style={{ color: '#b00', whiteSpace: 'pre-wrap' }}>{error}</pre></>)}
        </div>
        <div>
          <h3>调用日志</h3>
          <div style={{ border: '1px solid #ddd', padding: 8, height: 240, overflow: 'auto' }}>
            {logs.map((l, i) => <div key={i} style={{ fontSize: 13 }}>{l}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
