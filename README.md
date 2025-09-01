# 增量包：统一 LLM 代理 + 改善 fallback 文案（含错误写日志）

本包只包含两部分：
1. `pages/api/llm-proxy.ts` —— 统一的 **服务端代理**（POST），解决 CORS，并把第三方报错文本（**自动脱敏**）返回给前端以写入事件日志。
2. 文案/接线说明 —— 教你在现有 `lib/providers.ts` / 机器人调用处把 **错误文本写进 reason**，并区分“真过牌”和“改用内置策略”。

---

## 1) 放置文件
- 复制 `pages/api/llm-proxy.ts` 到你的项目同路径。
- 无需 .env（代理支持把 key 由前端传来；日志会自动脱敏）。

## 2) 前端调用改为请求本项目代理
把原来直接请求第三方的代码，替换为：
```ts
const payload = buildChatPayload(view, legal); // 你现有的构造函数
const resp = await fetch('/api/llm-proxy', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    provider: cfg.kind,       // 'openai' | 'kimi' | 'grok' | 'gemini' | 'http'
    baseURL: cfg.baseURL,     // 例如 https://api.moonshot.cn/v1
    model: cfg.model,         // 模型名
    apiKey: cfg.apiKey,       // 用户填写的 key
    timeoutMs: cfg.timeoutMs, // 来自 UI 的“AI 超时（ms）”，建议 15000~20000
    body: payload,            // 直接透传
  }),
}).then(r => r.json());
const { data, error } = resp;
```

- **OpenAI/Kimi/Grok**：按 OpenAI `/v1/chat/completions` 兼容发送即可（代理会补路径）。
- **Gemini**：把完整路径放进 `body.bodyPath`，例如：
  ```ts
  body: {
    bodyPath: '/v1beta/models/gemini-1.5-pro:generateContent',
    contents: [...],
    generationConfig: {...}
  }
  ```
  代理会拼上 `https://generativelanguage.googleapis.com` 前缀并转发。

## 3) fallback 文案统一 & 写入错误文本（脱敏）
在你 LLM 的 try/catch / 校验失败分支中：
```ts
// error -> 代理返回的错误字符串（例如 HTTP 403 / JSON 解析失败 / 超时等），可能为 undefined
// move  -> 兜底策略的动作（"pass" 或 { comboType, cards, ... }）
// detail-> 兜底策略给出的简短理由（如 "能压就打最大" / "随机跟牌" / "首家最大领出" 等）
const head = error ? `LLM错误/超时：${error}` : 'LLM无效/超时';
const reason = (move === 'pass')
    ? `${head}；默认过`
    : `${head}；改用内置策略：${detail}`;

return { move, reason };
```

> 说明：之前经常出现“**LLM无效/超时，默认过**”但实际上**出了牌**的情况，
> 这个改法会把理由改成“改用内置策略：xxx”，并在前缀附上**已脱敏**的错误文本，方便排查。

## 4) 事件日志示例（理想效果）
- LLM 正常返回：`reason: "分析后选择出对9：压制地主，但保留2"`
- LLM 报错 + 出牌：`reason: "LLM错误/超时：HTTP 403 Forbidden ...；改用内置策略：能压就打最大"`
- LLM 报错 + 过牌：`reason: "LLM错误/超时：网络或超时错误: AbortError；默认过"`

## 5) 常见问题
- **还是超时**：把“AI超时（ms）”调到 15000–20000；网络慢时再加大。
- **Gemini 返回 400**：确认 `body.bodyPath` 是否正确，并且 `contents`/`generationConfig` 符合 Gemini 要求。
- **不想在前端传 key**：可以把 key 存在服务端（例如从环境变量读取），把 `apiKey` 字段从请求体里移除并在代理里补上。


---
最后，如果你希望我直接替你把某个 `providers.ts` 文件补上上述改动，也可以把该文件贴上来，我按你的版本精确改好再给一个微型增量包。
