import { useRef, useState } from 'react';
import { runArenaInMemory } from '../lib/arenaWeb';
import type { PlayerSpec } from '../lib/arenaWeb';
import type { RuleConfig } from '../lib/types';
type Seat = 0|1|2;
const builtinOptions = ['Random','GreedyMin','GreedyMax'] as const;
type BuiltinName = typeof builtinOptions[number];
type UIPlayer = (
  | { kind:'builtin', name:BuiltinName }
  | { kind:'http', url:string, apiKey?:string, timeoutMs?:number }
  | { kind:'openai'|'gemini'|'kimi'|'grok', model?:string, apiKey?:string, timeoutMs?:number }
) & { apiKey?:string, timeoutMs?:number };
function toSpec(p: UIPlayer): PlayerSpec { return p as any; }
function download(filename:string, content:string, mime='application/octet-stream'){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: mime })); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }
export default function Home() {
  const [rounds, setRounds] = useState(3); const [baseScore, setBaseScore] = useState(3); const [delayMs, setDelayMs] = useState(200);
  const [players, setPlayers] = useState<UIPlayer[]>([{ kind:'builtin', name:'GreedyMin' },{ kind:'builtin', name:'GreedyMax' },{ kind:'builtin', name:'Random' },]);
  const [hands, setHands] = useState<string[][]>([[],[],[]]); const [bottom, setBottom] = useState<string[]>([]);
  const [landlord, setLandlord] = useState<Seat|null>(null); const [lastPlay, setLastPlay] = useState<{ seat: Seat, text: string } | null>(null);
  const [totals, setTotals] = useState<[number,number,number]>([0,0,0]); const [stream, setStream] = useState<string[]>([]); const [objs, setObjs] = useState<any[]>([]);
  const runningRef = useRef(false);
  function updatePlayer(i:number, patch: Partial<UIPlayer>){ const arr = players.slice(); arr[i] = { ...arr[i], ...patch } as any; setPlayers(arr); }
  async function onRun(){ if (runningRef.current) return; runningRef.current = true; setStream([]); setObjs([]); setHands([[],[],[]]); setBottom([]); setLandlord(null); setLastPlay(null); setTotals([0,0,0]);
    const rules: RuleConfig = { bidding:'call-score', baseScore, playDelayMs: delayMs }; const specs: [PlayerSpec,PlayerSpec,PlayerSpec] = [ toSpec(players[0]), toSpec(players[1]), toSpec(players[2]) ] as any;
    const pushLine = (obj:any)=>{ setObjs(prev => [...prev, obj]); setStream(prev => [...prev, JSON.stringify(obj)]);
      if (obj.type==='event'){ const ev = obj as any; switch (ev.kind){
          case 'deal': setHands(ev.hands.map((h:string[])=>h.map(String))); setBottom(ev.bottom); break;
          case 'landlord': setLandlord(ev.landlord); break;
          case 'play': if (ev.move==='pass') setLastPlay({ seat: ev.seat, text: `过（${ev.reason||''}）` }); else setLastPlay({ seat: ev.seat, text: `${ev.comboType}：${(ev.cards||[]).join(' ')}` }); break;
          case 'turn': break; case 'finish': break; } if (ev.kind==='deal') setStream(prev => [...prev, '-----']); if (ev.kind==='score' && Array.isArray(ev.totals)) setTotals(ev.totals); } };
    pushLine({ type:'event', stage:'ready' }); const result = await runArenaInMemory(rounds, rules, specs, pushLine); pushLine({ type:'event', stage:'done', result }); runningRef.current = false; }
  return (<div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1>斗地主 AI Arena（带花色 / 单对炸火）</h1>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
        {[0,1,2].map(i=>{ const p = players[i] as any; return (
          <div key={i} style={{ border:'1px solid #ddd', borderRadius:8, padding:12 }}>
            <b>{'甲乙丙'[i]}（座位 {i}）</b>
            <div style={{ marginTop:8 }}><label>类型：</label>
              <select value={p.kind} onChange={e=>updatePlayer(i, { kind: e.target.value as any })}>
                <option value="builtin">内置</option><option value="http">HTTP</option><option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option><option value="kimi">Kimi</option><option value="grok">Grok</option>
              </select></div>
            {p.kind==='builtin' && (<div style={{ marginTop:8 }}><label>内置策略：</label>
              <select value={p.name} onChange={e=>updatePlayer(i, { name: e.target.value as any })}>
                {builtinOptions.map(n=><option key={n} value={n}>{n}</option>)}
              </select></div>)}
            {p.kind==='http' && (<>
              <div style={{ marginTop:8 }}><label>URL</label><br/>
                <input style={{width:'100%'}} placeholder="https://..." value={p.url||''} onChange={e=>updatePlayer(i,{ url:e.target.value })} /></div>
              <div style={{ marginTop:8 }}><label>API Key（可选）</label><br/>
                <input type="password" style={{width:'100%'}} value={p.apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} /></div>
            </>)}
            {['openai','gemini','kimi','grok'].includes(p.kind) && (<>
              <div style={{ marginTop:8 }}><label>Model（可选）</label><br/>
                <input style={{width:'100%'}} placeholder="gpt-4o, gemini-1.5-pro, ..." value={p.model||''} onChange={e=>updatePlayer(i,{ model:e.target.value })} /></div>
              <div style={{ marginTop:8 }}><label>API Key</label><br/>
                <input type="password" style={{width:'100%'}} value={p.apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} /></div>
            </>)}
            <div style={{ marginTop:8 }}><label>超时（毫秒）</label><br/>
              <input type="number" value={p.timeoutMs||12000} onChange={e=>updatePlayer(i,{ timeoutMs:Number(e.target.value) })} /></div>
          </div> );})}
      </div>
      <div style={{marginTop:12, display:'flex', gap:12, alignItems:'center'}}>
        <label>回合数</label><input type="number" value={rounds} onChange={e=>setRounds(Number(e.target.value))} />
        <label>起始分（baseScore）</label><input type="number" value={baseScore} onChange={e=>setBaseScore(Number(e.target.value))} />
        <label>每手延迟(ms)</label><input type="number" value={delayMs} onChange={e=>setDelayMs(Number(e.target.value))} />
        <button onClick={onRun}>运行</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginTop:12 }}>
        {[0,1,2].map(i=>(<div key={i} style={{ border:'1px solid #eee', borderRadius:8, padding:12 }}>
          <b>{'甲乙丙'[i]} 手牌{landlord===i?'（地主）':''}</b>
          <div style={{ marginTop:8, fontFamily:'monospace', wordBreak:'break-all' }}>{(hands[i]||[]).join(' ')}</div>
          <div style={{ marginTop:8 }}>累计分：<b>{totals[i]}</b></div>
        </div>))}
      </div>
      <div style={{ marginTop:12, padding:12, border:'1px dashed #ddd', borderRadius:8 }}>
        <div>底牌：{bottom.join(' ')}</div>
        <div style={{ marginTop:6 }}>最近出牌：{lastPlay ? `${'甲乙丙'[lastPlay.seat]} -> ${lastPlay.text}` : '—'}</div>
      </div>
      <div style={{marginTop:12}}>
        <div style={{ display:'flex', gap:8, marginBottom:8 }}>
          <button onClick={()=>download(`ddz-${Date.now()}.ndjson`, stream.join('\n'), 'application/x-ndjson')} disabled={!stream.length}>下载 NDJSON</button>
          <button onClick={()=>download(`ddz-${Date.now()}.json`, JSON.stringify(objs,null,2), 'application/json')} disabled={!objs.length}>下载事件 JSON</button>
        </div>
        <textarea style={{ width:'100%', height:260, fontFamily:'monospace' }} value={stream.join('\n')} readOnly/>
      </div>
    </div>); }