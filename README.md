# DouDiZhu LLM Proxy Demo (Full)

这是一个最小可运行的 Next.js 项目，包含：

- `pages/api/llm-proxy.ts`: 统一代理 OpenAI / Kimi(Moonshot) / Grok(x.ai) / Gemini
- `lib/providers.ts`: 前端调用封装，带超时、错误透传（已脱敏）和 fallback 文案
- `pages/index.tsx`: 极简测试页

> 你可以把 `pages/api/llm-proxy.ts` 和 `lib/providers.ts` 直接拷到你的项目里。

## 启动

```bash
pnpm i   # 或 npm i / yarn
pnpm dev # 或 npm run dev
# 打开 http://localhost:3000
```
