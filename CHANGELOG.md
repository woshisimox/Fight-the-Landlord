# Changelog

## 1.6.3-hotfix4 (suits internalized)
- Added `suit` (H/D/S/C) and `code` (e.g., `7H`, `QC`) fields to `Card` type, following the MVP deck design.
- Updated `makeDeck()` to generate suits for each non-joker card; jokers keep `code` = `SJ`/`BJ`.
- Kept `label` unchanged to avoid any UI changes and to maintain event payloads and logs.
- No gameplay logic changes; detection and comparison still operate by `rank` only.

## 1.6.3-hotfix5 (suit-based text color)
- UI 仍保持原布局：仅在渲染时根据 `card.suit` 为 ♥/♦ 着红色，♠/♣ 着黑色。
- 事件扩展：在不破坏兼容的前提下，新增 `handsRich` / `bottomRich` / `cardsRich`（可选），保留原 `hands`/`bottom`/`cards`（字符串）。
- 回放/日志逻辑依旧按 label 字符串工作；渲染时优先使用 `*Rich` 显示彩色文本，无则回退到原字符串。