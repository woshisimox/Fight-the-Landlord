// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react';

/* ===================== 基础类型 ===================== */
type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type Rating = { mu:number; sigma:number };
type Role = 'L'|'F';
type TSBookEntry = {
  label: string;
  L: Rating & { games?: number };
  F: Rating & { games?: number };
  overallCR?: number;
  updatedAt?: string;
};
type TSBook = Record<string, TSBookEntry>;

type Score5 = { coop:number; agg:number; cons:number; eff:number; rob:number };

/* ===================== TrueSkill 轻量实现 ===================== */
const TS_DEFAULT: Rating = { mu:25, sigma:25/3 };
const TS_BETA = 25/6;
const TS_TAU  = 25/300;
const SQRT2 = Math.sqrt(2);

function erf(x:number){ const s=Math.sign(x); const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const t=1/(1+p*Math.abs(x)); const y=1-(((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t)*Math.exp(-x*x); return s*y; }
function phi(x:number){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function Phi(x:number){ return 0.5*(1+erf(x/SQRT2)); }
function V_exceeds(t:number){ const d=Math.max(1e-12,Phi(t)); return phi(t)/d; }
function W_exceeds(t:number){ const v=V_exceeds(t); return v*(v+t); }
function tsUpdateTwoTeams(r:Rating[], A:number[], B:number[]){
  const varA = A.reduce((s,i)=>s+r[i].sigma**2,0), varB = B.reduce((s,i)=>s+r[i].sigma**2,0);
  const muA  = A.reduce((s,i)=>s+r[i].mu,0),     muB  = B.reduce((s,i)=>s+r[i].mu,0);
  const c2   = varA + varB + 2*TS_BETA*TS_BETA, c = Math.sqrt(c2), t=(muA-muB)/c;
  const v=V_exceeds(t), w=W_exceeds(t);
  for (const i of A){ const sig2=r[i].sigma**2, m=sig2/c, m2=sig2/c2; r[i].mu+=m*v; r[i].sigma=Math.sqrt(Math.max(1e-6,sig2*(1-w*m2))+TS_TAU*TS_TAU); }
  for (const i of B){ const sig2=r[i].sigma**2, m=sig2/c, m2=sig2/c2; r[i].mu-=m*v; r[i].sigma=Math.sqrt(Math.max(1e-6,sig2*(1-w*m2))+TS_TAU*TS_TAU); }
}

/* ===================== 记录簿与默认项 ===================== */
const SUPPORTED_DEFAULT_IDS = [
  'built-in:greedy-max',
  'built-in:greedy-min',
  'built-in:random-legal',
  'ai:openai:gpt-4o-mini',
  'ai:gemini:gemini-1.5-flash',
  'ai:grok:grok-2-latest',
  'ai:kimi:kimi-k2-0905-preview',
  'ai:qwen:qwen-plus',
  'http:default',
];
function labelForId(id:string){
  if (id.startsWith('built-in:')){
    const m=id.split(':')[1]; if(m==='greedy-max') return 'Greedy Max';
    if(m==='greedy-min') return 'Greedy Min'; if(m==='random-legal') return 'Random Legal'; return id;
  }
  if (id.startsWith('ai:')){
    const [_,prov,model]=id.split(':'); const name=prov==='openai'?'OpenAI':prov==='gemini'?'Gemini':prov==='grok'?'Grok':prov==='kimi'?'Kimi':prov==='qwen'?'Qwen':prov;
    return `${name}(${model})`;
  }
  if (id.startsWith('http:')) return `HTTP(${id.slice(5)})`;
  return id;
}
function makeEmptyEntry(label:string): TSBookEntry {
  return { label, L:{...TS_DEFAULT,games:0}, F:{...TS_DEFAULT,games:0}, overallCR:0, updatedAt:new Date().toISOString() };
}
function computeOverall(e:TSBookEntry){ return 0.5*(e.L.mu-3*e.L.sigma)+0.5*(e.F.mu-3*e.F.sigma); }

/* ===================== 模型 Normalizer ===================== */
function defaultModelFor(c:BotChoice){ switch(c){ case 'ai:openai':return 'gpt-4o-mini'; case 'ai:gemini':return 'gemini-1.5-flash'; case 'ai:grok':return 'grok-2-latest'; case 'ai:kimi':return 'kimi-k2-0905-preview'; case 'ai:qwen':return 'qwen-plus'; default:return ''; } }
function normalizeModelForProvider(c:BotChoice, input:string){ const m=(input||'').trim(); if(!m) return ''; const low=m.toLowerCase(); switch(c){ case 'ai:kimi':return /^kimi[-\w]*/.test(low)?m:''; case 'ai:openai':return /^(gpt-|o[34]|text-|omni)/.test(low)?m:''; case 'ai:gemini':return /^gemini[-\w.]*/.test(low)?m:''; case 'ai:grok':return /^grok[-\w.]*/.test(low)?m:''; case 'ai:qwen':return /^qwen[-\w.]*/.test(low)?m:''; default:return ''; } }
function choiceLabel(c:BotChoice){ switch(c){ case 'built-in:greedy-max':return 'Greedy Max'; case 'built-in:greedy-min':return 'Greedy Min'; case 'built-in:random-legal':return 'Random Legal'; case 'ai:openai':return 'OpenAI'; case 'ai:gemini':return 'Gemini'; case 'ai:grok':return 'Grok'; case 'ai:kimi':return 'Kimi'; case 'ai:qwen':return 'Qwen'; case 'http':return 'HTTP'; } }

/* ===================== UI 小件 ===================== */
const seatName=(i:number)=>['甲','乙','丙'][i]||String(i);
function SeatTitle({ i }:{i:number}){ return <span style={{fontWeight:700}}>{seatName(i)}</span>; }
type SuitSym='♠'|'♥'|'♦'|'♣'|'🃏'; const SUITS:SuitSym[]=['♠','♥','♦','♣'];
const rankOf=(l:string)=>{ if(!l) return ''; const c0=l[0]; if('♠♥♦♣'.includes(c0)) return l.slice(1).replace(/10/i,'T').toUpperCase(); if(c0==='🃏') return (l.slice(2)||'X').replace(/10/i,'T').toUpperCase(); return l.replace(/10/i,'T').toUpperCase(); };
function candDecorations(l:string){ if(!l) return []; if(l==='x') return ['🃏X']; if(l==='X') return ['🃏Y']; if(l.startsWith('🃏')) return [l]; if('♠♥♦♣'.includes(l[0])) return [l]; const r=rankOf(l); if(r==='JOKER') return ['🃏Y']; return SUITS.map(s=>`${s}${r}`); }
function decorateHandCycle(raw:string[]){ let idx=0; return raw.map(l=>{ if(!l) return l; if(l==='x') return '🃏X'; if(l==='X') return '🃏Y'; if(l.startsWith('🃏')) return l; if('♠♥♦♣'.includes(l[0])) return l; const suit=SUITS[idx%SUITS.length]; idx++; return `${suit}${rankOf(l)}`; }); }
function Card({label}:{label:string}){ const suit=label.startsWith('🃏')?'🃏':label.charAt(0); const base=(suit==='♥'||suit==='♦')?'#af1d22':'#1a1a1a'; const rank=label.startsWith('🃏')?(label.slice(2)||''):label.slice(1); const rc=suit==='🃏'?(rank==='Y'?'#d11':'#16a34a'):undefined; return <span style={{display:'inline-flex',alignItems:'center',gap:6,border:'1px solid #ddd',borderRadius:8,padding:'6px 10px',marginRight:6,marginBottom:6,fontWeight:800,color:base}}><span style={{fontSize:16}}>{suit}</span><span style={{fontSize:16,...(rc?{color:rc}:{})}}>{rank==='T'?'10':rank}</span></span>; }
function Hand({cards}:{cards:string[]}){ return cards?.length? <div style={{display:'flex',flexWrap:'wrap'}}>{cards.map((c,i)=><Card key={`${c}-${i}`} label={c}/>)}</div> : <span style={{opacity:.6}}>（空）</span>; }
function PlayRow({seat,move,cards,reason}:{seat:number;move:'play'|'pass';cards?:string[];reason?:string}){ return <div style={{display:'flex',gap:8,alignItems:'center',padding:'6px 0'}}><div style={{width:32,textAlign:'right',opacity:.8}}>{seatName(seat)}</div><div style={{width:56,fontWeight:700}}>{move==='pass'?'过':'出牌'}</div><div style={{flex:1}}>{move==='pass'?<span style={{opacity:.6}}>过</span>:<Hand cards={cards||[]}/>}</div>{reason&&<div style={{width:260,fontSize:12,color:'#666'}}>{reason}</div>}</div>; }
function LogLine({text}:{text:string}){ return <div style={{fontFamily:'ui-monospace,Menlo,Consolas,monospace',fontSize:12,color:'#555',padding:'2px 0'}}>{text}</div>; }
function Section({title,children}:{title:string;children:React.ReactNode}){ return <div style={{marginBottom:16}}><div style={{fontWeight:700,marginBottom:8}}>{title}</div><div>{children}</div></div>; }

/* ===================== 文本重写（把“第x局”固定） ===================== */
const makeRewriteRoundLabel=(n:number)=>(msg:string)=> typeof msg!=='string'?msg
  : msg.replace(/第\s*\d+\s*局开始/g,`第 ${n} 局开始`)
       .replace(/开始第\s*\d+\s*局（/g,`开始第 ${n} 局（`).replace(/开始第\s*\d+\s*局\(/g,`开始第 ${n} 局(`)
       .replace(/开始连打\s*\d+\s*局（/g,`开始第 ${n} 局（`).replace(/开始连打\s*\d+\\s*局\(/g,`开始第 ${n} 局(`)
       .replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局（/g,`单局模式：开始第 ${n} 局（`).replace(/单局模式.*?(仅运行|运行)\s*\d+\s*局\(/g,`单局模式：开始第 ${n} 局(`);

/* ===================== [PATCH] 胜负识别工具 ===================== */
const lc=(s:any)=>String(s??'').toLowerCase();
function isWinLikeMsg(m:any){
  const T=lc(m?.type), K=lc(m?.kind);
  const finals=new Set(['win','result','game-over','game_end','gameover','final','end','summary','scores','done']);
  return finals.has(T)||finals.has(K);
}
function extractOutcome(m:any){
  const winner = m.winner ?? m.result?.winner ?? m.final?.winner ?? null;
  const landlord = m.landlord ?? m.result?.landlord ?? m.final?.landlord ?? null;
  const mult = m.multiplier ?? m.times ?? m.beiShu ?? m.beishu ?? m.x ?? 1;
  const candidates=[m.deltaScores,m.delta,m.score_delta,m.scoresDelta,m.result?.delta,m.result?.deltaScores,m.final?.deltaScores,m.scores];
  let ds:any=candidates.find(x=>Array.isArray(x)&&x.length===3)||null;
  if(!ds && Array.isArray(m.rawScores)&&Array.isArray(m.prevScores)&&m.rawScores.length===3&&m.prevScores.length===3){
    ds=m.rawScores.map((v:number,i:number)=>v-m.prevScores[i]);
  }
  return { winner, landlord, mult, ds };
}

/* ===================== 雷达图累计 ===================== */
function mergeScore(prev:Score5,curr:Score5,mode:'mean'|'ewma',count:number,alpha:number):Score5{
  if(mode==='mean'){ const c=Math.max(0,count); return { coop:(prev.coop*c+curr.coop)/(c+1), agg:(prev.agg*c+curr.agg)/(c+1), cons:(prev.cons*c+curr.cons)/(c+1), eff:(prev.eff*c+curr.eff)/(c+1), rob:(prev.rob*c+curr.rob)/(c+1) }; }
  const a=Math.min(0.95,Math.max(0.05,alpha||0.35)); return { coop:a*curr.coop+(1-a)*prev.coop, agg:a*curr.agg+(1-a)*prev.agg, cons:a*curr.cons+(1-a)*prev.cons, eff:a*curr.eff+(1-a)*prev.eff, rob:a*curr.rob+(1-a)*prev.rob };
}
function RadarChart({title,scores}:{title:string;scores:Score5}){ const vals=[scores.coop,scores.agg,scores.cons,scores.rob,scores.eff]; const size=180,R=70,cx=size/2,cy=size/2; const pts=vals.map((v,i)=>{ const ang=(-90+i*72)*Math.PI/180; const r=(Math.max(0,Math.min(5,v))/5)*R; return `${cx+r*Math.cos(ang)},${cy+r*Math.sin(ang)}`; }).join(' '); return (
  <div style={{border:'1px solid #eee',borderRadius:8,padding:8}}>
    <div style={{fontWeight:700,marginBottom:6}}>{title}</div>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[1,2,3,4,5].map(k=>{ const r=(k/5)*R; const polygon=Array.from({length:5},(_,i)=>{ const ang=(-90+i*72)*Math.PI/180; return `${cx+r*Math.cos(ang)},${cy+r*Math.sin(ang)}`; }).join(' '); return <polygon key={k} points={polygon} fill="none" stroke="#e5e7eb"/>; })}
      {Array.from({length:5},(_,i)=>{ const ang=(-90+i*72)*Math.PI/180; return <line key={i} x1={cx} y1={cy} x2={cx+R*Math.cos(ang)} y2={cy+R*Math.sin(ang)} stroke="#e5e7eb"/>; })}
      <polygon points={pts} fill="rgba(59,130,246,.25)" stroke="#3b82f6" strokeWidth={2}/>
      {(['配合','激进','保守','抢地主','效率']).map((lab,i)=>{ const ang=(-90+i*72)*Math.PI/180; return <text key={i} x={cx+(R+14)*Math.cos(ang)} y={cy+(R+14)*Math.sin(ang)} fontSize="12" textAnchor="middle" dominantBaseline="middle" fill="#374151">{lab}</text>; })}
    </svg>
  </div>
); }
function RadarPanel({aggStats,aggCount,aggMode,alpha,onChangeMode,onChangeAlpha}:{aggStats:Score5[]|null;aggCount:number;aggMode:'mean'|'ewma';alpha:number;onChangeMode:(m:'mean'|'ewma')=>void;onChangeAlpha:(a:number)=>void;}) {
  const [mode,setMode]=useState<'mean'|'ewma'>(aggMode); const [a,setA]=useState(alpha);
  useEffect(()=>setMode(aggMode),[aggMode]); useEffect(()=>setA(alpha),[alpha]);
  return <>
    <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:8}}>
      <label>汇总方式
        <select value={mode} onChange={e=>{ const v=e.target.value as 'mean'|'ewma'; setMode(v); onChangeMode(v); }} style={{marginLeft:6}}>
          <option value="ewma">指数加权（推荐）</option><option value="mean">简单平均</option>
        </select>
      </label>
      {mode==='ewma' && <label>α（0.05–0.95）
        <input type="number" min={0.05} max={0.95} step={0.05} value={a} onChange={e=>{ const v=Math.min(0.95,Math.max(0.05,Number(e.target.value)||0.35)); setA(v); onChangeAlpha(v); }} style={{width:80,marginLeft:6}}/>
      </label>}
      <div style={{fontSize:12,color:'#6b7280'}}>{mode==='ewma'?'越大越看重最近几局':`已累计 ${aggCount} 局`}</div>
    </div>
    {aggStats? <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
      {[0,1,2].map(i=><RadarChart key={i} title={`${seatName(i)}（累计）`} scores={aggStats[i]}/>)}
    </div> : <div style={{opacity:.6}}>（等待至少一局完成后生成累计画像）</div>}
  </>;
}

/* ===================== LivePanel（核心） ===================== */
type LiveProps = {
  rounds:number; startScore:number; seatDelayMs?:number[]; enabled:boolean; rob:boolean; four2:Four2Policy; farmerCoop:boolean;
  seats:BotChoice[]; seatModels:string[]; seatKeys:{openai?:string;gemini?:string;grok?:string;kimi?:string;qwen?:string;httpBase?:string;httpToken?:string;}[];
  onTotals?:(t:[number,number,number])=>void; onLog?:(l:string[])=>void;
  getTSRating?:(id:string,role:Role)=>Rating|null; onTSApply?:(u:{id:string;role:Role;rating:Rating}[], meta:any)=>void;
  exposeRefresh?:(fn:()=>void)=>void;
};
function LivePanel(props:LiveProps){
  const [running,setRunning]=useState(false);
  const [hands,setHands]=useState<string[][]>([[],[],[]]);
  const [landlord,setLandlord]=useState<number|null>(null);
  const [plays,setPlays]=useState<{seat:number;move:'play'|'pass';cards?:string[];reason?:string}[]>([]);
  const [multiplier,setMultiplier]=useState(1);
  const [winner,setWinner]=useState<number|null>(null);
  const [delta,setDelta]=useState<[number,number,number]|null>(null);
  const [log,setLog]=useState<string[]>([]);
  const [totals,setTotals]=useState<[number,number,number]>([props.startScore||0,props.startScore||0,props.startScore||0]);
  const [finishedCount,setFinishedCount]=useState(0);
  const [tsArr,setTsArr]=useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
  const [aggMode,setAggMode]=useState<'mean'|'ewma'>('ewma'); const [alpha,setAlpha]=useState(0.35);
  const [aggStats,setAggStats]=useState<Score5[]|null>(null); const [aggCount,setAggCount]=useState(0);

  useEffect(()=>props.onTotals?.(totals),[totals]); useEffect(()=>props.onLog?.(log),[log]);

  const controllerRef=useRef<AbortController|null>(null);
  const handsRef=useRef(hands), playsRef=useRef(plays), totalsRef=useRef(totals), finishedRef=useRef(finishedCount);
  const logRef=useRef(log), landlordRef=useRef(landlord), winnerRef=useRef(winner), deltaRef=useRef(delta), multiplierRef=useRef(multiplier);
  const aggStatsRef=useRef(aggStats), aggCountRef=useRef(aggCount), aggModeRef=useRef(aggMode), alphaRef=useRef(alpha);
  const tsRef=useRef(tsArr);
  useEffect(()=>{handsRef.current=hands;},[hands]); useEffect(()=>{playsRef.current=plays;},[plays]);
  useEffect(()=>{totalsRef.current=totals;},[totals]); useEffect(()=>{finishedRef.current=finishedCount;},[finishedCount]);
  useEffect(()=>{logRef.current=log;},[log]); useEffect(()=>{landlordRef.current=landlord;},[landlord]);
  useEffect(()=>{winnerRef.current=winner;},[winner]); useEffect(()=>{deltaRef.current=delta;},[delta]);
  useEffect(()=>{multiplierRef.current=multiplier;},[multiplier]); useEffect(()=>{aggStatsRef.current=aggStats;},[aggStats]);
  useEffect(()=>{aggCountRef.current=aggCount;},[aggCount]); useEffect(()=>{aggModeRef.current=aggMode;},[aggMode]);
  useEffect(()=>{alphaRef.current=alpha;},[alpha]); useEffect(()=>{tsRef.current=tsArr;},[tsArr]);

  const lastReasonRef=useRef<(string|null)[]>([null,null,null]);
  const appliedTSFromBookRef=useRef(false);
  const seatIdsRef=useRef<string[]>([]);
  const roundFinishedRef=useRef(false);
  const seenStatsRef=useRef(false);
  const fmt2=(x:number)=>(Math.round(x*100)/100).toFixed(2);
  const tsCr=(r:Rating)=>r.mu-3*r.sigma;

  const idFromSpec=(s:any)=>{ if(s.choice==='http'){ const base=(s.baseUrl||'default').trim().toLowerCase(); return `http:${base||'default'}`; } if(String(s.choice||'').startsWith('ai:')){ const ch=String(s.choice||'').toLowerCase(); const m=(s.model||'').trim()||defaultModelFor(s.choice); return `${ch}:${m.toLowerCase()}`; } return String(s.choice||''); };

  /* 刷新先验（按钮调用 & 发牌时自动） */
  const refreshTSFromBook=()=>{
    if(!props.getTSRating){ setLog(l=>[...l,'【TS】未配置记录簿读取函数 getTSRating。']); return; }
    const lord=landlordRef.current;
    if(lord==null){
      const preSpecs=props.seats.slice(0,3).map((c,i)=>{ const m=normalizeModelForProvider(c,props.seatModels[i]||'')||defaultModelFor(c); const k=props.seatKeys[i]||{}; return c==='http'?{choice:c,baseUrl:k.httpBase||''}:{choice:c,model:m}; });
      const ids=preSpecs.map(idFromSpec); const init:[Rating,Rating,Rating]=[0,1,2].map(i=>props.getTSRating!(ids[i],'F')||TS_DEFAULT) as any;
      setTsArr(init); setLog(l=>[...l,'【TS】手动刷新先验（预览）：尚未确定地主，按农民(F)口径载入。']); return;
    }
    const ids=seatIdsRef.current; const initR:[Rating,Rating,Rating]=[0,1,2].map(i=>props.getTSRating!(ids[i], i===lord?'L':'F')||TS_DEFAULT) as any;
    setTsArr(initR); appliedTSFromBookRef.current=true;
    const hit=[0,1,2].map(i=>props.getTSRating!(ids[i],i===lord?'L':'F')?'命中':'默认');
    setLog(l=>[...l,`【TS】手动刷新先验：${['甲','乙','丙'].map((n,i)=>`${n}(${i===lord?'L':'F'}):${hit[i]}`).join(' ｜ ')}`]);
  };
  useEffect(()=>{ props.exposeRefresh?.(refreshTSFromBook); },[props.exposeRefresh]);

  const start=async()=>{
    if(running) return;
    if(!props.enabled){ setLog(l=>[...l,'【前端】未启用对局：请在设置中勾选“启用对局”。']); return; }
    setRunning(true);
    setLandlord(null); setHands([[],[],[]]); setPlays([]); setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0); setTotals([props.startScore||0,props.startScore||0,props.startScore||0]);
    lastReasonRef.current=[null,null,null]; setAggStats(null); setAggCount(0); setTsArr([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
    controllerRef.current=new AbortController();

    const buildSeatSpecs=()=>props.seats.slice(0,3).map((c,i)=>{ const norm=normalizeModelForProvider(c,props.seatModels[i]||''); const model=norm||defaultModelFor(c); const k=props.seatKeys[i]||{}; switch(c){ case 'ai:openai':return{choice:c,model,apiKey:k.openai||''}; case 'ai:gemini':return{choice:c,model,apiKey:k.gemini||''}; case 'ai:grok':return{choice:c,model,apiKey:k.grok||''}; case 'ai:kimi':return{choice:c,model,apiKey:k.kimi||''}; case 'ai:qwen':return{choice:c,model,apiKey:k.qwen||''}; case 'http':return{choice:c,model,baseUrl:k.httpBase||'',token:k.httpToken||''}; default:return{choice:c}; }});
    const seatSummary=(specs:any[])=>specs.map((s,i)=> s.choice.startsWith('built-in')? `${seatName(i)}=${choiceLabel(s.choice)}`
      : s.choice==='http'? `${seatName(i)}=HTTP(${s.baseUrl?'custom':'default'})`
      : `${seatName(i)}=${choiceLabel(s.choice)}(${s.model||defaultModelFor(s.choice)})`).join(', ');

    // 在闭包内的“完成一局”工具
    const markRoundFinishedIfNeeded=(nextFinished:number,nextAggStats:Score5[]|null,nextAggCount:number)=>{
      if(!roundFinishedRef.current){
        if(!seenStatsRef.current){
          const neutral:Score5={coop:2.5,agg:2.5,cons:2.5,eff:2.5,rob:2.5}; const mode=aggModeRef.current, a=alphaRef.current;
          if(!nextAggStats){ nextAggStats=[neutral,neutral,neutral]; nextAggCount=1; }
          else { nextAggStats=nextAggStats.map(prev=>mergeScore(prev,neutral,mode,nextAggCount,a)); nextAggCount=nextAggCount+1; }
        }
        roundFinishedRef.current=true; nextFinished=nextFinished+1;
      }
      return { nextFinished, nextAggStats, nextAggCount };
    };

    const playOneGame=async (_i:number, n:number)=>{
      setLog([]); lastReasonRef.current=[null,null,null];
      const specs=buildSeatSpecs(); const trace=Math.random().toString(36).slice(2,10)+'-'+Date.now().toString(36);
      setLog(l=>[...l,`【前端】开始第 ${n} 局 | 座位: ${seatSummary(specs)} | coop=${props.farmerCoop?'on':'off'} | trace=${trace}`]);
      roundFinishedRef.current=false; seenStatsRef.current=false; appliedTSFromBookRef.current=false;
      seatIdsRef.current=specs.map(idFromSpec);

      const r=await fetch('/api/stream_ndjson',{ method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({
        rounds:1,startScore:props.startScore,seatDelayMs:props.seatDelayMs,enabled:props.enabled,rob:props.rob,four2:props.four2,seats:specs,clientTraceId:trace,stopBelowZero:true,farmerCoop:props.farmerCoop
      }), signal:controllerRef.current!.signal });
      if(!r.ok||!r.body) throw new Error(`HTTP ${r.status}`);

      const reader=r.body.getReader(); const decoder=new TextDecoder('utf-8'); let buf=''; const rewrite=makeRewriteRoundLabel(n);

      while(true){
        const {value,done}=await reader.read(); if(done) break;
        buf+=decoder.decode(value,{stream:true});
        let idx:number; const batch:any[]=[];
        while((idx=buf.indexOf('\n'))>=0){ const line=buf.slice(0,idx).trim(); buf=buf.slice(idx+1); if(!line) continue; try{batch.push(JSON.parse(line));}catch{} }

        if(batch.length){
          let nextHands=handsRef.current.map(x=>[...x]); let nextPlays=[...playsRef.current];
          let nextTotals=[...totalsRef.current] as [number,number,number];
          let nextFinished=finishedRef.current; let nextLog=[...logRef.current];
          let nextLandlord=landlordRef.current; let nextWinner=winnerRef.current as number|null;
          let nextDelta=deltaRef.current as [number,number,number]|null; let nextMul=multiplierRef.current;
          let nextAggStats=aggStatsRef.current; let nextAggCount=aggCountRef.current;

          for(const raw of batch){
            const m:any=raw;
            try{
              if(m.type==='ts' && Array.isArray(m.ratings) && m.ratings.length===3){
                const incoming:Rating[]=m.ratings.map((r:any)=>({mu:Number(r.mu)||25,sigma:Number(r.sigma)||25/3}));
                if(m.where==='before-round' && appliedTSFromBookRef.current){ nextLog=[...nextLog,'【TS】忽略后端 before-round 覆盖（已用导入先验）']; }
                else setTsArr(incoming);
                if(m.where==='after-round'){ const res=markRoundFinishedIfNeeded(nextFinished,nextAggStats,nextAggCount); nextFinished=res.nextFinished; nextAggStats=res.nextAggStats; nextAggCount=res.nextAggCount; nextLog=[...nextLog,'【TS】after-round 已更新 μ/σ']; }
                else if(m.where==='before-round'){ nextLog=[...nextLog,'【TS】before-round μ/σ 准备就绪']; }
                continue;
              }

              if(m.type==='event' && m.kind==='round-start'){ nextLog=[...nextLog,`【边界】round-start #${m.round}`]; continue; }
              if(m.type==='event' && m.kind==='round-end'){ nextLog=[...nextLog,`【边界】round-end #${m.round}`]; const res=markRoundFinishedIfNeeded(nextFinished,nextAggStats,nextAggCount); nextFinished=res.nextFinished; nextAggStats=res.nextAggStats; nextAggCount=res.nextAggCount; continue; }

              const rh=m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
              if(Array.isArray(rh) && rh.length===3 && Array.isArray(rh[0])){
                nextPlays=[]; nextWinner=null; nextDelta=null; nextMul=1;
                const decorated:string[][]=(rh as string[][]).map(decorateHandCycle); nextHands=decorated;
                const lord=m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null; nextLandlord=lord;
                nextLog=[...nextLog,`发牌完成，${lord!=null?seatName(lord):'?'}为地主`]; lastReasonRef.current=[null,null,null];

                if(lord!=null && props.getTSRating){
                  const ids=seatIdsRef.current;
                  const init:[Rating,Rating,Rating]=[0,1,2].map(i=>props.getTSRating!(ids[i], i===lord?'L':'F')||TS_DEFAULT) as any;
                  setTsArr(init); appliedTSFromBookRef.current=true;
                  const hit=[0,1,2].map(i=>props.getTSRating!(ids[i], i===lord?'L':'F')?'命中':'默认');
                  nextLog=[...nextLog,`【TS】载入先验（精确匹配）：${['甲','乙','丙'].map((n,i)=>`${n}(${i===lord?'L':'F'}):${hit[i]}`).join(' ｜ ')}`];
                }
                continue;
              }

              if(m.type==='event' && m.kind==='bot-call'){ nextLog=[...nextLog,`AI调用｜${seatName(m.seat)}｜${m.by}${m.model?`(${m.model})`:''}｜阶段=${m.phase||'unknown'}${m.need?`｜需求=${m.need}`:''}`]; continue; }
              if(m.type==='event' && m.kind==='bot-done'){ nextLog=[...nextLog,`AI完成｜${seatName(m.seat)}｜${m.by}${m.model?`(${m.model})`:''}｜耗时=${m.tookMs}ms`, ...(m.reason?[`AI理由｜${seatName(m.seat)}：${m.reason}`]:[])]; lastReasonRef.current[m.seat]=m.reason||null; continue; }
              if(m.type==='event' && m.kind==='rob'){ nextLog=[...nextLog,`${seatName(m.seat)} ${m.rob?'抢地主':'不抢'}`]; continue; }
              if(m.type==='event' && m.kind==='trick-reset'){ nextLog=[...nextLog,'一轮结束，重新起牌']; nextPlays=[]; continue; }

              if(m.type==='event' && m.kind==='play'){
                if(m.move==='pass'){ const reason=(m.reason ?? lastReasonRef.current[m.seat])||undefined; lastReasonRef.current[m.seat]=null; nextPlays=[...nextPlays,{seat:m.seat,move:'pass',reason}]; nextLog=[...nextLog,`${seatName(m.seat)} 过${reason?`（${reason}）`:''}`]; }
                else {
                  const pretty:string[]=[]; const seat=m.seat as number; const cards:string[]=m.cards||[]; const nh=nextHands.map(x=>[...x]);
                  for(const rawCard of cards){ const opts=candDecorations(rawCard); const chosen=opts.find(d=>nh[seat].includes(d))||opts[0]; const k=nh[seat].indexOf(chosen); if(k>=0) nh[seat].splice(k,1); pretty.push(chosen); }
                  const reason=(m.reason ?? lastReasonRef.current[m.seat])||undefined; lastReasonRef.current[m.seat]=null;
                  nextHands=nh; nextPlays=[...nextPlays,{seat:m.seat,move:'play',cards:pretty,reason}]; nextLog=[...nextLog,`${seatName(m.seat)} 出牌：${pretty.join(' ')}${reason?`（理由：${reason}）`:''}`];
                }
                continue;
              }

              /* ============== [PATCH] 胜负/结果的宽容识别 ============== */
              if (isWinLikeMsg(m)) {
                const {winner:win0, landlord:land0, mult, ds} = extractOutcome(m);
                let L = (nextLandlord ?? land0 ?? 0) as number;
                nextLandlord = (nextLandlord ?? land0 ?? null);

                if (Array.isArray(ds) && ds.length===3) {
                  const rot:[number,number,number]=[
                    ds[(0-L+3)%3], ds[(1-L+3)%3], ds[(2-L+3)%3]
                  ] as any;
                  nextDelta=rot;
                  nextTotals=[ nextTotals[0]+rot[0], nextTotals[1]+rot[1], nextTotals[2]+rot[2] ] as any;
                }

                let nextWinnerLocal = (win0 ?? nextWinner ?? null) as number|null;
                if (nextWinnerLocal==null && Array.isArray(ds)) {
                  const lDelta = ds[0] ?? 0;
                  if (lDelta>0) nextWinnerLocal=L;
                  else if (lDelta<0) nextWinnerLocal=[0,1,2].find(x=>x!==L)!;
                }
                nextWinner=nextWinnerLocal; nextMul = mult ?? nextMul ?? 1;

                const res=markRoundFinishedIfNeeded(nextFinished,nextAggStats,nextAggCount);
                nextFinished=res.nextFinished; nextAggStats=res.nextAggStats; nextAggCount=res.nextAggCount;

                if (nextLandlord!=null && Array.isArray(ds) && ds.length===3) {
                  const updated=tsRef.current.map(r=>({...r}));
                  const farmers=[0,1,2].filter(s=>s!==L);
                  const landlordWin=(nextWinnerLocal===L)||((ds[0]??0)>0);
                  landlordWin ? tsUpdateTwoTeams(updated,[L],farmers) : tsUpdateTwoTeams(updated,farmers,[L]);
                  setTsArr(updated);

                  if (props.onTSApply) {
                    const ids=seatIdsRef.current;
                    const ups=[
                      {id:ids[L],role:'L' as Role,rating:updated[L]},
                      {id:ids[farmers[0]],role:'F' as Role,rating:updated[farmers[0]]},
                      {id:ids[farmers[1]],role:'F' as Role,rating:updated[farmers[1]]},
                    ];
                    props.onTSApply(ups,{landlord:L,farmerIdxs:farmers,seatIds:ids,round:n});
                  }
                }

                nextLog=[...nextLog,`【TS】finalize：L=${nextLandlord??'-'} Winner=${nextWinner??'-'} x${nextMul}`];
                continue;
              }
              /* ============== [PATCH] 结束 ============== */

              if(m.type==='log' && typeof m.message==='string'){ nextLog=[...nextLog,rewrite(m.message)]; continue; }
            }catch(e){ console.error('[ingest:batch]',e,raw); }
          }

          setHands(nextHands); setPlays(nextPlays);
          setTotals(nextTotals); setFinishedCount(nextFinished);
          setLog(nextLog); setLandlord(nextLandlord);
          setWinner(nextWinner); setMultiplier(nextMul); setDelta(nextDelta);
          setAggStats(nextAggStats||null); setAggCount(nextAggCount||0);
        }
      }

      /* ============== [PATCH] 流结束兜底 ============== */
      if(!roundFinishedRef.current){
        let nf=finishedRef.current, na=aggStatsRef.current, nc=aggCountRef.current;
        const res={...{nextFinished:nf,nextAggStats:na,nextAggCount:nc}};
        // 复用闭包函数推进（用中性画像）
        const fin=(()=>{ const nres=(function(nextFinished:number,nextAggStats:Score5[]|null,nextAggCount:number){
          if(!seenStatsRef.current){ const neutral:Score5={coop:2.5,agg:2.5,cons:2.5,eff:2.5,rob:2.5}; const mode=aggModeRef.current, a=alphaRef.current;
            if(!nextAggStats){ nextAggStats=[neutral,neutral,neutral]; nextAggCount=1; }
            else { nextAggStats=nextAggStats.map(prev=>mergeScore(prev,neutral,mode,nextAggCount,a)); nextAggCount=nextAggCount+1; } }
          roundFinishedRef.current=true; return { nextFinished:nextFinished+1, nextAggStats, nextAggCount };
        })(res.nextFinished,res.nextAggStats,res.nextAggCount); return nres; })();
        setFinishedCount(fin.nextFinished); setAggStats(fin.nextAggStats||null); setAggCount(fin.nextAggCount);
        setLog(l=>[...l,'【前端】兜底：流结束但未收到 win/result，已计为完成一局（TS 保持不变）。']);
      }
      /* ============== [PATCH] 兜底结束 ============== */

      setLog(l=>[...l,'—— 本局流结束 ——']);
    };

    try{
      for(let i=0;i<props.rounds;i++){
        if(controllerRef.current?.signal.aborted) break;
        await playOneGame(i,i+1);
        const hasNeg=Array.isArray(totalsRef.current)&&totalsRef.current.some(v=>(v as number)<0);
        if(hasNeg){ setLog(l=>[...l,'【前端】检测到总分 < 0，停止连打。']); break; }
        await new Promise(r=>setTimeout(r,800+Math.floor(Math.random()*600)));
      }
    }catch(e:any){
      if(e?.name==='AbortError') setLog(l=>[...l,'已手动停止。']);
      else setLog(l=>[...l,`错误：${e?.message||e}`]);
    }finally{ setRunning(false); }
  };

  const stop=()=>{ controllerRef.current?.abort(); setRunning(false); };
  const remaining=Math.max(0,(props.rounds||1)-finishedCount);

  const getSeatIdForIdx=(i:number)=>{ const ids=seatIdsRef.current; if(ids&&ids[i]) return ids[i];
    const c=props.seats[i]; const norm=normalizeModelForProvider(c,props.seatModels[i]||''); const model=norm||defaultModelFor(c); const k=props.seatKeys[i]||{};
    const spec=c==='http'?{choice:c,baseUrl:k.httpBase||''}:{choice:c,model}; return idFromSpec(spec);
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
        <span style={{display:'inline-flex',alignItems:'center',padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:8,fontSize:12,background:'#fff'}}>剩余局数：{remaining}</span>
      </div>

      <Section title="TrueSkill（实时）">
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
          {[0,1,2].map(i=>{
            const lord=landlord; const role:Role|null=lord==null?null:(i===lord?'L':'F'); const preGame=lord==null;
            const seatId=getSeatIdForIdx(i);
            const bookL=props.getTSRating?(props.getTSRating(seatId,'L')||TS_DEFAULT):TS_DEFAULT;
            const bookF=props.getTSRating?(props.getTSRating(seatId,'F')||TS_DEFAULT):TS_DEFAULT;
            const rL=role==='L'?tsArr[i]:bookL; const rF=(role==='F'||preGame)?tsArr[i]:bookF;
            const CR=(r:Rating)=>(r.mu-3*r.sigma);
            return <div key={i} style={{border:'1px solid #eee',borderRadius:8,padding:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                <div><SeatTitle i={i}/> {lord===i&&<span style={{marginLeft:6,color:'#bf7f00'}}>（地主）</span>}</div>
              </div>
              <div style={{fontSize:13,color:'#374151',lineHeight:1.65}}>
                <div style={{fontWeight:700,marginBottom:2}}>按角色：</div>
                <div><span style={{width:70,display:'inline-block'}}>L（地主）</span> μ：<b>{fmt2(rL.mu)}</b>　σ：<b>{fmt2(rL.sigma)}</b>　CR：<b>{fmt2(CR(rL))}</b>{role==='L'&&<span style={{marginLeft:6,color:'#bf7f00'}}>（实时）</span>}</div>
                <div><span style={{width:70,display:'inline-block'}}>F（农民）</span> μ：<b>{fmt2(rF.mu)}</b>　σ：<b>{fmt2(rF.sigma)}</b>　CR：<b>{fmt2(CR(rF))}</b>{(role==='F'||preGame)&&<span style={{marginLeft:6,color:'#bf7f00'}}>{preGame?'（预览）':'（实时）'}</span>}</div>
              </div>
            </div>;
          })}
        </div>
        <div style={{fontSize:12,color:'#6b7280',marginTop:6}}>说明：当前局的真实角色行标注“实时”；未发牌且点过“刷新先验”时，F 行为导入记录簿的预览先验。</div>
      </Section>

      <Section title="积分（总分）">
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
          {[0,1,2].map(i=><div key={i} style={{border:'1px solid #eee',borderRadius:8,padding:10}}>
            <div><SeatTitle i={i}/></div><div style={{fontSize:24,fontWeight:800}}>{totals[i]}</div>
          </div>)}
        </div>
      </Section>

      <Section title="战术画像（累计，0~5）">
        <RadarPanel aggStats={aggStats} aggCount={aggCount} aggMode={aggMode} alpha={alpha} onChangeMode={setAggMode} onChangeAlpha={setAlpha}/>
      </Section>

      <Section title="手牌">
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
          {[0,1,2].map(i=><div key={i} style={{border:'1px solid #eee',borderRadius:8,padding:8}}>
            <div style={{marginBottom:6}}><SeatTitle i={i}/> {landlord===i&&<span style={{marginLeft:6,color:'#bf7f00'}}>（地主）</span>}</div>
            <Hand cards={hands[i]} />
          </div>)}
        </div>
      </Section>

      <Section title="出牌">
        <div style={{border:'1px dashed #eee',borderRadius:8,padding:'6px 8px'}}>
          {plays.length===0 ? <div style={{opacity:.6}}>（尚无出牌）</div> : plays.map((p,i)=><PlayRow key={i} seat={p.seat} move={p.move} cards={p.cards} reason={p.reason}/>)}
        </div>
      </Section>

      <Section title="结果">
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
          <div style={{border:'1px solid #eee',borderRadius:8,padding:10}}><div>倍数</div><div style={{fontSize:24,fontWeight:800}}>{multiplier}</div></div>
          <div style={{border:'1px solid #eee',borderRadius:8,padding:10}}><div>胜者</div><div style={{fontSize:24,fontWeight:800}}>{winner==null?'—':seatName(winner)}</div></div>
          <div style={{border:'1px solid #eee',borderRadius:8,padding:10}}><div>本局加减分</div><div style={{fontSize:20,fontWeight:700}}>{delta?delta.join(' / '):'—'}</div></div>
        </div>
      </Section>

      <div style={{display:'flex',gap:8}}>
        <button onClick={start} style={{padding:'8px 12px',borderRadius:8,background:'#222',color:'#fff'}}>开始</button>
        <button onClick={stop} style={{padding:'8px 12px',borderRadius:8}}>停止</button>
      </div>

      <div style={{marginTop:18}}>
        <Section title="运行日志">
          <div style={{border:'1px solid #eee',borderRadius:8,padding:'8px 10px',maxHeight:420,overflow:'auto',background:'#fafafa'}}>
            {log.length===0 ? <div style={{opacity:.6}}>（暂无）</div> : log.map((t,i)=><LogLine key={i} text={t}/>)}
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ===================== 默认设置 & 记录簿（导入/导出） ===================== */
const DEFAULTS={ enabled:true, rounds:10, startScore:100, rob:true, four2:'both' as Four2Policy, farmerCoop:true, seatDelayMs:[1000,1000,1000] as number[],
  seats:['built-in:greedy-max','built-in:greedy-min','built-in:random-legal'] as BotChoice[], seatModels:['gpt-4o-mini','gemini-1.5-flash','grok-2-latest'],
  seatKeys:[{openai:''},{gemini:''},{httpBase:'',httpToken:''}] as any[] };

function Home(){
  const [resetKey,setResetKey]=useState(0);
  const [enabled,setEnabled]=useState(DEFAULTS.enabled);
  const [rounds,setRounds]=useState(DEFAULTS.rounds);
  const [startScore,setStartScore]=useState(DEFAULTS.startScore);
  const [rob,setRob]=useState(DEFAULTS.rob);
  const [four2,setFour2]=useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop,setFarmerCoop]=useState(DEFAULTS.farmerCoop);
  const [seatDelayMs,setSeatDelayMs]=useState(DEFAULTS.seatDelayMs);
  const setSeatDelay=(i:number,v:number|string)=>setSeatDelayMs(a=>{const n=[...a]; n[i]=Math.max(0,Math.floor(Number(v)||0)); return n;});
  const [seats,setSeats]=useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels,setSeatModels]=useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys,setSeatKeys]=useState(DEFAULTS.seatKeys);
  const [liveLog,setLiveLog]=useState<string[]>([]);
  const [tsBook,setTsBook]=useState<TSBook>({});

  const upsertEntry=(id:string)=>setTsBook(prev=> prev[id]?prev : ({...prev,[id]:makeEmptyEntry(labelForId(id))}));

  const getTSRating=(id:string,role:Role):Rating|null=> tsBook[id] ? (role==='L'?{mu:tsBook[id].L.mu,sigma:tsBook[id].L.sigma}:{mu:tsBook[id].F.mu,sigma:tsBook[id].F.sigma}) : null;

  const onTSApply=(updates:{id:string;role:Role;rating:Rating}[])=>{
    setTsBook(prev=>{ const next:TSBook={...prev}; const now=new Date().toISOString();
      for(const u of updates){ if(!next[u.id]) next[u.id]=makeEmptyEntry(labelForId(u.id));
        if(u.role==='L') next[u.id].L={...next[u.id].L,mu:u.rating.mu,sigma:u.rating.sigma,games:(next[u.id].L.games||0)+1};
        else next[u.id].F={...next[u.id].F,mu:u.rating.mu,sigma:u.rating.sigma,games:(next[u.id].F.games||0)+1};
        next[u.id].overallCR=computeOverall(next[u.id]); next[u.id].updatedAt=now;
      } return next; });
  };

  const normalizeSeatId=(c:BotChoice, mRaw:string, k:any)=> c==='http'
    ? `http:${(k?.httpBase||'default').trim().toLowerCase()||'default'}`
    : String(c).startsWith('ai:') ? `${String(c).toLowerCase()}:${(normalizeModelForProvider(c,mRaw)||defaultModelFor(c)).toLowerCase()}` : String(c);

  const makeTemplate=()=>{ const entries:TSBook={}; for(const id of SUPPORTED_DEFAULT_IDS){ entries[id]=makeEmptyEntry(labelForId(id)); entries[id].overallCR=computeOverall(entries[id]); } setTsBook(entries); };
  const downloadJSON=(obj:any,filename:string)=>{ const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url); };
  const onDownloadTS=()=>downloadJSON({version:1,updatedAt:new Date().toISOString(),params:{mu0:25,sigma0:25/3,beta:TS_BETA,tau:TS_TAU,drawProbability:0},entries:tsBook},`trueskill_book_${Date.now()}.json`);
  const onUploadTS=(file:File)=>{ const r=new FileReader(); r.onload=()=>{ try{ const obj=JSON.parse(String(r.result||'{}')); if(obj?.entries&&typeof obj.entries==='object'){ const ent:TSBook=obj.entries; const cleaned:TSBook={}; Object.entries(ent).forEach(([id,e])=>{ if(!e||typeof e!=='object') return; const label=(e as any).label||labelForId(id);
        const L=(e as any).L&&typeof (e as any).L.mu==='number'&&typeof (e as any).L.sigma==='number'?{mu:(e as any).L.mu,sigma:(e as any).L.sigma,games:(e as any).L.games||0}:{...TS_DEFAULT,games:0};
        const F=(e as any).F&&typeof (e as any).F.mu==='number'&&typeof (e as any).F.sigma==='number'?{mu:(e as any).F.mu,sigma:(e as any).F.sigma,games:(e as any).F.games||0}:{...TS_DEFAULT,games:0};
        cleaned[id]={label,L,F,overallCR:0,updatedAt:(e as any).updatedAt||new Date().toISOString()}; cleaned[id].overallCR=computeOverall(cleaned[id]); });
        setTsBook(cleaned);
      } else alert('文件格式不正确：缺少 entries 字段');
    }catch(err:any){ alert('无法解析 JSON：'+(err?.message||String(err))); } }; r.readAsText(file); };

  const refreshTSFromBookRef=useRef<null|(()=>void)>(null);
  const doResetAll=()=>{ setEnabled(DEFAULTS.enabled); setRounds(DEFAULTS.rounds); setStartScore(DEFAULTS.startScore); setRob(DEFAULTS.rob); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]); setSeats([...DEFAULTS.seats]); setSeatModels([...DEFAULTS.seatModels]); setSeatKeys(DEFAULTS.seatKeys.map((x:any)=>({...x})));
    setLiveLog([]); setResetKey(k=>k+1);
  };

  return (
    <div style={{maxWidth:1080,margin:'24px auto',padding:'0 16px'}}>
      <h1 style={{fontSize:28,fontWeight:900,margin:'6px 0 16px'}}>斗地主 · Bot Arena</h1>

      <div style={{border:'1px solid #eee',borderRadius:12,padding:14,marginBottom:16}}>
        <div style={{fontSize:18,fontWeight:800,marginBottom:6}}>对局设置</div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <label style={{display:'flex',alignItems:'center',gap:8}}>启用对局 <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/></label>
              <button onClick={doResetAll} style={{padding:'4px 10px',border:'1px solid #e5e7eb',borderRadius:8,background:'#fff'}}>清空</button>
            </div>
            <div style={{fontSize:12,color:'#6b7280',marginTop:4}}>关闭后不可开始/继续对局；再次勾选即可恢复。</div>
          </div>

          <label>局数 <input type="number" min={1} step={1} value={rounds} onChange={e=>setRounds(Math.max(1,Math.floor(Number(e.target.value)||1)))} style={{width:'100%'}}/></label>
          <label>初始分 <input type="number" step={10} value={startScore} onChange={e=>setStartScore(Number(e.target.value)||0)} style={{width:'100%'}}/></label>
          <label>可抢地主 <div><input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)}/></div></label>
          <label>农民配合 <div><input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)}/></div></label>
          <label>4带2 规则
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{width:'100%'}}>
              <option value="both">都可</option><option value="2singles">两张单牌</option><option value="2pairs">两对</option>
            </select>
          </label>
        </div>

        {/* TrueSkill 记录（导入/导出） */}
        <div style={{marginTop:12,borderTop:'1px dashed #eee',paddingTop:12}}>
          <div style={{fontWeight:700,marginBottom:6}}>TrueSkill 记录（导入 / 导出）</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
            <button onClick={makeTemplate} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:8,background:'#fff'}}>生成模板（含内置与 AI 默认）</button>
            <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:8,background:'#fff',cursor:'pointer'}}>
              导入 JSON <input type="file" accept="application/json" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0]; if(f) onUploadTS(f); e.currentTarget.value='';}}/>
            </label>
            <button onClick={()=>refreshTSFromBookRef.current?.()} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:8,background:'#fff'}}>刷新先验（从记录簿）</button>
            <button onClick={onDownloadTS} style={{padding:'6px 10px',border:'1px solid #e5e7eb',borderRadius:8,background:'#fff'}}>下载当前记录</button>
            <div style={{fontSize:12,color:'#6b7280'}}>说明：导入用于下一次比赛的先验；每局结束把对应参赛体的 L/F TrueSkill 写回记录簿，并计算总分（CR_total）。</div>
          </div>

          {/* 当前三家记录簿先验（三列，L/F 两行） */}
          <div style={{marginTop:10}}>
            <div style={{fontSize:12,color:'#374151',marginBottom:6}}>当前三家记录簿先验（按角色）</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              {[0,1,2].map(i=>{
                const id=normalizeSeatId(seats[i],seatModels[i],seatKeys[i]); const e=tsBook[id];
                const rL=e?.L||TS_DEFAULT, rF=e?.F||TS_DEFAULT; const CR=(r:Rating)=>r.mu-3*r.sigma;
                return <div key={i} style={{border:'1px solid #eee',borderRadius:8,padding:10}}>
                  <div style={{fontWeight:700,marginBottom:6}}>{seatName(i)}</div>
                  <div style={{fontSize:13,color:'#374151',lineHeight:1.65}}>
                    <div><span style={{width:70,display:'inline-block'}}>L（地主）</span> μ：<b>{rL.mu.toFixed(2)}</b>　σ：<b>{rL.sigma.toFixed(2)}</b>　CR：<b>{CR(rL).toFixed(2)}</b></div>
                    <div><span style={{width:70,display:'inline-block'}}>F（农民）</span> μ：<b>{rF.mu.toFixed(2)}</b>　σ：<b>{rF.sigma.toFixed(2)}</b>　CR：<b>{CR(rF).toFixed(2)}</b></div>
                  </div>
                  <div style={{fontSize:12,color:'#6b7280',marginTop:4}}>{e?<span>来源：{e.label}</span>:<span>未记录，用默认先验</span>}</div>
                </div>;
              })}
            </div>
          </div>

          {/* 全部条目列表（可滚动） */}
          {Object.keys(tsBook).length>0 && (
            <div style={{marginTop:10,border:'1px dashed #eee',borderRadius:8,padding:10,maxHeight:220,overflow:'auto',background:'#fafafa'}}>
              <div style={{fontSize:12,color:'#374151',marginBottom:6}}>记录簿条目（全部 {Object.keys(tsBook).length} 个）：</div>
              {Object.entries(tsBook).map(([id,e])=><div key={id} style={{fontSize:12,color:'#4b5563',padding:'2px 0'}}>
                <b>{e.label}</b> <span style={{opacity:.7}}>（{id}）</span> ｜ L μ={e.L.mu.toFixed(2)} σ={e.L.sigma.toFixed(2)}（{e.L.games||0}）｜ F μ={e.F.mu.toFixed(2)} σ={e.F.sigma.toFixed(2)}（{e.F.games||0}）｜ 总分CR={Number(e.overallCR||0).toFixed(2)}
              </div>)}
            </div>
          )}
        </div>

        {/* 每家 AI 设置 */}
        <div style={{marginTop:10,borderTop:'1px dashed #eee',paddingTop:10}}>
          <div style={{fontWeight:700,marginBottom:6}}>每家 AI 设置（独立）</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
            {[0,1,2].map(i=><div key={i} style={{border:'1px dashed #ccc',borderRadius:8,padding:10}}>
              <div style={{fontWeight:700,marginBottom:8}}>{seatName(i)}</div>
              <label style={{display:'block',marginBottom:6}}>选择
                <select value={seats[i]} onChange={e=>{ const v=e.target.value as BotChoice; setSeats(a=>{const n=[...a]; n[i]=v; return n;}); upsertEntry(normalizeSeatId(v,seatModels[i],seatKeys[i])); }} style={{width:'100%'}}>
                  <optgroup label="内置"><option value="built-in:greedy-max">Greedy Max</option><option value="built-in:greedy-min">Greedy Min</option><option value="built-in:random-legal">Random Legal</option></optgroup>
                  <optgroup label="AI"><option value="ai:openai">OpenAI</option><option value="ai:gemini">Gemini</option><option value="ai:grok">Grok</option><option value="ai:kimi">Kimi</option><option value="ai:qwen">Qwen</option><option value="http">HTTP</option></optgroup>
                </select>
              </label>

              {seats[i].startsWith('ai:') && <label style={{display:'block',marginBottom:6}}>模型（可选）
                <input type="text" value={normalizeModelForProvider(seats[i],seatModels[i])} placeholder={defaultModelFor(seats[i])}
                  onChange={e=>{ const v=e.target.value; setSeatModels(a=>{const n=[...a]; n[i]=v; return n;}); upsertEntry(normalizeSeatId(seats[i],v,seatKeys[i])); }} style={{width:'100%'}}/>
                <div style={{fontSize:12,color:'#777',marginTop:4}}>留空则使用推荐：{defaultModelFor(seats[i])}</div>
              </label>}

              {seats[i]==='ai:openai' && <label style={{display:'block',marginBottom:6}}>OpenAI API Key
                <input type="password" value={seatKeys[i]?.openai||''} onChange={e=>setSeatKeys(a=>{const n=[...a]; n[i]={...(n[i]||{}),openai:e.target.value}; return n;})} style={{width:'100%'}}/>
              </label>}

              {seats[i]==='ai:gemini' && <label style={{display:'block',marginBottom:6}}>Gemini API Key
                <input type="password" value={seatKeys[i]?.gemini||''} onChange={e=>setSeatKeys(a=>{const n=[...a]; n[i]={...(n[i]||{}),gemini:e.target.value}; return n;})} style={{width:'100%'}}/>
              </label>}

              {seats[i]==='ai:grok' && <label style={{display:'block',marginBottom:6}}>xAI (Grok) API Key
                <input type="password" value={seatKeys[i]?.grok||''} onChange={e=>setSeatKeys(a=>{const n=[...a]; n[i]={...(n[i]||{}),grok:e.target.value}; return n;})} style={{width:'100%'}}/>
              </label>}

              {seats[i]==='ai:kimi' && <label style={{display:'block',marginBottom:6}}>Kimi API Key
                <input type="password" value={seatKeys[i]?.kimi||''} onChange={e=>setSeatKeys(a=>{const n=[...a]; n[i]={...(n[i]||{}),kimi:e.target.value}; return n;})} style={{width:'100%'}}/>
              </label>}

              {seats[i]==='ai:qwen' && <label style={{display:'block',marginBottom:6}}>Qwen API Key
                <input type="password" value={seatKeys[i]?.qwen||''} onChange={e=>setSeatKeys(a=>{const n=[...a]; n[i]={...(n[i]||{}),qwen:e.target.value}; return n;})} style={{width:'100%'}}/>
              </label>}

              {seats[i]==='http' && <>
                <label style={{display:'block',marginBottom:6}}>HTTP Base / URL
                  <input type="text" value={seatKeys[i]?.httpBase||''} onChange={e=>{const v=e.target.value; setSeatKeys(a=>{const n=[...a]; n[i]={...(n[i]||{}),httpBase:v}; return n;}); upsertEntry(normalizeSeatId(seats[i],seatModels[i],{...seatKeys[i],httpBase:v}));}} style={{width:'100%'}}/>
                </label>
                <label style={{display:'block',marginBottom:6}}>HTTP Token（可选）
                  <input type="password" value={seatKeys[i]?.httpToken||''} onChange={e=>setSeatKeys(a=>{const n=[...a]; n[i]={...(n[i]||{}),httpToken:e.target.value}; return n;})} style={{width:'100%'}}/>
                </label>
              </>}
            </div>)}
          </div>

          <div style={{marginTop:12}}>
            <div style={{fontWeight:700,marginBottom:6}}>每家出牌最小间隔 (ms)</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              {[0,1,2].map(i=><div key={i} style={{border:'1px dashed #eee',borderRadius:6,padding:10}}>
                <div style={{fontWeight:700,marginBottom:8}}>{seatName(i)}</div>
                <label style={{display:'block'}}>最小间隔 (ms)
                  <input type="number" min={0} step={100} value={seatDelayMs[i]??0} onChange={e=>setSeatDelay(i,e.target.value)} style={{width:'100%'}}/>
                </label>
              </div>)}
            </div>
          </div>
        </div>
      </div>

      <div style={{border:'1px solid #eee',borderRadius:12,padding:14}}>
        <div style={{fontSize:18,fontWeight:800,marginBottom:6}}>对局</div>
        <LivePanel key={resetKey} rounds={rounds} startScore={startScore} seatDelayMs={seatDelayMs} enabled={enabled} rob={rob} four2={four2} seats={seats}
          seatModels={seatModels} seatKeys={seatKeys} farmerCoop={farmerCoop} onLog={setLiveLog}
          getTSRating={(id,role)=>getTSRating(id,role)} onTSApply={ups=>onTSApply(ups)} exposeRefresh={fn=>{(refreshTSFromBookRef.current=fn);}}/>
      </div>
    </div>
  );
}

export default Home;
