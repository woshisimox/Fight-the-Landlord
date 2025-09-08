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
...

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

...

export default function Home(props: {
  rounds: number;
  startScore?: [number,number,number];
  seatDelayMs?: [number,number,number];
  enabled?: [boolean,boolean,boolean];
  rob?: boolean;
  four2?: boolean;
  seats?: any;
  seatModels?: any;
  seatKeys?: any;
  onLog?: (lines:string[])=>void;
}) {
  const [running, setRunning] = useState(false);
  const controllerRef = useRef<AbortController|null>(null);

  const [hands, setHands] = useState<Label[][]>([[],[],[]]);
  const [plays, setPlays] = useState<{seat:number;move:'play'|'pass';cards?:Label[];reason?:string}[]>([]);
  const [totals, setTotals] = useState<[number,number,number]>(props.startScore || [0,0,0]);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number]|null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [log, setLog] = useState<string[]>([]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [finishedCount, setFinishedCount] = useState(0);

  // —— ref 快照，避免闭包读到旧值 ——
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

  // ====================== A 方案：分段拉流 + 自动续跑（替换原 start） ======================
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
      while (winsRef.current < (props.rounds || 1)) {
        // 每段连接单独的 AbortController（便于 stop() 立即生效）
        controllerRef.current = new AbortController();
        const remaining = (props.rounds || 1) - winsRef.current;

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
                // 轻量心跳日志（可注掉）
                const tt = m?.type || '?'; const kk = m?.kind || '';
                nextLog.push(`[rx] ${tt}${kk?('/'+kk):''}`);

                const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);

                if (hasHands) {
                  // 初始化/重发手牌
                  nextHands = rh.map((arr: any[]) => (arr || []).map((l: string) => (candDecorations(l)[0] || l)));
                  if (m.landlord!=null) nextLandlord = m.landlord;
                  nextPlays = [];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'landlord') {
                  nextLandlord = m.seat;
                  nextLog.push(`地主：${['甲','乙','丙'][m.seat]}`);
                  continue;
                }

                if (m.type === 'event' && m.kind === 'round-reset') {
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
                      pretty.push(chosen);
                      // 从该玩家手牌移除一张
                      const ix = nh[seat].indexOf(chosen);
                      if (ix>=0) nh[seat].splice(ix,1);
                    }
                    nextHands = nh;
                    nextPlays = [...nextPlays, { seat, move:'play', cards: pretty, reason:m.reason }];
                    nextLog.push(`${['甲','乙','丙'][seat]} 出：${pretty.join(' ')}`);
                  }
                  continue;
                }

                if (m.type === 'event' && m.kind === 'finish') {
                  nextWinner = m.seat;
                  nextDelta = m.delta;
                  nextTotals = [
                    nextTotals[0] + (m.delta?.[0] ?? 0),
                    nextTotals[1] + (m.delta?.[1] ?? 0),
                    nextTotals[2] + (m.delta?.[2] ?? 0),
                  ] as [number,number,number];
                  nextMultiplier = m.multiplier ?? nextMultiplier;
                  nextFinished = nextFinished + 1;
                  nextLog.push(`—— 第 ${nextFinished} 局结束：胜者 ${['甲','乙','丙'][m.seat]}，倍数 x${nextMultiplier} ——`);
                  continue;
                }
              } catch {}
            }

            // 批量提交（合并 setState，降低渲染抖动）
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
              // 解析 NDJSON
              buf += chunk;
              let idx:number;
              const batch:any[] = [];
              while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line) continue;
                try { batch.push(JSON.parse(line)); } catch {}
              }
              if (batch.length) {
                commitBatch(batch);
                // 微让步一帧，防止 UI 被长批次饿死
                await new Promise(r => setTimeout(r, 0));
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
          // 一段连接自然结束；若还有剩余局数，外层 while 会立即续跑
        } catch (err:any) {
          // 用户点击“停止”后触发的中断
          if (err?.name === 'AbortError') break;
          // 其他异常：写日志并尝试续跑
          setLog(v => [...v, `[前端异常] ${err?.message || String(err)}（将尝试续跑）`]);
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
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'2px 8px', border:'1px solid #eee', borderRadius:6, fontSize:12, lineHeight:1.2, userSelect:'none', background:'#fff' }}>
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
