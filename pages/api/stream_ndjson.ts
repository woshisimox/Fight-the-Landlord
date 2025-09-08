// pages/api/stream_ndjson.ts — robust streaming + per-seat min interval + watchdog
import type { NextApiRequest, NextApiResponse } from 'next'

// NOTE: keep these imports as-is to match your repo structure
import { runOneGame, GreedyMax, GreedyMin, RandomLegal } from '../../lib/doudizhu/engine'
import { OpenAIBot } from '../../lib/bots/openai_bot'
import { GeminiBot } from '../../lib/bots/gemini_bot'
import { GrokBot } from '../../lib/bots/grok_bot'
import { HttpBot } from '../../lib/bots/http_bot'
import { KimiBot } from '../../lib/bots/kimi_bot'
import { QwenBot } from '../../lib/bots/qwen_bot'

type Four2Policy = 'both' | '2singles' | '2pairs'
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http'

type StartPayload = {
  rounds: number
  startScore?: number
  enabled?: boolean
  rob?: boolean
  four2?: Four2Policy
  seatDelayMs?: number[]
  seats: BotChoice[]
  seatModels?: string[]
  seatKeys?: {
    openai?: string
    gemini?: string
    grok?: string
    kimi?: string
    qwen?: string
    httpBase?: string
    httpToken?: string
  }[]
  // optional server-side kill switch
  stopBelowZero?: boolean
}

type BotFunc = (ctx:any)=>Promise<any>

function sleep(ms:number){ return new Promise(res=>setTimeout(res, ms)) }

// add seq and ts to every emission
function makeEmitter(res: NextApiResponse) {
  let seq = 0
  return (obj: any) => {
    try {
      const payload = { ...(obj||{}), ts: new Date().toISOString(), seq: ++seq }
      ;(res as any).write(JSON.stringify(payload) + '\\n')
    } catch {}
  }
}

function withMinInterval(bot: BotFunc, minMs: number): BotFunc {
  let last = 0
  return async (ctx:any) => {
    if (minMs > 0) {
      const now = Date.now()
      const wait = Math.max(0, minMs - (now - last))
      if (wait > 0) await sleep(wait)
      last = Date.now()
    }
    return bot(ctx)
  }
}

function chooseBot(kind: BotChoice, model?: string, keys?: any): BotFunc {
  switch (kind) {
    case 'built-in:greedy-max': return GreedyMax as unknown as BotFunc
    case 'built-in:greedy-min': return GreedyMin as unknown as BotFunc
    case 'built-in:random-legal': return RandomLegal as unknown as BotFunc
    case 'ai:openai': return OpenAIBot({ apiKey: keys?.openai, model }) as unknown as BotFunc
    case 'ai:gemini': return GeminiBot({ apiKey: keys?.gemini, model }) as unknown as BotFunc
    case 'ai:grok':   return GrokBot({ apiKey: keys?.grok, model }) as unknown as BotFunc
    case 'ai:kimi':   return KimiBot({ apiKey: keys?.kimi, model }) as unknown as BotFunc
    case 'ai:qwen':   return QwenBot({ apiKey: keys?.qwen, model }) as unknown as BotFunc
    case 'http':      return HttpBot({ base: keys?.httpBase, token: keys?.httpToken }) as unknown as BotFunc
    default: return GreedyMax as unknown as BotFunc
  }
}

// Forward a single game's async iterator to the client with watchdog
async function forwardGame(
  res: NextApiResponse,
  opts: { seats: BotFunc[], four2?: Four2Policy, rob?: boolean, delayMs?: number }
): Promise<void> {
  const emit = makeEmitter(res)
  const iter: AsyncIterator<any> = (runOneGame as any)({
    seats: opts.seats,
    four2: opts.four2,
    rob: opts.rob,
    delayMs: opts.delayMs ?? 0,
  })

  let lastProgress = Date.now()
  let landlord: number | null = null
  let trick = 0
  let closed = false

  const watchdog = setInterval(async () => {
    try {
      if (Date.now() - lastProgress > 9000 && !closed) {
        emit({ type:'log', message: '[防卡死] 超过 9s 无进度，本局强制结束。' })
        closed = true
        try { if (typeof (iter as any).return === 'function') await (iter as any).return(undefined) } catch {}
        // 兜底发一个胜利事件给前端收尾（地主胜）
        const w = typeof landlord === 'number' ? landlord : 0
        emit({ type:'event', kind:'win', winner:w, multiplier:1, deltaScores: w===landlord ? [+2,-1,-1] : [-2,+1,+1] })
      }
    } catch {}
  }, 2500)

  try {
    while (true) {
      const r = await (iter.next() as any)
      if (!r) break
      const { value, done } = r
      if (done) break
      emit(value)

      // 仅在“有效进度”时刷新进度时间（过滤掉心跳型事件，防误判）
      const k = value?.kind || value?.type
      if (k && k !== 'ka') lastProgress = Date.now()
      if (value?.kind === 'init' && typeof value?.landlord === 'number') landlord = value.landlord
      if (value?.kind === 'trick-reset') trick += 1
    }
  } finally {
    try { clearInterval(watchdog) } catch {}
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  // keep-alive (服务器侧心跳，前端会忽略渲染)
  const ka = setInterval(() => {
    try { (res as any).write(JSON.stringify({ type:'ka', ts: new Date().toISOString() }) + '\\n') } catch {}
  }, 2000)

  const emit = makeEmitter(res)

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10)
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1))
    const four2 = (body.four2 as Four2Policy) || 'both'
    const rob = !!body.rob
    const delays = Array.isArray(body.seatDelayMs) && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0]
    const seatKinds: BotChoice[] = (Array.isArray(body.seats) ? body.seats : []) as any
    const models: string[] = (Array.isArray(body.seatModels) ? body.seatModels : []) as any
    const keys = (Array.isArray(body.seatKeys) ? body.seatKeys : []) as any

    emit({ type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` })

    let scores = [0,0,0]

    for (let round = 1; round <= rounds; round++) {
      emit({ type:'log', message:`—— 第 ${round} 局开始 ——` })

      // Build seat bots per round（每局重新构造，保证状态干净）
      const bots: BotFunc[] = [0,1,2].map(i => {
        const kind = seatKinds[i] || 'built-in:greedy-max'
        const bot = chooseBot(kind, models[i], keys[i])
        return withMinInterval(bot, Math.max(0, Number(delays[i] || 0)))
      })

      // forward one game
      await forwardGame(res, { seats: bots, rob, four2 })

      // NOTE: 引擎会输出 win + deltaScores，前端已经累计，这里不再维护分数；
      // 若你要在服务端做“提前终止”，可以解析 deltaScores 累加到 scores。
      if (body.stopBelowZero && (scores[0] < 0 || scores[1] < 0 || scores[2] < 0)) {
        emit({ type:'log', message:'某方积分 < 0，提前终止。' })
        break
      }

      if (round < rounds) emit({ type:'log', message:`—— 第 ${round} 局结束 ——` })
    }
  } catch (e:any) {
    emit({ type:'log', message:`后端错误：${e?.message || String(e)}` })
  } finally {
    try { clearInterval(ka) } catch {}
    try { (res as any).end() } catch {}
  }
}
