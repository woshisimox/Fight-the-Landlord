
import { useState } from 'react';

type Provider = 'openai'|'kimi'|'grok';

export default function Home() {
  const [openaiKey, setOpenaiKey] = useState('');
  const [kimiKey, setKimiKey] = useState('');
  const [grokKey, setGrokKey] = useState('');
  const [provider, setProvider] = useState<Provider>('openai');
  const [role, setRole] = useState<'landlord'|'farmer'>('landlord');
  const [hand, setHand] = useState('3 3 4 5 5 5 6 7 8 8 8 8 J Q K BJ RJ');
  const [lastPlay, setLastPlay] = useState<{type:'single'|'pair'|'triple'|'bomb',count:number,rank:string} | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>('');

  const apiKey = provider==='openai' ? openaiKey : provider==='kimi' ? kimiKey : grokKey;

  async function onPlay() {
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch('/api/aiPlay', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          provider, apiKey, model: model || undefined, role,
          hand: hand.trim().split(/\s+/),
          lastPlay,
          snapshot: { note: 'demo v0 (singles/pairs/triples/bombs only)' }
        })
      });
      const data = await resp.json();
      setResult(data);
    } catch (e:any) {
      setResult({ error: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{maxWidth:840, margin:'40px auto', padding:16, fontFamily:'ui-sans-serif, system-ui'}}>
      <h1 style={{fontSize:28, fontWeight:800, marginBottom:12}}>Dou Dizhu AI Arena (v0)</h1>
      <p style={{opacity:0.8, marginBottom:16}}>参考麻将AI赛制，支持 ChatGPT / Kimi / Grok。页面输入 API Key，服务端转发调用。规则先实现单牌/对子/三张/炸弹（含火箭），后续可扩展顺子、连对、飞机。</p>

      <section style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16}}>
        <div>
          <label>Provider</label><br/>
          <select value={provider} onChange={(e)=>setProvider(e.target.value as Provider)}>
            <option value="openai">ChatGPT (OpenAI)</option>
            <option value="kimi">Kimi (Moonshot)</option>
            <option value="grok">Grok (xAI)</option>
          </select>
        </div>
        <div>
          <label>Model (optional)</label><br/>
          <input value={model} onChange={(e)=>setModel(e.target.value)} placeholder="auto by provider" style={{width:'100%'}}/>
        </div>
        <div>
          <label>OpenAI Key</label><br/>
          <input value={openaiKey} onChange={(e)=>setOpenaiKey(e.target.value)} placeholder="sk-..." style={{width:'100%'}}/>
        </div>
        <div>
          <label>Kimi Key</label><br/>
          <input value={kimiKey} onChange={(e)=>setKimiKey(e.target.value)} placeholder="moonshot key" style={{width:'100%'}}/>
        </div>
        <div>
          <label>Grok Key</label><br/>
          <input value={grokKey} onChange={(e)=>setGrokKey(e.target.value)} placeholder="xAI key" style={{width:'100%'}}/>
        </div>
        <div>
          <label>Role</label><br/>
          <select value={role} onChange={(e)=>setRole(e.target.value as any)}>
            <option value="landlord">Landlord(地主)</option>
            <option value="farmer">Farmer(农民)</option>
          </select>
        </div>
      </section>

      <section style={{marginBottom:16}}>
        <label>Hand (空格分隔，大小王: BJ RJ)</label><br/>
        <input value={hand} onChange={(e)=>setHand(e.target.value)} style={{width:'100%'}}/>
      </section>

      <fieldset style={{border:'1px solid #ddd', padding:12, borderRadius:8, marginBottom:16}}>
        <legend>上家出牌 (可空)</legend>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8}}>
          <div>
            <label>类型</label><br/>
            <select value={lastPlay?.type ?? ''} onChange={(e)=>{
              const t = e.target.value as any;
              if (!t) { setLastPlay(null); return; }
              setLastPlay({ type: t, count: lastPlay?.count || 1, rank: lastPlay?.rank || '3' });
            }}>
              <option value="">(无)</option>
              <option value="single">single</option>
              <option value="pair">pair</option>
              <option value="triple">triple</option>
              <option value="bomb">bomb</option>
            </select>
          </div>
          <div>
            <label>张数</label><br/>
            <input type="number" min={1} value={lastPlay?.count ?? 1}
              onChange={(e)=> setLastPlay(lp=> lp ? {...lp, count: Number(e.target.value)} : {type:'single',count:Number(e.target.value),rank:'3'}) } />
          </div>
          <div>
            <label>基准牌(如 7 J A 2 RJ)</label><br/>
            <input value={lastPlay?.rank ?? ''} onChange={(e)=> setLastPlay(lp=> lp ? {...lp, rank: e.target.value.toUpperCase()} : {type:'single',count:1,rank:e.target.value.toUpperCase()}) }/>
          </div>
          <div style={{display:'flex', alignItems:'end'}}>
            <button onClick={()=>setLastPlay(null)}>清空</button>
          </div>
        </div>
      </fieldset>

      <button onClick={onPlay} disabled={loading || !apiKey} style={{padding:'8px 14px', borderRadius:8}}>
        {loading ? 'Thinking…' : 'AI 出牌'}
      </button>

      <div style={{marginTop:16}}>
        <pre style={{whiteSpace:'pre-wrap', background:'#111', color:'#0f0', padding:12, borderRadius:8, minHeight:120}}>
{JSON.stringify(result, null, 2)}
        </pre>
      </div>

      <footer style={{opacity:0.7, marginTop:16}}>
        <div>提示：此演示仅校验 单牌/对子/三张/炸弹 合规性。请在 <code>lib/doudizhuCore.ts</code> 扩展顺子、连对、飞机等规则。</div>
      </footer>
    </div>
  );
}
