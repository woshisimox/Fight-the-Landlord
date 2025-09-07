已自动集成：
- 右下角 🐞Debug 按钮（下载合并日志报告）
- /api/ping 与 /api/debug_dump
- 对 stream_ndjson（若存在）做了非侵入式注入：拦截 res.write/res.end 以记录每行发送与结束

如需文件落地：设置环境变量 WRITE_LOG_FILE=1（可选 LOG_FILE_PATH=/tmp/app.log）。
环形日志容量：DEBUG_LOG_CAP（默认 5000）。
