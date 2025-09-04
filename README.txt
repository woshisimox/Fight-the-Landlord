# Pages Router-only Patch

将此包中的 `pages/index.tsx` 覆盖到你的项目相同路径。该文件包含：
- 显示各家**手牌**（花色+红黑着色）
- “对局参数”中新增 **甲/乙/丙算法选择** 与 **API Keys/HTTP** 输入
- 其他代码保持不变；请求体通过 `window.__ddz_req_body__` 注入，保持后端兼容。

使用：
1. 覆盖 `pages/index.tsx`
2. 清理构建：`rm -rf .next && npm run build && npm run start`
3. 浏览器强制刷新（Ctrl/Cmd+Shift+R）
