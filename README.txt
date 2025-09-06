# v1.0.2-aifix6-bundle（后端与适配器 + index.tsx 变更指导）

本包包含：
- lib/bots/*.ts：OpenAI / Gemini / Grok / Kimi / HTTP / Qwen 适配器（始终返回非空 reason）
- pages/api/stream_ndjson.ts：按座位选择 provider，读取 seatKeys[i] 中各自的 key，写事件时增强 provider/reason

前端（pages/index.tsx）最小改动：
1) 状态中确保：
   const [seatProviders, setSeatProviders] = useState<string[]>(['builtin','builtin','builtin']);
   type SeatKeys = { openai?: string; gemini?: string; grok?: string; kimi?: string; httpBase?: string; httpToken?: string; qwen?: string };
   const [seatKeys, setSeatKeys] = useState<SeatKeys[]>([{},{},{}]);

2) 算法下拉框新增：<option value="qwen">Qwen（千问）</option>

3) 当 seatProviders[i]==='qwen' 时渲染输入框：
   <input type="password" placeholder="dsk-..." value={seatKeys[i]?.qwen||''} onChange={e=>setSeatKeys(v=>{const n=v.slice(); n[i]={...(n[i]||{}), qwen:e.target.value}; return n;})}/>

4) 发起请求体中包含：
   body = { ..., players: seatProviders.join(','), seatProviders, seatKeys }
