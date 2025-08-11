import { useEffect, useRef, useState } from 'react';

type Scoreboard = { openai:number; kimi:number; grok:number };

function ComboView({combo}:{combo:any}){
  if (!combo) return <em>PASS</em>;
  return <span>{combo.type} — [{(combo.cards||[]).join(' ')}]</span>;
}

export default function Home(){
  const [openai, setOpenai] = useState('');
  const [kimi, setKimi] = useState('');
  const [grok, setGrok] = useState('');
  const [rounds, setRounds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [score, setScore] = useState<Scoreboard|null>(null);
  const [expanded, setExpanded] = useState<number|null>(0);

  // playback states
  const [playIndex, setPlayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<NodeJS.Timeout|null>(null);

  useEffect(()=>()=>{ if (timerRef.current) clearInterval(timerRef.current); }, []);

  async function run(){
    setBusy(true); setLogs([]); setScore(null); setPlayIndex(0); setPlaying(false);
    const r = await fetch('/api/runMatch',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rounds, keys:{ openai, kimi, grok } })});
    const data = await r.json();
    setBusy(false);
    if (data?.ok){ setScore(data.scoreboard); setLogs(data.logs); setExpanded(0); autoPlay(0, data.logs); } else { alert(data?.error||'unknown'); }
  }

  function autoPlay(roundIdx:number, lgs:any[] = logs){
    if (!lgs[roundIdx]) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setExpanded(roundIdx);
    setPlayIndex(0);
    setPlaying(true);
    const steps = lgs[roundIdx].events.filter((e:any)=>e.play || e.forced).length;
    timerRef.current = setInterval(()=>{
      setPlayIndex(prev => {
        if (prev+1 >= steps){
          if (timerRef.current) clearInterval(timerRef.current);
          setPlaying(false);
          return steps-1;
        }
        return prev+1;
      });
    }, 500); // 0.5s
  }

  return (
    <div className="container">
      <h1>🤖 Dou Dizhu — LLM Strategy Match</h1>
      <div className="card">
        <div className="row">
          <div style={{flex:1}}>
            <label className="small">ChatGPT (OpenAI) API Key</label>
            <input className="input" type="password" placeholder="sk-..." value={openai} onChange={e=>setOpenai(e.target.value)} />
          </div>
          <div style={{flex:1}}>
            <label className="small">Kimi (Moonshot) API Key</label>
            <input className="input" type="password" placeholder="sk-..." value={kimi} onChange={e=>setKimi(e.target.value)} />
          </div>
          <div style={{flex:1}}>
            <label className="small">Grok (xAI) API Key</label>
            <input className="input" type="password" placeholder="xaic-..." value={grok} onChange={e=>setGrok(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{marginTop:12}}>
          <div>
            <label className="small">Rounds</label>{' '}
            <select className="select" value={rounds} onChange={e=>setRounds(parseInt(e.target.value))}>
              {[1,3,5,10,20,30,50].map(n=> <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button className="btn" onClick={run} disabled={busy}>
            {busy? 'Running...' : 'Run Match'}
          </button>
          <span className="badge small">0.5s 动态播放 · 显示持牌/出牌/理由</span>
        </div>
      </div>

      {score && (
        <div className="card">
          <h3>Scoreboard</h3>
          <table className="table"><tbody>
            <tr><th>ChatGPT</th><td>{score.openai}</td></tr>
            <tr><th>Kimi</th><td>{score.kimi}</td></tr>
            <tr><th>Grok</th><td>{score.grok}</td></tr>
          </tbody></table>
        </div>
      )}

      {logs.length>0 && (
        <div className="card">
          <h3>对局详情</h3>
          <div className="row">
            {logs.map((g, i)=> (
              <button key={i} className="btn" onClick={()=>autoPlay(i)} disabled={expanded===i && playing} >
                {expanded===i && playing ? '播放中...' : `Round #${g.seed} — 座位: ${g.seats.join(' | ')}`}
              </button>
            ))}
          </div>
          {expanded!=null && logs[expanded] && (
            <div style={{marginTop:12}}>
              <div className="small">本局座位（从地主开始，顺时针）：{logs[expanded].seats.join('  →  ')}</div>
              <div className="row" style={{marginTop:8}}>
                <button className="btn" onClick={()=>autoPlay(expanded!)} disabled={playing}>▶ 重播</button>
                <button className="btn" onClick={()=>{ if (timerRef.current) clearInterval(timerRef.current); setPlaying(false); }}>⏸ 暂停</button>
                <button className="btn" onClick={()=>{ if (timerRef.current) clearInterval(timerRef.current); setPlaying(true); timerRef.current = setInterval(()=>setPlayIndex(p=>p+1),500); }}>▶ 继续</button>
              </div>
              <table className="table" style={{marginTop:8}}>
                <thead><tr>
                  <th>#</th><th>座位</th><th>Provider</th><th>上手</th><th>手牌（出牌前）</th><th>出牌</th><th>理由</th>
                </tr></thead>
                <tbody>
                  {logs[expanded].events.filter((e:any)=>e.play || e.forced).slice(0, playIndex+1).map((e:any, idx:number)=> (
                    <tr key={idx}>
                      <td>{idx+1}</td>
                      <td>{e.who}</td>
                      <td>{e.pv}</td>
                      <td>{e.last ? `${e.last.type} [${(e.last.cards||[]).join(' ')}]` : '-'}</td>
                      <td className="mono">{(e.hand||[]).join(' ')}</td>
                      <td>{e.forced ? <em>PASS (forced)</em> : <ComboView combo={e.play} />}</td>
                      <td className="small">{e.reason||''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="small">结果：{(() => {
                const r = logs[expanded].events.find((x:any)=>x.result);
                return r ? `Winner Seat ${r.result.winnerSeat} — ${r.result.winnerProvider}` : '';
              })()}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
