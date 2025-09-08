// pages/index.tsx — segmented per-round runner (safe with 1000ms delay)
// 说明：本页将 “多局连打的一次长连接” 改为 “每局一次独立请求”。
// 与 /api/stream_ndjson 搭配使用：POST body 至少包含 seats、rounds(=1)、seatDelayMs 等。

import React, { useEffect, useMemo, useRef, useState } from 'react'

// ====== UI/业务相关类型（仅本文件作用域，避免与工程其他处的全局类型冲突） ======
type SeatId = 0 | 1 | 2

// 与后端沟通的 Bot 枚举（命名避免与项目别处冲突）
type UIBotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai'
  | 'ai:gemini'
  | 'ai:grok'
  | 'ai:kimi'
  | 'ai:qwen'
  | 'http'

type UIFour2Policy = 'both' | '2singles' | '2pairs'

type UISeatKeys = {
  openai?: string
  gemini?: string
  grok?: string
  kimi?: string
  qwen?: string
  httpBase?: string
  httpToken?: string
}

type StartBody = {
  rounds: number
  startScore?: [number, number, number]
  seatDelayMs?: number | [number, number, number]
  enabled?: [boolean, boolean, boolean]
  rob?: boolean
  four2?: UIFour2Policy
  seats: UIBotChoice[]
  seatModels?: (string | undefined)[]
  seatKeys?: (UISeatKeys | undefined)[]
  debug?: boolean
  stopBelowZero?: boolean
}

// 后端 NDJSON 行的通用形态
type NdjsonLine = {
  type: 'ka' | 'log' | 'event'
  level?: 'error' | 'info' | 'warn'
  message?: string
  ts?: string
  seq?: number
  // event payload
  kind?: string
  [k: string]: any
}

// ====== 一些小工具 ======
const seatLabel = (i: SeatId) => '甲乙丙'[i]
const clampInt = (v: any, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(+v) ? Math.floor(+v) : lo))

function useSessionState<T>(key: string, init: T) {
  const [val, setVal] = useState<T>(() => {
    if (typeof window === 'undefined') return init
    try {
      const s = sessionStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : init
    } catch {
      return init
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(val))
    } catch {}
  }, [key, val])
  return [val, setVal] as const
}

// ====== 页面组件 ======
export default function Home() {
  // ---- 配置区（可被 sessionStorage 记忆） ----
  const [rounds, setRounds] = useSessionState<number>('cfg.rounds', 10)
  const [seatDelayMs, setSeatDelayMs] = useSessionState<number>('cfg.delay', 1000)
  const [rob, setRob] = useSessionState<boolean>('cfg.rob', true)
  const [four2, setFour2] = useSessionState<UIFour2Policy>('cfg.four2', 'both')
  const [seats, setSeats] = useSessionState<UIBotChoice[]>('cfg.seats', [
    'built-in:greedy-max',
    'built-in:greedy-min',
    'built-in:random-legal',
  ])
  const [seatModels, setSeatModels] = useSessionState<(string | undefined)[]>(
    'cfg.seatModels',
    [undefined, undefined, undefined]
  )
  const [enabled, setEnabled] = useSessionState<[boolean, boolean, boolean]>(
    'cfg.enabled',
    [true, true, true]
  )
  const [startScore, setStartScore] = useSessionState<[number, number, number]>(
    'cfg.startScore',
    [0, 0, 0]
  )
  const [debug, setDebug] = useSessionState<boolean>('cfg.debug', false)

  // 可选：每位选手的 key（如果你后端没有接 AI，就算填了也会兜底为内置）
  const [seatKeys, setSeatKeys] = useSessionState<(UISeatKeys | undefined)[]>(
    'cfg.keys',
    [{}, {}, {}]
  )

  // ---- 运行时状态 ----
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false) // 镜像，防止异步 setState 竞态
  useEffect(() => {
    runningRef.current = running
  }, [running])

  const controllerRef = useRef<AbortController | null>(null)

  // 展示用数据：手牌/出牌/倍率/赢家/累计分/日志/已完成局数
  const [hands, setHands] = useState<any[][]>([[], [], []])
  const [plays, setPlays] = useState<any[]>([])
  const [multiplier, setMultiplier] = useState<number>(1)
  const [winner, setWinner] = useState<SeatId | null>(null)
  const [delta, setDelta] = useState<[number, number, number] | null>(null)
  const [totals, setTotals] = useState<[number, number, number]>(startScore)
  const totalsRef = useRef(totals)
  useEffect(() => {
    totalsRef.current = totals
  }, [totals])

  // 首次从非运行->运行时，把 totals 重置为 startScore
  useEffect(() => {
    // 当 running 从 false -> true 切换时重置累计分
    // 注意：如果你希望“在一个长跑任务中多次点击开始”仍沿用累计分，这里可以去掉该逻辑
    // 这里选择：每次新启动都用 startScore 初始化
    if (running) setTotals([startScore[0], startScore[1], startScore[2]])
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  const [logLines, setLogLines] = useState<string[]>([])
  const [finishedCount, setFinishedCount] = useState<number>(0)

  // ---- 小工具：追加日志 ----
  const appendLog = (s: string) => {
    setLogLines((prev) => {
      const next = prev.length > 2000 ? prev.slice(-1500) : prev
      return [...next, s]
    })
  }

  // ---- 解析并处理从后端流回的每一行 ----
  const handleLine = (obj: NdjsonLine) => {
    if (!obj || typeof obj !== 'object') return
    if (obj.type === 'ka') return // keep-alive 忽略
    if (obj.type === 'log') {
      const msg = obj.message ?? ''
      appendLog(`[log] ${msg}`)
      return
    }
    if (obj.type === 'event') {
      const k = obj.kind
      if (k === 'win') {
        // 预期字段：winner, multiplier, deltaScores
        const w = (obj.winner ?? 0) as SeatId
        const m = Number(obj.multiplier ?? 1)
        const ds = (obj.deltaScores ?? [0, 0, 0]) as [number, number, number]
        setWinner(w)
        setMultiplier(m)
        setDelta(ds)

        // 累计分
        setTotals(([a, b, c]) => [a + ds[0], b + ds[1], c + ds[2]])
        setFinishedCount((n) => n + 1)
        appendLog(`[event] win — winner:${'甲乙丙'[w]} ×${m} Δ=${ds.join('/')}`)
        return
      }

      // 如果你有其他事件（发牌/叫分/出牌等），可在此扩展
      if (k === 'deal' && obj.hands) {
        setHands(obj.hands as any[][])
      } else if (k === 'play') {
        setPlays((p) => [...p, obj])
      }

      // 兜底记日志
      appendLog(`[event] ${k ?? 'unknown'} ${JSON.stringify(obj)}`)
      return
    }

    // 未知类型
    appendLog(`[?] ${JSON.stringify(obj)}`)
  }

  // ====== 单局请求：runOneRound ======
  const runOneRound = async () => {
    controllerRef.current = new AbortController()

    // 清空“当局”展示（保留 totals 与 finishedCount）
    setHands([[], [], []])
    setPlays([])
    setWinner(null)
    setDelta(null)
    setMultiplier(1)

    // 组装请求 body
    const body: StartBody = {
      rounds: 1, // 关键：单局分段
      startScore, // 后端通常不会用，但可以传
      seatDelayMs, // 也可传 [d0,d1,d2]，此处用全局一个值
      enabled,
      rob,
      four2,
      seats,
      seatModels,
      seatKeys,
      debug,
    }

    let resp: Response | null = null
    try {
      resp = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controllerRef.current.signal,
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        appendLog('[client] 请求已中止')
        return
      }
      appendLog(`[client] 请求失败: ${e?.message || e}`)
      return
    }

    if (!resp.ok || !resp.body) {
      appendLog(`[client] 响应异常: ${resp.status} ${resp.statusText}`)
      return
    }

    // 读取 NDJSON
    const reader = resp.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (runningRef.current) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // 拆行
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line) continue
          try {
            const obj = JSON.parse(line) as NdjsonLine
            handleLine(obj)
          } catch (e) {
            appendLog(`[client] JSON 解析失败: ${line}`)
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        appendLog('[client] 读取被中止')
      } else {
        appendLog(`[client] 读取异常: ${e?.message || e}`)
      }
    } finally {
      try {
        await reader.cancel()
      } catch {}
    }
  }

  // ====== start / stop ======
  const start = async () => {
    // 用 ref 判断，避免 setState 异步带来的竞态
    if (runningRef.current) return

    setRunning(true)
    runningRef.current = true // 关键：立即同步，避免首轮判断为 false

    // 清空“整场”日志（保留后端日志在服务器）
    setLogLines([])
    setFinishedCount(0)
    setTotals([startScore[0], startScore[1], startScore[2]])
    setWinner(null)
    setDelta(null)
    setMultiplier(1)
    setHands([[], [], []])
    setPlays([])

    try {
      const totalRounds = Math.max(1, rounds || 1)
      for (let r = 1; r <= totalRounds; r++) {
        if (!runningRef.current) break
        appendLog(`—— 第 ${r} 局开始 ——`)
        await runOneRound()
        if (!runningRef.current) break
      }
      appendLog('【本轮结束】')
    } catch (e: any) {
      appendLog(`[client] start() 异常: ${e?.message || e}`)
    } finally {
      runningRef.current = false
      setRunning(false)
      try {
        controllerRef.current?.abort()
      } catch {}
    }
  }

  const stop = () => {
    if (!runningRef.current) return
    runningRef.current = false
    setRunning(false)
    try {
      controllerRef.current?.abort()
    } catch {}
    appendLog('[client] 已停止')
  }

  // ====== 简易 UI ======
  return (
    <div style={{ maxWidth: 1080, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ margin: '12px 0 16px' }}>斗地主对战（分段版 · 每局一次请求）</h1>

      {/* 配置面板 */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div>
          <label>总局数</label>
          <input
            type="number"
            min={1}
            value={rounds}
            onChange={(e) => setRounds(clampInt(e.target.value, 1, 9999))}
            style={{ width: '100%', padding: 6 }}
          />
        </div>

        <div>
          <label>最小思考延时（ms）</label>
          <input
            type="number"
            min={0}
            value={seatDelayMs}
            onChange={(e) => setSeatDelayMs(clampInt(e.target.value, 0, 60000))}
            style={{ width: '100%', padding: 6 }}
          />
        </div>

        <div>
          <label>四带二策略</label>
          <select
            value={four2}
            onChange={(e) => setFour2(e.target.value as UIFour2Policy)}
            style={{ width: '100%', padding: 6 }}
          >
            <option value="both">both（两单/两对均可）</option>
            <option value="2singles">2singles（两单）</option>
            <option value="2pairs">2pairs（两对）</option>
          </select>
        </div>

        <div>
          <label>地主抢/叫</label>
          <select value={rob ? '1' : '0'} onChange={(e) => setRob(e.target.value === '1')} style={{ width: '100%', padding: 6 }}>
            <option value="1">开启</option>
            <option value="0">关闭</option>
          </select>
        </div>

        <div>
          <label>起始分（甲/乙/丙）</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              value={startScore[0]}
              onChange={(e) => setStartScore([clampInt(e.target.value, -99999, 99999), startScore[1], startScore[2]])}
              style={{ width: '100%', padding: 6 }}
            />
            <input
              type="number"
              value={startScore[1]}
              onChange={(e) => setStartScore([startScore[0], clampInt(e.target.value, -99999, 99999), startScore[2]])}
              style={{ width: '100%', padding: 6 }}
            />
            <input
              type="number"
              value={startScore[2]}
              onChange={(e) => setStartScore([startScore[0], startScore[1], clampInt(e.target.value, -99999, 99999)])}
              style={{ width: '100%', padding: 6 }}
            />
          </div>
        </div>

        <div>
          <label>调试日志（前端标记）</label>
          <select value={debug ? '1' : '0'} onChange={(e) => setDebug(e.target.value === '1')} style={{ width: '100%', padding: 6 }}>
            <option value="0">关闭</option>
            <option value="1">开启</option>
          </select>
        </div>
      </section>

      {/* 座位配置 */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <h3 style={{ margin: '4px 0 8px' }}>座位配置</h3>
        {[0, 1, 2].map((i) => {
          const seat = i as SeatId
          return (
            <div key={seat} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 80px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>座位 {seatLabel(seat)}</div>
              <select
                value={seats[seat]}
                onChange={(e) => {
                  const nv = [...seats] as UIBotChoice[]
                  nv[seat] = e.target.value as UIBotChoice
                  setSeats(nv)
                }}
                style={{ width: '100%', padding: 6 }}
              >
                <option value="built-in:greedy-max">内置：GreedyMax</option>
                <option value="built-in:greedy-min">内置：GreedyMin</option>
                <option value="built-in:random-legal">内置：RandomLegal</option>
                <option value="ai:openai">AI：OpenAI</option>
                <option value="ai:gemini">AI：Gemini</option>
                <option value="ai:grok">AI：Grok</option>
                <option value="ai:kimi">AI：Kimi</option>
                <option value="ai:qwen">AI：Qwen</option>
                <option value="http">HTTP 适配</option>
              </select>

              <input
                placeholder="可选：模型名"
                value={seatModels[seat] ?? ''}
                onChange={(e) => {
                  const nv = [...seatModels]
                  nv[seat] = e.target.value
                  setSeatModels(nv)
                }}
                style={{ width: '100%', padding: 6 }}
              />

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={enabled[seat]}
                  onChange={(e) => {
                    const nv: [boolean, boolean, boolean] = [enabled[0], enabled[1], enabled[2]]
                    nv[seat] = e.target.checked
                    setEnabled(nv)
                  }}
                />
                启用
              </label>
            </div>
          )
        })}
      </section>

      {/* 运行控制 */}
      <section style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <button
          onClick={start}
          disabled={running}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #10b981',
            background: running ? '#a7f3d0' : '#10b981',
            color: '#fff',
            cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          开始
        </button>
        <button
          onClick={stop}
          disabled={!running}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #ef4444',
            background: !running ? '#fecaca' : '#ef4444',
            color: '#fff',
            cursor: !running ? 'not-allowed' : 'pointer',
          }}
        >
          停止
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>已完成：<b>{finishedCount}</b> / 目标 <b>{rounds}</b></span>
          <span>倍率：<b>×{multiplier}</b></span>
          <span>赢家：<b>{winner == null ? '-' : seatLabel(winner)}</b></span>
        </div>
      </section>

      {/* 积分板 */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <h3 style={{ margin: '4px 0 8px' }}>累计分（甲/乙/丙）</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          {([0, 1, 2] as SeatId[]).map((i) => (
            <div key={i} style={{ flex: 1, border: '1px solid #e5e7eb', padding: 12, borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>座位 {seatLabel(i)}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: totals[i] >= 0 ? '#111827' : '#ef4444' }}>{totals[i]}</div>
            </div>
          ))}
        </div>
        {delta && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#374151' }}>
            上局分差：{delta[0]} / {delta[1]} / {delta[2]}
          </div>
        )}
      </section>

      {/* 简易日志 */}
      <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 24 }}>
        <h3 style={{ margin: '4px 0 8px' }}>运行日志（前端）</h3>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 12,
            height: 260,
            overflow: 'auto',
            background: '#fafafa',
          }}
        >
          {logLines.length === 0 ? (
            <div style={{ color: '#9ca3af' }}>（开始后会显示日志，这里只显示前端标记与后端回传的 log/event 摘要）</div>
          ) : (
            logLines.map((ln, idx) => <div key={idx}>{ln}</div>)
          )}
        </div>
      </section>

      <footer style={{ color: '#9ca3af', fontSize: 12, marginBottom: 40 }}>
        分段版 runner：每局一次请求；在 800–1000 ms 延时下也能稳定运行。
      </footer>
    </div>
  )
}
