import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * pages/index.tsx
 * 最终版骨架（仅调试与稳态修复，不动 UI 意图）
 * - 前端 NDJSON 解析：逐行解析 + 批量提交
 * - 提交后微让步：await new Promise(r => setTimeout(r, 0))
 * - 每行到达追加一条轻量日志（可删）
 * - 处理“尾包”：流结束时若 buf 里还剩最后一行且无换行，也会被处理
 */

type Label = string;
type ComboType =
  | 'single' | 'pair' | 'triple' | 'bomb' | 'rocket'
  | 'straight' | 'pair-straight' | 'plane'
  | 'triple-with-single' | 'triple-with-pair'
  | 'four-with-two-singles' | 'four-with-two-pairs';
type Four2Policy = boolean;

type EventObj =
  | { type:'state'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'init'; landlord:number; hands: Label[][] }   // 兼容部分后端
  | { type:'event'; kind:'play'; seat:number; move:'play'|'pass'; cards?:Label[]; comboType?:ComboType; reason?:string }
  | { type:'event'; kind:'rob'; seat:number; rob:boolean }
  | { type:'event'; kind:'trick-reset' }
  | { type:'event'; kind:'win'; winner:number; multiplier:number; deltaScores:[number,number,number] }
  | { type:'log'; message:string }
  | any;

type PlayRowT = { seat:number; move:'play'|'pass'; cards?:string[]; reason?:string };

function SeatTitle({ i }: { i:number }) {
  return <span style={{ fontWeight:700 }}>{['甲','乙','丙'][i]}</span>;
}

/* ---------- 花色渲染（前端显示专用） ---------- */
type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];

// 只提取点数；处理 10→T、大小写
const rankOf = (l: string) => {
  if (!l) return '';
  const c0 = l[0];
  if ('♠♥♦♣'.includes(c0)) return l.slice(1).replace(/10/i, 'T').toUpperCase();
  if (c0 === '🃏') return (l.slice(2) || 'X').replace(/10/i, 'T').toUpperCase();
  return l.replace(/10/i, 'T').toUpperCase();
};

// 返回所有可能的装饰写法（用于从后端原始标签映射到前端装饰牌）
function candDecorations(l: string): string[] {
  if (!l) return [];
  // Joker 映射：为避免大小写，统一用大写字母区分：小王=X，大王=Y
  if (l === 'x') return ['🃏X'];  // 小王
  if (l === 'X') return ['🃏Y'];  // 大王
  if (l.startsWith('🃏')) return [l];
  if ('♠♥♦♣'.includes(l[0])) return [l];
  const r = rankOf(l);
  if (r === 'JOKER') return ['🃏Y']; // 兜底，极少出现
  return SUITS.map(s => `${s}${r}`);
}

// 把一手原始手牌装饰为均匀花色
function decorateHandCycle(labels: string[]): string[] {
  const ranks = labels.map(rankOf);
  let idx = 0;
  return ranks.map(r => {
    if (r === 'X') return '🃏X';
    if (r === 'Y' || r === 'JOKER') return '🃏Y';
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${r}`;
  });
}

// 单张牌渲染
function Card({ label }: { label: string }) {
  const rank = useMemo(() => rankOf(label), [label]);
  const suit = useMemo(() => (label[0] === '🃏' ? '🃏' : label[0]), [label]) as SuitSym;
  const rankColor = suit === '♥' || suit === '♦' ? '#d23' : undefined;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6,
      padding:'2px 6px', margin:'2px 2px', border:'1px solid #eee', borderRadius:6
    }}>
      <span style={{ fontSize:16 }}>{suit}</span>
      <span style={{ fontSize:16, ...(rankColor ? { color: rankColor } : {}) }}>{rank === 'T' ? '10' : rank}</span>
    </span>
  );
}

function Hand({ cards }: { cards: string[] }) {
  if (!cards || !cards.length) return <span style={{ opacity:0.6 }}>（空）</span>;
  return <div style={{ display:'flex', flexWrap:'wrap' }}>
    {cards.map((c, idx) => <Card key={`${c}-${idx}`} label={c} />)}
  </div>;
}

function PlayRow(
  { seat, move, cards, reason }:
  { seat:number; move:'play'|'pass'; cards?:string[]; reason?:string }
) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0' }}>
      <div style={{ width:32, textAlign:'right', opacity:0.8 }}>{['甲','乙','丙'][seat]}</div>
      <div style={{ width:56, fontWeight:700 }}>{move === 'pass' ? '过' : '出牌'}</div>
      <div style={{ flex:1 }}>
        {move === 'pass'
          ? <span style={{ opacity:0.6 }}>过</span>
          : <Hand cards={cards || []} />}
      </div>
      {reason && <div style={{ width:220, fontSize:12, color:'#666' }}>{reason}</div>}
    </div>
  );
}

// 简单区块
function Section({ title, children }:{ title:string; children:React.ReactNode }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function LogLine({ text }:{ text:string }) {
  return <div style={{ fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize:12 }}>{text}</div>;
}

/* ==================== 实时对局面板 ==================== */
function LivePanel(props: {
  rounds: number;
  startScore: [number,number,number];
  seatDelayMs: number;
  enabled?: boolean[];
  rob?: boolean;
  four2?: Four2Policy;
  seats?: string[];
  seatModels?: string[];
  seatKeys?: Record<string,string>;
  onLog?: (lines: string[]) => void;
}) {
  const [running, setRunning] = useState(false);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [plays, setPlays] = useState<PlayRowT[]>([]);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number]|null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [totals, setTotals] = useState<[number,number,number]>(props.startScore || [0,0,0]);
  const [log, setLog] = useState<string[]>([]);
  const [finishedCount, setFinishedCount] = useState(0);

  const controllerRef = useRef<AbortController|null>(null);

  // —— 镜像到 ref，批处理时读取 ——
  const handsRef = useRef(hands); useEffect(()=>{ handsRef.current = hands; },[hands]);
  const playsRef = useRef(plays); useEffect(()=>{ playsRef.current = plays; },[plays]);
  const totalsRef = useRef(totals); useEffect(()=>{ totalsRef.current = totals; },[totals]);
  const finishedRef = useRef(finishedCount); useEffect(()=>{ finishedRef.current = finishedCount; },[finishedCount]);
  const logRef = useRef(log); useEffect(()=>{ logRef.current = log; props.onLog?.(log); },[log]);
  const landlordRef = useRef(landlord); useEffect(()=>{ landlordRef.current = landlord; },[landlord]);
  const winnerRef = useRef(winner); useEffect(()=>{ winnerRef.current = winner; },[winner]);
  const deltaRef = useRef(delta); useEffect(()=>{ deltaRef.current = delta; },[delta]);
  const multiplierRef = useRef(multiplier); useEffect(()=>{ multiplierRef.current = multiplier; },[multiplier]);
  const winsRef = useRef(0); useEffect(()=>{ winsRef.current = finishedCount; },[finishedCount]);

  const start = async () => {
    if (running) return;
    setRunning(true);
    setLandlord(null);
    setHands([[],[],[]]);
    setPlays([]);
    setWinner(null);
    setDelta(null);
    setMultiplier(1);
    setLog([]);
    setFinishedCount(0);

    const t0 = (typeof performance!=='undefined' ? performance.now() : Date.now());

    try {
      // —— 分段拉流，直到跑满 props.rounds 或被 stop() 终止 ——
      while ((winsRef.current||0) < (props.rounds || 1)) {
        // 每段连接单独的 AbortController
        controllerRef.current = new AbortController();
        const remaining = (props.rounds || 1) - (winsRef.current||0);

        try {
          const r = await fetch('/api/stream_ndjson', {
            method:'POST',
            headers: { 'content-type':'application/json' },
            body: JSON.stringify({
              rounds: remaining,                 // 关键：只跑“剩余局数”
              startScore: props.startScore,
              seatDelayMs: props.seatDelayMs,
              enabled: props.enabled,
              rob: props.rob,
              four2: props.four2,
              seats: props.seats,
              seatModels: props.seatModels,
              seatKeys: props.seatKeys,
            }),
            signal: controllerRef.current.signal,
          });
          if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

          const reader = r.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buf = '';

          const commitBatch = (batch: any[]) => {
            if (!batch.length) return;

            // Take snapshots
            let nextHands = handsRef.current.map(x => [...x]);
            let nextPlays = [...playsRef.current];
            let nextTotals = [...totalsRef.current] as [number,number,number];
            let nextFinished = finishedRef.current;
            let nextLog = [...logRef.current];
            let nextLandlord = landlordRef.current;
            let nextWinner = winnerRef.current as number|null;
            let nextDelta = deltaRef.current as [number,number,number]|null;
            let nextMultiplier = multiplierRef.current;

            for (const raw of batch) {
              const m: any = raw;
              try {
                const tt = m?.type || '?'; const kk = m?.kind || '';
                nextLog.push(`[rx] ${tt}${kk?('/'+kk):''}`);

                const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);

                if (hasHands) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  // 允许后端在每局开头重发手牌
                  nextHands = (rh as any[]).map((arr:any[]) => decorateHandCycle(arr || []));
                  if (m.landlord!=null) nextLandlord = m.landlord;
                  continue;
                }

                if (m.type === 'event' && m.kind === 'rob') {
                  nextLandlord = m.seat;
                  nextLog.push(`地主：${['甲','乙','丙'][m.seat]}`);
                  continue;
                }

                if (m.type === 'event' && m.kind === 'trick-reset') {
                  nextLog.push('一轮结束，重新起牌');
                  nextPlays = [];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'play') {
                  if (m.move === 'pass') {
                    nextPlays = [...nextPlays, { seat:m.seat, move:'pass', reason:m.reason }];
                    nextLog.push(`${['甲','乙','丙'][m.seat]} 过${m.reason ? `（${m.reason}）` : ''}`);
                  } else {
                    const pretty: string[] = [];
                    const seat = m.seat as number;
                    const cards: string[] = (m.cards || []) as string[];
                    const nh = (nextHands && (nextHands as any[]).length===3 ? nextHands : [[],[],[]]).map((x:any)=>[...x]);
                    for (const rawCard of cards) {
                      const options = candDecorations(rawCard);
                      const chosen = options.find((d:string) => nh[seat].includes(d)) || options[0];
                      const k = nh[seat].indexOf(chosen);
                      if (k >= 0) nh[seat].splice(k, 1);
                      pretty.push(chosen);
                    }
                    nextHands = nh;
                    nextPlays = [...nextPlays, { seat:m.seat, move:'play', cards: pretty }];
                    nextLog.push(`${['甲','乙','丙'][m.seat]} 出牌：${pretty.join(' ')}`);
                  }
                  continue;
                }

                if (m.type === 'event' && m.kind === 'win') {
                  nextWinner = m.winner;
                  nextMultiplier = m.multiplier;
                  nextDelta = m.deltaScores;
                  nextLog.push(`胜者：${['甲','乙','丙'][m.winner]}，倍数 x${m.multiplier}，当局积分变更 ${m.deltaScores.join(' / ')}`);
                  nextTotals = [
                    nextTotals[0] + (m.deltaScores?.[0] ?? 0),
                    nextTotals[1] + (m.deltaScores?.[1] ?? 0),
                    nextTotals[2] + (m.deltaScores?.[2] ?? 0),
                  ];
                  nextFinished = nextFinished + 1;
                  winsRef.current = (winsRef.current||0) + 1;
                  continue;
                }

                if (m.type === 'log' && typeof m.message === 'string') {
                  nextLog.push(m.message);
                  continue;
                }
              } catch(e) {
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
          };

          const pump = async (): Promise<void> => {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              let chunk = decoder.decode(value, { stream:true });
              if (!chunk) continue;
              let idx:number;
              const batch:any[] = [];
              // 累积并分行
              buf += chunk;
              while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line) continue;
                try { batch.push(JSON.parse(line)); } catch {}
              }
              if (batch.length) {
                commitBatch(batch);
                await new Promise(r => setTimeout(r, 0)); // 微让步
              }
            }
            // 尾包
            const last = buf.trim();
            if (last) {
              try { commitBatch([JSON.parse(last)]); } catch {}
            }
          };

          await pump();
          try { reader.releaseLock(); } catch {}
        } catch (err:any) {
          if (err?.name === 'AbortError') break; // 用户点击停止
          setLog(v => [...v, `[前端异常] ${err?.message || String(err)}（将尝试续跑）`]);
          // 其他异常：继续 while，立刻续跑
        }
      }
    } finally {
      const elapsed = (typeof performance!=='undefined' ? performance.now() : Date.now()) - t0;
      setLog(v => [...v, `[stream end] elapsed=${(elapsed/1000).toFixed(1)}s, finished=${winsRef.current}/${props.rounds}`]);
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  return (
    <div>
      {/* 剩余局数徽标（不改 UI 结构，仅补一个轻量展示） */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'4px 8px', border:'1px solid #eee', borderRadius:8, fontSize:12, lineHeight:1.2, userSelect:'none', background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      <Section title="积分（总分）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i =>
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px' }}>
              <div><SeatTitle i={i} />：{totals[i]}</div>
            </div>
          )}
        </div>
      </Section>

      <Section title="出牌">
        <div style={{ border:'1px dashed #eee', borderRadius:8, padding:'6px 8px' }}>
          {plays.length === 0
            ? <div style={{ opacity:0.6 }}>（尚无出牌）</div>
            : plays.map((p, idx) =>
                <PlayRow key={idx} seat={p.seat} move={p.move} cards={p.cards} reason={p.reason} />
              )
          }
        </div>
      </Section>

      <Section title="结果">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px' }}>
            <div>胜者：{winner!=null ? ['甲','乙','丙'][winner] : '—'}</div>
            <div>倍数：x{multiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:'8px 10px' }}>
            <div>积分变化：{delta ? delta.join(' / ') : '—'}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end' }}>
            <button onClick={running ? stop : start} style={{ padding:'6px 12px', border:'1px solid #ddd', borderRadius:8, background: running ? '#fee2e2' : '#e0f2fe' }}>
              {running ? '停止' : '开始'}
            </button>
          </div>
        </div>
      </Section>

      <Section title="运行日志">
        <div style={{
          border:'1px solid #eee', borderRadius:8, padding:'8px 10px',
          maxHeight:420, overflow:'auto', background:'#fafafa'
        }}>
          {log.length === 0
            ? <div style={{ opacity:0.6 }}>（暂无）</div>
            : log.map((t, idx) => <LogLine key={idx} text={t} />)
          }
        </div>
      </Section>
    </div>
  );
}

export default function Home() {
  // 维持你的原始默认 UI 配置；若你的外层已有这些控件，可忽略下面容器，只保留 <LivePanel ... />
  const [rounds] = useState(100);
  const [startScore] = useState<[number,number,number]>([0,0,0]);
  const [seatDelayMs] = useState(100);
  const [enabled] = useState<boolean[]|undefined>(undefined);
  const [rob] = useState<boolean>(true);
  const [four2] = useState<Four2Policy>(true);
  const [seats] = useState<string[]|undefined>(undefined);
  const [seatModels] = useState<string[]|undefined>(undefined);
  const [seatKeys] = useState<Record<string,string>|undefined>(undefined);
  const [liveLog, setLiveLog] = useState<string[]>([]);

  return (
    <div style={{ maxWidth: 1100, margin: '20px auto', padding: '0 12px' }}>
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局</div>
        <LivePanel
          rounds={rounds}
          startScore={startScore}
          seatDelayMs={seatDelayMs}
          enabled={enabled}
          rob={rob}
          four2={four2}
          seats={seats}
          seatModels={seatModels}
          seatKeys={seatKeys}
          onLog={setLiveLog}
        />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:12, marginTop:12 }}>
        <Section title="运行日志">
          <div style={{
            border:'1px solid #eee', borderRadius:8, padding:'8px 10px',
            maxHeight:420, overflow:'auto', background:'#fafafa'
          }}>
            {liveLog.length === 0
              ? <div style={{ opacity:0.6 }}>（暂无）</div>
              : liveLog.map((t, idx) => <LogLine key={idx} text={t} />)
            }
          </div>
        </Section>
      </div>
    </div>
  );
}
