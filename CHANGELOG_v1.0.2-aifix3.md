# v1.0.2-aifix3 补丁包（仅包含改动文件）

本补丁只包含 **Kimi 适配器** 的修正：成功/失败都返回 `reason`，避免后端兜底提示“外部AI未接入后端”。

## 覆盖路径
将 `lib/bots/kimi_bot.ts` 覆盖到你当前项目的同路径下。

## 变更点
- 成功：`{ move, cards, reason }`（reason 为 Kimi 返回的解释或兜底文案）
- 失败：`{ move:'pass'| 'play', cards?, reason: 'Kimi 调用失败：...' }`，不会中断对局，仍能继续

> 依赖前置：引擎已在 v1.0.2-aifix2 中支持异步 Bot 与 `BotMove.reason` 可选字段；
> API 路由会优先显示事件里的 reason，只有缺失时才给出兜底文案。
