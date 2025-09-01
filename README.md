# 斗地主 AI 比赛（v1.3.2）

- Next.js 14 + React 18（pages 路由）
- 甲/乙/丙分别可选：**Kimi / Grok / Gemini / OpenAI / HTTP JSON / 内置**（GreedyMin / GreedyMax / RandomLegal）
- 可配置各自 API Key / 模型 / Base URL
- **每步出牌延迟**（ms）
- **实时回放**（NDJSON 流）：发牌、叫分/抢、地主确认、出牌、结束
- **首家（地主）不能过**：外部 AI 若返回 `pass` 或非法动作，会自动改为**最小合法领出**；跟牌若非法则视作 pass。

## 本地开发
```bash
npm i
npm run dev
```

## 部署到 Vercel
- Root Directory 指向项目根（包含 `package.json`）
- 环境变量（可选）：你也可以把外部模型的 Key 放到 Server 端，再在前端做选择。

## 外部 AI 协议（HTTP JSON）
POST 你的 URL：
```json
{
  "phase": "play",
  "seat": 0,
  "landlord": 1,
  "lead": false,
  "hand": ["3","3","A","SJ","BJ"],
  "bottom": ["9","T","J"],
  "history": [{"seat":1,"type":"pair","cards":["9","9"]}],
  "require": {"type":"pair","length":1,"mainRank":11},
  "legal": [{"type":"pair","cards":["A","A"],"length":1,"mainRank":14}]
}
```
响应：
```json
{"type":"pass"}
```
或
```json
{"type":"single","cards":["A"]}
```

> 该示例引擎只实现了 **单张、对子** 与 `pass`，便于演示与接入各模型。若你需要完整牌型/倍数/炸弹逻辑，我可以继续扩充枚举器与比较器。

