# Changelog

## 1.6.3-hotfix4 (suits internalized)
- Added `suit` (H/D/S/C) and `code` (e.g., `7H`, `QC`) fields to `Card` type, following the MVP deck design.
- Updated `makeDeck()` to generate suits for each non-joker card; jokers keep `code` = `SJ`/`BJ`.
- Kept `label` unchanged to avoid any UI changes and to maintain event payloads and logs.
- No gameplay logic changes; detection and comparison still operate by `rank` only.