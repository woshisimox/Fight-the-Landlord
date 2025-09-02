import { useState } from 'react';

type Resp = {
  ok: boolean;
  totals: [number,number,number];
  logs: any[];
};

export default function Home() {
  const [rounds, setRounds] = useState(1);
  const [data, setData] = useState<Resp|null>(null);
  const [busy, setBusy] = useState(false);

  const run = async ()=>{
    setBusy(true);
    setData(null);
    try {
      const r = await fetch(`/api/arena?rounds=${rounds}`);
      const j:Resp = await r.json();
      setData(j);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{padding:24, fontFamily:'system-ui, sans-serif'}}>
      <h1>斗地主（带花色） - 最小完整包</h1>
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <label>局数：</label>
        <input type="number" value={rounds} min={1} max={5} onChange={e=>setRounds(Number(e.target.value)||1)} />
        <button onClick={run} disabled={busy}>{busy?'运行中…':'运行'}</button>
      </div>

      {data && (
        <div style={{marginTop:16}}>
          <h3>累计分：甲 {data.totals[0]} ｜ 乙 {data.totals[1]} ｜ 丙 {data.totals[2]}</h3>
          {data.logs.map((log, idx)=>(
            <div key={idx} style={{border:'1px solid #ddd', borderRadius:8, padding:12, marginTop:12}}>
              <div>第 {log.round+1} 局 ｜ 地主：{'甲乙丙'[log.landlord]} ｜ 本局得分：[{log.scores.join(', ')}]</div>
              <details style={{marginTop:8}}>
                <summary>事件明细</summary>
                <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(log.events, null, 2)}</pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
