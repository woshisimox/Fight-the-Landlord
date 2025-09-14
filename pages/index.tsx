// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react';

/* ================== 类型定义（方案 A / LiveProps） ================== */
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
  | 'http';

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
    httpBase?: string;
    httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals: [number, number, number]) => void;
  onLog?: (lines: string[]) => void;
};

/* ================== 小组件 & 工具 ================== */
function SeatTitle({ i }: { i: number }) {
  return <span style={{ fontWeight: 700 }}>{['甲', '乙', '丙'][i]}</span>;
}
const seatName = (i: number) => ['甲', '乙', '丙'][i] || String(i);

type SuitSym = '♠' | '♥' | '♦' | '♣' | '🃏';
const SUITS: SuitSym[] = ['♠', '♥', '♦', '♣'];

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
      <div style={{ flex: 1 }}>
        {move === 'pass' ? <span style={{ opacity: 0.6 }}>过</span> : <Hand cards={cards || []} />}
      </div>
      {reason && <div style={{ width: 260, fontSize: 12, color: '#666' }}>{reason}</div>}
    </div>
  );
}
function LogLine({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 12, color: '#555', padding: '2px 0' }}>
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

/* ================== 模型预设与校验 ================== */
function defaultModelFor(choice: BotChoice): string {
  switch (choice) {
    case 'ai:openai':
      return 'gpt-4o-mini';
    case 'ai:gemini':
      return 'gemini-1.5-flash';
    case 'ai:grok':
      return 'grok-2';
    case 'ai:kimi':
      return 'kimi-k2-0905-preview';
    case 'ai:qwen':
      return 'qwen-plus';
    default:
      return '';
  }
}
function normalizeModelForProvider(choice: BotChoice, input: string): string {
  const m = (input || '').trim();
  if (!m) return '';
  const low = m.toLowerCase();
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
    case 'http':
      return 'HTTP';
  }
}

/* ================== 雷达图（0~5 累计） ================== */
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
  const size = 180;
  const R = 70;
  const cx = size / 2;
  const cy = size / 2;
  const pts = vals
    .map((v, i) => {
      const ang = (-90 + (i * 360) / 5) * (Math.PI / 180);
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
            const ang = (-90 + (i * 360) / 5) * (Math.PI / 180);
            return `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`;
          }).join(' ');
          return <polygon key={k} points={polygon} fill="none" stroke="#e5e7eb" />;
        })}
        {Array.from({ length: 5 }, (_, i) => {
          const ang = (-90 + (i * 360) / 5) * (Math.PI / 180);
          return <line key={i} x1={cx} y1={cy} x2={cx + R * Math.cos(ang)} y2={cy + R * Math.sin(ang)} stroke="#e5e7eb" />;
        })}
        <polygon points={pts} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={2} />
        {['配合', '激进', '保守', '效率', '抢地主'].map((lab, i) => {
          const ang = (-90 + (i * 360) / 5) * (Math.PI / 180);
          return (
            <text
              key={i}
              x={cx + (R + 14) * Math.cos(ang)}
              y={cy + (R + 14) * Math.sin(ang)}
              fontSize="12"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#374151"
            >
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
