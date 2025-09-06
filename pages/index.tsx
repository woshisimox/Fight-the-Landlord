import React, { useEffect, useRef, useState } from 'react';

type Seat = 0|1|2;
type Label = string;

// 与后端事件对齐（简化版）
type Event =
  | { type: 'event'; kind: 'meta'; seatProviders: string[] }
  | { type: 'event'; kind: 'deal'; hands: string[][]; bottom: string[] }
  | { type: 'event'; kind: 'lead'; seat: Seat; require?: any }
  | { type: 'event'; kind: 'play'; seat: Seat; move: 'play'|'pass'; cards?: Label[]; comboType?: string; reason?: string; provider?: string }
  | { type: 'event'; kind: 'score'; totals: number[] }
  | { type: 'event'; kind: 'terminated' }
  | { type: 'event'; kind: 'error'; message: string };

type SeatKeys = {
  openai?: string;
  gemini?: string;
  grok?: string;
  kimi?: string;
  httpBase?: string;
  httpToken?: string;
  qwen?: string; // 千问
};

const suitsColor: Record<string, string> = { '♥':'#e53935','♦':'#e53935','♠':'#222','♣':'#222' };

function colorizeCard(c: string) {
  // 兼容纯面值或带花色：如 'A' / 'A♥'
  const m = c.match(/^(.+?)([♥♦♠♣])?$/);
  if (!m) return c as any;
  const rank = m[1];
  const suit = m[2] || '';
  if (!suit) return <span style={{paddingRight:2}}>{rank}</span>;
  return <span style={{paddingRight:2}}><span>{rank}</span><span style={{color: suitsColor[suit]||'#222'}}>{suit}</span></span>;
}

export default function Home() {
  // 控件
  const [rounds, setRounds] = useState(1);
  const [seed, setSeed] = useState(0);
  const [delayMs, setDelayMs] = useState(150);
  const [four2, setFour2] = useState<'both'|'2singles'|'2pairs'>('both');
  const [startScore, setStartScore] = useState(10);

  // 每位玩家的 provider + key
  const [seatProviders, setSeatProviders] = useState<string[]>(['builtin','builtin','builtin']);
  const [seatKeys, setSeatKeys] = useState<SeatKeys[]>([{},{},{}]);

  // 运行时状态
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [totals, setTotals] = useState<number[]>([startScore,startScore,startScore]);
  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [last, setLast] = useState<string[]>(['','','']);
  const [trick, setTrick] = useState<any[]>([]);
  const ctrlAbort = useRef<AbortController|null>(null);

  useEffect(()=>{ setTotals([startScore,startScore,startScore]); }, [startScore]);

  const push = (t: string) => setLines(v=>[...v, t]);

  const start = async () => {
    if (running) return;
    setRunning(true);
    setLines([]);
    setTrick([]);
    setLast(['','','']);
    setHands([[],[],[]]);
    setTotals([startScore,startScore,startScore]);
    try {
      const body = {
        rounds, seed, delayMs, four2, startScore,
        players: seatProviders.join(','), // 兼容旧字段
        seatProviders,
        seatKeys,
      };
      ctrlAbort.current = new AbortController();
      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrlAbort.current.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line) as Event;
            handle(ev);
          } catch (e) {
            push('解析错误：' + (e as any)?.message);
          }
        }
      }
    } catch (e:any) {
      push('连接失败：' + (e?.message || e));
    } finally {
      setRunning(false);
      ctrlAbort.current = null;
    }
  };

  const stop = () => {
    ctrlAbort.current?.abort();
    setRunning(false);
  };

  const handle = (ev: Event) => {
    if (ev.kind === 'meta') {
      push(`对局开始：providers=${(ev as any).seatProviders?.join(', ')}`);
    } else if (ev.kind === 'deal') {
      setHands(ev.hands);
      push(`发牌：底牌 ${(ev.bottom||[]).join('')}`);
    } else if (ev.kind === 'lead') {
      const seatName = ['甲','乙','丙'][ev.seat];
      push(`【回合】${seatName} 领出 ${ev.require? ('需跟:'+ev.require.type+'>'+ev.require.mainRank) : ''}`);
      setTrick([]);
    } else if (ev.kind === 'play') {
      const seatName = ['甲','乙','丙'][ev.seat];
      if (ev.move === 'pass') {
        setLast(v=>{ const n=v.slice(); n[ev.seat] = '过'; return n; });
        push(`【AI:${(ev as any).provider||'-'}】${seatName}：过 — 理由：${ev.reason||'无'}`);
        setTrick(t=>[...t, { seat: ev.seat, action: 'pass' }]);
      } else {
        const cards = (ev.cards||[]).join('');
        setLast(v=>{ const n=v.slice(); n[ev.seat] = cards; return n; });
        push(`【AI:${(ev as any).provider||'-'}】${seatName}：${ev.comboType||'出牌'} ${cards} — 理由：${ev.reason||'无'}`);
        setHands(h=>{
          const nh = h.map(a=>a.slice());
          // 移除刚打出的牌（按 label 匹配，尽力而为）
          for (const c of (ev.cards||[])) {
            const i = nh[ev.seat].indexOf(c);
            if (i >= 0) nh[ev.seat].splice(i,1);
          }
          return nh;
        });
        setTrick(t=>[...t, { seat: ev.seat, action: 'play', cards: ev.cards||[] }]);
      }
    } else if (ev.kind === 'score') {
      setTotals([ev.totals[0], ev.totals[1], ev.totals[2]]);
    } else if (ev.kind === 'terminated') {
      push('对局结束。');
    } else if (ev.kind === 'error') {
      push('错误：' + (ev as any).message);
    }
  };

  return (
    <div style={{fontFamily:'system-ui,-apple-system,Segoe UI,Roboto', padding: 20, maxWidth: 1200, margin:'0 auto'}}>
      <h1>斗地主 · AI 对战（已接入千问/Qwen & 校验 Kimi）</h1>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
        {[0,1,2].map((i)=> (
          <div key={i} style={{border:'1px solid #eee', borderRadius:8, padding:12}}>
            <div style={{fontWeight:700, marginBottom:8}}>玩家 {['甲','乙','丙'][i]}</div>
            <div style={{display:'flex', gap:8, alignItems:'center'}}>
              <label>算法</label>
              <select
                value={seatProviders[i]}
                onChange={e=>{
                  const v = e.target.value;
                  setSeatProviders(prev=>{ const n=prev.slice(); n[i]=v; return n; });
                }}
              >
                <option value="builtin">内建（GreedyMax）</option>
                <option value="max">GreedyMax</option>
                <option value="min">GreedyMin</option>
                <option value="random">Random</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="grok">Grok</option>
                <option value="kimi">Kimi</option>
                <option value="http">HTTP</option>
                <option value="qwen">Qwen（千问）</option>
              </select>
            </div>

            {/* 针对不同 provider 的密钥输入（每位独立） */}
            {seatProviders[i]==='openai' && (
              <div style={{marginTop:8}}>
                <label style={{display:'block', fontSize:12, color:'#666'}}>OpenAI Key</label>
                <input type="password" placeholder="sk-..." value={seatKeys[i]?.openai||''}
                  onChange={e=>setSeatKeys(prev=>{ const n=prev.slice(); n[i]={...(n[i]||{}), openai:e.target.value}; return n; })} style={{width:'100%'}}/>
              </div>
            )}
            {seatProviders[i]==='gemini' && (
              <div style={{marginTop:8}}>
                <label style={{display:'block', fontSize:12, color:'#666'}}>Gemini Key</label>
                <input type="password" placeholder="AIza..." value={seatKeys[i]?.gemini||''}
                  onChange={e=>setSeatKeys(prev=>{ const n=prev.slice(); n[i]={...(n[i]||{}), gemini:e.target.value}; return n; })} style={{width:'100%'}}/>
              </div>
            )}
            {seatProviders[i]==='grok' && (
              <div style={{marginTop:8}}>
                <label style={{display:'block', fontSize:12, color:'#666'}}>Grok Key</label>
                <input type="password" placeholder="xai-..." value={seatKeys[i]?.grok||''}
                  onChange={e=>setSeatKeys(prev=>{ const n=prev.slice(); n[i]={...(n[i]||{}), grok:e.target.value}; return n; })} style={{width:'100%'}}/>
              </div>
            )}
            {seatProviders[i]==='kimi' && (
              <div style={{marginTop:8}}>
                <label style={{display:'block', fontSize:12, color:'#666'}}>Kimi Key</label>
                <input type="password" placeholder="sk-..." value={seatKeys[i]?.kimi||''}
                  onChange={e=>setSeatKeys(prev=>{ const n=prev.slice(); n[i]={...(n[i]||{}), kimi:e.target.value}; return n; })} style={{width:'100%'}}/>
                <div style={{fontSize:12, color:'#999', marginTop:4}}>接口：https://api.moonshot.cn/v1/chat/completions</div>
              </div>
            )}
            {seatProviders[i]==='http' && (
              <div style={{marginTop:8}}>
                <label style={{display:'block', fontSize:12, color:'#666'}}>HTTP Base</label>
                <input placeholder="https://your-proxy.example.com" value={seatKeys[i]?.httpBase||''}
                  onChange={e=>setSeatKeys(prev=>{ const n=prev.slice(); n[i]={...(n[i]||{}), httpBase:e.target.value}; return n; })} style={{width:'100%'}}/>
                <label style={{display:'block', fontSize:12, color:'#666', marginTop:6}}>HTTP Token</label>
                <input type="password" placeholder="Bearer ..." value={seatKeys[i]?.httpToken||''}
                  onChange={e=>setSeatKeys(prev=>{ const n=prev.slice(); n[i]={...(n[i]||{}), httpToken:e.target.value}; return n; })} style={{width:'100%'}}/>
              </div>
            )}
            {seatProviders[i]==='qwen' && (
              <div style={{marginTop:8}}>
                <label style={{display:'block', fontSize:12, color:'#666'}}>Qwen Key</label>
                <input type="password" placeholder="dsk-..." value={seatKeys[i]?.qwen||''}
                  onChange={e=>setSeatKeys(prev=>{ const n=prev.slice(); n[i]={...(n[i]||{}), qwen:e.target.value}; return n; })} style={{width:'100%'}}/>
                <div style={{fontSize:12, color:'#999', marginTop:4}}>接口：/compatible-mode/v1/chat/completions</div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:12, marginTop:16}}>
        <div style={{border:'1px solid #eee', borderRadius:8, padding:12}}>
          <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:8}}>
            <label>轮数</label><input type="number" value={rounds} onChange={e=>setRounds(+e.target.value)} style={{width:100}}/>
            <label>Seed</label><input type="number" value={seed} onChange={e=>setSeed(+e.target.value)} style={{width:120}}/>
            <label>延迟(ms)</label><input type="number" value={delayMs} onChange={e=>setDelayMs(+e.target.value)} style={{width:120}}/>
            <label>四带二</label>
            <select value={four2} onChange={e=>setFour2(e.target.value as any)}>
              <option value="both">可单/对</option>
              <option value="2singles">仅两单</option>
              <option value="2pairs">仅两对</option>
            </select>
            <label>起始分</label><input type="number" value={startScore} onChange={e=>setStartScore(+e.target.value)} style={{width:120}}/>
            {!running ? <button onClick={start}>开始</button> : <button onClick={stop}>停止</button>}
          </div>

          <div style={{fontWeight:700, marginTop:8}}>本轮出牌顺序</div>
          <div style={{whiteSpace:'pre-wrap', background:'#fcfcfc', padding:'6px 8px', border:'1px solid #eee', borderRadius:4}}>
            {trick.length ? trick.map((t,idx)=> (
              <div key={idx} style={{margin:'2px 0'}}>
                <b>{['甲','乙','丙'][t.seat]}：</b>
                {t.action==='pass' ? '过' : (t.cards||[]).map(colorizeCard)}
              </div>
            )) : <span style={{color:'#999'}}>（本轮尚无出牌）</span>}
          </div>

          <div style={{fontWeight:700, marginTop:12}}>事件日志</div>
          <div style={{whiteSpace:'pre-wrap', background:'#fcfcfc', padding:'6px 8px', border:'1px solid #eee', borderRadius:4, minHeight:160}}>
            {lines.length ? lines.join('\n') : '（等待开始）'}
          </div>
        </div>

        <div style={{border:'1px solid #eee', borderRadius:8, padding:12}}>
          <div style={{fontWeight:700}}>玩家状态</div>
          {[0,1,2].map(i=> (
            <div key={i} style={{borderTop:'1px dashed #eee', paddingTop:8, marginTop:8}}>
              <div><b>{['甲','乙','丙'][i]}</b>（{seatProviders[i]}） · 分数：{totals[i]}</div>
              <div>手牌数：{hands[i].length}</div>
              <div>手牌：{hands[i].map(colorizeCard)}</div>
              <div>最近出牌：{last[i] ? last[i].split('').map(colorizeCard) : <span style={{color:'#999'}}>暂无</span>}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
