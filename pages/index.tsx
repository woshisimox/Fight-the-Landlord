// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react';

/** ---------- 花色渲染 ---------- **/
const SUIT_CHAR: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', RJ: '🃏', BJ: '🃏' };
const SUIT_COLOR: Record<string, string> = { S: '#222', C: '#222', H: '#c00', D: '#c00', RJ: '#c00', BJ: '#222' };
const labelText = (l: string) => (l === 'T' ? '10' : l);

function CardLine({ cards }: { cards: any[] }) {
  if (!cards || !cards.length) return <span style={{ opacity: 0.6 }}>过</span>;
  return (
    <span>
      {cards.map((c: any, idx: number) => (
        <span key={c.code || `${c.label}-${idx}`} style={{ marginRight: 6, color: SUIT_COLOR[c.suit] || '#222' }}>
          <span>{SUIT_CHAR[c.suit] || ''}</span>
          <span style={{ marginLeft: 2 }}>{labelText(c.label || '')}</span>
        </span>
      ))}
    </span>
  );
}

/** ---------- 类型 ---------- **/
type Board = {
  hands: string[][];
  last: string[];
  landlord: number | null;
  bottom: string[];
  handsRich: any[][];
  lastRich: any[][];
  bottomRich: any[];
  trick: Array<{ seat: number; pass?: boolean; cardsRich?: any[] }>;
};

type LiveProps = {
  rounds: number;
  seed: number;
  rob: boolean;
  four2: 'both' | '2singles' | '2pairs';
  delayMs: number;
  startScore: number;
  players: string;
  apiKeys?: {
    openai?: string;
    gemini?: string;
    kimi?: string;
    grok?: string;
    httpBase?: string;
    httpToken?: string;
  };
};

type Mode = 'auto' | 'post' | 'sse';

/** ---------- 实时面板 ---------- **/
const LivePanel: React.FC<LiveProps> = (props) => {
  const [lines, setLines] = useState<string[]>([]);
  const push = (t: string) => setLines((l) => [...l, t]);

  const [board, setBoard] = useState<Board>({
    hands: [[], [], []],
    last: ['', '', ''],
    landlord: null,
    bottom: [],
    handsRich: [[], [], []],
    lastRich: [[], [], []],
    bottomRich: [],
    trick: [],
  });

  const [totals, setTotals] = useState<[number, number, number]>([
    props.startScore || 0,
    props.startScore || 0,
    props.startScore || 0,
  ]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'streaming' | 'terminated'>('idle');

  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotFirstChunkRef = useRef(false);

  /** 连接设置（诊断用） */
  const [endpointOverride, setEndpointOverride] = useState<string>(''); // 例如 /api/stream_ndjson
  const [mode, setMode] = useState<Mode>('auto'); // auto / post / sse

  function clearWatchdog() {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current as any);
      watchdogRef.current = null;
    }
  }
  function armWatchdog() {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (!gotFirstChunkRef.current) {
        push('⚠️ 长时间未收到数据，请检查后端是否返回 NDJSON 或 SSE。');
      }
    }, 5000);
  }

  function handle(obj: any) {
    if (obj?.type === 'event') {
      if (obj.kind === 'turn') {
        const seat = ['甲', '乙', '丙'][obj.seat];
        const req = obj.require ? `需跟:${obj.require.type}>${obj.require.mainRank}` : '';
        push(`【回合】${seat} ${obj.lead ? '(领出)' : ''} ${req}`);
      } else if (obj.kind === 'deal') {
        // 为每张牌分配花色，后续渲染稳定
        const SUITS = ['S', 'H', 'D', 'C'];
        const nextIdx: Record<string, number> = {};
        const take = (label: string) => {
          if (label === 'X') return { label, suit: 'RJ', code: 'J-R' };
          if (label === 'x') return { label, suit: 'BJ', code: 'J-B' };
          const i = nextIdx[label] || 0;
          const suit = SUITS[i % 4];
          nextIdx[label] = i + 1;
          return { label, suit, code: `${label}-${suit}-${i + 1}` };
        };
        const handsRich = (obj.hands || []).map((arr: string[]) => arr.map(take));
        const bottomRich = (obj.bottom || []).map(take);
        setBoard((b) => ({
          ...b,
          hands: obj.hands,
          bottom: obj.bottom,
          handsRich,
          bottomRich,
          lastRich: [[], [], []],
          trick: [],
        }));
        push(`发牌：底牌 ${obj.bottom?.join('') ?? ''}`);
      } else if (obj.kind === 'landlord') {
        setBoard((b) => ({ ...b, landlord: obj.landlord }));
        push(`确定地主：${['甲', '乙', '丙'][obj.landlord]}，底牌 ${obj.bottom?.join('') ?? ''} 基础分 ${obj.baseScore ?? ''}`);
      } else if (obj.kind === 'trick-reset') {
        setBoard((b) => ({ ...b, trick: [] }));
        push('新一轮开始。');
      } else if (obj.kind === 'play') {
        const seatName = ['甲', '乙', '丙'][obj.seat];
        if (obj.move === 'pass') {
          push(`${seatName}：过${obj.reason ? ' — 理由：' + obj.reason : ''}`);
          setBoard((b) => {
            const last = b.last.slice(); last[obj.seat] = '过';
            const lastRich = b.lastRich.map((x) => x.slice()); lastRich[obj.seat] = [];
            const trick = b.trick.slice(); trick.push({ seat: obj.seat, pass: true, cardsRich: [] });
            return { ...b, last, lastRich, trick };
          });
        } else {
          const labels: string[] = obj.cards || [];
          const text = labels.join('');
          push(`${seatName}：${obj.comboType || obj.type || '出牌'} ${text}${obj.reason ? ' — 理由：' + obj.reason : ''}`);
          setBoard((b) => {
            const last = b.last.slice(); last[obj.seat] = text;

            const hands = b.hands.map((a) => a.slice());
            for (const lab of labels) {
              const k = hands[obj.seat].indexOf(lab);
              if (k >= 0) hands[obj.seat].splice(k, 1);
            }

            const handsRich = b.handsRich.map((arr) => arr.slice());
            const taken: any[] = [];
            for (const lab of labels) {
              const k = handsRich[obj.seat].findIndex((c: any) => c.label === lab);
              if (k >= 0) taken.push(handsRich[obj.seat].splice(k, 1)[0]);
            }

            const lastRich = b.lastRich.map((x) => x.slice()); lastRich[obj.seat] = taken;
            const trick = b.trick.slice(); trick.push({ seat: obj.seat, cardsRich: taken });

            return { ...b, last, hands, handsRich, lastRich, trick };
          });
        }
      }
    } else if (obj?.type === 'score') {
      setTotals([obj.totals?.[0], obj.totals?.[1], obj.totals?.[2]]);
      push(`积分：甲 ${obj.totals?.[0]} / 乙 ${obj.totals?.[1]} / 丙 ${obj.totals?.[2]}`);
    } else if (obj?.type === 'terminated') {
      setStatus('terminated');
      push('对局已终止。');
    }
  }

  /** POST + NDJSON */
  async function runPOST(url: string) {
    const body: any = {
      rounds: props.rounds,
      seed: props.seed,
      rob: props.rob,
      four2: props.four2,
      delayMs: props.delayMs,
      delay: props.delayMs,            // 兼容旧字段
      startScore: props.startScore,
      start_score: props.startScore,   // 兼容蛇形
      players: props.players,
      playersList: (props.players || '').split(',').map((s) => s.trim()), // 兼容数组
      apiKeys: props.apiKeys || {},
    };
    const ac = new AbortController();
    abortRef.current = ac;

    push(`连接(POST NDJSON)：${url}`);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    push(`HTTP ${r.status} ${r.statusText} · content-type=${r.headers.get('content-type')}`);
    if (!r.ok || !r.body) throw new Error('响应不可读');
    setStatus('streaming');
    gotFirstChunkRef.current = false;
    armWatchdog();

    const reader = r.body.getReader();
    readerRef.current = reader;
    const dec = new TextDecoder('utf-8');
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (!gotFirstChunkRef.current) {
        gotFirstChunkRef.current = true;
        push('✅ 已收到数据流(POST)。');
        clearWatchdog();
      }
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
          const obj = JSON.parse(payload);
          handle(obj);
        } catch {}
      }
    }
  }

  /** GET + SSE */
  function runSSE(url: string) {
    return new Promise<void>((resolve, reject) => {
      const qs = new URLSearchParams({
        rounds: String(props.rounds),
        seed: String(props.seed),
        rob: String(props.rob),
        four2: String(props.four2),
        delayMs: String(props.delayMs),
        startScore: String(props.startScore),
        players: props.players,
      });
      const full = url.includes('?') ? url + '&' + qs.toString() : url + '?' + qs.toString();
      push(`连接(GET SSE)：${full}`);
      const es = new EventSource(full);
      esRef.current = es;
      let opened = false;
      setStatus('streaming');
      armWa
