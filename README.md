
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
- pages/index.tsx — 平台入口（选择游戏、加载对应渲染器）
- games/ — 游戏插件目录（`ddz`、`gobang` 为示例实现）
  - games/ddz/game.ts — 斗地主 GameEngine 适配（含统一状态/动作接口）
  - games/ddz/renderer.tsx — 斗地主前端渲染器
  - games/ddz/config.json — 斗地主元数据
  - games/gobang/game.ts — 五子棋 GameEngine 适配（15×15 棋盘、五连胜判定）
  - games/gobang/renderer.tsx — 五子棋前端渲染器（人类对战演示）
  - games/gobang/config.json — 五子棋元数据
- core/ — 通用 GameEngine 接口与 `runMatch` 调度器
- lib/engine.ts — 新的统一导出入口（暴露核心类型 + 兼容旧引擎导出）
- pages/api/stream_ndjson.ts — 流式 NDJSON API（仍使用 legacy 斗地主引擎）
- lib/doudizhu/engine.ts — 完整斗地主引擎（含正式记分：炸弹/火箭×2，春天/反春天×2）
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

关于新增阶段上下文、回调顺序和参考代码的更详细说明，可见 [`docs/multi-phase-bot-guide.md`](docs/multi-phase-bot-guide.md)。
