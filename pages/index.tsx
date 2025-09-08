import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

type Label = string;
type ComboType =
  | 'single' | 'pair' | 'triple' | 'bomb' | 'rocket'
  | 'straight' | 'pair-straight' | 'plane'
  | 'triple-with-single' | 'triple-with-pair'
  | 'four-with-two-singles' | 'four-with-two-pairs';
type Four2Policy = 'both' | '2singles' | '2pairs';

type EventObj =
  | { type:'state'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'play'; seat:number; move:'play'|'pass'; cards?:Label[]; comboType?:ComboType; reason?:string }
  | { type:'event'; kind:'rob'; seat:number; rob:boolean }
  | { type:'event'; kind:'trick-reset' }
  | { type:'event'; kind:'win'; winner:number; multiplier:number; deltaScores:[number,number,number] }
  | { type:'log';  message:string };

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
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
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
};

// 游戏状态接口
interface GameState {
  hands: string[][];
  landlord: number | null;
  plays: { seat: number; move: 'play' | 'pass'; cards?: string[]; reason?: string }[];
  multiplier: number;
  winner: number | null;
  delta: [number, number, number] | null;
  totals: [number, number, number];
  finishedCount: number;
  log: string[];
}

function SeatTitle({ i }: { i:number }) {
  return <span style={{ fontWeight:700 }}>{['甲','乙','丙'][i]}</span>;
}

/* ---------- 花色渲染（前端显示专用） ---------- */
type SuitSym = '♠'|'♥'|'♦'|'♣'|'🃏';
const SUITS: SuitSym[] = ['♠','♥','♦','♣'];

const rankOf = (l: string) => {
  if (!l) return '';
  const c0 = l[0];
  if ('♠♥♦♣'.includes(c0)) return l.slice(1).replace(/10/i, 'T').toUpperCase();
  if (c0 === '🃏') return (l.slice(2) || 'X').replace(/10/i, 'T').toUpperCase();
  return l.replace(/10/i, 'T').toUpperCase();
};

function candDecorations(l: string): string[] {
  if (!l) return [];
  if (l === 'x') return ['🃏X'];  // 小王
  if (l === 'X') return ['🃏Y'];  // 大王
  if (l.startsWith('🃏')) return [l];
  if ('♠♥♦♣'.includes(l[0])) return [l];
  const r = rankOf(l);
  if (r === 'JOKER') return ['🃏Y'];
  return SUITS.map(s => `${s}${r}`);
}

function decorateHandCycle(raw: string[]): string[] {
  let idx = 0;
  return raw.map(l => {
    if (!l) return l;
    if (l === 'x') return '🃏X';
    if (l === 'X') return '🃏Y';
    if (l.startsWith('🃏')) return l;
    if ('♠♥♦♣'.includes(l[0])) return l;
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(l)}`;
  });
}

function Card({ label }: { label:string }) {
  const suit = label.startsWith('🃏') ? '🃏' : label.charAt(0);
  const baseColor = (suit === '♥' || suit === '♦') ? '#af1d22' : '#1a1a1a';
  const rank = label.startsWith('🃏') ? (label.slice(2) || '') : label.slice(1);
  const rankColor = suit === '🃏' ? (rank === 'Y' ? '#d11' : '#16a34a') : undefined;
  
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

function Hand({ cards }: { cards: string[] }) {
  if (!cards || !cards.length) return <span style={{ opacity:0.6 }}>（空）</span>;
  return (
    <div style={{ display:'flex', flexWrap:'wrap' }}>
      {cards.map((c, idx) => <Card key={`${c}-${idx}`} label={c} />)}
    </div>
  );
}

function PlayRow({ seat, move, cards, reason }: { 
  seat:number; 
  move:'play'|'pass'; 
  cards?:string[]; 
  reason?:string 
}) {
  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', padding:'6px 0' }}>
      <div style={{ width:32, textAlign:'right', opacity:0.8 }}>
        {['甲','乙','丙'][seat]}
      </div>
      <div style={{ width:56, fontWeight:700 }}>
        {move === 'pass' ? '过' : '出牌'}
      </div>
      <div style={{ flex:1 }}>
        {move === 'pass' ? (
          <span style={{ opacity:0.6 }}>过</span>
        ) : (
          <Hand cards={cards || []} />
        )}
      </div>
      {reason && (
        <div style={{ width:220, fontSize:12, color:'#666' }}>
          {reason}
        </div>
      )}
    </div>
  );
}

function LogLine({ text }: { text:string }) {
  return (
    <div style={{
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize:12, color:'#555', padding:'2px 0'
    }}>
      {text}
    </div>
  );
}

function Section({ title, children }:{title:string; children:React.ReactNode}) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

/* ==================== 优化后的LivePanel ==================== */
function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);
  const [gameState, setGameState] = useState<GameState>({
    hands: [[], [], []],
    landlord: null,
    plays: [],
    multiplier: 1,
    winner: null,
    delta: null,
    totals: [props.startScore || 0, props.startScore || 0, props.startScore || 0],
    finishedCount: 0,
    log: []
  });

  const controllerRef = useRef<AbortController | null>(null);

  // 初始化总分
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (running && !prevRunningRef.current) {
      const base = props.startScore || 0;
      setGameState(prev => ({ ...prev, totals: [base, base, base] }));
    }
    prevRunningRef.current = running;
  }, [running, props.startScore]);

  // 回调通知
  useEffect(() => {
    props.onTotals?.(gameState.totals);
  }, [gameState.totals, props]);

  useEffect(() => {
    props.onLog?.(gameState.log);
  }, [gameState.log, props]);

  // 优化的事件处理函数
  const processEvent = useCallback((event: any): Partial<GameState> | null => {
    try {
      // 处理初始化事件
      const rh = event.hands ?? event.payload?.hands ?? event.state?.hands ?? event.init?.hands;
      const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);

      if (hasHands) {
        const handsRaw: string[][] = rh as string[][];
        const decorated: string[][] = handsRaw.map(decorateHandCycle);
        const lord = event.landlord ?? event.payload?.landlord ?? event.state?.landlord ?? event.init?.landlord ?? null;
        
        return {
          hands: decorated,
          landlord: lord,
          plays: [],
          winner: null,
          delta: null,
          multiplier: 1,
          log: [`发牌完成，${lord != null ? ['甲','乙','丙'][lord] : '?'}为地主`]
        };
      }

      // 处理抢地主事件
      if (event.type === 'event' && event.kind === 'rob') {
        return {
          log: [`${['甲','乙','丙'][event.seat]} ${event.rob ? '抢地主' : '不抢'}`]
        };
      }

      // 处理回合重置
      if (event.type === 'event' && event.kind === 'trick-reset') {
        return {
          log: ['一轮结束，重新起牌'],
          plays: []
        };
      }

      // 处理出牌事件
      if (event.type === 'event' && event.kind === 'play') {
        if (event.move === 'pass') {
          const newPlay = { 
            seat: event.seat, 
            move: 'pass' as const, 
            reason: event.reason 
          };
          const logMsg = `${['甲','乙','丙'][event.seat]} 过${event.reason ? `（${event.reason}）` : ''}`;
          
          return {
            plays: [newPlay],
            log: [logMsg]
          };
        } else {
          const seat = event.seat as number;
          const cards: string[] = event.cards || [];
          const pretty: string[] = [];
          
          // 更新手牌需要在状态更新中处理，这里先返回出牌信息
          for (const rawCard of cards) {
            const options = candDecorations(rawCard);
            pretty.push(options[0]); // 简化处理，使用第一个选项
          }
          
          const newPlay = { 
            seat: event.seat, 
            move: 'play' as const, 
            cards: pretty 
          };
          const logMsg = `${['甲','乙','丙'][event.seat]} 出牌：${pretty.join(' ')}`;
          
          return {
            plays: [newPlay],
            log: [logMsg],
            // 标记需要更新手牌
            _updateHands: { seat, cards: pretty }
          };
        }
      }

      // 处理胜利事件
      if (event.type === 'event' && event.kind === 'win') {
        const logMsg = `胜者：${['甲','乙','丙'][event.winner]}，倍数 x${event.multiplier}，当局积分变更 ${event.deltaScores.join(' / ')}`;
        
        return {
          winner: event.winner,
          multiplier: event.multiplier,
          delta: event.deltaScores,
          log: [logMsg],
          finishedCount: 1, // 增量
          totals: event.deltaScores // 增量
        };
      }

      // 处理日志事件
      if (event.type === 'log' && typeof event.message === 'string') {
        return {
          log: [event.message]
        };
      }

      return null;
    } catch (e) {
      console.error('[processEvent]', e, event);
      return null;
    }
  }, []);

  // 批处理状态更新
  const updateGameState = useCallback((updates: Array<Partial<GameState> & { _updateHands?: any }>) => {
    setGameState(prevState => {
      let newState = { ...prevState };
      
      for (const update of updates) {
        if (!update) continue;
        
        // 处理特殊的手牌更新
        if (update._updateHands) {
          const { seat, cards } = update._updateHands;
          const newHands = newState.hands.map((hand, idx) => {
            if (idx === seat) {
              // 简化手牌更新逻辑
              const newHand = [...hand];
              for (const card of cards) {
                const index = newHand.findIndex(c => {
                  const options = candDecorations(card);
                  return options.includes(c);
                });
                if (index >= 0) {
                  newHand.splice(index, 1);
                }
              }
              return newHand;
            }
            return hand;
          });
          newState.hands = newHands;
          delete update._updateHands;
        }
        
        // 处理数组类型的增量更新
        if (update.log) {
          newState.log = [...newState.log, ...update.log];
          // 限制日志长度，防止内存泄漏
          if (newState.log.length > 1000) {
            newState.log = newState.log.slice(-500);
          }
        }
        
        if (update.plays) {
          if (update.plays.length === 0) {
            newState.plays = [];
          } else {
            newState.plays = [...newState.plays, ...update.plays];
            // 限制出牌记录长度
            if (newState.plays.length > 100) {
              newState.plays = newState.plays.slice(-50);
            }
          }
        }
        
        if (update.totals) {
          newState.totals = [
            newState.totals[0] + update.totals[0],
            newState.totals[1] + update.totals[1],
            newState.totals[2] + update.totals[2]
          ] as [number, number, number];
        }
        
        if (update.finishedCount) {
          newState.finishedCount += update.finishedCount;
        }
        
        // 处理其他简单更新
        Object.keys(update).forEach(key => {
          if (!['log', 'plays', 'totals', 'finishedCount', '_updateHands'].includes(key)) {
            (newState as any)[key] = (update as any)[key];
          }
        });
      }
      
      return newState;
    });
  }, []);

  const start = async () => {
    if (running) return;
    
    setRunning(true);
    setGameState({
      hands: [[], [], []],
      landlord: null,
      plays: [],
      multiplier: 1,
      winner: null,
      delta: null,
      totals: [props.startScore || 0, props.startScore || 0, props.startScore || 0],
      finishedCount: 0,
      log: []
    });

    controllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rounds: props.rounds,
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

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        const batch: any[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          try {
            batch.push(JSON.parse(trimmed));
          } catch (e) {
            console.warn('[JSON parse error]', e, trimmed);
          }
        }

        if (batch.length > 0) {
          // 处理批量事件
          const updates = batch
            .map(event => processEvent(event))
            .filter(Boolean) as Array<Partial<GameState> & { _updateHands?: any }>;
          
          if (updates.length > 0) {
            updateGameState(updates);
          }
        }

        // 让出控制权，防止UI阻塞
        await new Promise(resolve => setTimeout(resolve, 0));
      }

    } catch (e: any) {
      if (e?.name === 'AbortError') {
        updateGameState([{ log: ['已手动停止。'] }]);
      } else {
        updateGameState([{ log: [`错误：${e?.message || e}`] }]);
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setRunning(false);
  }, []);

  // 计算剩余局数
  const remainingGames = useMemo(() => {
    return Math.max(0, (props.rounds || 1) - gameState.finishedCount);
  }, [props.rounds, gameState.finishedCount]);

  return (
    <div>
      {/* 剩余局数徽标 */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ 
          display:'inline-flex', 
          alignItems:'center', 
          padding:'6px 10px', 
          border:'1px solid #e5e7eb', 
          borderRadius:8, 
          fontSize:12, 
          lineHeight:1.2, 
          userSelect:'none', 
          background:'#fff' 
        }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* 积分（总分） */}
      <Section title="积分（总分）">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
              <div><SeatTitle i={i}/></div>
              <div style={{ fontSize:24, fontWeight:800 }}>{gameState.totals[i]}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="手牌">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:8 }}>
              <div style={{ marginBottom:6 }}>
                <SeatTitle i={i} /> 
                {gameState.landlord === i && (
                  <span style={{ marginLeft:6, color:'#bf7f00' }}>（地主）</span>
                )}
              </div>
              <Hand cards={gameState.hands[i]} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="出牌">
        <div style={{ border:'1px dashed #eee', borderRadius:8, padding:'6px 8px' }}>
          {gameState.plays.length === 0 ? (
            <div style={{ opacity:0.6 }}>（尚无出牌）</div>
          ) : (
            gameState.plays.map((p, idx) => (
              <PlayRow 
                key={`${p.seat}-${idx}`} 
                seat={p.seat} 
                move={p.move} 
                cards={p.cards} 
                reason={p.reason} 
              />
            ))
          )}
        </div>
      </Section>

      <Section title="结果">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>倍数</div>
            <div style={{ fontSize:24, fontWeight:800 }}>{gameState.multiplier}</div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>胜者</div>
            <div style={{ fontSize:24, fontWeight:800 }}>
              {gameState.winner == null ? '—' : ['甲','乙','丙'][gameState.winner]}
            </div>
          </div>
          <div style={{ border:'1px solid #eee', borderRadius:8, padding:10 }}>
            <div>本局加减分</div>
            <div style={{ fontSize:20, fontWeight:700 }}>
              {gameState.delta ? gameState.delta.join(' / ') : '—'}
            </div>
          </div>
        </div>
      </Section>

      <div style={{ display:'flex', gap:8 }}>
        <button 
          onClick={start} 
          disabled={running}
          style={{ 
            padding:'8px 12px', 
            borderRadius:8, 
            background: running ? '#ccc' : '#222', 
            color:'#fff',
            cursor: running ? 'not-allowed' : 'pointer'
          }}
        >
          开始
        </button>
        <button 
          onClick={stop} 
          disabled={!running}
          style={{ 
            padding:'8px 12px', 
            borderRadius:8,
            cursor: !running ? 'not-allowed' : 'pointer'
          }}
        >
          停止
        </button>
      </div>
    </div>
  );
}

/* ==================== 主页面 ==================== */
export default function Home() {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [rounds, setRounds] = useState<number>(10);
  const [startScore, setStartScore] = useState<number>(100);
  const [rob, setRob] = useState<boolean>(true);
  const [four2, setFour2] = useState<'both'|'2singles'|'2pairs'>('both');

  const [seatDelayMs, setSeatDelayMs] = useState<number[]>([1000, 1000, 1000]);
  const setSeatDelay = (i:number, v:number|string) =>
    setSeatDelayMs(arr => { const n=[...arr]; n[i] = Math.max(0, Math.floor(Number(v) || 0)); return n; });

  const [seats, setSeats] = useState<BotChoice[]>([
    'built-in:greedy-max',
    'built-in:greedy-min',
    'built-in:random-legal',
  ]);
  const [seatModels, setSeatModels] = useState<string[]>(['gpt-4o-mini', 'gemini-1.5-flash', 'grok-2-latest']);
  const [seatKeys, setSeatKeys] = useState<
    { openai?:string; gemini?:string; grok?:string; kimi?:string; qwen?:string; httpBase?:string; httpToken?:string; }[]
  >([
    { openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }
  ]);

  const [liveLog, setLiveLog] = useState<string[]>([]);

  return (
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Bot Arena</h1>

      {/* 1) 对局设置 */}
      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:6 }}>对局设置</div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:12 }}>
          <label>
            启用对局
            <div><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /></div>
          </label>

          <label>
            局数
            <input
              type="number" min={1} step={1} value={rounds}
              onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||1)))}
              style={{ width:'100%' }}
            />
          </label>

          <label>
            初始分
            <input type="number" step={10} value={startScore}
                   onChange={e=>setStartScore(Number(e.target.value)||0)}
                   style={{ width:'100%' }} />
          </label>

          <label>
            可抢地主
            <div><input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} /></div>
          </label>

          <label>
            4带2 规则
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{ width:'100%' }}>
              <option value="both">都可</option>
              <option value="2singles">两张单牌</option>
              <option value="2pairs">两对</option>
            </select>
          </label>
        </div>

        {/* 每家 AI 设置（独立） */}
        <div style={{ marginTop:10, borderTop:'1px dashed #eee', paddingTop:10 }}>
          <div style={{ fontWeight:700, marginBottom:6 }}>每家 AI 设置（独立）</div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
            {[0,1,2].map(i=>(
              <div key={i} style={{ border:'1px dashed #ccc', borderRadius:8, padding:10 }}>
                <div style={{ fontWeight:700, marginBottom:8 }}><SeatTitle i={i} /></div>

                <label style={{ display:'block', marginBottom:6 }}>
                  选择
                  <select
                    value={seats[i]}
                    onChange={e=>{
                      const v = e.target.value as BotChoice;
                      setSeats(arr => { const n=[...arr]; n[i] = v; return n; });
                    }}
                    style={{ width:'100%' }}
                  >
                    <optgroup label="内置">
                      <option value="built-in:greedy-max">Greedy Max</option>
                      <option value="built-in:greedy-min">Greedy Min</option>
                      <option value="built-in:random-legal">Random Legal</option>
                    </optgroup>
                    <optgroup label="AI">
                      <option value="ai:openai">OpenAI</option>
                      <option value="ai:gemini">Gemini</option>
                      <option value="ai:grok">Grok</option>
                      <option value="ai:kimi">Kimi</option>
                      <option value="ai:qwen">Qwen</option>
                      <option value="http">HTTP</option>
                    </optgroup>
                  </select>
                </label>

                {seats[i].startsWith('ai:') && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    模型（可选）
                    <input type="text" value={seatModels[i]||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatModels(arr => { const n=[...arr]; n[i] = v; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {/* 各家 key/端点 */}
                {seats[i] === 'ai:openai' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    OpenAI API Key
                    <input type="password" value={seatKeys[i]?.openai||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), openai:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:gemini' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Gemini API Key
                    <input type="password" value={seatKeys[i]?.gemini||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), gemini:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:grok' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    xAI (Grok) API Key
                    <input type="password" value={seatKeys[i]?.grok||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), grok:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:kimi' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Kimi API Key
                    <input type="password" value={seatKeys[i]?.kimi||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), kimi:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
                )}

                {seats[i] === 'ai:qwen' && (
                  <label style={{ display:'block', marginBottom:6 }}>
                    Qwen API Key
                    <input type="password" value={seatKeys[i]?.qwen||''}
                           onChange={e=>{
                             const v = e.target.value;
                             setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), qwen:v }; return n; });
                           }}
                           style={{ width:'100%' }} />
                  </label>
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
                             style={{ width:'100%' }} />
                    </label>
                    <label style={{ display:'block', marginBottom:6 }}>
                      HTTP Token（可选）
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

          {/* 每家出牌最小间隔（独立） */}
          <div style={{ marginTop:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>每家出牌最小间隔 (ms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <div key={i} style={{ border:'1px dashed #eee', borderRadius:6, padding:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8 }}>{['甲','乙','丙'][i]}</div>
                  <label style={{ display:'block' }}>
                    最小间隔 (ms)
                    <input
                      type="number" min={0} step={100}
                      value={seatDelayMs[i]}
                      onChange={e=>setSeatDelay(i, e.target.value)}
                      style={{ width:'100%' }}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2) 对局（设置下面、运行日志上面） */}
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

      {/* 3) 运行日志（页面底部） */}
      <div style={{ marginTop:18 }}>
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