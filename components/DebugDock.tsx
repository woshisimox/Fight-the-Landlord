"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

const dockStyle: React.CSSProperties = { position:"fixed", right:16, bottom:16, zIndex:99999, display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" };
const btnStyle: React.CSSProperties = { borderRadius:9999, padding:"10px 14px", border:"1px solid rgba(0,0,0,.1)", background:"white", boxShadow:"0 2px 10px rgba(0,0,0,.08)", cursor:"pointer" };
const panelStyle: React.CSSProperties = { width:380, maxHeight:520, overflow:"auto", borderRadius:16, border:"1px solid rgba(0,0,0,.1)", background:"white", boxShadow:"0 6px 24px rgba(0,0,0,.12)", padding:12 };

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
    if(this.patched) return;
    this.patched = true;
    const o = { ...console } as any;
    (['log','info','warn','error','debug'] as const).forEach(k => {
      (console as any)[k] = (...a:any[]) => { this.push({ ts:new Date().toISOString(), level: k as any, src:'ui', msg:'console.'+k, data:a }); (o[k] as any)(...a); };
    });
    // Patch ReadableStream reader to capture inbound NDJSON
    try{
      const RS:any = (window as any).ReadableStream;
      if (RS?.prototype?.getReader){
        const og = RS.prototype.getReader;
        RS.prototype.getReader = function(...args:any[]){
          const r = og.apply(this, args);
          if (r?.read){
            const or = r.read.bind(r);
            r.read = async (...aa:any[]) => {
              const out = await or(...aa);
              try{
                if (out?.value){
                  const txt = new TextDecoder().decode(out.value);
                  if (txt) ClientLogger.I.pushRxText(txt);
                }
              }catch{}
              return out;
            };
          }
          return r;
        };
      }
    }catch{}
    this.ping(); setInterval(()=>this.ping(), 5000);
  }

  async ping(){
    try{ const r = await fetch('/api/ping'); const j = await r.json(); (window as any).__backendAlive = !!j?.ok; this.push({ ts:new Date().toISOString(), level:'debug', src:'net', msg:'ping', data:j }); }
    catch{ (window as any).__backendAlive = false; }
  }

  getAll(){ return [...this.logs]; }
  getRx(){ return [...this.rxObjs]; }
  clear(){ this.logs = []; this.rxText = ""; this.rxObjs = []; }
}

export default function DebugDock(){
  const [open, setOpen] = useState(false);
  const [alive, setAlive] = useState<boolean|null>(null);
  const [cnt, setCnt] = useState(0);
  const [rxCnt, setRxCnt] = useState(0);

  useEffect(()=>{
    ClientLogger.I.start();
    const t = setInterval(()=>{
      setCnt(ClientLogger.I.getAll().length);
      setRxCnt(ClientLogger.I.getRx().length);
      setAlive((window as any).__backendAlive ?? null);
    }, 1000);
    return ()=>clearInterval(t);
  }, []);

  function downloadReport(){
    const data = { meta:{ when:new Date().toISOString(), url:location.href }, clientLogs: ClientLogger.I.getAll(), streamRx: ClientLogger.I.getRx() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `debug-report-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  function downloadClientNdjson(){
    const arr = ClientLogger.I.getRx().map(x => x.obj ?? x.text);
    const body = arr.map(x => JSON.stringify(x)).join('\n');
    const blob = new Blob([body], { type:'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `client-rx-${new Date().toISOString().replace(/[:.]/g,'-')}.ndjson`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }

  return (<div style={dockStyle}>
    {open && (
      <div style={panelStyle}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <b>Debug</b>
          <button style={btnStyle} onClick={()=>setOpen(false)}>Close</button>
        </div>
        <div style={{fontSize:12, opacity:.8, marginTop:6}}>
          Backend: {alive===null?'…':alive?'●':'○'} • Logs: {cnt} • RX: {rxCnt}
        </div>
        <div style={{display:'flex', gap:8, marginTop:8, flexWrap:'wrap'}}>
          <button style={btnStyle} onClick={()=>ClientLogger.I.clear()}>Clear</button>
          <button style={btnStyle} onClick={downloadClientNdjson}>下载仅客户端RX（NDJSON）</button>
          <button style={btnStyle} onClick={downloadReport}>下载合并报告</button>
        </div>
      </div>
    )}
    <button title="Debug" style={btnStyle} onClick={()=>setOpen(v=>!v)}>🐞 Debug {(alive===null)?'':(alive?'●':'○')}</button>
  </div>);
}
