# 斗地主 AI Arena (v1.7.1)

- Next.js + TypeScript，`npm i && npm run dev`
- 页面：`/` 运行锦标赛；可配置 3 位选手（内置/LLM）、步进延迟、起始分与局数；支持 NDJSON/JSON 下载。
- LLM 代理：`pages/api/llm-proxy.ts`（示例返回第一个合法出牌，生产可替换为真实调用 OpenAI/Gemini/Kimi/Grok）。
- 规则：不计花色，但**发牌保留花色**以确保同点多张（可正常组成对子/炸弹）。比较大小仅用点数。

## 目录
```
lib/
  cards.ts     // 54 张牌，含花色+王，洗牌/发牌
  combos.ts    // 列举出牌、响应牌/能否压制、王炸/炸弹
  engine.ts    // 叫分/地主先手/两家过重启/胜负计分
  bots/        // Random / GreedyMin / GreedyMax
  providers.ts // LLM bot（统一代理 + 兜底策略）
pages/
  index.tsx    // UI + 控制台 + 下载
  api/llm-proxy.ts // 统一 LLM 代理（可替换为真实外调）
```
