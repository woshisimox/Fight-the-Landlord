// pages/api/stream_ndjson.ts — safe-sliced v1
import type { NextApiRequest, NextApiResponse } from 'next'

// 你的引擎与各类 Bot（保持原路径即可）
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine'
import { OpenAIBot } from '../../lib/bots/openai_bot'
import { GeminiBot } from '../../lib/bots/gemini_bot'
import { GrokBot } from '../../lib/bots/grok_bot'
import { HttpBot } from '../../lib/bots/http_bot'
import { KimiBot } from '../../lib/bots/kimi_bot'
import { QwenBot } from '../../lib/bots/qwen_bot'

// ---------- 类型定义（和你现有前端/引擎保持兼容的最小集合） ----------
type Four2Policy = 'both' | '2singles' | '2pairs'
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai'
  | 'ai:gemini'
  | 'ai:grok'
  | 'ai:kimi'
  | 'ai:qwen'
  | 'http'

type SeatKeys = {
  openai?: string
  gemini?: string
  grok?: string
  kimi?: string
  qwen?: string
  httpBase?: string
  httpToken?: string
}

type StartParams = {
  rounds: number
  startScore?: [number, number, number]
  seatDelayMs?: number | [number, number, number]
  enabled?: [boolean, boolean, boolean]
  rob?: boolean
  four2?: Four2Policy
  seats: BotChoice[]
  seatModels?: (string | undefined)[]
  seatKeys?: SeatKeys[]
  debug?: boolean
  stopBelowZero?: boolean
}

type BotFunc = (ctx: any) => Promise<any>
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

// ---------- NDJSON 工具 ----------
function writeLine(res: NextApiResponse, obj: any, seqCounter: { n: number }) {
  const payload = { ...(obj || {}), ts: new Date().toISOString(), seq: ++seqCounter.n }
  ;(res as any).write(JSON.stringify(payload) + '\n')
  try { (res as any).flush?.() } catch {}
}
function makeEmitter(res: NextApiResponse, seqCounter: { n: number }) {
  return (obj: any) => writeLine(res, obj, seqCounter)
}

// ---------- Bot 选择与节流 ----------
function chooseBot(kind: BotChoice, model?: string, keys?: SeatKeys): BotFunc {
  switch (kind) {
    case 'built-in:greedy-max': return (ctx:any)=>GreedyMax(ctx)
    case 'built-in:greedy-min': return (ctx:any)=>GreedyMin(ctx)
    case 'built-in:random-legal': return (ctx:any)=>RandomLegal(ctx)
    case 'ai:openai': {
      // 如果你项目里 OpenAIBot 是 class/函数，按需改造；此处统一回退并提示
      return async (ctx:any) => {
        return {
          move: await GreedyMax(ctx).then((r:any)=>r?.move ?? 'pass'),
          reason: '外部AI(openai)未接入后端，已回退内建（GreedyMax）'
        }
      }
    }
    case 'ai:gemini':
    case 'ai:grok':
    case 'ai:kimi':
    case 'ai:qwen':
    case 'http': {
      return async (ctx:any) => {
        return {
          move: await GreedyMax(ctx).then((r:any)=>r?.move ?? 'pass'),
          reason: `外部AI(${kind.split(':')[1]||'http'})未接入后端，已回退内建（GreedyMax）`
        }
      }
    }
    default:
      return (ctx:any)=>GreedyMax(ctx)
  }
}

function withMinInterval(bot: BotFunc, minMs: number): BotFunc {
  return async (ctx:any) => {
    const t0 = Date.now()
    const out = await bot(ctx)
    const el = Date.now() - t0
    if (el < minMs) await sleep(minMs - el)
    return out
  }
}

// ---------- 转发一局（兼容 iterator 风格） ----------
async function forwardGameCompat(
  res: NextApiResponse,
  opts: { seats: BotFunc[], four2?: Four2Policy, rob?: boolean, delayMs?: number },
  seqCounter: { n: number }
): Promise<void> {
  const emit = makeEmitter(res, seqCounter)

  let lastProgress = Date.now()
  let closed = false
  let sawWin = false

  // 9s 无进度 watchdog：强制给一个胜利事件兜底
  const watchdog = setInterval(() => {
    try {
      if (!closed && Date.now() - lastProgress > 9000) {
        emit({ type:'log', message:'[防卡死] 超过 9s 无进度，本局强制结束。' })
        closed = true
        // 兜底发一个胜利事件（默认地主胜）
        emit({ type:'event', kind:'win', winner:0, multiplier:1, deltaScores:[+2,-1,-1] })
        sawWin = true
      }
    } catch {}
  }, 2500)

  try {
    // 你的引擎通常返回 async iterator
    const iter = runOneGame({
      seats: opts.seats as any,
      rob: opts.rob,
      four2: opts.four2,
    } as any)

    for await (const ev of (iter as any)) {
      emit(ev)
      lastProgress = Date.now()
      if (ev?.kind === 'win') sawWin = true
    }

    if (!sawWin) {
      emit({ type:'log', message:'[提示] 未检测到 win 事件，可能提前中止。' })
    }
  } catch (err:any) {
    emit({ type:'log', level:'error', message:`后端异常：${err?.message || err}` })
  } finally {
    clearInterval(watchdog)
  }
}

// ---------- API 入口 ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const WALL_T0 = Date.now()
  const MAX_WALL_MS = 55_000 // 单次连接墙钟保护（serverless/代理层常见 60s）

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // 禁用缓冲&Nagle
  try { (res.socket as any)?.setTimeout?.(0) } catch {}
  try { (res.socket as any)?.setNoDelay?.(true) } catch {}

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  const seqCounter = { n: 0 }
  const emit = makeEmitter(res, seqCounter)

  // server keep-alive（前端忽略渲染）
  const ka = setInterval(() => {
    writeLine(res, { type:'ka' }, seqCounter)
  }, 2000)

  try {
    const body = (req.body || {}) as Partial<StartParams>
    const {
      rounds,
      startScore,
      seatDelayMs,
      enabled,
      rob,
      four2,
      seats,
      seatModels,
      seatKeys,
      debug,
      stopBelowZero,
    } = body

    // 延时数组化
    const delays: [number, number, number] = (() => {
      if (Array.isArray(seatDelayMs)) {
        const a = seatDelayMs as any[]
        return [Number(a[0]||0), Number(a[1]||0), Number(a[2]||0)]
      }
      const d = Math.max(0, Number(seatDelayMs || 0))
      return [d, d, d]
    })()

    // 启用位
    const enabled3: [boolean, boolean, boolean] = (() => {
      if (Array.isArray(enabled)) {
        const a = enabled as any[]
        return [!!a[0], !!a[1], !!a[2]]
      }
      return [true, true, true]
    })()

    // Bot 种类 & 模型/Key
    const kinds: [BotChoice, BotChoice, BotChoice] = [
      (seats?.[0] || 'built-in:greedy-max') as BotChoice,
      (seats?.[1] || 'built-in:greedy-min') as BotChoice,
      (seats?.[2] || 'built-in:random-legal') as BotChoice,
    ]
    const models: [string|undefined, string|undefined, string|undefined] = [
      seatModels?.[0], seatModels?.[1], seatModels?.[2]
    ]
    const keys: [SeatKeys|undefined, SeatKeys|undefined, SeatKeys|undefined] = [
      seatKeys?.[0], seatKeys?.[1], seatKeys?.[2]
    ]

    // 大延时自动按单局切分，避免长连接超时
    const safeSeatDelay = Math.max(delays[0], delays[1], delays[2])
    const reqRounds = Math.max(1, Number(rounds || 1))
    const safeRounds = (safeSeatDelay >= 800 ? 1 : reqRounds)

    // 逐局运行
    for (let round = 1; round <= safeRounds; round++) {
      if (Date.now() - WALL_T0 > MAX_WALL_MS) {
        emit({ type:'log', message:'⏱️ Wall-clock guard: end this connection early to avoid serverless timeout.' })
        break
      }

      emit({ type:'log', message:`—— 第 ${round} 局开始 ——` })

      // 每局构造 bot，保证状态干净
      const bots: BotFunc[] = [0,1,2].map(i => {
        const kind = kinds[i]
        const bot = chooseBot(kind, models[i], keys[i])
        const d = enabled3[i] ? Math.max(0, delays[i]) : 0
        return withMinInterval(bot, d)
      })

      await forwardGameCompat(res, { seats: bots, four2, rob }, seqCounter)
    }

    emit({ type:'log', message:'【本次连接结束】' })
  } catch (err:any) {
    emit({ type:'log', level:'error', message:`发生异常：${err?.message || err}` })
  } finally {
    clearInterval(ka)
    try { (res as any).end?.() } catch {}
  }
}
