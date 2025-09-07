
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
