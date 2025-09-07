# ddz-debug-ready

一个可直接运行的 Next.js (pages + TS) 小项目，已**完整集成**：
- 右下角 🐞Debug 浮窗（前端日志捕获 + 后端在线心跳 + 一键导出合并报告）
- /api/stream_ndjson 流式接口（已接入服务端环形日志）
- /api/ping（心跳）与 /api/debug_dump（导出服务端日志）

## 使用

```bash
npm i
npm run dev
# 打开 http://localhost:3000
```

页面里：
- 点“开始”即可连接 `stream_ndjson`，观察流式日志；
- 可用 `crashAt` 模拟后端在第 N 条时抛错停止；
- 右下角点 🐞Debug → Download debug report 下载**合并报告**（客户端日志 + 服务器端日志 + 基本元信息）。

## 接入到你的项目

若你不想手动改：
- 可以把本项目作为“调试版”直接部署到 Vercel 或本地运行，用于重现和判断“前端卡死 vs 后端停止”；
- 或者将本项目中以下文件整体拷贝到你的仓库（目录路径保持不变），即可零修改使用：
  - `components/DebugDock.tsx`
  - `lib/debug/serverLog.ts`
  - `pages/api/ping.ts`
  - `pages/api/debug_dump.ts`
  - `pages/api/stream_ndjson.ts`（若你已有同名文件，可先改名对比diff 或覆盖使用）
  - `pages/index.tsx`（示例页面，包含 DebugDock 的调用）

> 环形日志容量可由环境变量 `DEBUG_LOG_CAP` 控制（默认 5000）。
> 若需落地到文件：设置 `WRITE_LOG_FILE=1`，可选 `LOG_FILE_PATH=/tmp/app.log`。

## 说明

- 客户端脱敏：对于明显像密钥/Token 的值进行遮罩；导出报告仅记录 `sessionStorage` 键的“存在性”（不含值）。
- 通过比较服务端日志中 `request:start`/`send`/`request:end` 和客户端最后一条记录，即可快速判断问题归因。
