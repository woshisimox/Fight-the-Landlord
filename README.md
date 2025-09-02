# 斗地主 AI Arena（带花色 / 单对炸火）
- Next.js + TypeScript，可本地运行
- 规则：花色仅用于显示；大小只按点数比较
- 牌型：单张、对子、炸弹、火箭
- 三个内置 Bot（Random/GreedyMin/GreedyMax），以及 HTTP/OpenAI/Gemini/Kimi/Grok 的占位配置（通过 `/api/llm-proxy` 模拟）
## 启动
```bash
npm i
npm run dev
# 打开 http://localhost:3000
```
## 功能
- 可设置回合数、起始分、超时与出牌间隔
- 实时显示三家手牌、底牌、最近出牌、累计分
- 事件流（NDJSON/JSON）下载