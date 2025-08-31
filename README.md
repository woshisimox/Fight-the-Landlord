# Dou Dizhu AI Web (Vercel-ready)

最小可部署的 Next.js 包装，提供网页界面与 `/api/arena` 接口来运行 3 人斗地主 AI 比赛（甲/乙/丙）。

## 本地运行
```bash
npm i
npm run dev
```

## Vercel 部署说明
- 此项目已包含 `next` 依赖并使用 Next.js 14，Vercel 会自动识别。
- 在 Vercel 创建项目时，确保 **Root Directory** 指向本目录（能看到这个 `package.json`）。

## API
`GET /api/arena?rounds=10&seed=42&rob=false&four2=both`
