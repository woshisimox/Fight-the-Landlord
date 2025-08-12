# Dou Dizhu AI Match (Pages Router)

- Three AI seats using **ChatGPT / Kimi / Grok**. If no key or error → **fallback AI**.
- Frontend shows each seat's **hand**, **table history**, and **per-move reason**.
- Supports **multi-round** matches. Click **New Round** to redeal. Auto-play uses 0.5s pacing.

## Quick Start
```bash
npm i
npm run dev
```
Open http://localhost:3000

### Production
```bash
npm run build && npm start
```
Deploy to Vercel with the default settings.
