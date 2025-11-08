# v1.0.2-qwen-patch（基于 v1.0.2-aifix5 增量补丁，仅加入千问）

本补丁**仅新增千问(Qwen)** 后端调用，尽可能不改动其它逻辑：
- 新增文件：lib/bots/qwen_bot.ts（DashScope OpenAI 兼容接口）
- 更新文件：pages/api/stream_ndjson.ts（映射 provider='qwen'|'qianwen' → QwenBot，并从 seatKeys[idx].qwen 读取 Key）

前端最小改动（若你已有“每位玩家独立 Key”）：
1) 在算法下拉框中新增：<option value="qwen">Qwen（千问）</option>
2) 当 seatProviders[i]==='qwen' 时，显示并写入 seatKeys[i].qwen（例如一个密码输入框）
3) 发起请求体确保包含：{ seatProviders, seatKeys }，seatKeys[i].qwen 会被后端读取使用

其余保持原状。
