import React, { useEffect, useRef, useState } from 'react';

type Label = string;
type ComboType =
  | 'single' | 'pair' | 'triple' | 'bomb' | 'rocket'
  | 'straight' | 'pair-straight' | 'plane'
  | 'triple-with-single' | 'triple-with-pair'
  | 'four-with-two-singles' | 'four-with-two-pairs';
type Four2Policy = 'both' | '2singles' | '2pairs';

type EventObj =
  | { type:'state'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'init'; landlord:number; hands: Label[][] }   // 兼容部分后端
  | { type:'event'; kind:'play'; seat:number; move:'play'|'pass'; cards?:Label[]; comboType?:ComboType; reason?:string }
  | { type:'event'; kind:'rob'; seat:number; rob:boolean }
  | { type:'event'; kind:'trick-reset' }
  | { type:'event'; kind:'win'; winner:number; multiplier:number; deltaScores:[number,number,number] }
  | { type:'log'; message:string }
  | { type:'progress', phase:'round-start'|'round-end', round:number, ts?:number }
  | { type:'summary', roundsCompleted:number, ts?:number }
  | { type:'ka'; ts:string };  // keep-alive

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type SeatSpec =
  | { choice:'built-in:greedy-max'|'built-in:greedy-min'|'built-in:random-legal' }
  | { choice:'ai:openai'|'ai:gemini'|'ai:grok'|'ai:kimi'|'ai:qwen', apiKey?:string, model?:string }
  | { choice:'http', baseUrl?:string, token?:string };

type Props = {
  rounds: number;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels?: (string|null)[];
  seatKeys?: ({ openai?:string, gemini?:string, grok?:string, kimi?:string, qwen?:string, httpToken?:string, httpBase?:string }|null)[];
  seatDelayMs?: [number,number,number];
  startScore?: number;
  rob?: boolean;
  onTotals?: (t:[number,number,number])=>void;
  onLog?: (lines:string[])=>void;
};

const SUITS = ['♠','♥','♣','♦'] as const;
function rankOf(label:string){
  const l = String(label||'').trim();
  if (l==='X' || l==='x') return l;
  const r = l.replace(/[^\da-zA-Z]/g,'');
  return r.toUpperCase();
}
function decorateHandCycle(raw:string[]):string[] {
  let idx = 0;
  return raw.map(l=>{
    if (l==='X' || l==='x') return l; // 保留大小写：x=小王, X=大王
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(l)}`;
  });
}
function candDecorations(card:string):string[] {
  if (card==='X' || card==='x') return [card];
  const r = rankOf(card);
  return SUITS.map(s=>`${s}${r}`);
}

function SeatTitle({i}:{i:number}){
  return <span>{['甲(地主候选)','乙','丙'][i] || `座位${i}`}</span>;
}
function Section({title, children}:{title:string, children:any}){
  return (
    <div style={{ margin:'12px 0' }}>
      <div style={{ fontWeight:700, margin:'6px 0' }}>{title}</div>
      {children}
    </div>
  );
}
function LogLine({text}:{text:string}){
  return <div style={{ fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', whiteSpace:'pre-wrap' }}>{text}</div>;
}
function PlayRow({seat, move, cards, reason}:{seat:number, move:'play'|'pass', cards?:string[], reason?:string}){
  return (
    <div style={{ display:'flex', gap:8 }}>
      <div style={{ width:24, textAlign:'right' }}>{['甲','乙','丙'][seat]||seat}</div>
      <div style={{ flex:1 }}>
        {move==='pass'
          ? <span>过{reason?`（${reason}）`:''}</span>
          : <span>出：{(cards||[]).join(' ')}</span>}
      </div>
    </div>
  );
}

export default function Home(){
  const [rounds, setRounds] = useState<number>(10);
  const [four2, setFour2] = useState<Four2Policy>('both');
  const [seats, setSeats] = useState<BotChoice[]>(['built-in:greedy-max','built-in:greedy-min','built-in:random-legal']);
  const [seatModels, setSeatModels] = useState<(string|null)[]>([null,null,null]);
  const [seatKeys, setSeatKeys] = useState<any[]>([{}, {}, {}]);
  const [seatDelayMs, setSeatDelayMs] = useState<[number,number,number]>([0,0,0]);
  const [startScore, setStartScore] = useState<number>(0);
  const [rob, setRob] = useState<boolean>(false);

  const [running, setRunning] = useState<boolean>(false);
  const [hands, setHands] = useState<Label[][]>([[],[],[]]);
  const [plays, setPlays] = useState<{ seat:number; move:'play'|'pass'; cards?:string[]; reason?:string }[]>([]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [winner, setWinner] = useState<number|null>(null);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [delta, setDelta] = useState<[number,number,number]|null>(null);
  const [totals, setTotals] = useState<[number,number,number]>([0,0,0]);
  const [log, setLog] = useState<string[]>([]);
  const [finishedCount, setFinishedCount] = useState<number>(0);

  const liveLog = log.slice(-400);

  // keep previous running to reset totals at start of a session
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      const base = startScore || 0;
      setTotals([base, base, base]);
    }
    prevRunningRef.current = running;
  }, [running, startScore]);

  const controllerRef = useRef<AbortController|null>(null);

  // --- Batch ingest state mirrors (for robust chunk processing) ---
  const handsRef = useRef(hands); useEffect(() => { handsRef.current = hands; }, [hands]);
  const playsRef = useRef(plays); useEffect(() => { playsRef.current = plays; }, [plays]);
  const totalsRef = useRef(totals); useEffect(() => { totalsRef.current = totals; }, [totals]);
  const finishedRef = useRef(finishedCount); useEffect(() => { finishedRef.current = finishedCount; }, [finishedCount]);
  const logRef = useRef(log); useEffect(() => { logRef.current = log; }, [log]);
  const landlordRef = useRef(landlord); useEffect(() => { landlordRef.current = landlord; }, [landlord]);
  const winnerRef = useRef(winner); useEffect(() => { winnerRef.current = winner; }, [winner]);
  const deltaRef = useRef(delta); useEffect(() => { deltaRef.current = delta; }, [delta]);
  const multiplierRef = useRef(multiplier); useEffect(() => { multiplierRef.current = multiplier; }, [multiplier]);
  const winsRef = useRef(0); useEffect(() => { winsRef.current = finishedCount; }, [finishedCount]);
  // --- End mirrors ---

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
    winsRef.current = 0;

    controllerRef.current = new AbortController();

    try {
      const r = await fetch('/api/stream_ndjson', {
        method:'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({
          rounds,
          seatDelayMs,
          rob,
          four2,
          seats: seats.map((c, i) => {
            const s:any = { choice:c };
            const m = seatModels?.[i];
            if (m && typeof m==='string') s.model = m;
            const k = seatKeys?.[i]||{};
            if (c.startsWith('ai:')) s.apiKey = k?.openai||k?.gemini||k?.grok||k?.kimi||k?.qwen||'';
            if (c==='http') { s.baseUrl = k?.httpBase||''; s.token = k?.httpToken||''; }
            return s;
          }),
          seatModels,
          seatKeys,
        }),
        signal: controllerRef.current.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';

      const pump = async (): Promise<void> => {
        while (true) {
          const { value, done } = await reader.read();
          if (!done) {
            buf += decoder.decode(value, { stream:true });
          }

          let idx: number;
          const batch: any[] = [];
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            try { batch.push(JSON.parse(line)); } catch {}
          }

          // handle tail at stream end
          if (done) {
            const tail = buf.trim();
            if (tail) { try { batch.push(JSON.parse(tail)); } catch {} }
            buf = '';
          }

          if (batch.length) {
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
                const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);

                // 兜底推进：后端 progress: round-end
                if (m.type === 'progress' && m.phase === 'round-end') {
                  const r = Number(m.round) || 0;
                  if (r > 0) {
                    nextFinished = Math.max(nextFinished, r);
                    if (!winsRef.current || r > winsRef.current) winsRef.current = r;
                  }
                  continue;
                }

                if (hasHands) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  nextMultiplier = 1;
                  const handsRaw: string[][] = rh as string[][];
                  const decorated: string[][] = handsRaw.map(decorateHandCycle);
                  nextHands = decorated;
                  const lord = m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
                  nextLandlord = lord;
                  nextLog = [...nextLog, `发牌完成，${lord!=null?['甲','乙','丙'][lord]:'?'}为地主`];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'rob') {
                  nextLog = [...nextLog, `${['甲','乙','丙'][m.seat]} ${m.rob ? '抢地主' : '不抢'}`];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'trick-reset') {
                  nextLog = [...nextLog, '一轮结束，重新起牌'];
                  nextPlays = [];
                  continue;
                }

                if (m.type === 'event' && m.kind === 'play') {
                  if (m.move === 'pass') {
                    nextPlays = [...nextPlays, { seat:m.seat, move:'pass', reason:m.reason }];
                    nextLog = [...nextLog, `${['甲','乙','丙'][m.seat]} 过${m.reason ? `（${m.reason}）` : ''}`];
                  } else {
                    const pretty: string[] = [];
                    const seat = m.seat as number;
                    const cards: string[] = m.cards || [];
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
                    nextLog = [...nextLog, `${['甲','乙','丙'][m.seat]} 出牌：${pretty.join(' ')}`];
                  }
                  continue;
                }

                if (m.type === 'event' && m.kind === 'win') {
                  nextWinner = m.winner;
                  nextMultiplier = m.multiplier;
                  nextDelta = m.deltaScores;
                  nextLog = [...nextLog, `胜者：${['甲','乙','丙'][m.winner]}，倍数 x${m.multiplier}，当局积分变更 ${m.deltaScores.join(' / ')}`];
                  nextTotals = [ nextTotals[0] + m.deltaScores[0], nextTotals[1] + m.deltaScores[1], nextTotals[2] + m.deltaScores[2] ] as any;
                  nextFinished = nextFinished + 1;
                  winsRef.current = (winsRef.current||0) + 1;
                  continue;
                }

                if (m.type === 'log' && typeof m.message === 'string') {
                  nextLog = [...nextLog, m.message];
                  continue;
                }
              } catch(e) {
                console.error('[ingest:batch]', e, raw);
              }
            }

            // Commit once per chunk
            setHands(nextHands);
            setPlays(nextPlays);
            setTotals(nextTotals);
            setFinishedCount(winsRef.current || nextFinished);
            setLog(nextLog);
            setLandlord(nextLandlord);
            setWinner(nextWinner);
            setMultiplier(nextMultiplier);
            setDelta(nextDelta);
          }

          if (done) break;
        }
      };

      await pump();
    } catch (e:any) {
      if (e?.name === 'AbortError') {
        setLog(l => [...l, '（已停止）']);
      } else {
        setLog(l => [...l, `错误：${e?.message || e}`]);
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    controllerRef.current?.abort();
    setRunning(false);
  };

  const remainingGames = Math.max(0, (rounds || 1) - finishedCount);

  return (
    <div>
      {/* 剩余局数徽标 */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{
          display:'inline-flex', alignItems:'center', gap:6,
          padding:'4px 8px', border:'1px solid #eee', borderRadius:999,
          background:'#f9fafb', fontSize:12, lineHeight:1.2, userSelect:'none'
        }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* 第一行：积分（总分） */}
      <Section title="积分（总分）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div><SeatTitle i={i}/></div>
              <div style={{ fontSize:24, fontWeight:800 }}>{totals[i]}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* 第二行：当局信息 */}
      <Section title="当局信息">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>地主</div>
            <div>{landlord!=null ? ['甲','乙','丙'][landlord] : '（尚未确定）'}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>结果</div>
            <div>
              {winner==null ? '（未结束）' : `胜者：${['甲','乙','丙'][winner]}，倍数 x${multiplier}${delta?`，当局积分变更 ${delta.join(' / ')}`:''}`}
            </div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>控制</div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={start} disabled={running}
                style={{ padding:'6px 10px', borderRadius:6, border:'1px solid #ddd', background: running?'#f3f4f6':'#fff' }}>
                开始
              </button>
              <button onClick={stop} disabled={!running}
                style={{ padding:'6px 10px', borderRadius:6, border:'1px solid #ddd', background: !running?'#f3f4f6':'#fff' }}>
                停止
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* 手牌（仅做演示/对齐 UI） */}
      <Section title="手牌（演示）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div style={{ marginBottom:6 }}><SeatTitle i={i}/></div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {(hands[i]||[]).map((c,idx)=><span key={idx} style={{
                  display:'inline-flex', alignItems:'center', justifyContent:'center',
                  padding:'2px 6px', border:'1px solid #ddd', borderRadius:6, background:'#fff',
                  fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                }}>{c}</span>)}
              </div>
            </div>
          ))}
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

      <Section title="设置">
        <div style={{ border:'1px solid #eee', borderRadius:8, padding:10, display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <label>
            局数
            <input type="number" min={1} max={200} value={rounds}
                   onChange={e=>setRounds(Math.max(1, Math.min(200, Number(e.target.value)||1)))} />
          </label>
          <label>
            起始分
            <input type="number" value={startScore}
                   onChange={e=>setStartScore(Number(e.target.value)||0)} />
          </label>
          <label>
            4带2策略
            <select value={four2} onChange={e=>setFour2(e.target.value as any)}>
              <option value="both">均可</option>
              <option value="2singles">两单</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
          <label>
            抢地主流程
            <input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} />
          </label>

          <div style={{ gridColumn:'1 / -1', marginTop:8 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>每座位延时（ms）</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
              {[0,1,2].map(i=>(
                <label key={i}>
                  {['甲','乙','丙'][i]}：
                  <input type="number" value={seatDelayMs[i]}
                         onChange={e=>{
                           const v = Math.max(0, Number(e.target.value)||0);
                           const n:[number,number,number] = [...seatDelayMs] as any;
                           n[i] = v; setSeatDelayMs(n);
                         }} />
                </label>
              ))}
            </div>
          </div>

          <div style={{ gridColumn:'1 / -1' }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>座位设置</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
                  <div style={{ marginBottom:6 }}><SeatTitle i={i}/></div>
                  <label style={{ display:'block', marginBottom:6 }}>
                    类型
                    <select value={seats[i]} onChange={e=>{
                      const v = e.target.value as BotChoice;
                      setSeats(arr => { const n=[...arr]; n[i]=v; return n; });
                    }}>
                      <option value="built-in:greedy-max">内置 GreedyMax</option>
                      <option value="built-in:greedy-min">内置 GreedyMin</option>
                      <option value="built-in:random-legal">内置 Random</option>
                      <option value="ai:openai">AI: OpenAI</option>
                      <option value="ai:gemini">AI: Gemini</option>
                      <option value="ai:grok">AI: Grok</option>
                      <option value="ai:kimi">AI: Kimi</option>
                      <option value="ai:qwen">AI: Qwen</option>
                      <option value="http">HTTP</option>
                    </select>
                  </label>

                  {(seats[i]||'').startsWith('ai:') && (
                    <>
                      <label style={{ display:'block', marginBottom:6 }}>
                        Model
                        <input type="text" value={seatModels[i]||''}
                               onChange={e=>{
                                 const v = e.target.value;
                                 setSeatModels(arr => { const n=[...arr]; n[i] = v; return n; });
                               }}
                               placeholder="可留空使用默认" style={{ width:'100%' }} />
                      </label>
                      <label style={{ display:'block', marginBottom:6 }}>
                        API Key
                        <input type="password" value={
                          seatKeys[i]?.openai || seatKeys[i]?.gemini || seatKeys[i]?.grok || seatKeys[i]?.kimi || seatKeys[i]?.qwen || ''
                        }
                               onChange={e=>{
                                 const v = e.target.value;
                                 setSeatKeys(arr => {
                                   const n=[...arr];
                                   const prev = n[i]||{};
                                   n[i] = { ...prev, openai:v, gemini:v, grok:v, kimi:v, qwen:v };
                                   return n;
                                 });
                               }}
                               style={{ width:'100%' }} />
                      </label>
                    </>
                  )}

                  {seats[i] === 'http' && (
                    <>
                      <label style={{ display:'block', marginBottom:6 }}>
                        HTTP Base / URL
                        <input type="text" value={seatKeys[i]?.httpBase||''}
                               onChange={e=>{
                                 const v = e.target.value;
                                 setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpBase:v }; return n; });
                               }}
                               placeholder="https://your-bot.example.com" style={{ width:'100%' }} />
                      </label>
                      <label style={{ display:'block', marginBottom:6 }}>
                        Bearer Token
                        <input type="password" value={seatKeys[i]?.httpToken||''}
                               onChange={e=>{
                                 const v = e.target.value;
                                 setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpToken:v }; return n; });
                               }}
                               style={{ width:'100%' }} />
                      </label>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

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
  );
}
