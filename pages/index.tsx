import React, { useEffect, useRef, useState } from 'react';

/**
 * pages/index.tsx — 稳定版
 * - 只定义一次 type BotChoice（以分号结尾）
 * - 兼容 /api/stream_ndjson 返回的 state/event/log/ka
 * - 简洁 UI：对局设置 / 牌桌 / 日志
 */

/* ===== 类型定义（顺序很重要，确保一次性定义且不重复） ===== */

type Label = string;

type ComboType =
  | 'single' | 'pair' | 'triple' | 'bomb' | 'rocket'
  | 'straight' | 'pair-straight' | 'plane'
  | 'triple-with-single' | 'triple-with-pair'
  | 'four-with-two-singles' | 'four-with-two-pairs';

type Four2Policy = 'both' | '2singles' | '2pairs';

/** 关键：只在此处定义一次，并以分号结尾 */
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type EventObj =
  | { type:'state'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'init'; landlord:number; hands: Label[][] } // 兼容部分后端写法
  | { type:'event'; kind:'rob';  seat:number; rob:boolean }
  | { type:'event'; kind:'play'; seat:number; move:'play'|'pass'; cards?:Label[]; comboType?:ComboType; reason?:string }
  | { type:'event'; kind:'trick-reset' }
  | { type:'event'; kind:'win'; winner:number; multiplier:number; deltaScores:[number,number,number] }
  | { type:'log';  message:string }
  | { type:'ka' }
  | any;

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
  stopBelowZero?: boolean;
};

/* ===== 小组件 ===== */

function Card({ label }: { label: string }) {
  return (
    <span
      style={{
        display:'inline-flex', alignItems:'center', justifyContent:'center',
        border:'1px solid #e8e8e8', borderRadius:6, minWidth:28, height:36,
        padding:'0 6px', margin:2, fontFamily:'monospace', fontSize:16, background:'#fff',
      }}
      title={label}
    >
      {label}
    </span>
  );
}

function Hand({ cards }: { cards: string[] }) {
  if (!cards || !cards.length) return <span style={{ opacity:0.6 }}>（空）</span>;
  return (
    <div style={{ display:'flex', flexWrap:'wrap' }}>
      {cards.map((c, idx) => <Card key={`${c}-${idx}`} label={c} />)}
    </div>
  );
}

function PlayRow({
  seat, move, cards, reason, comboType,
}: {
  seat: number;
  move: 'play' | 'pass';
  cards?: string[];
  reason?: string;
  comboType?: ComboType;
}) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      <b>{['甲','乙','丙'][seat]}：</b>
      {move === 'pass'
        ? <span style={{ opacity:0.7 }}>过</span>
        : <>
            <span style={{ opacity:0.7 }}>{comboType || '—'}</span>
            <div>{(cards || []).map((c, i) => <Card key={`${c}-${i}`} label={c} />)}</div>
          </>
      }
      {reason ? <span style={{ opacity:0.6 }}>（{reason}）</span> : null}
    </div>
  );
}

/* ===== NDJSON 工具 ===== */
async function* ndjsonIterator(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream:true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

/* ===== 页面组件 ===== */
export default function Home() {
  // 对局参数
  const [rounds, setRounds] = useState<number>(10);
  const [startScore, setStartScore] = useState<number>(100);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>([0,0,0]);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [rob, setRob] = useState<boolean>(true);
  const [four2, setFour2] = useState<Four2Policy>('both');

  const [seats, setSeats] = useState<BotChoice[]>([
    'built-in:greedy-max',
    'built-in:greedy-min',
    'built-in:random-legal',
  ]);
  const [seatModels, setSeatModels] = useState<string[]>(['gpt-4o','gemini-1.5-pro','']);
  const [seatKeys, setSeatKeys] = useState<{
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string;
    httpBase?: string; httpToken?: string;
  }[]>([{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }]);

  const [stopBelowZero, setStopBelowZero] = useState<boolean>(false);

  // 运行态
  const [running, setRunning] = useState<boolean>(false);
  const [log, setLog] = useState<string[]>([]);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [landlord, setLandlord] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [winner, setWinner] = useState<number | null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);

  // 桌面态
  const [hands, setHands] = useState<Label[][]>([[],[],[]]);
  const [plays, setPlays] = useState<{ seat:number; move:'play'|'pass'; cards?:string[]; comboType?:ComboType; reason?:string }[]>([]);

  // 累积分
  const [totals, setTotals] = useState<[number,number,number]>([startScore,startScore,startScore]);

  // Refs 保持闭包一致
  const controllerRef = useRef<AbortController | null>(null);
  const handsRef = useRef<Label[][]>([[],[],[]]);
  const playsRef = useRef<typeof plays>([]);
  const totalsRef = useRef<[number,number,number]>([startScore,startScore,startScore]);
  const runningRef = useRef<boolean>(false);

  useEffect(()=>{ handsRef.current = hands; }, [hands]);
  useEffect(()=>{ playsRef.current = plays; }, [plays]);
  useEffect(()=>{ totalsRef.current = totals; }, [totals]);
  useEffect(()=>{ runningRef.current = running; }, [running]);

  // 启动
  const start = async () => {
    if (runningRef.current) return;
    setRunning(true);
    setWinner(null);
    setDelta(null);
    setMultiplier(1);
    setLog([]);
    setLiveLog([]);
    setPlays([]);
    setHands([[],[],[]]);
    setLandlord(null);

    const ac = new AbortController();
    controllerRef.current = ac;

    const payload: LiveProps = {
      rounds, startScore, seatDelayMs, enabled, rob, four2,
      seats, seatModels, seatKeys,
      stopBelowZero,
    };

    try {
      const resp = await fetch('/api/stream_ndjson', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        signal: ac.signal,
        body: JSON.stringify(payload),
      });
      if (!resp.ok || !resp.body) {
        setLog(l => [...l, `后端异常：${resp.status} ${resp.statusText}`]);
        setRunning(false);
        return;
      }

      for await (const line of ndjsonIterator(resp.body)) {
        let m: EventObj | null = null;
        try { m = JSON.parse(line); }
        catch { setLiveLog(l=>[...l, `（非JSON）${line.slice(0,160)}`]); continue; }

        if ((m as any).type === 'ka') continue;

        if ((m as any).type === 'log') {
          setLiveLog(l=>[...l, (m as any).message]);
          continue;
        }

        if ((m as any).kind === 'init') {
          const { landlord, hands } = m as any;
          if (typeof landlord === 'number') setLandlord(landlord);
          if (hands && Array.isArray(hands)) setHands(hands as Label[][]);
          continue;
        }

        if ((m as any).type === 'event' && (m as any).kind === 'rob') {
          setLog(l=>[...l, `${['甲','乙','丙'][(m as any).seat]} ${(m as any).rob ? '抢地主' : '不抢'}`]);
          continue;
        }

        if ((m as any).type === 'event' && (m as any).kind === 'play') {
          const { seat, move, cards, reason, comboType } = m as any;
          setPlays(p=>[...p, { seat, move, cards, reason, comboType }]);

          // 前端同步扣牌（若后端已扣，这里不会产生副作用）
          if (move === 'play' && Array.isArray(cards) && cards.length) {
            setHands(prev => {
              const next = prev.map(x=>[...x]) as Label[][];
              const h = next[seat] || [];
              for (const c of cards) {
                const idx = h.indexOf(c);
                if (idx >= 0) h.splice(idx, 1);
              }
              next[seat] = h;
              return next;
            });
          }
          continue;
        }

        if ((m as any).type === 'event' && (m as any).kind === 'trick-reset') {
          setLog(l=>[...l, '一轮结束，重新起牌']);
          setPlays([]);
          continue;
        }

        if ((m as any).type === 'event' && (m as any).kind === 'win') {
          const { winner, multiplier, deltaScores } = m as any;
          setWinner(winner ?? null);
          setMultiplier(multiplier ?? 1);
          if (deltaScores && Array.isArray(deltaScores)) {
            setDelta(deltaScores as [number,number,number]);
            setTotals(t => [ t[0]+deltaScores[0], t[1]+deltaScores[1], t[2]+deltaScores[2] ]);
          }
          continue;
        }

        // 未知消息
        setLiveLog(l=>[...l, `未知：${line.slice(0,160)}`]);
      }
    } catch (err:any) {
      if (err?.name === 'AbortError') setLog(l=>[...l, '已停止']);
      else setLog(l=>[...l, `异常：${String(err)}`]);
    } finally {
      setRunning(false);
      controllerRef.current = null;
    }
  };

  const stop = () => {
    try { controllerRef.current?.abort(); } catch {}
    setRunning(false);
  };

  function Section({ title, children }: { title:string; children:React.ReactNode }) {
    return (
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>{title}</div>
        {children}
      </div>
    );
  }

  return (
    <div style={{ maxWidth:1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Bot Arena</h1>

      {/* 对局设置 */}
      <Section title="对局设置">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
          <label>
            对局数
            <input type="number" min={1} value={rounds}
              onChange={e=>setRounds(parseInt(e.target.value || '1'))}
              style={{ width:'100%', marginTop:6 }} />
          </label>
          <label>
            初始分
            <input type="number" value={startScore}
              onChange={e=>{
                const v = parseInt(e.target.value || '0');
                setStartScore(v); setTotals([v,v,v]);
              }}
              style={{ width:'100%', marginTop:6 }} />
          </label>
          <label>
            启用对局
            <input type="checkbox" checked={enabled}
              onChange={e=>setEnabled(e.target.checked)}
              style={{ marginLeft:8 }} />
          </label>
          <label>
            抢地主
            <input type="checkbox" checked={rob}
              onChange={e=>setRob(e.target.checked)}
              style={{ marginLeft:8 }} />
          </label>
          <label>
            四个2策略
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)}
              style={{ width:'100%', marginTop:6 }}>
              <option value="both">both</option>
              <option value="2singles">2singles</option>
              <option value="2pairs">2pairs</option>
            </select>
          </label>
          <label title="任何一方分数低于 0 则提前停止多局">
            低于 0 提前停
            <input type="checkbox" checked={stopBelowZero}
              onChange={e=>setStopBelowZero(e.target.checked)}
              style={{ marginLeft:8 }} />
          </label>
        </div>

        <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>{['甲','乙','丙'][i]}</div>

              <label>
                Bot
                <select value={seats[i]}
                  onChange={e=>{
                    const v = e.target.value as BotChoice;
                    const next = [...seats] as BotChoice[];
                    next[i] = v; setSeats(next);
                  }}
                  style={{ width:'100%', marginTop:6 }}>
                  <option value="built-in:greedy-max">内置：GreedyMax</option>
                  <option value="built-in:greedy-min">内置：GreedyMin</option>
                  <option value="built-in:random-legal">内置：RandomLegal</option>
                  <option value="ai:openai">AI: OpenAI</option>
                  <option value="ai:gemini">AI: Gemini</option>
                  <option value="ai:grok">AI: Grok</option>
                  <option value="ai:kimi">AI: Kimi</option>
                  <option value="ai:qwen">AI: 千问</option>
                  <option value="http">HTTP 自定义</option>
                </select>
              </label>

              <label>
                Model
                <input value={seatModels[i] || ''}
                  onChange={e=>{
                    const next = [...seatModels]; next[i] = e.target.value; setSeatModels(next);
                  }}
                  placeholder="如 gpt-4o / gemini-1.5-pro"
                  style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                OpenAI Key
                <input value={seatKeys[i]?.openai || ''}
                  onChange={e=>{
                    const next = [...seatKeys]; next[i] = { ...(next[i]||{}), openai:e.target.value }; setSeatKeys(next);
                  }}
                  placeholder="sk-..." style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                Gemini Key
                <input value={seatKeys[i]?.gemini || ''}
                  onChange={e=>{
                    const next = [...seatKeys]; next[i] = { ...(next[i]||{}), gemini:e.target.value }; setSeatKeys(next);
                  }}
                  placeholder="..." style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                Grok Key
                <input value={seatKeys[i]?.grok || ''}
                  onChange={e=>{
                    const next = [...seatKeys]; next[i] = { ...(next[i]||{}), grok:e.target.value }; setSeatKeys(next);
                  }}
                  placeholder="..." style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                Kimi Key
                <input value={seatKeys[i]?.kimi || ''}
                  onChange={e=>{
                    const next = [...seatKeys]; next[i] = { ...(next[i]||{}), kimi:e.target.value }; setSeatKeys(next);
                  }}
                  placeholder="..." style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                Qwen Key
                <input value={seatKeys[i]?.qwen || ''}
                  onChange={e=>{
                    const next = [...seatKeys]; next[i] = { ...(next[i]||{}), qwen:e.target.value }; setSeatKeys(next);
                  }}
                  placeholder="..." style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                HTTP Base
                <input value={seatKeys[i]?.httpBase || ''}
                  onChange={e=>{
                    const next = [...seatKeys]; next[i] = { ...(next[i]||{}), httpBase:e.target.value }; setSeatKeys(next);
                  }}
                  placeholder="http(s)://host/path" style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                HTTP Token
                <input value={seatKeys[i]?.httpToken || ''}
                  onChange={e=>{
                    const next = [...seatKeys]; next[i] = { ...(next[i]||{}), httpToken:e.target.value }; setSeatKeys(next);
                  }}
                  placeholder="Bearer ..." style={{ width:'100%', marginTop:6 }} />
              </label>

              <label>
                出牌延时（ms）
                <input type="number" min={0} value={seatDelayMs[i] || 0}
                  onChange={e=>{
                    const v = parseInt(e.target.value || '0');
                    const next = [...seatDelayMs]; next[i] = v; setSeatDelayMs(next);
                  }}
                  style={{ width:'100%', marginTop:6 }} />
              </label>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:8, marginTop:12 }}>
          <button onClick={start} disabled={running} style={{ padding:'8px 14px' }}>▶ 开始</button>
          <button onClick={stop}  disabled={!running} style={{ padding:'8px 14px' }}>■ 停止</button>
        </div>
      </Section>

      {/* 牌桌 */}
      <Section title="牌桌">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginBottom:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <div style={{ fontWeight:800 }}>{['甲','乙','丙'][i]}</div>
                {landlord === i ? (
                  <span style={{ fontSize:12, background:'#f90', color:'#fff', borderRadius:4, padding:'2px 6px' }}>
                    地主
                  </span>
                ) : null}
              </div>
              <Hand cards={hands[i] || []} />
            </div>
          ))}
        </div>

        <div style={{ borderTop:'1px dashed #eee', marginTop:8, paddingTop:8 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>当前出牌</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {plays.map((p, idx) => (
              <PlayRow key={idx} seat={p.seat} move={p.move} cards={p.cards} reason={p.reason} comboType={p.comboType} />
            ))}
          </div>
        </div>

        <div style={{ display:'flex', gap:12, marginTop:12 }}>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>倍数</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{multiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>胜者</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{winner == null ? '—' : ['甲','乙','丙'][winner]}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>本局加减分</div>
            <div style={{ fontSize:20, fontWeight:700 }}>{delta ? delta.join(' / ') : '—'}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>累计分</div>
            <div style={{ fontSize:20, fontWeight:700 }}>{totals.join(' / ')}</div>
          </div>
        </div>
      </Section>

      {/* 日志 */}
      <Section title="运行日志">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <div style={{ fontWeight:700, marginBottom:6 }}>Live</div>
            <div style={{ border:'1px solid #eee', borderRadius:8, padding:10, height:260, overflow:'auto', background:'#fafafa' }}>
              {liveLog.map((x, i) => <div key={i} style={{ whiteSpace:'pre-wrap' }}>{x}</div>)}
            </div>
          </div>
          <div>
            <div style={{ fontWeight:700, marginBottom:6 }}>事件</div>
            <div style={{ border:'1px solid #eee', borderRadius:8, padding:10, height:260, overflow:'auto', background:'#fafafa' }}>
              {log.map((x, i) => <div key={i} style={{ whiteSpace:'pre-wrap' }}>{x}</div>)}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
