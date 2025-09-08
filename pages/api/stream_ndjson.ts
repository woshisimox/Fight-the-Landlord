// pages/api/stream_ndjson.ts — v4: compat iterator/onEmit + flush + watchdog
import type { NextApiRequest, NextApiResponse } from 'next'

// Adjust these to your real paths
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
  stopBelowZero?: boolean
}

type BotFunc = (ctx:any)=>Promise<any>
const sleep = (ms:number)=> new Promise(res=>setTimeout(res, ms))

function writeLine(res: NextApiResponse, obj:any, seqCounter:{n:number}) {
  const payload = { ...(obj||{}), ts: new Date().toISOString(), seq: ++seqCounter.n }
  ;(res as any).write(JSON.stringify(payload) + '\\n')
  try { (res as any).flush?.() } catch {}
}

function makeEmitter(res: NextApiResponse, seqCounter:{n:number}) {
  return (obj:any) => writeLine(res, obj, seqCounter)
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
    // HttpBot 大多数实现不需要 model；如需请自行扩展签名
    case 'http':      return (HttpBot as any)({ base: keys?.httpBase, token: keys?.httpToken }) as BotFunc
    default: return GreedyMax as unknown as BotFunc
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

// forward one game; support both async-iterator and onEmit styles
async function forwardGameCompat(
  res: NextApiResponse,
  opts: { seats: BotFunc[], four2?: Four2Policy, rob?: boolean, delayMs?: number },
  seqCounter:{n:number}
): Promise<void> {
  const emit = makeEmitter(res, seqCounter)

  let lastProgress = Date.now()
  let landlord: number | null = null
  let closed = false
  let sawWin = false
  const doneResolvers: {resolve:()=>void}[] = []
  const doneP = new Promise<void>(r=> doneResolvers.push({resolve:r}))

  const watchdog = setInterval(() => {
    try {
      if (!closed && Date.now() - lastProgress > 9000) {
        emit({ type:'log', message:'[防卡死] 超过 9s 无进度，本局强制结束。'})
        closed = true
        // 兜底发一个胜利事件（地主胜）
        const w = typeof landlord === 'number' ? landlord : 0
        emit({ type:'event', kind:'win', winner:w, multiplier:1, deltaScores:[+2,-1,-1] })
        sawWin = true
        doneResolvers.forEach(d=>d.resolve())
      }
    } catch {}
  }, 2500)

  try {
    // 尝试 onEmit 风格与 iterator 风格兼容
    const base: any = { seats: opts.seats, four2: opts.four2, rob: opts.rob, delayMs: opts.delayMs ?? 0 }
    const optAny: any = {
      ...base,
      onEmit: (value:any) => {
        emit(value)
        const k = value?.kind || value?.type
        if (k && k !== 'ka') lastProgress = Date.now()
        if (value?.kind === 'init' && typeof value?.landlord === 'number') landlord = value.landlord
        if (value?.kind === 'win') { sawWin = true; doneResolvers.forEach(d=>d.resolve()) }
      }
    }

    let ret: any
    try {
      ret = (runOneGame as any)(optAny)
    } catch (e:any) {
      emit({ type:'log', message:`引擎调用异常：${e?.message || e}` })
      return
    }

    // 如果是 Promise，先等一下
    if (ret && typeof ret.then === 'function') {
      try { ret = await ret } catch (e:any) {
        emit({ type:'log', message:`引擎 Promise 异常：${e?.message || e}` })
        return
      }
    }

    // 如果是 async-iterator，就消费它
    const iter: any =
      (ret && (typeof ret.next === 'function' || typeof ret[Symbol.asyncIterator] === 'function'))
        ? ret
        : null

    if (iter) {
      const ai = typeof iter[Symbol.asyncIterator] === 'function' ? iter[Symbol.asyncIterator]() : iter
      while (true) {
        const { value, done } = await ai.next()
        if (done) break
        emit(value)
        const k = value?.kind || value?.type
        if (k && k !== 'ka') lastProgress = Date.now()
        if (value?.kind === 'init' && typeof value?.landlord === 'number') landlord = value.landlord
        if (value?.kind === 'win') sawWin = true
      }
    } else {
      // 否则认为是 onEmit 风格，等到 win 或超时
      await Promise.race([doneP, sleep(45000)])
    }
  } finally {
    try { clearInterval(watchdog) } catch {}
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const WALL_T0 = Date.now();
  const MAX_WALL_MS = 55_000; // safe wall time per request

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // 尽量禁用缓冲和 Nagle
  try { res.socket?.setTimeout?.(0) } catch {}
  try { res.socket?.setNoDelay?.(true) } catch {}

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  const seqCounter = { n: 0 }

  // server keep-alive（前端会忽略渲染）
  const ka = setInterval(() => {
    writeLine(res, { type:'ka' }, seqCounter)
  }, 2000)

  const emit = makeEmitter(res, seqCounter)

  try {
    const body: StartPayload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
  // Safe rounds fallback
  const safeSeatDelay = Math.max(0, Number((req.body?.seatDelayMs) ?? 0));
  const safeRounds = (safeSeatDelay >= 800 ? 1 : Math.max(1, Number((req.body?.rounds) ?? 1)));

    const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '200', 10)
    const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(body.rounds) || 1))
    const four2 = (body.four2 as Four2Policy) || 'both'
    const rob = !!body.rob
    const delays = Array.isArray(body.seatDelayMs) && body.seatDelayMs.length === 3 ? body.seatDelayMs : [0,0,0]
    const seatKinds: BotChoice[] = (Array.isArray(body.seats) ? body.seats : []) as any
    const models: string[] = (Array.isArray(body.seatModels) ? body.seatModels : []) as any
    const keys = (Array.isArray(body.seatKeys) ? body.seatKeys : []) as any

    emit({ type:'log', message:`开始连打 ${rounds} 局（four2=${four2}）…` })

    for (let round = 1; round <= safeRounds; round++) {
    if (Date.now() - WALL_T0 > MAX_WALL_MS) {
      writeLine(res, { type:'log', message:'⏱️ Wall-clock guard: end this connection early to avoid serverless timeout.' });
      break;
    }
      emit({ type:'log', message:`—— 第 ${round} 局开始 ——` })

      // 每局重新构造 bot，保证状态干净
      const bots: BotFunc[] = [0,1,2].map(i => {
        const kind = seatKinds[i] || 'built-in:greedy-max'
        const bot = chooseBot(kind, models[i], keys[i])
        return withMinInterval(bot, Math.max(0, Number(delays[i] || 0)))
      })

      await forwardGameCompat(res, { seats: bots, rob, four2 }, seqCounter)

      if (round < rounds) emit({ type:'log', message:`—— 第 ${round} 局结束 ——` })
    }
  } catch (e:any) {
    emit({ type:'log', message:`后端错误：${e?.message || String(e)}` })
  } finally {
    try { clearInterval(ka) } catch {}
    try { (res as any).end() } catch {}
  }
}
