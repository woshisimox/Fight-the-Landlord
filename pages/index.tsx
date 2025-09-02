import { useState } from 'react';
import { runArenaInMemory } from '../lib/arenaWeb';
import type { RuleConfig } from '../lib/types';

type ProviderKind = 'builtin'|'http'|'openai'|'gemini'|'kimi'|'grok';
type PlayerSpec = {
  kind: ProviderKind;
  name?: 'Random'|'GreedyMin'|'GreedyMax';
  url?: string;
  apiKey?: string;
  headers?: Record<string,string>;
  temperature?: number;
  timeoutMs?: number;
};

function dl(filename: string, content: string){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type:'application/octet-stream'}));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Home(){
  const [players, setPlayers] = useState<PlayerSpec[]>([
    { kind:'builtin', name:'GreedyMin', timeoutMs: 8000 },
    { kind:'builtin', name:'GreedyMax', timeoutMs: 8000 },
    { kind:'builtin', name:'Random', timeoutMs: 8000 },
  ]);
  const [rounds, setRounds] = useState(3);
  const [delayMs, setDelayMs] = useState(200);
  const [startBase, setStartBase] = useState(1);
  const [running, setRunning] = useState(false);
  const [ndjson, setNdjson] = useState<string[]>([]);
  const [objs, setObjs] = useState<any[]>([]);
  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [lastPlay, setLastPlay] = useState<{ seat:number, text:string }|null>(null);
  const [totals, setTotals] = useState<[number,number,number]>([0,0,0]);

  function updatePlayer(i:number, p: Partial<PlayerSpec>){
    const arr = players.slice(); arr[i] = { ...arr[i], ...p }; setPlayers(arr);
  }

  async function run(){
    setRunning(true); setNdjson([]); setObjs([]); setTotals([0,0,0]); setLastPlay(null);
    const rules: RuleConfig = { bidding:'call-score', startBaseScore: startBase };
    await runArenaInMemory(rules, players as any, rounds, delayMs, (line)=>{
      setNdjson(prev=> [...prev, line]);
      try{
        const obj = JSON.parse(line);
        setObjs(prev=> [...prev, obj]);
        if (obj.kind==='deal'){ setHands(obj.hands); }
        if (obj.kind==='play'){
          const who = '甲乙丙'[obj.seat];
          const txt = obj.move==='pass'? `${who} 过（${obj.reason||''}）` : `${who} 出[${obj.comboType}] ${obj.cards?.join(' ')}（${obj.reason||''}）`;
          setLastPlay({ seat: obj.seat, text: txt });
        }
        if (obj.kind==='score' && obj.totals){ setTotals(obj.totals); }
      }catch{}
    });
    setRunning(false);
  }

  return <div style={{padding:20, fontFamily:'system-ui, -apple-system, Segoe UI, Roboto'}}>
    <h1>斗地主 AI Arena（带花色）</h1>
    <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16}}>
      {['甲','乙','丙'].map((name, i)=>(
        <div key={i} style={{border:'1px solid #ddd', borderRadius:8, padding:12}}>
          <div style={{fontWeight:600, marginBottom:8}}>{name} 选手</div>
          <label>类型
            <select value={players[i].kind} onChange={e=>updatePlayer(i,{ kind: e.target.value as ProviderKind })} style={{marginLeft:8}}>
              <option value="builtin">内置</option>
              <option value="http">HTTP</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="kimi">Kimi</option>
              <option value="grok">Grok</option>
            </select>
          </label>
          {players[i].kind==='builtin' && (
            <div style={{marginTop:8}}>
              <label>内置名称
                <select value={players[i].name||'Random'} onChange={e=>updatePlayer(i,{ name: e.target.value as any })} style={{marginLeft:8}}>
                  <option value="Random">Random</option>
                  <option value="GreedyMin">GreedyMin</option>
                  <option value="GreedyMax">GreedyMax</option>
                </select>
              </label>
            </div>
          )}
          {players[i].kind!=='builtin' && (
            <div style={{marginTop:8, display:'grid', gap:6}}>
              <label>API Key<br/>
                <input type="password" placeholder="sk-..." value={players[i].apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} />
              </label>
              {players[i].kind==='http' && (
                <label>HTTP URL<br/>
                  <input placeholder="https://example.com/ai" value={players[i].url||''} onChange={e=>updatePlayer(i,{ url:e.target.value })} />
                </label>
              )}
              <label>超时(ms)<br/>
                <input type="number" value={players[i].timeoutMs||8000} onChange={e=>updatePlayer(i,{ timeoutMs: Number(e.target.value||0) })} />
              </label>
            </div>
          )}
        </div>
      ))}
    </div>

    <div style={{marginTop:12, display:'flex', gap:16, alignItems:'center'}}>
      <label>局数 <input type="number" value={rounds} onChange={e=>setRounds(Number(e.target.value||0))} style={{width:80}} /></label>
      <label>每手间隔(ms) <input type="number" value={delayMs} onChange={e=>setDelayMs(Number(e.target.value||0))} style={{width:100}} /></label>
      <label>起始分 <input type="number" value={startBase} onChange={e=>setStartBase(Number(e.target.value||0))} style={{width:80}} /></label>
      <button onClick={run} disabled={running} style={{padding:'8px 16px'}}>{running? '运行中...' : '开始运行'}</button>
      <button onClick={()=> dl(`ddz-events-${Date.now()}.ndjson`, ndjson.join(''))} disabled={!ndjson.length}>下载 NDJSON</button>
      <button onClick={()=> dl(`ddz-events-${Date.now()}.json`, JSON.stringify(objs,null,2))} disabled={!objs.length}>下载事件 JSON</button>
    </div>

    <div style={{marginTop:16, display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12}}>
      {['甲','乙','丙'].map((n,i)=>(
        <div key={i} style={{border:'1px solid #eee', borderRadius:8, padding:12}}>
          <div style={{fontWeight:600}}>{n} 手牌</div>
          <div style={{marginTop:6, minHeight:24, display:'flex', flexWrap:'wrap', gap:6}}>
            {(hands[i]||[]).map((x,j)=>(<span key={j} style={{padding:'2px 6px', border:'1px solid #ddd', borderRadius:6}}>{x}</span>))}
          </div>
        </div>
      ))}
    </div>

    <div style={{marginTop:16}}>
      <div style={{fontWeight:700}}>最近动作</div>
      <div style={{minHeight:24, marginTop:6}}>{lastPlay?.text||'—'}</div>
    </div>

    <div style={{marginTop:16}}>
      <div style={{fontWeight:700}}>比分（累计）</div>
      <div style={{marginTop:6}}>甲：{totals[0]}　乙：{totals[1]}　丙：{totals[2]}</div>
    </div>

    <div style={{marginTop:16}}>
      <div style={{fontWeight:700}}>事件日志</div>
      <pre style={{whiteSpace:'pre-wrap', background:'#fafafa', padding:12, border:'1px solid #eee', borderRadius:8, maxHeight:320, overflow:'auto'}}>
        {ndjson.join('')}
      </pre>
    </div>
  </div>;
}
