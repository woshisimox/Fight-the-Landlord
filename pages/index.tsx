import React, { useEffect, useRef, useState } from 'react';

/** 工具：把后端 label 格式（如 "♠A" / "🃏x"）转换为 UI 显示 */
function decorateHandCycle(ls: string[]): string[] {
  return ls.map(l => {
    if (!l) return '';
    const c0 = l[0];
    if (c0 === '🃏') return l; // 已经带 Joker 符号
    if (l === 'x' || l === 'X') return `🃏${l}`;  // 保留大小写：x=小王, X=大王
    const suit = c0;
    const rank = l.slice(1);
    return `${suit}${rank}`;
  });
}

/** 手牌里按点数/花色显示的卡片 */
function Card({ label }: { label:string }) {
  const suit = label.startsWith('🃏') ? '🃏' : label.charAt(0);
  const baseColor = (suit === '♥' || suit === '♦')
    ? '#af1d22'
    : (suit === '🃏' ? '#6b5' : '#1a1a1a');
  const rank = label.startsWith('🃏') ? (label.slice(2) || '') : label.slice(1);
  // Joker：大王 X = 红，小王 x = 绿
  const rankColor = suit === '🃏' ? (rank === 'X' ? '#d11' : '#16a34a') : undefined;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6,
      border:'1px solid #ddd', borderRadius:8, padding:'6px 10px',
      marginRight:6, marginBottom:6, fontWeight:800, color: baseColor
    }}>
      <span style={{ fontSize:16 }}>{suit}</span>
      <span style={{ fontSize:16, ...(rankColor ? { color: rankColor } : {}) }}>
        {rank === 'T' ? '10' : rank}
      </span>
    </span>
  );
}

/** —— 下面是页面主体 —— */

type LiveProps = {
  rounds: number;           // 总局数
  startScore?: number;      // 初始积分
  endpoint?: string;        // 流接口（默认 /api/stream_ndjson）
};

function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const [lord, setLord] = useState<number | null>(null);
  const [leader, setLeader] = useState<number | null>(null);
  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState<[number,number,number]>([
    props.startScore || 0, props.startScore || 0, props.startScore || 0,
  ]);
  const [finishedCount, setFinishedCount] = useState(0);

  // 剩余局数（包含当前局）：总局数 - 已完成局数
  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  const abortRef = useRef<AbortController | null>(null);

  const pushLog = (msg: string) => {
    setLog(prev => {
      const base = prev.length > 1200 ? prev.slice(-800) : prev;
      return [...base, msg];
    });
  };

  const start = async () => {
    if (running) return;
    setRunning(true);
    setWinner(null);
    setLeader(null);
    setLord(null);
    setHands([[],[],[]]);
    setDelta(null);
    setLog([]);
    setFinishedCount(0);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const r = await fetch(props.endpoint || '/api/stream_ndjson', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ rounds: props.rounds }),
      signal: ctrl.signal
    });

    if (!r.body) {
      pushLog('未获得流响应'); setRunning(false); return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        try { buf += decoder.decode(); } catch {}
        if (buf && buf.trim()) {
          try {
            const tail = buf.trim();
            const m: any = JSON.parse(tail);
            // 处理最后一条（若无换行）
            handleMsg(m);
          } catch {}
        }
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const m: any = JSON.parse(line);
          handleMsg(m);
        } catch (e:any) {
          pushLog(`前端解析错误：${e?.message || String(e)}`);
        }
      }
    }

    setRunning(false);
    abortRef.current = null;
  };

  // 处理服务端事件
  function handleMsg(m: any) {
    // 统一的日志
    if (m.type === 'log') {
      const msg = String(m.message ?? '');
      pushLog(msg);
      return;
    }

    // 状态：开局/发牌完成（包含 hands）
    const hasHands = (m.type === 'state') &&
                     (m.hands && Array.isArray(m.hands) && m.hands.length === 3);
    if (hasHands) {
      const lordSeat = typeof m.landlord === 'number' ? m.landlord : null;
      const leaderSeat = typeof m.leader === 'number' ? m.leader : null;
      setLord(lordSeat);
      setLeader(leaderSeat);
      setWinner(null);
      setDelta(null);

      // 仅显示“本局日志”：新一局到来时清空并写入开头行
      setLog([`发牌完成，${lordSeat!=null?['甲','乙','丙'][lordSeat]:'?'}为地主`]);

      // 显示三家手牌（转为带花色/Joker 符号）
      const hs = m.hands.map((h: string[]) => decorateHandCycle(h));
      setHands(hs);
      return;
    }

    // 普通事件
    if (m.type === 'event' && m.kind === 'play') {
      if (m.move === 'pass') {
        pushLog(`【${['甲','乙','丙'][m.seat]}】过牌`);
      } else {
        const show = (m.cards || []).map((l:string)=> (l.startsWith('🃏')? l : l)).join(' ');
        pushLog(`【${['甲','乙','丙'][m.seat]}】出：${show}`);
        // 前端移除该家的牌
        setHands(prev => {
          const next = prev.map(a => [...a]);
          for (const c of (m.cards||[])) {
            const label = c.startsWith('🃏') ? c : c; // 已是 decorate 过的
            const i = next[m.seat].indexOf(label);
            if (i >= 0) next[m.seat].splice(i, 1);
          }
          return next as string[][];
        });
      }
      return;
    }

    if (m.type === 'event' && m.kind === 'trick-reset') {
      pushLog(`—— 新一轮 ——`);
      return;
    }

    if (m.type === 'event' && m.kind === 'win') {
      const seat = m.winner;
      setWinner(seat);
      setFinishedCount(c => c + 1);
      const d = m.delta as [number,number,number];
      if (d) setDelta(d);
      // 累加到总分
      setTotals(t => [t[0]+d[0], t[1]+d[1], t[2]+d[2]]);
      pushLog(`【${['甲','乙','丙'][seat]}】胜！ 本局积分变动：${d[0]}/${d[1]}/${d[2]}`);
      return;
    }

    if (m.type === 'state' && m.kind === 'over') {
      pushLog('本轮对局结束');
      return;
    }
  }

  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
    setRunning(false);
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:12 }}>
      {/* 剩余局数徽标（不影响原布局） */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, lineHeight:1.2, userSelect:'none', background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* 控制区 */}
      <div style={{ display:'flex', gap:8 }}>
        {!running
          ? <button onClick={start} style={{ padding:'6px 12px' }}>开始</button>
          : <button onClick={stop} style={{ padding:'6px 12px' }}>停止</button>}
      </div>

      {/* 桌面/手牌显示 */}
      <div>
        <div style={{ fontWeight:700, marginBottom:6 }}>
          对局（{winner===null ? '进行中' : `胜者：${['甲','乙','丙'][winner]}`}）
          {lord!==null && <span style={{ marginLeft:8, fontWeight:400 }}>地主：{['甲','乙','丙'][lord]}</span>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:6 }}>
          {[0,1,2].map(seat => (
            <div key={seat} style={{ display:'flex', alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ width:26, fontWeight:700 }}>{['甲','乙','丙'][seat]}</span>
              <div>
                {hands[seat]?.map((l, i) => <Card key={i} label={l} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 计分区 */}
      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        <div>总分：[{totals[0]} / {totals[1]} / {totals[2]}]</div>
        {delta && <div>本局：[{delta[0]} / {delta[1]} / {delta[2]}]</div>}
      </div>

      {/* 日志（仅显示本局；新局开头 setLog([…]) 已自动清空） */}
      <div style={{ border:'1px solid #eee', borderRadius:8, padding:8, background:'#fafafa' }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>运行日志（本局）</div>
        <div style={{ maxHeight:260, overflow:'auto', whiteSpace:'pre-wrap', fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  // 这里可按需读取 URL 参数或 UI 设置；示例：总局数默认 5，初始分 0
  return (
    <div style={{ padding:16 }}>
      <h1 style={{ fontSize:18, marginBottom:10 }}>斗地主·对局</h1>
      <LivePanel rounds={5} startScore={0} />
    </div>
  );
}
