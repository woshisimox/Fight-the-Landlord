"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

const dockStyle: React.CSSProperties = { position:"fixed", right:16, bottom:16, zIndex:99999, display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" };
const btnStyle: React.CSSProperties = { borderRadius:9999, padding:"10px 14px", border:"1px solid rgba(0,0,0,.1)", background:"white", boxShadow:"0 2px 10px rgba(0,0,0,.08)", cursor:"pointer" };
const panelStyle: React.CSSProperties = { width:420, maxHeight:560, overflow:"auto", borderRadius:16, border:"1px solid rgba(0,0,0,.1)", background:"white", boxShadow:"0 6px 24px rgba(0,0,0,.12)", padding:12 };

type Level = "debug" | "info" | "warn" | "error";
type ClientLog = { ts:string; level:Level; src:string; msg:string; data?:any; };

class ClientLogger {
  static I = new ClientLogger();
  logs: ClientLog[] = [];
  cap = 6000;
  rxText = "";
  rxObjs: any[] = [];
  rxCap = 12000;
  patched = false;

  push(e: ClientLog){ this.logs.push(e); if(this.logs.length>this.cap) this.logs.splice(0,this.logs.length-this.cap); }
  pushRxText(txt:string){
    this.rxText += txt;
    let i;
    while((i = this.rxText.indexOf("\n")) >= 0){
      const line = this.rxText.slice(0,i).trim();
      this.rxText = this.rxText.slice(i+1);
      if(!line) continue;
      try{ this.rxObjs.push({ ts:new Date().toISOString(), obj: JSON.parse(line) }); }
      catch{ this.rxObjs.push({ ts:new Date().toISOString(), text: line }); }
      if(this.rxObjs.length>this.rxCap) this.rxObjs.splice(0, this.rxObjs.length - this.rxCap);
    }
  }
  start(){
    if(this.patched) return; this.patched = true;
    const o = { ...console } as any;
    (['log','info','warn','error','debug'] as const).forEach(k => {
      (console as any)[k] = (...a:any[]) => { this.push({ ts:new Date().toISOString(), level: k as any, src:'ui', msg:'console.'+k, data:a }); (o[k] as any)(...a); };
    });
    try{ const RS:any = (window as any).ReadableStream; if (RS?.prototype?.getReader){ const og = RS.prototype.getReader;
      RS.prototype.getReader = function(...args:any[]){ const r = og.apply(this,args); if(r?.read){ const or=r.read.bind(r);
        r.read = async (...aa:any[]) => { const out = await or(...aa); try{ if (out?.value){ const txt=new TextDecoder().decode(out.value); if (txt) ClientLogger.I.pushRxText(txt); } }catch{} return out; };
      } return r; }; } }catch{}
  }
  getAll(){ return [...this.logs]; } getRx(){ return [...this.rxObjs]; } clear(){ this.logs=[]; this.rxText=""; this.rxObjs=[]; }
}

export default function DebugDock(){
  const [open, setOpen] = useState(false);
  const [alive, setAlive] = useState<boolean|null>(null);
  const [cnt, setCnt] = useState(0);
  const [rxCnt, setRxCnt] = useState(0);

  const [backendBase, setBackendBase] = useState<string>('');
  const [pingPath, setPingPath] = useState<string>('/api/ping');
  const [dumpPath, setDumpPath] = useState<string>('/api/debug_dump');
  const [lastPingTs, setLastPingTs] = useState<string|undefined>(undefined);

  const [tab, setTab] = useState<'rx'|'console'>('rx');
  const [filter, setFilter] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const viewRef = useRef<HTMLDivElement|null>(null);

  useEffect(()=>{
    try{ const b=localStorage.getItem('debug.backend.base'); const p=localStorage.getItem('debug.backend.pingPath'); const d=localStorage.getItem('debug.backend.dumpPath');
      if(b!==null) setBackendBase(b); if(p!==null) setPingPath(p); if(d!==null) setDumpPath(d); }catch{}
    ClientLogger.I.start();
    const t = setInterval(async ()=>{
      setCnt(ClientLogger.I.getAll().length);
      setRxCnt(ClientLogger.I.getRx().length);
      if (autoScroll && viewRef.current) { try { viewRef.current.scrollTop = viewRef.current.scrollHeight; } catch{} }
      // ping
      let ok=false, ts: string|undefined=undefined;
      try{ const url = new URL((pingPath||'/api/ping'), (backendBase||window.location.origin)).toString(); const r=await fetch(url, {cache:'no-store'}); const j=await r.json(); ok=!!j?.ok; ts=j?.ts; }catch{}
      (window as any).__backendAlive = ok; setAlive(ok); setLastPingTs(ts);
    }, 2000);
    return ()=>clearInterval(t);
  }, [backendBase, pingPath, autoScroll]);

  function saveBackendCfg(){ try{ localStorage.setItem('debug.backend.base', backendBase); localStorage.setItem('debug.backend.pingPath', pingPath); localStorage.setItem('debug.backend.dumpPath', dumpPath);}catch{} }

  function fmtRxLine(e:any): string {
    const o = e?.obj ?? e?.text ?? e; if (!o) return '';
    try {
      if (o.type === 'event') {
        if (o.kind === 'play') return `[${e.ts}] PLAY seat=${o.seat} ${o.move==='pass'?'PASS':('cards='+(o.cards||[]).join(' '))}`;
        if (o.kind === 'trick-reset') return `[${e.ts}] TRICK-RESET`;
        if (o.kind === 'win') return `[${e.ts}] WIN seat=${o.winner} mult=${o.multiplier} delta=${(o.deltaScores||[]).join('/')}`;
        if (o.kind === 'rob') return `[${e.ts}] ROB seat=${o.seat} ${o.rob?'YES':'NO'}`;
      }
      if (o.type === 'log' && typeof o.message === 'string') return `[${e.ts}] LOG ${o.message}`;
      if (o.type === 'ka') return `[${e.ts}] KA`;
      if (o.hands || o.init?.hands || o.state?.hands) return `[${e.ts}] DEAL hands…`;
    } catch {}
    return `[${e.ts}] ${JSON.stringify(o)}`;
  }
  function fmtConsoleLine(l:any): string { return `[${l.ts}] ${(l.level||'LOG').toUpperCase()} ${l.src||'ui'}: ${l.msg}${l.data!==undefined?' '+JSON.stringify(l.data):''}`; }

  function downloadReport(){
    const data: any = { meta:{ when:new Date().toISOString(), url:location.href, backendBase, pingPath, dumpPath }, clientLogs: ClientLogger.I.getAll(), streamRx: ClientLogger.I.getRx() };
    (async()=>{ try{ const url = new URL((dumpPath||'/api/debug_dump'), (backendBase||window.location.origin)).toString(); const r=await fetch(url,{cache:'no-store'}); const j=await r.json(); data.server=j; }catch(e){ data.server={ok:false,error:String(e)}; }
      const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`debug-report-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    })();
  }
  function downloadClientNdjson(){ const arr=ClientLogger.I.getRx().map(x=>x.obj??x.text); const body=arr.map(x=>JSON.stringify(x)).join('\n'); const blob=new Blob([body],{type:'application/x-ndjson'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`client-rx-${new Date().toISOString().replace(/[:.]/g,'-')}.ndjson`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000); }

  return (<div style={dockStyle}>
    {open && (<div style={panelStyle}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}><b>Debug</b><button style={btnStyle} onClick={()=>setOpen(false)}>Close</button></div>
      <div style={{marginTop:8}}>
        <div style={{fontSize:12,fontWeight:600,marginBottom:4}}>Backend 设置</div>
        <div style={{display:'grid', gridTemplateColumns:'80px 1fr', gap:8, alignItems:'center'}}>
          <div>Base</div><input style={{border:'1px solid #ddd', borderRadius:8, padding:'6px 8px'}} placeholder="(留空=同源) https://api.example.com" value={backendBase} onChange={e=>setBackendBase(e.target.value)} />
          <div>Ping</div><input style={{border:'1px solid #ddd', borderRadius:8, padding:'6px 8px'}} placeholder="/api/ping" value={pingPath} onChange={e=>setPingPath(e.target.value || '/api/ping')} />
          <div>Dump</div><input style={{border:'1px solid #ddd', borderRadius:8, padding:'6px 8px'}} placeholder="/api/debug_dump" value={dumpPath} onChange={e=>setDumpPath(e.target.value || '/api/debug_dump')} />
        </div>
        <div style={{display:'flex', gap:8, marginTop:8, alignItems:'center'}}>
          <button style={btnStyle} onClick={saveBackendCfg}>保存设置</button>
          <span style={{fontSize:12, opacity:.8}}>状态：{alive===null?'…':alive?'● alive':'○ offline'}{lastPingTs?` • ts=${lastPingTs}`:''}</span>
        </div>
      </div>

      <div style={{display:'flex', gap:8, marginTop:12, flexWrap:'wrap', alignItems:'center'}}>
        <div style={{display:'inline-flex', border:'1px solid #eee', borderRadius:9999, overflow:'hidden'}}>
          <button style={{...btnStyle, border:'none', borderRadius:0, background: tab==='rx'?'#f3f4f6':'white'}} onClick={()=>setTab('rx')}>RX流</button>
          <button style={{...btnStyle, border:'none', borderRadius:0, background: tab==='console'?'#f3f4f6':'white'}} onClick={()=>setTab('console')}>Console</button>
        </div>
        <input style={{flex:1, minWidth:160, border:'1px solid #ddd', borderRadius:8, padding:'6px 8px'}} placeholder="过滤关键字" value={filter} onChange={e=>setFilter(e.target.value)} />
        <label style={{display:'inline-flex', gap:6, alignItems:'center', fontSize:12, opacity:.8}}><input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)} /> 自动滚动</label>
        <button style={btnStyle} onClick={()=>ClientLogger.I.clear()}>清空</button>
        <button style={btnStyle} onClick={downloadClientNdjson}>下载RX（NDJSON）</button>
        <button style={btnStyle} onClick={downloadReport}>下载合并报告</button>
      </div>

      <div ref={viewRef} style={{marginTop:8, fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize:12, lineHeight:'18px', border:'1px solid #eee', borderRadius:12, padding:10, maxHeight:280, overflow:'auto', background:'#fafafa'}}>
        {(tab==='rx' ? ClientLogger.I.getRx().slice(-400) : ClientLogger.I.getAll().slice(-400))
          .map((e:any,i:number)=> (tab==='rx'? fmtRxLine(e) : fmtConsoleLine(e)))
          .filter((s:string)=> !filter || s.toLowerCase().includes(filter.toLowerCase()))
          .map((s:string,i:number)=>(<div key={i} style={{whiteSpace:'pre-wrap'}}>{s}</div>))}
      </div>

      <div style={{fontSize:12, opacity:.8, marginTop:8}}>Logs: {cnt} • RX: {rxCnt}</div>
    </div>)}
    <button title="Debug" style={btnStyle} onClick={()=>setOpen(v=>!v)}>🐞 Debug {(alive===null)?'':(alive?'●':'○')}</button>
  </div>);
}
