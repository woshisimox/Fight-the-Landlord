// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react';

/* ===================== 基础类型 ===================== */
type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai'
  | 'ai:gemini'
  | 'ai:grok'
  | 'ai:kimi'
  | 'ai:qwen'
  | 'ai:deepseek'
  | 'http';

/* ===================== TrueSkill 实现 ===================== */
type Rating = { mu: number; sigma: number };
const TS_DEFAULT: Rating = { mu: 25, sigma: 25 / 3 };
const TS_BETA = 25 / 6;
const TS_TAU = 25 / 300;
const SQRT2 = Math.sqrt(2);

function erf(x: number) {
  const s = Math.sign(x);
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return s * y;
}
function phi(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
function Phi(x: number) {
  return 0.5 * (1 + erf(x / SQRT2));
}
function V_exceeds(t: number) {
  const d = Math.max(1e-12, Phi(t));
  return phi(t) / d;
}
function W_exceeds(t: number) {
  const v = V_exceeds(t);
  return v * (v + t);
}
/** 双队更新（A 胜 B） */
function tsUpdateTwoTeams(r: Rating[], teamA: number[], teamB: number[]) {
  const varA = teamA.reduce((s, i) => s + r[i].sigma ** 2, 0),
    varB = teamB.reduce((s, i) => s + r[i].sigma ** 2, 0);
  const muA = teamA.reduce((s, i) => s + r[i].mu, 0),
    muB = teamB.reduce((s, i) => s + r[i].mu, 0);
  const c2 = varA + varB + 2 * TS_BETA * TS_BETA;
  const c = Math.sqrt(c2);
  const t = (muA - muB) / c;
  const v = V_exceeds(t),
    w = W_exceeds(t);

  for (const i of teamA) {
    const sig2 = r[i].sigma ** 2,
      mult = sig2 / c,
      mult2 = sig2 / c2;
    r[i].mu += mult * v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2 * (1 - w * mult2)) + TS_TAU * TS_TAU);
  }
  for (const i of teamB) {
    const sig2 = r[i].sigma ** 2,
      mult = sig2 / c,
      mult2 = sig2 / c2;
    r[i].mu -= mult * v;
    r[i].sigma = Math.sqrt(Math.max(1e-6, sig2 * (1 - w * mult2)) + TS_TAU * TS_TAU);
  }
}

/* ===================== PageRank（相对 + 绝对） ===================== */
type PRState = {
  W: number[][];
  pr: number[];
  abs: number[];
  reward: number[];
  rounds: number;
};
const prZero = (): PRState => ({
  W: [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  pr: [1 / 3, 1 / 3, 1 / 3],
  abs: [0, 0, 0],
  reward: [0, 0, 0],
  rounds: 0,
});

// PR 参数
const PR_ALPHA = 0.85;
const PR_ITERS = 40;
const PR_DECAY = 0.98;

/** 相对 PR（归一化） */
function computePRRelative(W: number[][], d = PR_ALPHA, iters = PR_ITERS) {
  const n = 3;
  const out = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += W[i][j];
    out[i] = s;
  }
  let cur = Array(n).fill(1 / n);
  for (let k = 0; k < iters; k++) {
    const nxt = Array(n).fill((1 - d) / n);
    for (let i = 0; i < n; i++) {
      if (out[i] > 0) {
        for (let j = 0; j < n; j++) {
          const pij = W[i][j] / out[i];
          nxt[j] += d * cur[i] * pij;
        }
      } else {
        for (let j = 0; j < n; j++) nxt[j] += d * cur[i] / n;
      }
    }
    const s = nxt.reduce((a, b) => a + b, 0) || 1;
    for (let j = 0; j < n; j++) nxt[j] /= s;
    cur = nxt;
  }
  return cur;
}
/** 绝对 PR（Katz 风格，不归一化，体现超预期进步） */
function computePRAbsolute(
  W: number[][],
  reward: number[],
  d = PR_ALPHA,
  iters = PR_ITERS,
  warm?: number[],
) {
  const n = 3;
  const out = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += W[i][j];
    out[i] = s;
  }
  let x = warm && warm.length === n ? warm.slice() : Array(n).fill(0);
  for (let k = 0; k < iters; k++) {
    const nxt = Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      let acc = reward[j];
      for (let i = 0; i < n; i++) {
        const pij = out[i] > 0 ? W[i][j] / out[i] : 1 / n;
        acc += d * pij * x[i];
      }
      nxt[j] = acc;
    }
    x = nxt;
  }
  return x;
}
/** 用相对 PR 估算 A 胜 B 的期望胜率 */
function expectedWin(rel: number[], a: number, b: number) {
  const denom = Math.max(1e-9, rel[a] + rel[b]);
  return rel[a] / denom;
}

/* ===================== 存档结构 ===================== */
// TS
type TsRole = 'landlord' | 'farmer';
type TsStoreEntry = {
  id: string;
  label?: string;
  overall?: Rating | null;
  roles?: { landlord?: Rating | null; farmer?: Rating | null };
  meta?: { choice?: string; model?: string; httpBase?: string };
};
type TsStore = {
  schema: 'ddz-trueskill@1';
  updatedAt: string;
  players: Record<string, TsStoreEntry>;
};
const TS_STORE_KEY = 'ddz_ts_store_v1';

const ensureRating = (x: any): Rating => {
  const mu = Number(x?.mu),
    sigma = Number(x?.sigma);
  if (Number.isFinite(mu) && Number.isFinite(sigma)) return { mu, sigma };
  return { ...TS_DEFAULT };
};
const emptyTsStore = (): TsStore => ({
  schema: 'ddz-trueskill@1',
  updatedAt: new Date().toISOString(),
  players: {},
});
const readTsStore = (): TsStore => {
  try {
    const raw = localStorage.getItem(TS_STORE_KEY);
    if (!raw) return emptyTsStore();
    const j = JSON.parse(raw);
    if (j?.schema && j?.players) return j as TsStore;
  } catch {}
  return emptyTsStore();
};
const writeTsStore = (s: TsStore) => {
  try {
    s.updatedAt = new Date().toISOString();
    localStorage.setItem(TS_STORE_KEY, JSON.stringify(s));
  } catch {}
};

// PR
type PrStoreEntry = {
  id: string;
  pr?: number | null;
  abs?: number | null;
  reward?: number | null;
};
type PrStore = {
  schema: 'ddz-pagerank@1' | 'ddz-pagerank@2';
  updatedAt: string;
  players: Record<string, PrStoreEntry>;
};
const PR_STORE_KEY = 'ddz_pr_store_v1';
const emptyPrStore = (): PrStore => ({
  schema: 'ddz-pagerank@2',
  updatedAt: new Date().toISOString(),
  players: {},
});
const readPrStore = (): PrStore => {
  try {
    const raw = localStorage.getItem(PR_STORE_KEY);
    if (!raw) return emptyPrStore();
    const j = JSON.parse(raw);
    if (j?.schema && j?.players) return j as PrStore;
  } catch {}
  return emptyPrStore();
};
const writePrStore = (s: PrStore) => {
  try {
    s.updatedAt = new Date().toISOString();
    localStorage.setItem(PR_STORE_KEY, JSON.stringify(s));
  } catch {}
};

/* ===================== UI 小组件 ===================== */
function SeatTitle({ i }: { i: number }) {
  return <span style={{ fontWeight: 700 }}>{['甲', '乙', '丙'][i]}</span>;
}
type SuitSym = '♠' | '♥' | '♦' | '♣' | '🃏';
const SUITS: SuitSym[] = ['♠', '♥', '♦', '♣'];

const seatName = (i: number) => ['甲', '乙', '丙'][i] || String(i);

const rankOf = (l: string) => {
  if (!l) return '';
  const c0 = l[0];
  if ('♠♥♦♣'.includes(c0)) return l.slice(1).replace(/10/i, 'T').toUpperCase();
  if (c0 === '🃏') return (l.slice(2) || 'X').replace(/10/i, 'T').toUpperCase();
  return l.replace(/10/i, 'T').toUpperCase();
};
function candDecorations(l: string): string[] {
  if (!l) return [];
  if (l === 'x') return ['🃏X'];
  if (l === 'X') return ['🃏Y'];
  if (l.startsWith('🃏')) return [l];
  if ('♠♥♦♣'.includes(l[0])) return [l];
  const r = rankOf(l);
  if (r === 'JOKER') return ['🃏Y'];
  return SUITS.map((s) => `${s}${r}`);
}
function decorateHandCycle(raw: string[]): string[] {
  let idx = 0;
  return raw.map((l) => {
    if (!l) return l;
    if (l === 'x') return '🃏X';
    if (l === 'X') return '🃏Y';
    if (l.startsWith('🃏')) return l;
    if ('♠♥♦♣'.includes(l[0])) return l;
    const suit = SUITS[idx % SUITS.length];
    idx++;
    return `${suit}${rankOf(l)}`;
  });
}
function Card({ label }: { label: string }) {
  const suit = label.startsWith('🃏') ? '🃏' : label.charAt(0);
  const baseColor = suit === '♥' || suit === '♦' ? '#af1d22' : '#1a1a1a';
  const rank = label.startsWith('🃏') ? label.slice(2) || '' : label.slice(1);
  const rankColor = suit === '🃏' ? (rank === 'Y' ? '#d11' : '#16a34a') : undefined;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: '6px 10px',
        marginRight: 6,
        marginBottom: 6,
        fontWeight: 800,
        color: baseColor,
      }}
    >
      <span style={{ fontSize: 16 }}>{suit}</span>
      <span style={{ fontSize: 16, ...(rankColor ? { color: rankColor } : {}) }}>
        {rank === 'T' ? '10' : rank}
      </span>
    </span>
  );
}
function Hand({ cards }: { cards: string[] }) {
  if (!cards || cards.length === 0) return <span style={{ opacity: 0.6 }}>（空）</span>;
  return <div style={{ display: 'flex', flexWrap: 'wrap' }}>{cards.map((c, i) => <Card key={`${c}-${i}`} label={c} />)}</div>;
}
function PlayRow({
  seat,
  move,
  cards,
  reason,
}: {
  seat: number;
  move: 'play' | 'pass';
  cards?: string[];
  reason?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
      <div style={{ width: 32, textAlign: 'right', opacity: 0.8 }}>{seatName(seat)}</div>
      <div style={{ width: 56, fontWeight: 700 }}>{move === 'pass' ? '过' : '出牌'}</div>
      <div style={{ flex: 1 }}>{move === 'pass' ? <span style={{ opacity: 0.6 }}>过</span> : <Hand cards={cards || []} />}</div>
      {reason && <div style={{ width: 260, fontSize: 12, color: '#666' }}>{reason}</div>}
    </div>
  );
}
function LogLine({ text }: { text: string }) {
  return (
    <div
      style={{
        fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
        fontSize: 12,
        color: '#555',
        padding: '2px 0',
      }}
    >
      {text}
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

/* ===================== 模型选择/校验 ===================== */
function defaultModelFor(choice: BotChoice): string {
  switch (choice) {
    case 'ai:openai':
      return 'gpt-4o-mini';
    case 'ai:gemini':
      return 'gemini-1.5-flash';
    case 'ai:grok':
      return 'grok-2-latest';
    case 'ai:kimi':
      return 'kimi-k2-0905-preview';
    case 'ai:qwen':
      return 'qwen-plus';
    case 'ai:deepseek':
      return 'deepseek-chat';
    default:
      return '';
  }
}
function normalizeModelForProvider(choice: BotChoice, input: string): string {
  const m = (input || '').trim();
  const low = m.toLowerCase();
  if (!m) return '';
  switch (choice) {
    case 'ai:kimi':
      return /^kimi[-\w]*/.test(low) ? m : '';
    case 'ai:openai':
      return /^(gpt-|o[34]|text-|omni)/.test(low) ? m : '';
    case 'ai:gemini':
      return /^gemini[-\w.]*/.test(low) ? m : '';
    case 'ai:grok':
      return /^grok[-\w.]*/.test(low) ? m : '';
    case 'ai:qwen':
      return /^qwen[-\w.]*/.test(low) ? m : '';
    case 'ai:deepseek':
      return /^deepseek[-\w.]*/.test(low) ? m : '';
    default:
      return '';
  }
}
function choiceLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max':
      return 'Greedy Max';
    case 'built-in:greedy-min':
      return 'Greedy Min';
    case 'built-in:random-legal':
      return 'Random Legal';
    case 'ai:openai':
      return 'OpenAI';
    case 'ai:gemini':
      return 'Gemini';
    case 'ai:grok':
      return 'Grok';
    case 'ai:kimi':
      return 'Kimi';
    case 'ai:qwen':
      return 'Qwen';
    case 'ai:deepseek':
      return 'DeepSeek';
    case 'http':
      return 'HTTP';
  }
}

/* ===================== 雷达图（0~5） ===================== */
type Score5 = { coop: number; agg: number; cons: number; eff: number; rob: number };
function mergeScore(prev: Score5, curr: Score5, mode: 'mean' | 'ewma', count: number, alpha: number): Score5 {
  if (mode === 'mean') {
    const c = Math.max(0, count);
    return {
      coop: (prev.coop * c + curr.coop) / (c + 1),
      agg: (prev.agg * c + curr.agg) / (c + 1),
      cons: (prev.cons * c + curr.cons) / (c + 1),
      eff: (prev.eff * c + curr.eff) / (c + 1),
      rob: (prev.rob * c + curr.rob) / (c + 1),
    };
  }
  const a = Math.min(0.95, Math.max(0.05, alpha || 0.35));
  return {
    coop: a * curr.coop + (1 - a) * prev.coop,
    agg: a * curr.agg + (1 - a) * prev.agg,
    cons: a * curr.cons + (1 - a) * prev.cons,
    eff: a * curr.eff + (1 - a) * prev.eff,
    rob: a * curr.rob + (1 - a) * prev.rob,
  };
}
function RadarChart({ title, scores }: { title: string; scores: Score5 }) {
  const vals = [scores.coop, scores.agg, scores.cons, scores.eff, scores.rob];
  const size = 180,
    R = 70,
    cx = size / 2,
    cy = size / 2;
  const pts = vals
    .map((v, i) => {
      const ang = (-90 + i * (360 / 5)) * (Math.PI / 180);
      const r = (Math.max(0, Math.min(5, v)) / 5) * R;
      return `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
    })
    .join(' ');
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {[1, 2, 3, 4, 5].map((k) => {
          const r = (k / 5) * R;
          const polygon = Array.from({ length: 5 }, (_, i) => {
            const ang = (-90 + i * (360 / 5)) * (Math.PI / 180);
            return `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
          }).join(' ');
          return <polygon key={k} points={polygon} fill="none" stroke="#e5e7eb" />;
        })}
        {Array.from({ length: 5 }, (_, i) => {
          const ang = (-90 + i * (360 / 5)) * (Math.PI / 180);
          return <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(ang)} y2={cy + R * Math.sin(ang)} stroke="#e5e7eb" />;
        })}
        <polygon points={pts} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={2} />
        {['配合', '激进', '保守', '效率', '抢地主'].map((lab, i) => {
          const ang = (-90 + i * (360 / 5)) * (Math.PI / 180);
          return (
            <text key={i} x={cx + (R + 14) * Math.cos(ang)} y={cy + (R + 14) * Math.sin(ang)} fontSize="12" textAnchor="middle" dominantBaseline="middle" fill="#374151">
              {lab}
            </text>
          );
        })}
      </svg>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        分数（0~5）：Coop {scores.coop} / Agg {scores.agg} / Cons {scores.cons} / Eff {scores.eff} / Rob {scores.rob}
      </div>
    </div>
  );
}

/* ===================== 文本改写（将“第 n 局”固定） ===================== */
const makeRewriteRoundLabel = (n: number) => (msg: string) => {
  if (typeof msg !== 'string') return msg;
  let out = msg;
  out = out.replace(/第\s*\d+\s*局开始/g, `第 ${n} 局开始`);
  out = out.replace(/开始第\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始第\s*\d+\s*局\(/g, `开始第 ${n} 局(`);
  out = out.replace(/开始连打\s*\d+\s*局（/g, `开始第 ${n} 局（`);
  out = out.replace(/开始连打\s*\d+\s*局\(/g, `开始第 ${n} 局(`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局（/g, `单局模式：开始第 ${n} 局（`);
  out = out.replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局\(/g, `单局模式：开始第 ${n} 局(`);
  return out;
};

/* ===================== Live Panel（对局） ===================== */
type LiveProps = {
  rounds: number;
  startScore: number;
  seatDelayMs?: number[];
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: {
    openai?: string;
    gemini?: string;
    grok?: string;
    kimi?: string;
    qwen?: string;
    deepseek?: string;
    httpBase?: string;
    httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals: [number, number, number]) => void;
  onLog?: (lines: string[]) => void;
};

function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);

  const [hands, setHands] = useState<string[][]>([[], [], []]);
  const [landlord, setLandlord] = useState<number | null>(null);
  const [plays, setPlays] = useState<{ seat: number; move: 'play' | 'pass'; cards?: string[]; reason?: string }[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [winner, setWinner] = useState<number | null>(null);
  const [delta, setDelta] = useState<[number, number, number] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState<[number, number, number]>([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
  const [finishedCount, setFinishedCount] = useState(0);

  // 显示开关
  const [showTS, setShowTS] = useState(true);
  const [showPR, setShowPR] = useState(true);

  // TrueSkill
  const [tsArr, setTsArr] = useState<Rating[]>([{ ...TS_DEFAULT }, { ...TS_DEFAULT }, { ...TS_DEFAULT }]);
  const tsRef = useRef(tsArr);
  useEffect(() => {
    tsRef.current = tsArr;
  }, [tsArr]);
  const tsCr = (r: Rating) => r.mu - 3 * r.sigma;

  // PageRank
  const [prState, setPrState] = useState<PRState>(prZero());
  const prRef = useRef(prState);
  useEffect(() => {
    prRef.current = prState;
  }, [prState]);

  // —— TS 存档 —— //
  const tsStoreRef = useRef<TsStore>(emptyTsStore());
  useEffect(() => {
    try {
      tsStoreRef.current = readTsStore();
    } catch {}
  }, []);
  const tsFileRef = useRef<HTMLInputElement | null>(null);

  // —— PR 存档 —— //
  const prStoreRef = useRef<PrStore>(emptyPrStore());
  useEffect(() => {
    try {
      prStoreRef.current = readPrStore();
    } catch {}
  }, []);
  const prFileRef = useRef<HTMLInputElement | null>(null);

  const seatIdentity = (i: number) => {
    const choice = props.seats[i];
    const model = normalizeModelForProvider(choice, props.seatModels[i] || '') || defaultModelFor(choice);
    const base = choice === 'http' ? props.seatKeys[i]?.httpBase || '' : '';
    return `${choice}|${model}|${base}`;
  };

  /* ---------- TS：从存档解析/应用 ---------- */
  const resolveRatingForIdentity = (id: string, role?: TsRole): Rating | null => {
    const p = tsStoreRef.current.players[id];
    if (!p) return null;
    if (role && p.roles?.[role]) return ensureRating(p.roles[role]);
    if (p.overall) return ensureRating(p.overall);
    const L = p.roles?.landlord,
      F = p.roles?.farmer;
    if (L && F) return { mu: (L.mu + F.mu) / 2, sigma: (L.sigma + F.sigma) / 2 };
    if (L) return ensureRating(L);
    if (F) return ensureRating(F);
    return null;
  };
  const applyTsFromStore = (why: string) => {
    const ids = [0, 1, 2].map(seatIdentity);
    const init = ids.map((id) => resolveRatingForIdentity(id) || { ...TS_DEFAULT });
    setTsArr(init);
    setLog((l) => [
      ...l,
      `【TS】已从存档应用（${why}）：` +
        init.map((r, i) => `${['甲', '乙', '丙'][i]} μ=${r.mu.toFixed(2)} σ=${r.sigma.toFixed(2)}`).join(' | '),
    ]);
  };
  const applyTsFromStoreByRole = (lord: number | null, why: string) => {
    const ids = [0, 1, 2].map(seatIdentity);
    const init = [0, 1, 2].map((i) => {
      const role: TsRole | undefined = lord == null ? undefined : i === lord ? 'landlord' : 'farmer';
      return resolveRatingForIdentity(ids[i], role) || { ...TS_DEFAULT };
    });
    setTsArr(init);
    setLog((l) => [...l, `【TS】按角色应用（${why}，地主=${lord ?? '未知'}）`]);
  };
  const updateTsStoreAfterRound = (updated: Rating[], landlordIndex: number) => {
    const ids = [0, 1, 2].map(seatIdentity);
    for (let i = 0; i < 3; i++) {
      const id = ids[i];
      const entry: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles: {} };
      entry.overall = { ...updated[i] };
      const role: TsRole = i === landlordIndex ? 'landlord' : 'farmer';
      entry.roles = entry.roles || {};
      entry.roles[role] = { ...updated[i] };
      const choice = props.seats[i];
      const model = (props.seatModels[i] || '').trim();
      const base = choice === 'http' ? props.seatKeys[i]?.httpBase || '' : '';
      entry.meta = { choice, ...(model ? { model } : {}), ...(base ? { httpBase: base } : {}) };
      tsStoreRef.current.players[id] = entry;
    }
    writeTsStore(tsStoreRef.current);
  };
  const handleTsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: TsStore = emptyTsStore();
      if (Array.isArray(j?.players)) {
        for (const p of j.players) {
          const id = p.id || p.identity || p.key;
          if (!id) continue;
          store.players[id] = {
            id,
            overall: p.overall || p.rating || null,
            roles: {
              landlord: p.roles?.landlord ?? p.landlord ?? p.L ?? null,
              farmer: p.roles?.farmer ?? p.farmer ?? p.F ?? null,
            },
            meta: p.meta || {},
          };
        }
      } else if (j?.players && typeof j.players === 'object') store.players = j.players;
      else if (Array.isArray(j)) {
        for (const p of j) {
          const id = p.id || p.identity;
          if (!id) continue;
          store.players[id] = p;
        }
      } else if (j?.id) store.players[j.id] = j;

      tsStoreRef.current = store;
      writeTsStore(store);
      setLog((l) => [...l, `【TS】已上传存档（${Object.keys(store.players).length}）`]);
    } catch (err: any) {
      setLog((l) => [...l, `【TS】上传解析失败：${err?.message || err}`]);
    } finally {
      e.target.value = '';
    }
  };
  const handleTsSave = () => {
    const ids = [0, 1, 2].map(seatIdentity);
    ids.forEach((id, i) => {
      const e: TsStoreEntry = tsStoreRef.current.players[id] || { id, roles: {} };
      e.overall = { ...tsRef.current[i] };
      tsStoreRef.current.players[id] = e;
    });
    writeTsStore(tsStoreRef.current);
    const blob = new Blob([JSON.stringify(tsStoreRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trueskill_store.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    setLog((l) => [...l, '【TS】已导出当前存档。']);
  };
  const handleTsRefresh = () => {
    applyTsFromStoreByRole(landlordRef.current, '手动刷新');
  };

  /* ---------- PR：应用/上传/保存 ---------- */
  const applyPrFromStore = (why: string) => {
    const ids = [0, 1, 2].map(seatIdentity);
    const pr = ids.map((id) => {
      const p = prStoreRef.current.players[id];
      const v = Number(p?.pr);
      return Number.isFinite(v) ? v : 1 / 3;
    });
    const sum = pr.reduce((a, b) => a + b, 0) || 1;
    const norm = pr.map((v) => v / sum);

    const abs = ids.map((id) => {
      const p = prStoreRef.current.players[id];
      const v = Number(p?.abs);
      return Number.isFinite(v) ? v : 0;
    });
    const reward = ids.map((id) => {
      const p = prStoreRef.current.players[id];
      const v = Number(p?.reward);
      return Number.isFinite(v) ? v : 0;
    });

    setPrState((ps) => ({ ...ps, pr: norm, abs, reward }));
    setLog((l) => [
      ...l,
      `【PR】已从存档应用（${why}）：相对=${norm
        .map((v) => (v * 100).toFixed(2) + '%')
        .join(' | ')}；绝对=${abs.map((v) => v.toFixed(2)).join(' | ')}`,
    ]);
  };
  const handlePrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const j = JSON.parse(text);
      const store: PrStore = emptyPrStore();
      if (j?.players && typeof j.players === 'object') store.players = j.players;
      else if (Array.isArray(j))
        for (const p of j) {
          const id = p.id || p.identity;
          if (!id) continue;
          store.players[id] = { id, pr: Number(p.pr), abs: Number(p.abs), reward: Number(p.reward) };
        }
      store.schema = 'ddz-pagerank@2';
      prStoreRef.current = store;
      writePrStore(store);
      setLog((l) => [...l, `【PR】已上传存档（${Object.keys(store.players).length}）`]);
      applyPrFromStore('上传后');
    } catch (err: any) {
      setLog((l) => [...l, `【PR】上传解析失败：${err?.message || err}`]);
    } finally {
      e.target.value = '';
    }
  };
  const handlePrSave = () => {
    const ids = [0, 1, 2].map(seatIdentity);
    ids.forEach((id, i) => {
      prStoreRef.current.players[id] = {
        id,
        pr: prRef.current.pr[i],
        abs: prRef.current.abs[i],
        reward: prRef.current.reward[i],
      };
    });
    prStoreRef.current.schema = 'ddz-pagerank@2';
    writePrStore(prStoreRef.current);
    const blob = new Blob([JSON.stringify(prStoreRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pagerank_store.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    setLog((l) => [...l, '【PR】已导出当前存档（含相对/绝对/奖励）。']);
  };
  const handlePrRefresh = () => {
    applyPrFromStore('手动刷新');
  };

  // 累计画像
  const [aggMode, setAggMode] = useState<'mean' | 'ewma'>('ewma');
  const [alpha, setAlpha] = useState<number>(0.35);
  const [aggStats, setAggStats] = useState<Score5[] | null>(null);
  const [aggCount, setAggCount] = useState<number>(0);

  useEffect(() => {
    props.onTotals?.(totals);
  }, [totals]);
  useEffect(() => {
    props.onLog?.(log);
  }, [log]);

  const controllerRef = useRef<AbortController | null>(null);
  const handsRef = useRef(hands);
  useEffect(() => {
    handsRef.current = hands;
  }, [hands]);
  const playsRef = useRef(plays);
  useEffect(() => {
    playsRef.current = plays;
  }, [plays]);
  const totalsRef = useRef(totals);
  useEffect(() => {
    totalsRef.current = totals;
  }, [totals]);
  const finishedRef = useRef(finishedCount);
  useEffect(() => {
    finishedRef.current = finishedCount;
  }, [finishedCount]);
  const logRef = useRef(log);
  useEffect(() => {
    logRef.current = log;
  }, [log]);
  const landlordRef = useRef(landlord);
  useEffect(() => {
    landlordRef.current = landlord;
  }, [landlord]);
  const winnerRef = useRef(winner);
  useEffect(() => {
    winnerRef.current = winner;
  }, [winner]);
  const deltaRef = useRef(delta);
  useEffect(() => {
    deltaRef.current = delta;
  }, [delta]);
  const multiplierRef = useRef(multiplier);
  useEffect(() => {
    multiplierRef.current = multiplier;
  }, [multiplier]);

  const aggStatsRef = useRef(aggStats);
  useEffect(() => {
    aggStatsRef.current = aggStats;
  }, [aggStats]);
  const aggCountRef = useRef(aggCount);
  useEffect(() => {
    aggCountRef.current = aggCount;
  }, [aggCount]);
  const aggModeRef = useRef(aggMode);
  useEffect(() => {
    aggModeRef.current = aggMode;
  }, [aggMode]);
  const alphaRef = useRef(alpha);
  useEffect(() => {
    alphaRef.current = alpha;
  }, [alpha]);

  const lastReasonRef = useRef<(string | null)[]>([null, null, null]);

  const roundFinishedRef = useRef(false);
  const seenStatsRef = useRef(false);

  // 工具函数
  const fmt2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
  const tsMuSigStr = (r: Rating | null | undefined) => (r ? `μ ${fmt2(r.mu)}｜σ ${fmt2(r.sigma)}` : '—');
  const getStoredForSeat = (i: number) => {
    const id = seatIdentity(i);
    const p = tsStoreRef.current.players[id];
    return {
      overall: p?.overall ? ensureRating(p.overall) : null,
      landlord: p?.roles?.landlord ? ensureRating(p.roles.landlord) : null,
      farmer: p?.roles?.farmer ? ensureRating(p.roles.farmer) : null,
    };
  };

  // 兜底：如果这一局没有被标记完成，在流结束/异常时补一次
  const finalizeRoundIfMissing = () => {
    if (roundFinishedRef.current) return;

    // 雷达图：若本局未收到 stats，则补一个“中性样本”，并按汇总策略累计
    setAggStats((prev) => {
      const neutral: Score5 = { coop: 2.5, agg: 2.5, cons: 2.5, eff: 2.5, rob: 2.5 };
      if (!prev) return [neutral, neutral, neutral];
      const mode = aggModeRef.current,
        a = alphaRef.current;
      const cnt = aggCountRef.current;
      return prev.map((p) => mergeScore(p, neutral, mode, cnt, a));
    });
    setAggCount((c) => c + 1);

    // 只把“已完成局数”加一次
    setFinishedCount((c) => c + 1);
    roundFinishedRef.current = true;
  };

  const start = async () => {
    if (running) return;
    if (!props.enabled) {
      setLog((l) => [...l, '【前端】未启用对局：请在设置中勾选“启用对局”。']);
      return;
    }

    setRunning(true);
    setLandlord(null);
    setHands([[], [], []]);
    setPlays([]);
    setWinner(null);
    setDelta(null);
    setMultiplier(1);
    setLog([]);
    setFinishedCount(0);
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null);
    setAggCount(0);

    // TS：开赛先按 overall 应用
    setTsArr([{ ...TS_DEFAULT }, { ...TS_DEFAULT }, { ...TS_DEFAULT }]);
    try {
      applyTsFromStore('比赛开始前');
    } catch {}
    // PR：清零
    setPrState(prZero());

    controllerRef.current = new AbortController();

    const buildSeatSpecs = (): any[] => {
      return props.seats.slice(0, 3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai':
            return { choice, model, apiKey: keys.openai || '' };
          case 'ai:gemini':
            return { choice, model, apiKey: keys.gemini || '' };
          case 'ai:grok':
            return { choice, model, apiKey: keys.grok || '' };
          case 'ai:kimi':
            return { choice, model, apiKey: keys.kimi || '' };
          case 'ai:qwen':
            return { choice, model, apiKey: keys.qwen || '' };
          case 'ai:deepseek':
            return { choice, model, apiKey: keys.deepseek || '' };
          case 'http':
            return { choice, model, baseUrl: keys.httpBase || '', token: keys.httpToken || '' };
          default:
            return { choice };
        }
      });
    };

    const seatSummaryText = (specs: any[]) =>
      specs
        .map((s, i) => {
          const nm = seatName(i);
          if (s.choice.startsWith('built-in')) return `${nm}=${choiceLabel(s.choice as BotChoice)}`;
          if (s.choice === 'http') return `${nm}=HTTP(${s.baseUrl ? 'custom' : 'default'})`;
          return `${nm}=${choiceLabel(s.choice as BotChoice)}(${s.model || defaultModelFor(s.choice as BotChoice)})`;
        })
        .join(', ');

    const rewrite = (n: number) => makeRewriteRoundLabel(n);

    const markRoundFinishedIfNeeded = (nextFinished: number, nextAggStats: Score5[] | null, nextAggCount: number) => {
      if (!roundFinishedRef.current) {
        if (!seenStatsRef.current) {
          const neutral: Score5 = { coop: 2.5, agg: 2.5, cons: 2.5, eff: 2.5, rob: 2.5 };
          const mode = aggModeRef.current,
            a = alphaRef.current;
          if (!nextAggStats) {
            nextAggStats = [neutral, neutral, neutral];
            nextAggCount = 1;
          } else {
            nextAggStats = nextAggStats.map((prev) => mergeScore(prev, neutral, mode, nextAggCount, a));
            nextAggCount = nextAggCount + 1;
          }
        }
        roundFinishedRef.current = true;
        nextFinished = nextFinished + 1;
      }
      return { nextFinished, nextAggStats, nextAggCount };
    };

    const playOneGame = async (_gameIndex: number, labelRoundNo: number) => {
      setLog([]);
      lastReasonRef.current = [null, null, null];
      const specs = buildSeatSpecs();
      const traceId = Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      setLog((l) => [...l, `【前端】开始第 ${labelRoundNo} 局 | 座位: ${seatSummaryText(specs)} | coop=${props.farmerCoop ? 'on' : 'off'} | trace=${traceId}`]);

      roundFinishedRef.current = false;
      seenStatsRef.current = false;

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rounds: 1,
          startScore: props.startScore,
          seatDelayMs: props.seatDelayMs,
          enabled: props.enabled,
          rob: props.rob,
          four2: props.four2,
          seats: specs,
          clientTraceId: traceId,
          stopBelowZero: true,
          farmerCoop: props.farmerCoop,
        }),
        signal: controllerRef.current!.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      const rewriteLine = rewrite(labelRoundNo);

      try {
        while (true) {
          const { value, done } = await reader.read();

          buf += decoder.decode(value || new Uint8Array(), { stream: !done });

          // 解析完整行
          let idx: number;
          const batch: any[] = [];
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            try {
              batch.push(JSON.parse(line));
            } catch {}
          }

          // 流结束时冲刷尾块
          if (done) {
            const tail = buf.trim();
            if (tail) {
              try {
                batch.push(JSON.parse(tail));
              } catch {}
            }
            buf = '';
          }

          if (batch.length) {
            let nextHands = handsRef.current.map((x) => [...x]);
            let nextPlays = [...playsRef.current];
            let nextTotals = [...totalsRef.current] as [number, number, number];
            let nextFinished = finishedRef.current;
            let nextLog = [...logRef.current];
            let nextLandlord = landlordRef.current;
            let nextWinner = winnerRef.current as number | null;
            let nextDelta = deltaRef.current as [number, number, number] | null;
            let nextMultiplier = multiplierRef.current;
            let nextAggStats = aggStatsRef.current;
            let nextAggCount = aggCountRef.current;

            for (const raw of batch) {
              const m: any = raw;
              try {
                // TS 注入
                if (m.type === 'ts' && Array.isArray(m.ratings) && m.ratings.length === 3) {
                  const incoming: Rating[] = m.ratings.map((r: any) => ({ mu: Number(r.mu) || 25, sigma: Number(r.sigma) || 25 / 3 }));
                  setTsArr(incoming);
                  if (m.where === 'after-round') {
                    const res = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                    nextFinished = res.nextFinished;
                    nextAggStats = res.nextAggStats;
                    nextAggCount = res.nextAggCount;
                    nextLog = [...nextLog, `【TS】after-round 已更新 μ/σ`];
                  } else if (m.where === 'before-round') nextLog = [...nextLog, `【TS】before-round μ/σ 准备就绪`];
                  continue;
                }
                // 事件边界
                if (m.type === 'event' && m.kind === 'round-start') {
                  nextLog = [...nextLog, `【边界】round-start #${m.round}`];
                  continue;
                }
                if (m.type === 'event' && m.kind === 'round-end') {
                  nextLog = [...nextLog, `【边界】round-end #${m.round}`];
                  const r2 = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = r2.nextFinished;
                  nextAggStats = r2.nextAggStats;
                  nextAggCount = r2.nextAggCount;
                  continue;
                }

                // 发牌
                const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);
                if (hasHands) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  nextMultiplier = 1;

                  const decorated: string[][] = (rh as string[][]).map(decorateHandCycle);
                  nextHands = decorated;

                  const lord = m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
                  nextLandlord = lord;
                  nextLog = [...nextLog, `发牌完成，${lord != null ? seatName(lord) : '?'}为地主`];

                  try {
                    applyTsFromStoreByRole(lord, '发牌后');
                  } catch {}
                  lastReasonRef.current = [null, null, null];
                  continue;
                }

                // 机器人事件
                if (m.type === 'event' && m.kind === 'bot-call') {
                  nextLog = [
                    ...nextLog,
                    `AI调用｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜阶段=${m.phase || 'play'}${m.need ? `｜需求=${m.need}` : ''}`,
                  ];
                  continue;
                }
                if (m.type === 'event' && m.kind === 'bot-done') {
                  nextLog = [
                    ...nextLog,
                    `AI完成｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜耗时=${m.tookMs}ms`,
                    ...(m.reason ? [`AI理由｜${seatName(m.seat)}：${m.reason}`] : []),
                  ];
                  lastReasonRef.current[m.seat] = m.reason || null;
                  continue;
                }
                if (m.type === 'event' && m.kind === 'rob') {
                  nextLog = [...nextLog, `${seatName(m.seat)} ${m.rob ? '抢地主' : '不抢'}`];
                  continue;
                }
                if (m.type === 'event' && m.kind === 'trick-reset') {
                  nextLog = [...nextLog, '一轮结束，重新起牌'];
                  nextPlays = [];
                  continue;
                }

                // 出牌
                if (m.type === 'event' && m.kind === 'play') {
                  if (m.move === 'pass') {
                    const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                    lastReasonRef.current[m.seat] = null;
                    nextPlays = [...nextPlays, { seat: m.seat, move: 'pass', reason }];
                    nextLog = [...nextLog, `${seatName(m.seat)} 过${reason ? `（${reason}）` : ''}`];
                  } else {
                    const pretty: string[] = [];
                    const seat = m.seat as number;
                    const cards: string[] = m.cards || [];
                    const nh = (nextHands && (nextHands as any[]).length === 3 ? nextHands : [[], [], []]).map((x: any) => [...x]);
                    for (const rawCard of cards) {
                      const options = candDecorations(rawCard);
                      const chosen = options.find((d: string) => nh[seat].includes(d)) || options[0];
                      const k = nh[seat].indexOf(chosen);
                      if (k >= 0) nh[seat].splice(k, 1);
                      pretty.push(chosen);
                    }
                    const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                    lastReasonRef.current[m.seat] = null;

                    nextHands = nh;
                    nextPlays = [...nextPlays, { seat: m.seat, move: 'play', cards: pretty, reason }];
                    nextLog = [...nextLog, `${seatName(m.seat)} 出牌：${pretty.join(' ')}${reason ? `（理由：${reason}）` : ''}`];
                  }
                  continue;
                }

                // 胜负
                const isWinLike =
                  (m.type === 'event' &&
                    (m.kind === 'win' || m.kind === 'result' || m.kind === 'game-over' || m.kind === 'game_end')) ||
                  m.type === 'result' ||
                  m.type === 'game-over' ||
                  m.type === 'game_end';
                if (isWinLike) {
                  const L = (nextLandlord ?? 0) as number;
                  const ds = (Array.isArray(m.deltaScores) ? m.deltaScores : Array.isArray(m.delta) ? m.delta : [0, 0, 0]) as [number, number, number];

                  const rot: [number, number, number] = [ds[(0 - L + 3) % 3], ds[(1 - L + 3) % 3], ds[(2 - L + 3) % 3]];
                  let nextWinnerLocal = m.winner ?? nextWinner ?? null;
                  nextMultiplier = m.multiplier ?? nextMultiplier ?? 1;
                  nextDelta = rot;
                  nextTotals = [nextTotals[0] + rot[0], nextTotals[1] + rot[1], nextTotals[2] + rot[2]] as any;

                  if (nextWinnerLocal == null) {
                    const landlordDelta = ds[0] ?? 0;
                    if (landlordDelta > 0) nextWinnerLocal = L;
                    else if (landlordDelta < 0) nextWinnerLocal = [0, 1, 2].find((x) => x !== L)!;
                  }
                  nextWinner = nextWinnerLocal;

                  // ✅ 显示层修正：无论末帧 play 是否丢失，赢家手牌在 UI 中清空
                  if (nextWinner != null) {
                    nextHands = nextHands.map((h, idx) => (idx === nextWinner ? [] : h));
                  }

                  // —— TS 更新 & 存档 —— //
                  {
                    const updated = tsRef.current.map((r) => ({ ...r }));
                    const farmers = [0, 1, 2].filter((s) => s !== L);
                    const landlordWin = nextWinner === L || (ds[0] ?? 0) > 0;
                    if (landlordWin) tsUpdateTwoTeams(updated, [L], farmers);
                    else tsUpdateTwoTeams(updated, farmers, [L]);
                    setTsArr(updated);
                    updateTsStoreAfterRound(updated, L);
                    nextLog = [
                      ...nextLog,
                      `TS(局后)：甲 μ=${fmt2(updated[0].mu)} σ=${fmt2(updated[0].sigma)}｜乙 μ=${fmt2(updated[1].mu)} σ=${fmt2(
                        updated[1].sigma,
                      )}｜丙 μ=${fmt2(updated[2].mu)} σ=${fmt2(updated[2].sigma)}`,
                    ];
                  }

                  // —— PR：期望校正 + 时间衰减（相对 + 绝对） —— //
                  {
                    const W = prRef.current.W.map((row) => row.map((v) => v * PR_DECAY));
                    const reward = prRef.current.reward.map((x) => x * PR_DECAY);

                    const relBefore = prRef.current.pr;
                    const mlt = Math.max(1, Number(nextMultiplier) || 1);
                    const Lwin = nextWinner === L;
                    const winners = Lwin ? [L] : [0, 1, 2].filter((x) => x !== L);
                    const losers = Lwin ? [0, 1, 2].filter((x) => x !== L) : [L];

                    for (const wi of winners)
                      for (const lj of losers) {
                        const p = expectedWin(relBefore, wi, lj);
                        const gainWin = mlt * (1 - p);
                        const lossLos = mlt * p;

                        reward[wi] += gainWin;
                        reward[lj] -= lossLos;

                        W[wi][lj] += mlt;
                      }

                    const prRel = computePRRelative(W, PR_ALPHA, PR_ITERS);
                    const abs = computePRAbsolute(W, reward, PR_ALPHA, PR_ITERS, prRef.current.abs);

                    const cur = { W, pr: prRel, abs, reward, rounds: prRef.current.rounds + 1 };
                    setPrState(cur);

                    nextLog = [
                      ...nextLog,
                      `PR(相对)：${['甲', '乙', '丙']
                        .map((n, i) => `${n}=${(prRel[i] * 100).toFixed(2)}`)
                        .join('% / ')}%`,
                      `PR(绝对·校正)：${['甲', '乙', '丙']
                        .map((n, i) => `${n}=${Math.max(0, abs[i]).toFixed(2)}`)
                        .join(' / ')}`,
                    ];
                  }

                  const r2 = markRoundFinishedIfNeeded(nextFinished, nextAggStats, nextAggCount);
                  nextFinished = r2.nextFinished;
                  nextAggStats = r2.nextAggStats;
                  nextAggCount = r2.nextAggCount;

                  nextLog = [
                    ...nextLog,
                    `胜者：${nextWinner == null ? '—' : seatName(nextWinner)}，倍数 x${nextMultiplier}，当局积分（按座位） ${rot.join(
                      ' / ',
                    )}｜原始（相对地主） ${ds.join(' / ')}｜地主=${seatName(L)}`,
                  ];
                  continue;
                }

                // 战术画像
                const isStatsTop = m.type === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats));
                const isStatsEvt = m.type === 'event' && m.kind === 'stats' && (Array.isArray(m.perSeat) || Array.isArray(m.seats));
                if (isStatsTop || isStatsEvt) {
                  seenStatsRef.current = true;
                  const arr = (m.perSeat ?? m.seats) as any[];
                  const s3 = [0, 1, 2].map((i) => {
                    const rec = arr.find((x: any) => x.seat === i || x.index === i);
                    const sc = rec?.scaled || rec?.score || {};
                    return {
                      coop: Number(sc.coop ?? 2.5),
                      agg: Number(sc.agg ?? 2.5),
                      cons: Number(sc.cons ?? 2.5),
                      eff: Number(sc.eff ?? 2.5),
                      rob: Number(sc.rob ?? 2.5),
                    };
                  }) as Score5[];

                  const mode = aggModeRef.current,
                    a = alphaRef.current;
                  if (!nextAggStats) {
                    nextAggStats = s3.map((x) => ({ ...x }));
                    nextAggCount = 1;
                  } else {
                    nextAggStats = nextAggStats.map((prev, idx) => mergeScore(prev, s3[idx], mode, nextAggCount, a));
                    nextAggCount = nextAggCount + 1;
                  }

                  const msg = s3
                    .map((v, i) => `【${seatName(i)}】Coop ${v.coop}｜Agg ${v.agg}｜Cons ${v.cons}｜Eff ${v.eff}｜Rob ${v.rob}`)
                    .join(' ｜ ');
                  nextLog = [...nextLog, `战术画像（本局）：${msg}（已累计 ${nextAggCount} 局）`];
                  continue;
                }

                // 文本日志
                if (m.type === 'log' && typeof m.message === 'string') {
                  nextLog = [...nextLog, rewriteLine(m.message)];
                  continue;
                }
              } catch (e) {
                console.error('[ingest:batch]', e, raw);
              }
            }

            setHands(nextHands);
            setPlays(nextPlays);
            setTotals(nextTotals);
            setFinishedCount(nextFinished);
            setLog(nextLog);
            setLandlord(nextLandlord);
            setWinner(nextWinner);
            setMultiplier(nextMultiplier);
            setDelta(nextDelta);
            setAggStats(nextAggStats || null);
            setAggCount(nextAggCount || 0);
          }

          if (done) break;
        }
      } finally {
        // ✅ 兜底：仅在有进展时才补一次
        const hadProgress = playsRef.current.length > 0 || winnerRef.current != null;
        if (hadProgress) finalizeRoundIfMissing();
      }

      setLog((l) => [...l, `—— 本局流结束 ——`]);
    };

    try {
      for (let i = 0; i < props.rounds; i++) {
        if (controllerRef.current?.signal.aborted) break;
        const thisRound = i + 1;
        await playOneGame(i, thisRound);
        const hasNegative = Array.isArray(totalsRef.current) && totalsRef.current.some((v) => (v as number) < 0);
        if (hasNegative) {
          setLog((l) => [...l, '【前端】检测到总分 < 0，停止连打。']);
          break;
        }
        await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 600)));
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') setLog((l) => [...l, '已手动停止。']);
      else setLog((l) => [...l, `错误：${e?.message || e}`]);
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);
  const prRankIndex = (i: number) => {
    const order = [0, 1, 2].sort((a, b) => prState.pr[b] - prState.pr[a]);
    return order.indexOf(i) + 1;
  };

  /* ===================== 渲染 ===================== */
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, background: '#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* —— 改名为：排名 —— */}
      <Section title="排名">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontSize: 12 }}>
            显示：
            <label style={{ marginLeft: 6 }}>
              <input type="checkbox" checked={showTS} onChange={(e) => setShowTS(e.target.checked)} /> TrueSkill
            </label>
            <label style={{ marginLeft: 10 }}>
              <input type="checkbox" checked={showPR} onChange={(e) => setShowPR(e.target.checked)} /> PageRank
            </label>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>TS 区分地主/农民；PR 为整体分数（相对% 与 绝对·校正）。</div>
        </div>

        {/* —— TrueSkill 框 —— */}
        {showTS && (
          <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ fontWeight: 800, color: '#1d4ed8' }}>TrueSkill</div>
              <input ref={tsFileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handleTsUpload} />
              <button onClick={() => tsFileRef.current?.click()} style={{ padding: '4px 10px', border: '1px solid #93c5fd', borderRadius: 8, background: '#fff' }}>
                上传
              </button>
              <button onClick={handleTsSave} style={{ padding: '4px 10px', border: '1px solid #93c5fd', borderRadius: 8, background: '#fff' }}>
                存档
              </button>
              <button onClick={handleTsRefresh} style={{ padding: '4px 10px', border: '1px solid #93c5fd', borderRadius: 8, background: '#fff' }}>
                刷新
              </button>
              <div style={{ fontSize: 12, color: '#2563eb' }}>按“内置/AI+模型/版本(+HTTP Base)”识别，区分地主/农民。</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[0, 1, 2].map((i) => {
                const stored = getStoredForSeat(i);
                const usingRole: 'overall' | 'landlord' | 'farmer' = landlord == null ? 'overall' : landlord === i ? 'landlord' : 'farmer';
                return (
                  <div key={i} style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 10, background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div>
                        <SeatTitle i={i} /> {landlord === i && <span style={{ marginLeft: 6, color: '#bf7f00' }}>（地主）</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#374151' }}>
                      <div>
                        μ：<b>{fmt2(tsArr[i].mu)}</b>
                      </div>
                      <div>
                        σ：<b>{fmt2(tsArr[i].sigma)}</b>
                      </div>
                      <div>
                        CR = μ − 3σ：<b>{fmt2(tsCr(tsArr[i]))}</b>
                      </div>
                    </div>
                    <div style={{ borderTop: '1px dashed #e5e7eb', marginTop: 8, paddingTop: 8 }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>
                        当前使用：<b>{usingRole === 'overall' ? '总体档' : usingRole === 'landlord' ? '地主档' : '农民档'}</b>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12, color: '#374151' }}>
                        <div>
                          <div style={{ fontWeight: 600, opacity: 0.8 }}>总体</div>
                          <div>{tsMuSigStr(stored.overall)}</div>
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, opacity: 0.8 }}>地主</div>
                          <div>{tsMuSigStr(stored.landlord)}</div>
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, opacity: 0.8 }}>农民</div>
                          <div>{tsMuSigStr(stored.farmer)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* —— PageRank 框 —— */}
        {showPR && (
          <div style={{ border: '1px solid #bbf7d0', background: '#ecfdf5', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ fontWeight: 800, color: '#059669' }}>PageRank</div>
              <input ref={prFileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handlePrUpload} />
              <button onClick={() => prFileRef.current?.click()} style={{ padding: '4px 10px', border: '1px solid #86efac', borderRadius: 8, background: '#fff' }}>
                上传
              </button>
              <button onClick={handlePrSave} style={{ padding: '4px 10px', border: '1px solid #86efac', borderRadius: 8, background: '#fff' }}>
                存档
              </button>
              <button onClick={handlePrRefresh} style={{ padding: '4px 10px', border: '1px solid #86efac', borderRadius: 8, background: '#fff' }}>
                刷新
              </button>
              <div style={{ fontSize: 12, color: '#047857' }}>PR 为整体分数。相对%用于排序，绝对·校正用于体现长期进步。</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ border: '1px solid #dcfce7', borderRadius: 8, padding: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <SeatTitle i={i} /> {landlord === i && <span style={{ marginLeft: 6, color: '#bf7f00' }}>（地主）</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: '#064e3b' }}>
                    <div>
                      PR（相对）：<b>{(prState.pr[i] * 100).toFixed(2)}%</b>
                    </div>
                    <div>
                      排名：<b>#{prRankIndex(i)}</b>
                    </div>
                    <div>
                      绝对（校正）：<b>{Math.max(0, prState.abs[i]).toFixed(2)}</b>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="积分（总分）">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
              <div>
                <SeatTitle i={i} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{totals[i]}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="战术画像（累计，0~5）">
        <RadarPanel aggStats={aggStats} aggCount={aggCount} aggMode={aggMode} alpha={alpha} onChangeMode={setAggMode} onChangeAlpha={setAlpha} />
      </Section>

      <Section title="手牌">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
              <div style={{ marginBottom: 6 }}>
                <SeatTitle i={i} /> {landlord === i && <span style={{ marginLeft: 6, color: '#bf7f00' }}>（地主）</span>}
              </div>
              <Hand cards={hands[i]} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="出牌">
        <div style={{ border: '1px dashed #eee', borderRadius: 8, padding: '6px 8px' }}>
          {plays.length === 0 ? <div style={{ opacity: 0.6 }}>（尚无出牌）</div> : plays.map((p, idx) => <PlayRow key={idx} seat={p.seat} move={p.move} cards={p.cards} reason={p.reason} />)}
        </div>
      </Section>

      <Section title="结果">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
            <div>倍数</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{multiplier}</div>
          </div>
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
            <div>胜者</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{winner == null ? '—' : seatName(winner)}</div>
          </div>
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
            <div>本局加减分</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{delta ? delta.join(' / ') : '—'}</div>
          </div>
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={start} style={{ padding: '8px 12px', borderRadius: 8, background: '#222', color: '#fff' }}>
          开始
        </button>
        <button onClick={stop} style={{ padding: '8px 12px', borderRadius: 8 }}>停止</button>
      </div>

      <div style={{ marginTop: 18 }}>
        <Section title="运行日志">
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: '8px 10px', maxHeight: 420, overflow: 'auto', background: '#fafafa' }}>
            {log.length === 0 ? <div style={{ opacity: 0.6 }}>（暂无）</div> : log.map((t, idx) => <LogLine key={idx} text={t} />)}
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ===================== 雷达图控制面板 ===================== */
function RadarPanel({
  aggStats,
  aggCount,
  aggMode,
  alpha,
  onChangeMode,
  onChangeAlpha,
}: {
  aggStats: Score5[] | null;
  aggCount: number;
  aggMode: 'mean' | 'ewma';
  alpha: number;
  onChangeMode: (m: 'mean' | 'ewma') => void;
  onChangeAlpha: (a: number) => void;
}) {
  const [mode, setMode] = useState<'mean' | 'ewma'>(aggMode);
  const [a, setA] = useState<number>(alpha);
  useEffect(() => {
    setMode(aggMode);
  }, [aggMode]);
  useEffect(() => {
    setA(alpha);
  }, [alpha]);

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
        <label>
          汇总方式
          <select
            value={mode}
            onChange={(e) => {
              const v = e.target.value as 'mean' | 'ewma';
              setMode(v);
              onChangeMode(v);
            }}
            style={{ marginLeft: 6 }}
          >
            <option value="ewma">指数加权（推荐）</option>
            <option value="mean">简单平均</option>
          </select>
        </label>
        {mode === 'ewma' && (
          <label>
            α（0.05–0.95）
            <input
              type="number"
              min={0.05}
              max={0.95}
              step={0.05}
              value={a}
              onChange={(e) => {
                const v = Math.min(0.95, Math.max(0.05, Number(e.target.value) || 0.35));
                setA(v);
                onChangeAlpha(v);
              }}
              style={{ width: 80, marginLeft: 6 }}
            />
          </label>
        )}
        <div style={{ fontSize: 12, color: '#6b7280' }}>{mode === 'ewma' ? '越大越看重最近几局' : `已累计 ${aggCount} 局`}</div>
      </div>

      {aggStats ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <RadarChart key={i} title={`${['甲', '乙', '丙'][i]}（累计）`} scores={aggStats[i]} />
          ))}
        </div>
      ) : (
        <div style={{ opacity: 0.6 }}>（等待至少一局完成后生成累计画像）</div>
      )}
    </>
  );
}

/* ===================== 页面：设置 + Live ===================== */
const DEFAULTS = {
  enabled: true,
  rounds: 10,
  startScore: 100,
  rob: true,
  four2: 'both' as Four2Policy,
  farmerCoop: true,
  seatDelayMs: [1000, 1000, 1000] as number[],
  seats: ['built-in:greedy-max', 'built-in:greedy-min', 'built-in:random-legal'] as BotChoice[],
  seatModels: ['', '', ''],
  seatKeys: [
    { openai: '', deepseek: '' },
    { gemini: '', httpBase: '', httpToken: '' },
    { kimi: '', qwen: '' },
  ] as any[],
};

function Home() {
  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [rob, setRob] = useState<boolean>(DEFAULTS.rob);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState<boolean>(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const setSeatDelay = (i: number, v: number | string) =>
    setSeatDelayMs((arr) => {
      const n = [...arr];
      n[i] = Math.max(0, Math.floor(Number(v) || 0));
      return n;
    });

  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState(DEFAULTS.seatKeys);

  const [liveLog, setLiveLog] = useState<string[]>([]);

  const doResetAll = () => {
    setEnabled(DEFAULTS.enabled);
    setRounds(DEFAULTS.rounds);
    setStartScore(DEFAULTS.startScore);
    setRob(DEFAULTS.rob);
    setFour2(DEFAULTS.four2);
    setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]);
    setSeats([...DEFAULTS.seats]);
    setSeatModels([...DEFAULTS.seatModels]);
    setSeatKeys(DEFAULTS.seatKeys.map((x: any) => ({ ...x })));
    setLiveLog([]);
    setResetKey((k) => k + 1);
  };

  const providerOptions: { value: BotChoice; label: string }[] = [
    { value: 'built-in:greedy-max', label: '内置 · Greedy Max' },
    { value: 'built-in:greedy-min', label: '内置 · Greedy Min' },
    { value: 'built-in:random-legal', label: '内置 · Random Legal' },
    { value: 'ai:openai', label: 'AI · OpenAI' },
    { value: 'ai:gemini', label: 'AI · Gemini' },
    { value: 'ai:grok', label: 'AI · Grok' },
    { value: 'ai:kimi', label: 'AI · Kimi' },
    { value: 'ai:qwen', label: 'AI · Qwen' },
    { value: 'ai:deepseek', label: 'AI · DeepSeek' },
    { value: 'http', label: 'HTTP · 自定义服务' },
  ];

  const renderSeatConfig = (i: number) => {
    const choice = seats[i];
    const model = seatModels[i] || '';
    const keys = seatKeys[i] || {};

    const updateChoice = (v: BotChoice) => {
      setSeats((arr) => {
        const n = [...arr];
        n[i] = v;
        return n;
      });
      // 如果换了提供方，清空模型名以免误用
      setSeatModels((arr) => {
        const n = [...arr];
        n[i] = '';
        return n;
      });
    };
    const updateModel = (v: string) =>
      setSeatModels((arr) => {
        const n = [...arr];
        n[i] = v;
        return n;
      });
    const updateKeys = (patch: any) =>
      setSeatKeys((arr: any[]) => {
        const n = arr.map((x) => ({ ...x }));
        n[i] = { ...(n[i] || {}), ...patch };
        return n;
      });

    const needModelInput = choice !== 'http' && !choice.startsWith('built-in');
    const needHttp = choice === 'http';
    const needOpenAI = choice === 'ai:openai';
    const needGemini = choice === 'ai:gemini';
    const needGrok = choice === 'ai:grok';
    const needKimi = choice === 'ai:kimi';
    const needQwen = choice === 'ai:qwen';
    const needDeepSeek = choice === 'ai:deepseek';

    return (
      <div key={i} style={{ border: '1px solid #eee', borderRadius: 10, padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <SeatTitle i={i} /> 座位
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>延时（ms）：</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 10 }}>
          <div>
            <label>
              算法/提供方
              <select
                value={choice}
                onChange={(e) => updateChoice(e.target.value as BotChoice)}
                style={{ width: '100%' }}
              >
                {providerOptions.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </label>

            {needModelInput && (
              <label style={{ display: 'block', marginTop: 8 }}>
                模型
                <input
                  value={model}
                  onChange={(e) => updateModel(e.target.value)}
                  placeholder={defaultModelFor(choice) || '模型名'}
                  style={{ width: '100%' }}
                />
              </label>
            )}

            {needOpenAI && (
              <label style={{ display: 'block', marginTop: 8 }}>
                OpenAI Key
                <input
                  value={keys.openai || ''}
                  onChange={(e) => updateKeys({ openai: e.target.value })}
                  style={{ width: '100%' }}
                />
              </label>
            )}
            {needGemini && (
              <label style={{ display: 'block', marginTop: 8 }}>
                Gemini Key
                <input
                  value={keys.gemini || ''}
                  onChange={(e) => updateKeys({ gemini: e.target.value })}
                  style={{ width: '100%' }}
                />
              </label>
            )}
            {needGrok && (
              <label style={{ display: 'block', marginTop: 8 }}>
                Grok Key
                <input
                  value={keys.grok || ''}
                  onChange={(e) => updateKeys({ grok: e.target.value })}
                  style={{ width: '100%' }}
                />
              </label>
            )}
            {needKimi && (
              <label style={{ display: 'block', marginTop: 8 }}>
                Kimi Key
                <input
                  value={keys.kimi || ''}
                  onChange={(e) => updateKeys({ kimi: e.target.value })}
                  style={{ width: '100%' }}
                />
              </label>
            )}
            {needQwen && (
              <label style={{ display: 'block', marginTop: 8 }}>
                Qwen Key
                <input
                  value={keys.qwen || ''}
                  onChange={(e) => updateKeys({ qwen: e.target.value })}
                  style={{ width: '100%' }}
                />
              </label>
            )}
            {needDeepSeek && (
              <label style={{ display: 'block', marginTop: 8 }}>
                DeepSeek Key
                <input
                  value={keys.deepseek || ''}
                  onChange={(e) => updateKeys({ deepseek: e.target.value })}
                  style={{ width: '100%' }}
                />
              </label>
            )}
            {needHttp && (
              <>
                <label style={{ display: 'block', marginTop: 8 }}>
                  HTTP Base URL
                  <input
                    value={keys.httpBase || ''}
                    onChange={(e) => updateKeys({ httpBase: e.target.value })}
                    placeholder="https://your-bot/act"
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', marginTop: 8 }}>
                  HTTP Token
                  <input
                    value={keys.httpToken || ''}
                    onChange={(e) => updateKeys({ httpToken: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </label>
              </>
            )}
          </div>

          <div>
            <input
              type="number"
              min={0}
              step={100}
              value={seatDelayMs[i]}
              onChange={(e) => setSeatDelay(i, e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>用于前后端一致的“思考时间”。</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1080, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, margin: '6px 0 16px' }}>斗地主 · Bot Arena</h1>

      {/* 对局设置 */}
      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>对局设置</div>

        {/* ✅ 仅调整了“可抢地主”和“初始分”的左右列顺序，其它不变 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                启用对局
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              </label>
              <button onClick={doResetAll} style={{ padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                清空
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              关闭后不可开始/继续对局；再次勾选即可恢复。
            </div>
          </div>

          <label>
            局数
            <input
              type="number"
              min={1}
              step={1}
              value={rounds}
              onChange={(e) => setRounds(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              style={{ width: '100%' }}
            />
          </label>

          {/* ⬅️ 放到左列：可抢地主 */}
          <label>
            可抢地主
            <div>
              <input type="checkbox" checked={rob} onChange={(e) => setRob(e.target.checked)} />
            </div>
          </label>

          {/* ➡️ 放到右列：初始分 */}
          <label>
            初始分
            <input
              type="number"
              step={10}
              value={startScore}
              onChange={(e) => setStartScore(Number(e.target.value) || 0)}
              style={{ width: '100%' }}
            />
          </label>

          <label>
            农民配合
            <div>
              <input type="checkbox" checked={farmerCoop} onChange={(e) => setFarmerCoop(e.target.checked)} />
            </div>
          </label>

          <label>
            4带2 规则
            <select value={four2} onChange={(e) => setFour2(e.target.value as Four2Policy)} style={{ width: '100%' }}>
              <option value="both">都可</option>
              <option value="2singles">两张单牌</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
        </div>
      </div>

      {/* ✅ 玩家（座位）设置 —— 恢复/增强：算法选择 + 模型/Key + HTTP + 间隔时间 */}
      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>玩家（座位）设置</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[0, 1, 2].map(renderSeatConfig)}
        </div>
      </div>

      <div style={{ border: '1px solid #eee', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>对局</div>
        <LivePanel
          key={resetKey}
          rounds={rounds}
          startScore={startScore}
          seatDelayMs={seatDelayMs}
          enabled={enabled}
          rob={rob}
          four2={four2}
          seats={seats}
          seatModels={seatModels}
          seatKeys={seatKeys}
          farmerCoop={farmerCoop}
          onLog={setLiveLog}
        />
      </div>
    </div>
  );
}

export default Home;
