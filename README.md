# Dou Dizhu AI Web (Next.js, per-player providers)

- 支持为 **甲/乙/丙** 分别指定 AI 提供方：内置 / HTTP JSON / OpenAI（可输入 API Key）。
- 支持设置 **每步出牌延迟**（ms），在服务器执行对局时按延迟节奏进行。
- 在调用外部 AI 时，会将 **自己的手牌**、**已出的牌（历史）**、**当前需要跟的牌型（require）** 等上下文一并传递。

## 本地开发
```bash
npm i
npm run dev
```

## Vercel 部署
- 本项目已包含 `"next"` 依赖，Vercel 会自动识别。
- Root Directory 指向项目根目录（能看到这个 `package.json`）。

## HTTP JSON Bot 协议（你可自建服务接入）
POST {url}
```json
{
  "phase": "bid" | "play",
  "seat": 0,
  "landlord": 0,
  "lead": true,
  "hand": ["3","3","A","SJ","BJ"],
  "bottom": ["9","T","J"],
  "history": [{"seat":1,"type":"pair","cards":["9","9"]}, ...],
  "require": {"type":"pair","length":1,"mainRank":11},
  "legal": [{"type":"pair","cards":["A","A"],"length":1,"mainRank":14}, ...] // 仅在 phase=play 提供
}
```
- **返回**（JSON）：
  - 叫分/抢阶段：`{"bid": 0|1|2|3|"pass"|"rob"|"norob"}`
  - 出牌阶段：`{"type":"pass"}` 或 `{"type":"pair","cards":["A","A"]}`（只需给出**牌面标签**，大小写同上）

> 若返回无效/不合规，系统会自动视为 `pass`。

## OpenAI 适配
- 在前端输入 `API Key`、`model`（如 `gpt-4o-mini`），可直接调用 OpenAI Chat Completions。
- 我们会使用 `response_format: { type: "json_object" }`，并提示只输出 JSON。

## 注意
- 将 API Key 放在前端会暴露给使用者，生产环境建议放到后端或使用代理服务。
- Serverless 平台有超时限制；如果 `delayMs` 很大、局数多，建议减小延迟或降低局数。


## 可选 AI 提供方
- **内置**：GreedyMin / GreedyMax / RandomLegal（无需 Key）
- **HTTP JSON**：自建接口，收到完整对局上下文与所有合法出牌，返回 JSON 决策
- **OpenAI**：`API Key` + `model`（如 `gpt-4o-mini`）；可选 `Base URL`
- **Gemini**：`API Key` + `model`（如 `gemini-1.5-flash`）
- **Kimi**：`API Key` + `model`（如 `moonshot-v1-8k`）；可选 `Base URL`（默认 `https://api.moonshot.cn/v1`，OpenAI 兼容）
- **Grok**：`API Key` + `model`（如 `grok-beta`）；可选 `Base URL`（默认 `https://api.x.ai/v1`，OpenAI 兼容）
