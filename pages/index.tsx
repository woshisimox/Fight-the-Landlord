import { useState } from 'react';

type Scoreboard = { openai:number; kimi:number; grok:number };

export default function Home(){
  const [openai, setOpenai] = useState('');
  const [kimi, setKimi] = useState('');
  const [grok, setGrok] = useState('');
  const [rounds, setRounds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<any>(null);
  const [score, setScore] = useState<Scoreboard|null>(null);

  async function run(){
    setBusy(true); setLog(null); setScore(null);
    const r = await fetch('/api/runMatch',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ rounds, keys:{ openai, kimi, grok } })});
    const data = await r.json();
    setBusy(false);
    if (data?.ok){ setScore(data.scoreboard); setLog(data.logs); } else { alert(data?.error||'unknown'); }
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
          <span className="badge small">已支持：单张/对子/三张/三带一/三带二/顺子/连对/飞机/飞机带翅/炸弹/火箭</span>
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

      {log && (
        <div className="card">
          <h3>Logs</h3>
          <details open>
            <summary>展开/折叠</summary>
            <pre className="mono" style={{maxHeight: 480, overflow:'auto'}}>{JSON.stringify(log, null, 2)}</pre>
          </details>
        </div>
      )}

      <div className="card">
        <h3>提示词(核心)</h3>
        <pre className="mono" style={{whiteSpace:'pre-wrap'}}>
{`你是斗地主出牌助手。
你的手牌(以空格分隔): <HAND>
局面(JSON): <SNAPSHOT>
任务:
1) 在【SINGLE/PAIR/TRIPLE/TRIPLE_WITH_SINGLE/TRIPLE_WITH_PAIR/STRAIGHT/CONSECUTIVE_PAIRS/AIRPLANE/AIRPLANE_SINGLE/AIRPLANE_PAIR/BOMB】这些类型内选择，且必须来自你的手牌。
2) 必须要能压过上一手(若有)；若无法压过，返回空数组表示PASS。
3) 严格输出JSON: {"cards":["..."],"reason":"..."}`}
        </pre>
      </div>
    </div>
  );
}
