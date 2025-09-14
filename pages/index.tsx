// /pages/index.tsx
import * as React from 'react';

/* =========================
   [TS] Step 1: TrueSkill 类型 + 初值
   ========================= */
type TSSeat = { mu: number; sigma: number; rc?: number };
const __initTS = (): TSSeat[] => {
  const mu0 = 1000, sig0 = 1000 / 3;
  return [
    { mu: mu0, sigma: sig0, rc: mu0 - 3 * sig0 },
    { mu: mu0, sigma: sig0, rc: mu0 - 3 * sig0 },
    { mu: mu0, sigma: sig0, rc: mu0 - 3 * sig0 },
  ];
};

/* =========================
   牌面/事件 辅助类型
   ========================= */
type PlayEvent = {
  seat: number;                    // 0/1/2
  move: 'play' | 'pass';
  cards?: string[];                // 出的牌，如 ["3","3","3","4","4","4"] 或 ["x"]（小王）
  reason?: string;
};

type InitEvent = {
  type?: string;
  landlordIdx?: number;
  hands?: string[][];              // 三个座位的起手牌
  bottom?: string[];               // 底牌
};

type EndEvent = {
  type?: string;
  landlordIdx?: number;
  landlordWin?: boolean;
  winnerRole?: 'landlord' | 'farmers';
  deltaScores?: [number, number, number];
};

type AnyEvent = any;

/* =========================
   UI 小组件
   ========================= */

const seatName = (i: number) => (i === 0 ? '甲' : i === 1 ? '乙' : '丙');

function CardPill({ c }: { c: string }) {
  // 用一个简单圆角块显示牌面，兼容带花色/大小王的编码
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 6px',
        border: '1px solid #ddd',
        borderRadius: 6,
        marginRight: 4,
        marginBottom: 4,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        background: '#fff',
      }}
    >
      {c}
    </span>
  );
}

function CardsRow({ cards }: { cards: string[] }) {
  if (!cards || !cards.length) return <span style={{ opacity: 0.6 }}>（无）</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {cards.map((c, i) => (
        <CardPill key={`${c}-${i}`} c={c} />
      ))}
    </div>
  );
}

/* ============================================================
   主页面
   ============================================================ */
export default function Home() {
  // 基本运行控制
  const [rounds, setRounds] = React.useState<number>(5);
  const [running, setRunning] = React.useState<boolean>(false);

  // 局内状态
  const [landlordIdx, setLandlordIdx] = React.useState<number>(-1);
  const [bottom, setBottom] = React.useState<string[]>([]);
  const [hands, setHands] = React.useState<string[][]>([[], [], []]);     // 三家手牌（仅展示）
  const handsRef = React.useRef<string[][]>([[], [], []]);

  const [plays, setPlays] = React.useState<PlayEvent[]>([]);              // 本局出牌记录
  const [totals, setTotals] = React.useState<[number, number, number]>([0, 0, 0]); // 总分板（0 和累计）
  const totalsRef = React.useRef<[number, number, number]>([0, 0, 0]);

  const [logs, setLogs] = React.useState<string[]>([]);

  /* =========================
     [TS] Step 2: TrueSkill 前端状态
     ========================= */
  const [tsSeats, setTsSeats] = React.useState<TSSeat[]>(__initTS());

  // 日志工具
  const appendLog = React.useCallback((line: string) => {
    setLogs(prev => (prev.length > 500 ? prev.slice(prev.length - 500) : prev).concat(line));
  }, []);

  // 清理/开新局的可视化
  const resetForNewRound = React.useCallback(() => {
    setLandlordIdx(-1);
    setBottom([]);
    setPlays([]);
    setHands([[], [], []]);
    handsRef.current = [[], [], []];
  }, []);

  // 根据事件兼容更新 landlordIdx
  const pickLandlordIdxFromEvent = (ev: AnyEvent): number => {
    if (typeof ev?.landlordIdx === 'number') return ev.landlordIdx;
    if (typeof ev?.landlord === 'number') return ev.landlord;
    if (ev?.init && typeof ev.init.landlordIdx === 'number') return ev.init.landlordIdx;
    return -1;
  };

  // 根据事件尝试读取 deltaScores
  const pickDeltaScoresFromEvent = (ev: AnyEvent): [number, number, number] | null => {
    if (Array.isArray(ev?.deltaScores) && ev.deltaScores.length === 3) {
      const d = ev.deltaScores;
      return [Number(d[0]) | 0, Number(d[1]) | 0, Number(d[2]) | 0];
    }
    return null;
  };

  // 处理 'init' 类事件（起手牌、底牌、地主）
  const onInit = React.useCallback((e: InitEvent) => {
    if (Array.isArray(e.hands) && e.hands.length === 3) {
      setHands(e.hands);
      handsRef.current = e.hands;
    }
    if (Array.isArray(e.bottom)) setBottom(e.bottom);
    const ld = pickLandlordIdxFromEvent(e);
    if (ld >= 0) setLandlordIdx(ld);
  }, []);

  // 处理 'play' 事件（出牌记录，仅展示）
  const onPlay = React.useCallback((e: PlayEvent) => {
    if (typeof e?.seat !== 'number') return;
    setPlays(prev => prev.concat(e));
  }, []);

  // 处理 'end' 事件（更新总分）
  const onEnd = React.useCallback(
    (e: EndEvent) => {
      const ds = pickDeltaScoresFromEvent(e);
      if (ds) {
        const next: [number, number, number] = [
          totalsRef.current[0] + (ds[0] || 0),
          totalsRef.current[1] + (ds[1] || 0),
          totalsRef.current[2] + (ds[2] || 0),
        ];
        totalsRef.current = next;
        setTotals(next);
      }
    },
    []
  );

  // ======== 发起比赛（NDJSON 流） ========
  const startMatch = async () => {
    if (running) return;
    setRunning(true);
    setLogs([]);
    totalsRef.current = totals; // 保持累计

    try {
      // 你可以将现有前端的参数都合并到 body，这里给出最小体
      const body: any = {
        rounds,
        // ……这里透传你现有的各种设置（rob/four2/seats/seatModels/seatKeys/seed 等）……
        /* =========================
           [TS] Step 3: 请求体附带 tsSeats
           ========================= */
        tsSeats: tsSeats.map(s => ({ mu: s.mu, sigma: s.sigma })),
      };

      const res = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const reader = res.body?.getReader();
      if (!reader) {
        appendLog('无法获取 NDJSON 流');
        setRunning(false);
        return;
      }

      resetForNewRound();
      let currentRound = 0;
      let lastDelta: [number, number, number] = [0, 0, 0];
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;

          let ev: AnyEvent;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }

          // 通用日志
          if (ev.type === 'log') {
            appendLog(ev.message || '');
          }
          if (ev.type === 'warn') {
            appendLog('[WARN] ' + (ev.message || ''));
          }
          if (ev.type === 'error') {
            appendLog('[ERROR] ' + (ev.message || ''));
          }

          // [TS] Step 4: 处理 TrueSkill 事件
          if (ev.type === 'ts' && Array.isArray(ev.seats)) {
            setTsSeats(ev.seats as TSSeat[]);
          }

          // 兼容初始化事件
          if (ev.type === 'init' || ev.kind === 'init' || ev.init) {
            const landlordMaybe = pickLandlordIdxFromEvent(ev);
            if (landlordMaybe >= 0) setLandlordIdx(landlordMaybe);

            const initEvent: InitEvent = {
              type: 'init',
              landlordIdx: landlordMaybe,
              hands: Array.isArray(ev.hands) ? ev.hands : ev.init?.hands,
              bottom: Array.isArray(ev.bottom) ? ev.bottom : ev.init?.bottom,
            };
            onInit(initEvent);
          }

          // 兼容每局开始的标识
          if (typeof ev.round === 'number') {
            // 某些实现会在 ts/init 中携带 round 字段
            if (ev.type === 'ts' && ev.round !== currentRound) {
              // 新局开始时清理上一局的可视化（但 totals 保持）
              resetForNewRound();
              currentRound = ev.round;
            }
          }

          // 出牌（play）事件
          if (ev.type === 'play' || ev.kind === 'play') {
            const p: PlayEvent = {
              seat: typeof ev.seat === 'number' ? ev.seat : -1,
              move: ev.move === 'pass' ? 'pass' : 'play',
              cards: Array.isArray(ev.cards) ? ev.cards : [],
              reason: ev.reason,
            };
            onPlay(p);
          }

          // 分数变化（用于胜负判定兜底）
          const ds = pickDeltaScoresFromEvent(ev);
          if (ds) lastDelta = ds;

          // 局结束
          if (ev.type === 'end' || ev.kind === 'end') {
            onEnd(ev as EndEvent);
          }
        }
      }
    } catch (e: any) {
      appendLog('流处理异常：' + (e?.message || String(e)));
    } finally {
      setRunning(false);
    }
  };

  /* =========================
     渲染
     ========================= */
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial' }}>
      <h2 style={{ margin: 0, marginBottom: 12 }}>斗地主 · 牌面与 TrueSkill</h2>

      {/* 控制条 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <label>
          局数：
          <input
            type="number"
            value={rounds}
            min={1}
            max={1000}
            onChange={e => setRounds(Math.max(1, Number(e.target.value || 1)))}
            style={{ width: 80, marginLeft: 6 }}
          />
        </label>
        <button onClick={startMatch} disabled={running} style={{ padding: '6px 12px' }}>
          {running ? '运行中…' : '开始'}
        </button>
      </div>

      {/* TrueSkill 只读卡片（不影响原布局，可移动位置） */}
      <div style={{ marginTop: 8, padding: 8, border: '1px solid #eee', borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>TrueSkill（μ / σ / 保守 μ−3σ）</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {tsSeats.map((s, i) => (
            <div key={i} style={{ padding: 8, border: '1px solid #ddd', borderRadius: 8, minWidth: 160 }}>
              <div style={{ opacity: 0.7, marginBottom: 4 }}>座位 {seatName(i)}</div>
              <div>μ = {s.mu.toFixed(2)}</div>
              <div>σ = {s.sigma.toFixed(2)}</div>
              <div>Rc = {(s.mu - 3 * s.sigma).toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 牌面展示区 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
              <div style={{ fontWeight: 600 }}>
                {seatName(i)} {landlordIdx === i && <span style={{ color: '#E67E22' }}>（地主）</span>}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>总分：{totals[i]}</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>手牌（起手/展示）</div>
            <CardsRow cards={hands[i] || []} />

            <div style={{ fontSize: 12, opacity: 0.7, margin: '8px 0 4px' }}>最近出牌</div>
            <div>
              {plays
                .filter(p => p.seat === i)
                .slice(-3)
                .map((p, k) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    {p.move === 'pass' ? (
                      <span style={{ opacity: 0.7 }}>过</span>
                    ) : (
                      <CardsRow cards={p.cards || []} />
                    )}
                    {p.reason && <div style={{ fontSize: 12, opacity: 0.6 }}>理由：{p.reason}</div>}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* 底牌与地主标识 */}
      <div style={{ marginTop: 10, padding: 8, border: '1px dashed #ddd', borderRadius: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>底牌</div>
        <CardsRow cards={bottom} />
      </div>

      {/* 运行日志 */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>运行日志</div>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            border: '1px solid #eee',
            borderRadius: 8,
            padding: 8,
            minHeight: 140,
            maxHeight: 260,
            overflow: 'auto',
            background: '#fafafa',
          }}
        >
          {logs.join('\n')}
        </div>
      </div>
    </div>
  );
}
