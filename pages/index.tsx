import { useMemo, useState } from 'react';
import { runArenaInBrowser } from '../lib/arenaWeb';
import { ProviderSpec } from '../lib/types';

type PlayerKind = 'builtin'|'openai'|'gemini'|'kimi'|'grok';
type BuiltinName = 'Random'|'GreedyMin'|'GreedyMax';

interface PlayerCfg extends ProviderSpec {
  kind: PlayerKind;
  name?: BuiltinName;
  apiKey?: string;
  timeoutMs?: number;
}

function DownloadButtons({ raw, objects }: { raw: string[], objects: any[] }) {
  const download = (filename: string, content: BlobPart, type='application/octet-stream') => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(()=> URL.revokeObjectURL(url), 0);
  };
  return (
    <div style={{display:'flex', gap:8}}>
      <button onClick={()=>download(`ddz-${Date.now()}.ndjson`, raw.join('\n'),'application/x-ndjson')} disabled={!raw.length}>下载 NDJSON</button>
      <button onClick={()=>download(`ddz-${Date.now()}.json`, JSON.stringify(objects,null,2),'application/json')} disabled={!objects.length}>下载事件 JSON</button>
    </div>
  );
}

export default function Home() {
  const [players, setPlayers] = useState<PlayerCfg[]>([
    { kind:'builtin', name:'GreedyMax' },
    { kind:'builtin', name:'GreedyMin' },
    { kind:'builtin', name:'Random' },
  ]);
  const [rounds, setRounds] = useState(3);
  const [startScore, setStartScore] = useState(10);
  const [delayMs, setDelayMs] = useState(100);
  const [running, setRunning] = useState(false);
  const [ndjson, setNdjson] = useState<string[]>([]);
  const [objs, setObjs] = useState<any[]>([]);
  const [status, setStatus] = useState<string>('');

  const append = (o:any)=>{
    setObjs(prev=>[...prev,o]);
    setNdjson(prev=>[...prev, JSON.stringify(o)]);
  };

  const run = async () => {
    setObjs([]); setNdjson([]);
    setRunning(true); setStatus('');
    try {
      await runArenaInBrowser({
        players,
        rounds,
        startScore,
        delayMs
      }, append);
    } catch (e:any) {
      setStatus('运行错误：' + String(e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  const playerRow = (i:number) => {
    const p = players[i];
    return (
      <div key={i} style={{border:'1px solid #ddd', padding:12, borderRadius:8}}>
        <div><b>{'甲乙丙'[i]}</b></div>
        <div style={{display:'flex', gap:8, alignItems:'center', marginTop:6}}>
          <label>类型</label>
          <select value={p.kind} onChange={e=>{
            const kind = e.target.value as PlayerKind;
            const next = players.slice(); next[i] = { kind, name: kind==='builtin' ? 'GreedyMax' : undefined };
            setPlayers(next);
          }}>
            <option value="builtin">内置</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="kimi">Kimi</option>
            <option value="grok">Grok</option>
          </select>
          {p.kind==='builtin' && (
            <>
              <label>BOT</label>
              <select value={p.name||'GreedyMax'} onChange={e=>{
                const next = players.slice(); next[i] = { ...p, name: e.target.value as BuiltinName };
                setPlayers(next);
              }}>
                <option value="Random">Random</option>
                <option value="GreedyMin">GreedyMin</option>
                <option value="GreedyMax">GreedyMax</option>
              </select>
            </>
          )}
          {p.kind!=='builtin' && (
            <>
              <label>API Key</label>
              <input type="password" placeholder="填入对应API Key" value={p.apiKey||''}
                onChange={e=>{ const next=players.slice(); next[i]={...p,apiKey:e.target.value}; setPlayers(next); }} />
              <label>超时(ms)</label>
              <input type="number" style={{width:100}} value={p.timeoutMs||8000} onChange={e=>{
                const next=players.slice(); next[i]={...p, timeoutMs:Number(e.target.value)}; setPlayers(next);
              }} />
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{padding:24, fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'}}>
      <h1>斗地主 AI Arena</h1>
      <p style={{color:'#666'}}>Next.js + TypeScript（v1.7.1）。支持 内置BOT / OpenAI / Gemini / Kimi / Grok（需在 /api/llm-proxy.ts 接好）。</p>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
        {playerRow(0)}
        {playerRow(1)}
        {playerRow(2)}
      </div>

      <div style={{marginTop:12, display:'flex', gap:16}}>
        <label>局数</label><input type="number" value={rounds} onChange={e=>setRounds(Number(e.target.value||1))} />
        <label>起始分</label><input type="number" value={startScore} onChange={e=>setStartScore(Number(e.target.value||0))} />
        <label>每步延迟(ms)</label><input type="number" value={delayMs} onChange={e=>setDelayMs(Number(e.target.value||0))} />
        <button onClick={run} disabled={running}>{running?'运行中...':'运行'}</button>
      </div>

      <div style={{marginTop:16}}>
        <DownloadButtons raw={ndjson} objects={objs} />
      </div>

      {status && <div style={{marginTop:12, color:'crimson'}}>{status}</div>}

      <div style={{marginTop:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
        <div>
          <h3>事件（NDJSON预览）</h3>
          <pre style={{maxHeight:360, overflow:'auto', background:'#fafafa', padding:12, border:'1px solid #eee'}}>
            {ndjson.join('\n')}
          </pre>
        </div>
        <div>
          <h3>对象事件（调试）</h3>
          <pre style={{maxHeight:360, overflow:'auto', background:'#fafafa', padding:12, border:'1px solid #eee'}}>
            {JSON.stringify(objs,null,2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
