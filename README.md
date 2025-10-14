
# 斗地主 AI（Next.js Pages Router）

## 启动
```bash
npm install
npm run dev
# 或
npm run build && npm run start
```
前端默认 POST NDJSON 到 `/api/stream_ndjson`。

## 结构
- pages/index.tsx — 前端页面（花色图标/红黑着色、本轮出牌顺序、实时日志等）
- pages/api/stream_ndjson.ts — 流式 NDJSON API（调用引擎）
- lib/doudizhu/engine.ts — 完整斗地主引擎（含正式记分：炸弹/火箭×2，春天/反春天×2）
- lib/engine.ts — 旧代码兼容适配层（导出 Engine / IBot 等别名）
- lib/arenaStream.ts — 旧流程的组装/驱动

## Bot 接口（抢地主 / 翻倍支持）

自 2024 年 6 月起，`lib/doudizhu/engine.ts` 引擎向 Bot 透出三类阶段：

| 阶段 (`ctx.phase`) | Bot 返回值                       | 备注 |
| ------------------ | -------------------------------- | ---- |
| `"bid"`            | `{ phase:"bid", bid:boolean }`  | 抢地主（返回 `true` 抢 / `false` 不抢）。 |
| `"double"`         | `{ phase:"double", double:boolean }` | 明牌后的加倍决策。 |
| `"play"` *(默认)*  | `{ move:"play"|"pass", cards?:string[] }` | 出牌阶段；向后兼容旧逻辑。 |

因此，**除了引擎外，所有外接 Bot（LLM/HTTP）也必须支持新的 `ctx.phase`**，在非出牌阶段返回对应 JSON，否则 API 层会回退到内置启发式逻辑（无法真正调用 AI）。

参考实现：`lib/bots/openai_bot.ts`、`gemini_bot.ts`、`grok_bot.ts`、`kimi_bot.ts`、`qwen_bot.ts`、`deepseek_bot.ts`、`http_bot.ts`、`mininet_bot.ts` 均已实现新的多阶段提示词与结果解析。
