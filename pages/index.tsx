import { useEffect, useState } from 'react';
import type React from 'react';


function CardLine(props:{items:any[]|string[]}){
  const items = props.items||[];
  const isRich = typeof items[0]==='object';
  const SUIT_CHAR: Record<'H'|'D'|'S'|'C', string> = { H:'♥', D:'♦', S:'♠', C:'♣' };
  return (
    <code>
      {items.map((it:any, idx:number)=> {
        if (!isRich) return <span key={idx} style={{marginRight:6}}>{String(it)}</span>;
        const suit = it.suit as ('H'|'D'|'S'|'C'|undefined);
        const isRed = suit==='H' || suit==='D';
        const color = isRed ? 'red' : (suit==='S' || suit==='C') ? 'black' : undefined;
        const icon = suit ? SUIT_CHAR[suit] : (it.label==='SJ' || it.label==='BJ' ? '🃏' : '');
        return (
          <span key={idx} style={{marginRight:8, display:'inline-flex', alignItems:'center', gap:4}}>
            {icon ? <span style={{color, fontWeight:700}}>{icon}</span> : null}
            <span style={{color}}>{it.label}</span>
          </span>
        );
      })}
    </code>
  );
}


type Builtin = 'GreedyMin'|'GreedyMax'|'RandomLegal';
type ProviderKind = 'builtin'|'http'|'openai'|'gemini'|'kimi'|'grok';

interface PlayerConfig {
  kind: ProviderKind;
  builtin?: Builtin;
  url?: string;
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

function seatName(i:number){ return ['甲(A)','乙(B)','丙(C)'][i]; }

export default function Home() {
  const [rounds, setRounds] = useState(10);
  const [seed, setSeed] = useState(42);
  const [rob, setRob] = useState(false);
  const [four2, setFour2] = useState<'both'|'2singles'|'2pairs'>('both');
  const [delayMs, setDelayMs] = useState(0);
  const [startScore, setStartScore] = useState(0);

  const [players, setPlayers] = useState<PlayerConfig[]>([
    { kind:'builtin', builtin:'GreedyMin' },
    { kind:'builtin', builtin:'GreedyMax' },
    { kind:'builtin', builtin:'RandomLegal' },
  ]);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<any>(null);

  useEffect(()=>{
    try {
      const s = sessionStorage.getItem('ddz_players');
      if (s) setPlayers(JSON.parse(s));
    } catch {}
  }, []);
  useEffect(()=>{
    try {
      sessionStorage.setItem('ddz_players', JSON.stringify(players));
    } catch {}
  }, [players]);

  function updatePlayer(i:number, patch: Partial<PlayerConfig>){
    setPlayers(prev => prev.map((p,idx)=> idx===i ? {...p, ...patch} : p));
  }

  async function run() {
    setLoading(true); setResp(null);
    try {
      const body:any = {
        rounds, seed, rob, four2, delayMs, startScore,
        players: players.map(p=> {
          if (p.kind==='builtin') return { kind:'builtin', name: p.builtin };
          if (p.kind==='http') return { kind:'http', url: p.url, apiKey: p.apiKey };
          if (p.kind==='openai') return { kind:'openai', apiKey: p.apiKey, model: p.model || 'gpt-4o-mini', baseURL: p.baseURL };
          if (p.kind==='gemini') return { kind:'gemini', apiKey: p.apiKey, model: p.model || 'gemini-1.5-flash' };
          if (p.kind==='kimi') return { kind:'kimi', apiKey: p.apiKey, model: p.model || 'moonshot-v1-8k', baseURL: p.baseURL };
          if (p.kind==='grok') return { kind:'grok', apiKey: p.apiKey, model: p.model || 'grok-beta', baseURL: p.baseURL };
          return { kind:'builtin', name:'RandomLegal' };
        }),
      };
      const r = await fetch('/api/arena', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const j = await r.json();
      setResp(j);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{fontFamily:'system-ui, -apple-system, Segoe UI, Roboto', padding: 20, maxWidth: 1100, margin:'0 auto'}}>
      <h1>斗地主 AI 比赛 · 甲 / 乙 / 丙</h1>
      <p>为每位选手选择内置或外部 AI（HTTP / OpenAI / Gemini / Kimi / Grok），并可设置每步出牌延迟（ms）。</p>

      <fieldset style={{border:'1px solid #ddd', padding:12, borderRadius:8}}>
        <legend>对局参数</legend>
        <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap: 12, alignItems:'end'}}>
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
          <label>起始分<br/>
            <input type="number" value={startScore} onChange={e=>setStartScore(Number(e.target.value))} />
          </label>
          <label>每步延迟 (ms)<br/>
            <input type="number" value={delayMs} min={0} onChange={e=>setDelayMs(Number(e.target.value))} />
          </label>
        </div>
      </fieldset>

      <fieldset style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginTop:12}}>
        <legend>参赛者设置</legend>
        {[0,1,2].map(i=> (
          <div key={i} style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:12, padding:'10px 0', borderBottom: i<2?'1px solid #eee':'none'}}>
            <div style={{fontWeight:600}}>{seatName(i)}</div>
            <div>
              <div style={{display:'grid', gridTemplateColumns:'160px 1fr 1fr', gap:8, alignItems:'center'}}>
                <label>类型<br/>
                  <select value={players[i].kind} onChange={e=>updatePlayer(i,{ kind:e.target.value as ProviderKind })}>
                    <option value="builtin">内置</option>
                    <option value="http">HTTP JSON</option>
                    <option value="openai">OpenAI</option>
                    <option value="gemini">Gemini</option>
                    <option value="kimi">Kimi</option>
                    <option value="grok">Grok</option>
                  </select>
                </label>

                {players[i].kind==='builtin' && (
                  <label>内置策略<br/>
                    <select value={players[i].builtin} onChange={e=>updatePlayer(i,{ builtin:e.target.value as Builtin })}>
                      <option value="GreedyMin">GreedyMin</option>
                      <option value="GreedyMax">GreedyMax</option>
                      <option value="RandomLegal">RandomLegal</option>
                    </select>
                  </label>
                )}

                {players[i].kind==='http' && (
                  <>
                    <label>URL<br/>
                      <input type="text" placeholder="https://your-bot.example/api" value={players[i].url||''} onChange={e=>updatePlayer(i,{ url:e.target.value })} />
                    </label>
                    <label>API Key（可选）<br/>
                      <input type="password" placeholder="将作为 Bearer 发送" value={players[i].apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} />
                    </label>
                  </>
                )}

                {players[i].kind==='openai' && (
                  <>
                    <label>API Key<br/>
                      <input type="password" placeholder="sk-..." value={players[i].apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} />
                    </label>
                    <label>模型<br/>
                      <input type="text" placeholder="gpt-4o-mini" value={players[i].model||''} onChange={e=>updatePlayer(i,{ model:e.target.value })} />
                    </label>
                    <label>Base URL（可选）<br/>
                      <input type="text" placeholder="https://api.openai.com/v1" value={players[i].baseURL||''} onChange={e=>updatePlayer(i,{ baseURL:e.target.value })} />
                    </label>
                  </>
                )}

                {players[i].kind==='gemini' && (
                  <>
                    <label>API Key<br/>
                      <input type="password" placeholder="AIza..." value={players[i].apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} />
                    </label>
                    <label>模型<br/>
                      <input type="text" placeholder="gemini-1.5-flash" value={players[i].model||''} onChange={e=>updatePlayer(i,{ model:e.target.value })} />
                    </label>
                  </>
                )}

                {players[i].kind==='kimi' && (
                  <>
                    <label>API Key<br/>
                      <input type="password" placeholder="KIMI_API_KEY" value={players[i].apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} />
                    </label>
                    <label>模型<br/>
                      <input type="text" placeholder="moonshot-v1-8k" value={players[i].model||''} onChange={e=>updatePlayer(i,{ model:e.target.value })} />
                    </label>
                    <label>Base URL（可选）<br/>
                      <input type="text" placeholder="https://api.moonshot.cn/v1" value={players[i].baseURL||''} onChange={e=>updatePlayer(i,{ baseURL:e.target.value })} />
                    </label>
                  </>
                )}

                {players[i].kind==='grok' && (
                  <>
                    <label>API Key<br/>
                      <input type="password" placeholder="GROK_API_KEY" value={players[i].apiKey||''} onChange={e=>updatePlayer(i,{ apiKey:e.target.value })} />
                    </label>
                    <label>模型<br/>
                      <input type="text" placeholder="grok-beta" value={players[i].model||''} onChange={e=>updatePlayer(i,{ model:e.target.value })} />
                    </label>
                    <label>Base URL（可选）<br/>
                      <input type="text" placeholder="https://api.x.ai/v1" value={players[i].baseURL||''} onChange={e=>updatePlayer(i,{ baseURL:e.target.value })} />
                    </label>
                  </>
                )}

              </div>
            </div>
          </div>
        ))}
      </fieldset>

      <button onClick={run} disabled={loading} style={{marginTop:16,padding:'8px 16px'}}>
        {loading ? '运行中…' : '运行'}
      </button>

      {resp && (
        <div style={{marginTop:24}}>
          <h2>结果</h2>
          <p>总局数：{resp.rounds}；起始分：{resp.startScore}；总分：甲 {resp.totals[0]} / 乙 {resp.totals[1]} / 丙 {resp.totals[2]}{resp.endedEarly?'（已提前终止）':''}</p>

          <h3>首局详情</h3>
          <pre style={{whiteSpace:'pre-wrap', background:'#f7f7f7', padding:12, border:'1px solid #eee', maxHeight:400, overflow:'auto'}}>
{JSON.stringify(resp.logs?.[0], null, 2)}
          </pre>
        </div>
      )}

      <details style={{marginTop:16}}>
        <summary>实时运行（流式）</summary>
        <LivePanel rounds={rounds} seed={seed} rob={rob} four2={four2} delayMs={delayMs} startScore={startScore} players={players} />
      </details>
    </div>
  );
}
const LivePanel: React.FC<any> = (props) => {
  const [lines, setLines] = useState<string[]>([]);
  const [raw, setRaw] = useState<string[]>([]);
  const [objs, setObjs] = useState<any[]>([]);
  const [board, setBoard] = useState<{hands:string[][], last:string[], landlord:number|null, bottom:string[], handsRich?: any[][], lastRich?: any[][], bottomRich?: any[], trick?: any[]}>({hands:[[],[],[]], last:['','',''], landlord:null, bottom:[]});
  const [totals, setTotals] = useState<[number,number,number]>([props.startScore||0, props.startScore||0, props.startScore||0]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('idle');

  function labelFor(i:number){
    const p = props.players[i]; const seat=['甲','乙','丙'][i];
    if(!p) return seat;
    if(p.kind==='builtin') return `${seat}（内置:${p.builtin||'Random'}）`;
    if(p.kind==='http') return `${seat}（HTTP）`;
    if(p.kind==='openai') return `${seat}（OpenAI）`;
    if(p.kind==='gemini') return `${seat}（Gemini）`;
    if(p.kind==='kimi') return `${seat}（Kimi）`;
    if(p.kind==='grok') return `${seat}（Grok）`;
    return seat;
  }

  const downloadNdjson = (lines:string[])=>{
    const blob = new Blob([lines.join('\\n')], {type:'application/x-ndjson'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ddz-log-' + new Date().toISOString().replace(/[:.]/g,'-') + '.ndjson';
    a.click();
    setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
  };
  const downloadJson = (objs:any[])=>{
    const blob = new Blob([JSON.stringify(objs, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ddz-events-' + new Date().toISOString().replace(/[:.]/g,'-') + '.json';
    a.click();
    setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
  };
  function toB64(obj:any){ 
    const s = JSON.stringify(obj); 
    // @ts-ignore

  }

  async function start(){
    setLines([]);
    setRaw([]);
    setObjs([]);
    setBoard({hands:[[],[],[]], handsRich:[[],[],[]], last:['','',''], lastRich:[[],[],[]], landlord:null, bottom:[], bottomRich:[], trick:[]});
    setTotals([props.startScore||0, props.startScore||0, props.startScore||0]);
    setRunning(true);
    setStatus('connecting');
    const body:any = {
      rounds: props.rounds, seed: props.seed, rob: props.rob, four2: props.four2, delayMs: props.delayMs, startScore: props.startScore,
      players: props.players.map((p:any)=> {
        if (p.kind==='builtin') return { kind:'builtin', name: p.builtin };
        if (p.kind==='http') return { kind:'http', url: p.url, apiKey: p.apiKey };
        if (p.kind==='openai') return { kind:'openai', apiKey: p.apiKey, model: p.model || 'gpt-4o-mini', baseURL: p.baseURL };
        if (p.kind==='gemini') return { kind:'gemini', apiKey: p.apiKey, model: p.model || 'gemini-1.5-flash' };
        if (p.kind==='kimi') return { kind:'kimi', apiKey: p.apiKey, model: p.model || 'moonshot-v1-8k', baseURL: p.baseURL };
        if (p.kind==='grok') return { kind:'grok', apiKey: p.apiKey, model: p.model || 'grok-beta', baseURL: p.baseURL };
        return { kind:'builtin', name:'RandomLegal' };
      }),
    };

    try {
      const es = new EventSource(`/api/stream_sse?q=${toB64(body)}`);
      es.onopen = () => setStatus('open');
      es.onmessage = (e) => {
        try {
          const obj = JSON.parse(e.data);
          setRaw(r=>[...r, e.data]);
          setObjs(o=>[...o, obj]);
          handle(obj);
        } catch {}
      };
      es.addEventListener('done', () => {
        es.close();
        setStatus('done');
        setRunning(false);
      });
      es.addEventListener('error', () => {
        es.close();
        setStatus('sse-error');
        fallbackNdjson(body);
      });
    } catch (e) {
      setStatus('sse-unsupported');
      fallbackNdjson(body);
    }
  }

  async function fallbackNdjson(body:any){
    try{
      setStatus('ndjson');
      const r = await fetch('/api/stream_ndjson', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true){
        const {value, done} = await reader.read();
        if (done) break;
        buf += decoder.decode(value, {stream:true});
        let idx;
        while ((idx = buf.indexOf("\\n")) >= 0){
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx+1);
          if (!line) continue;
          setRaw(r=>[...r, line]);
          const obj = JSON.parse(line);
          setObjs(o=>[...o, obj]);
          handle(obj);
        }
      }
    } finally {
      setRunning(false);
      setStatus('done');
    }
  }

  function handle(obj:any){
    if (obj.type==='event'){
      if (obj.kind==='turn'){
        const seat = ['甲','乙','丙'][obj.seat];
        const req = obj.require?(`需跟:${obj.require.type}>${obj.require.mainRank}`):'';
        push(`【回合】${seat} ${obj.lead?'(领出)':''} ${req}`);
      } else if (obj.kind==='deal'){
        setBoard(b=> ({...b, hands: obj.hands, bottom: obj.bottom, handsRich: obj.handsRich||[[],[],[]], bottomRich: obj.bottomRich||[], trick:[]}));
        push(`发牌：底牌 ${obj.bottom.join('')}`);
      } else if (obj.kind==='bid'){
        const seat = ['甲','乙','丙'][obj.seat];
        push(`叫分/抢：${seat} -> ${String(obj.action)}`);
      } else if (obj.kind==='landlord'){
        push(`确定地主：${['甲','乙','丙'][obj.landlord]}，底牌 ${obj.bottom.join('')} 基础分 ${obj.baseScore}`);
        setBoard(b=> ({...b, landlord: obj.landlord}));
      } else if (obj.kind==='trick-reset'){
          push(`（新一轮）由 ${['甲','乙','丙'][obj.leader]} 继续领出`);
          setBoard(b=> ({...b, trick: []}));
        } else if (obj.kind==='play'){
        const seat = ['甲','乙','丙'][obj.seat];
        const label = labelFor(obj.seat);
        if (obj.move==='pass'){
          push(`${label}：过${obj.reason?(' — 理由：'+obj.reason):''}`);
          setBoard(b=> { 
            const last=b.last.slice(); 
            last[obj.seat]='过'; 
            const lastRich = (b as any).lastRich ? (b as any).lastRich.slice() : [[],[],[]];
            lastRich[obj.seat] = [];
            const trick = (b as any).trick ? (b as any).trick.slice() : [];
            trick.push({ seat: obj.seat, labels: [], cardsRich: [], pass: true });
            return {...b, last, lastRich, trick}; 
          });
        } else {
          const labels=(obj.cards||[]) as string[];
          const cards = labels.join('');
          const cardsRich=(obj.cardsRich||[]) as any[];
          push(`${label}：${obj.comboType || obj.type} ${cards}${obj.reason?(' — 理由：'+obj.reason):''}`);
          setBoard(b=> { 
            const last=b.last.slice(); 
            last[obj.seat]=cards;
            const hands=b.hands.map(arr=>arr.slice());
            for (const lab of labels){ const k=hands[obj.seat].indexOf(lab); if (k>=0) hands[obj.seat].splice(k,1); }
            const handsRichArr = (b as any).handsRich ? (b as any).handsRich.map((arr:any)=> arr.slice()) : [[],[],[]];
            if (cardsRich && cardsRich.length && handsRichArr[obj.seat]) {
              for (const c of cardsRich){
                const k = handsRichArr[obj.seat].findIndex((x:any)=> (x.code && c.code && x.code===c.code) || (x.label===c.label && x.suit===c.suit));
                if (k>=0) handsRichArr[obj.seat].splice(k,1);
              }
            } else if (handsRichArr[obj.seat]) {
              for (const lab of labels){
                const k = handsRichArr[obj.seat].findIndex((x:any)=> x.label===lab);
                if (k>=0) handsRichArr[obj.seat].splice(k,1);
              }
            }
            const lastRich = (b as any).lastRich ? (b as any).lastRich.slice() : [[],[],[]];
            lastRich[obj.seat] = cardsRich && cardsRich.length ? cardsRich : (labels.map(l=>({label:l})) as any[]);
            const trick = (b as any).trick ? (b as any).trick.slice() : [];
            trick.push({ seat: obj.seat, labels, cardsRich });
            return {...b, last, lastRich, hands, handsRich: handsRichArr, trick}; 
          });
        }
      } else if (obj.kind==='score'){
        setTotals([obj.totals[0], obj.totals[1], obj.totals[2]]);
        push(`积分：甲 ${obj.totals[0]} / 乙 ${obj.totals[1]} / 丙 ${obj.totals[2]}`);
      } else if (obj.kind==='terminated'){
        setTotals([obj.totals[0], obj.totals[1], obj.totals[2]]);
        push(`比赛提前终止（原因：${obj.reason}），当前积分：甲 ${obj.totals[0]} / 乙 ${obj.totals[1]} / 丙 ${obj.totals[2]}`);
      } else if (obj.kind==='finish'){
        push(`结束：赢家 ${obj.winner==='landlord' ? '地主' : '农民'}`);
      }
    } else if (obj.type==='done'){
      push('全部对局完成。');
    }

  function push(t:string){ setLines(l=> [...l, t]); }

  return (
    <div style={{marginTop:12}}>
      <button onClick={start} disabled={running} style={{padding:'6px 12px'}}>{running?('运行中…('+status+')'):'开始实时运行'}</button>
      <div style={{marginTop:8, display:'flex', gap:8}}>
        <button onClick={()=>downloadNdjson(raw)} disabled={!raw.length}>下载 NDJSON</button>
        <button onClick={()=>downloadJson(objs)} disabled={!objs.length}>下载事件 JSON</button>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginTop:12}}>
        {[0,1,2].map(i=> (
          <div key={i} style={{border:'1px solid #eee', borderRadius:8, padding:10}}>
            <div style={{fontWeight:700}}>{labelFor(i)}{board.landlord===i?'（地主）':''} — 分数：{totals[i]}</div>
            <div>手牌：{(board as any).handsRich && (board as any).handsRich[i]?.length ? <CardLine items={(board as any).handsRich[i]} /> : <code>{board.hands[i]?.join(' ')}</code>}</div>
            <div>最近出牌：{(board as any).lastRich && (board as any).lastRich[i]?.length ? <CardLine items={(board as any).lastRich[i]} /> : <code>{board.last[i]||''}</code>}</div>
          </div>
        ))}

      <div style={{marginTop:12}}>
        <div style={{fontWeight:700}}>本轮出牌顺序</div>
        <div style={{whiteSpace:'normal', background:'#f9f9f9', padding:10, border:'1px solid #eee'}}>
          {((board as any).trick||[]).map((step:any, idx:number)=> (
            <div key={idx} style={{marginBottom:4}}>
              <span style={{marginRight:8}}>{['甲','乙','丙'][step.seat]}{board.landlord===step.seat?'（地主）':''}：</span>
              {step.pass ? <code>过</code> : (step.cardsRich && step.cardsRich.length ? <CardLine items={step.cardsRich} /> : <code>{(step.labels||[]).join(' ')}</code>)}
            </div>
          ))}
          {((board as any).trick||[]).length===0 ? <div style={{opacity:0.6}}>（暂无出牌）</div> : null}
        </div>
      </div>
      </div>
      <div style={{marginTop:12}}>
        <div style={{fontWeight:700}}>事件日志</div>
        <div style={{whiteSpace:'pre-wrap', background:'#f9f9f9', padding:10, border:'1px solid #eee', height:240, overflow:'auto'}}>
          {lines.join('\n')}
        </div>
      </div>
    </div>
  );
};