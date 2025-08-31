import { useState } from 'react';

export default function Home() {
  const [rounds, setRounds] = useState(10);
  const [seed, setSeed] = useState(42);
  const [rob, setRob] = useState(false);
  const [four2, setFour2] = useState<'both'|'2singles'|'2pairs'>('both');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);

  async function run() {
    setLoading(true);
    setResp(null);
    try {
      const q = new URLSearchParams({ rounds: String(rounds), seed: String(seed), rob: String(rob), four2 });
      const r = await fetch('/api/arena?' + q.toString());
      const j = await r.json();
      setResp(j);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{fontFamily:'system-ui, -apple-system, Segoe UI, Roboto', padding: 20, maxWidth: 960, margin:'0 auto'}}>
      <h1>斗地主 AI 比赛 · 甲/乙/丙</h1>
      <p>基于你提供的规则实现（叫分制/抢地主制、四带二两种等）。选择参数后点击“运行”。</p>

      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap: 12, alignItems:'end', marginTop: 12}}>
        <label>局数<br/>
          <input type="number" value={rounds} min={1} onChange={e=>setRounds(Number(e.target.value))} />
        </label>
        <label>随机种子<br/>
          <input type="number" value={seed} onChange={e=>setSeed(Number(e.target.value))} />
        </label>
        <label>抢地主制<br/>
          <input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} />
        </label>
        <label>四带二<br/>
          <select value={four2} onChange={e=>setFour2(e.target.value as any)}>
            <option value="both">两种都允许</option>
            <option value="2singles">只允许两单</option>
            <option value="2pairs">只允许两对</option>
          </select>
        </label>
      </div>

      <button onClick={run} disabled={loading} style={{marginTop:16,padding:'8px 16px'}}>
        {loading ? '运行中…' : '运行'}
      </button>

      {resp && (
        <div style={{marginTop:24}}>
          <h2>结果</h2>
          <p>总局数：{resp.rounds}；总分：甲 {resp.totals[0]} / 乙 {resp.totals[1]} / 丙 {resp.totals[2]}</p>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th style={{borderBottom:'1px solid #ccc'}}>#</th>
                <th style={{borderBottom:'1px solid #ccc'}}>地主</th>
                <th style={{borderBottom:'1px solid #ccc'}}>赢家</th>
                <th style={{borderBottom:'1px solid #ccc'}}>倍数</th>
                <th style={{borderBottom:'1px solid #ccc'}}>炸弹</th>
                <th style={{borderBottom:'1px solid #ccc'}}>王炸</th>
                <th style={{borderBottom:'1px solid #ccc'}}>春天</th>
                <th style={{borderBottom:'1px solid #ccc'}}>甲分</th>
                <th style={{borderBottom:'1px solid #ccc'}}>乙分</th>
                <th style={{borderBottom:'1px solid #ccc'}}>丙分</th>
              </tr>
            </thead>
            <tbody>
              {resp.logs.map((l:any, i:number)=> (
                <tr key={i}>
                  <td style={{borderBottom:'1px solid #eee'}}>{i+1}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{['甲','乙','丙'][l.landlord]}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.winner==='landlord'?'地主':'农民'}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.finalMultiplier}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.bombs}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.rocket}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.spring}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.scores[0]}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.scores[1]}</td>
                  <td style={{borderBottom:'1px solid #eee'}}>{l.scores[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{marginTop:16}}>
            <summary>展开查看首局日志示例</summary>
            <pre style={{whiteSpace:'pre-wrap', background:'#f7f7f7', padding:12, border:'1px solid #eee'}}>{JSON.stringify(resp.logs[0], null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
