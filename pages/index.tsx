// pages/index.tsx
import React, { useEffect, useRef, useState } from 'react';

type Four2Policy = 'both' | '2singles' | '2pairs';
type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen' | 'ai:deepseek'
  | 'http';

/* ========= TrueSkill（前端轻量实现，1v2：地主 vs 两农民） ========= */
type Rating = { mu:number; sigma:number };
const TS_DEFAULT: Rating = { mu:25, sigma:25/3 };
const TS_BETA = 25/6;
// const TS_TAU  = 25/300; // 如需漂移可启用

/* 数值函数 */
const SQRT2 = Math.sqrt(2);
function erf(x:number){
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const t = 1/(1+p*ax);
  const y = 1 - (((((a5*t + a4)*t + a3)*t + a2)*t + a1)*t) * Math.exp(-ax*ax);
  return sign * y;
}
function phi(x:number){ return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function Phi(x:number){ return 0.5*(1+erf(x/SQRT2)); }
function V_exceeds(t:number){ const d=Math.max(1e-12,Phi(t)); return phi(t)/d; }
function W_exceeds(t:number){ const v=V_exceeds(t); return v*(v+t); }
function tsUpdateTwoTeams(r:Rating[], teamA:number[], teamB:number[]){
  const varA = teamA.reduce((s,i)=>s+r[i].sigma**2,0);
  const varB = teamB.reduce((s,i)=>s+r[i].sigma**2,0);
  const c = Math.sqrt(varA+varB+2*TS_BETA*TS_BETA);
  const deltaMu = teamA.reduce((s,i)=>s+r[i].mu,0) - teamB.reduce((s,i)=>s+r[i].mu,0);
  const t = deltaMu/c;
  const v = V_exceeds(t);
  const w = W_exceeds(t);
  const upd = (ri:Rating, isA:boolean)=>{
    const s2 = ri.sigma**2;
    const mult = s2 / c;
    const mu = ri.mu + (isA ? mult*v : -mult*v);
    const sigma = Math.sqrt(Math.max(1e-6, s2 * (1 - w * s2 / (c*c))));
    return { mu, sigma };
  };
  teamA.forEach(i=> r[i]=upd(r[i], true));
  teamB.forEach(i=> r[i]=upd(r[i], false));
}

/* ====== 页面小部件（保持原布局） ====== */
function Section({ title, children }:{ title:string; children:React.ReactNode }){
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

/* ====== 模型预设/校验 ====== */
function defaultModelFor(choice: BotChoice): string {
  switch (choice) {
    case 'ai:openai': return 'gpt-4o-mini';
    case 'ai:gemini': return 'gemini-1.5-flash';
    case 'ai:grok':  return 'grok-2-latest';
    case 'ai:kimi':  return 'kimi-k2-0905-preview';
    case 'ai:qwen':  return 'qwen-plus';
    case 'ai:deepseek': return 'deepseek-chat';
    default: return '';
  }
}
function normalizeModelForProvider(choice: BotChoice, input: string): string {
  const m = (input || '').trim(); if (!m) return '';
  const low = m.toLowerCase();
  switch (choice) {
    case 'ai:kimi':   return /^kimi[-\w]*/.test(low) ? m : '';
    case 'ai:openai': return /^(gpt-|o[34]|text-|omni)/.test(low) ? m : '';
    case 'ai:gemini': return /^gemini[-\w.]*/.test(low) ? m : '';
    case 'ai:grok':   return /^grok[-\w.]*/.test(low) ? m : '';
    case 'ai:qwen':   return /^qwen[-\w.]*/.test(low) ? m : '';
    case 'ai:deepseek': return /^deepseek[-\w.]*/.test(low) ? m : '';
    default: return '';
  }
}
function choiceLabel(choice: BotChoice): string {
  switch (choice) {
    case 'built-in:greedy-max': return 'Greedy Max';
    case 'built-in:greedy-min': return 'Greedy Min';
    case 'built-in:random-legal': return 'Random Legal';
    case 'ai:openai': return 'OpenAI';
    case 'ai:gemini': return 'Gemini';
    case 'ai:grok':  return 'Grok';
    case 'ai:kimi':  return 'Kimi';
    case 'ai:qwen':  return 'Qwen';
    case 'ai:deepseek': return 'DeepSeek';
    case 'http':     return 'HTTP';
  }
}

/* ====== 雷达图累计（0~5） ====== */
type Score5 = { coop:number; agg:number; cons:number; eff:number; rob:number };

function RadarChart({ title, scores }:{ title:string; scores: Score5|null }) {
  return (
    <div style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
      <div style={{ fontWeight:700, marginBottom:8 }}>{title}</div>
      {scores
        ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:8 }}>
            {[
              ['协作', scores.coop],
              ['进攻', scores.agg],
              ['保守', scores.cons],
              ['效率', scores.eff],
              ['抢地主', scores.rob],
            ].map(([k, v]:any)=>(
              <div key={k} style={{ fontSize:12 }}>
                <div style={{ marginBottom:6, opacity:0.7 }}>{k}</div>
                <div style={{ height:6, background:'#eee', borderRadius:6, overflow:'hidden' }}>
                  <div style={{ width:`${Math.max(0, Math.min(5, Number(v)))*20}%`, height:'100%' }} />
                </div>
                <div style={{ fontSize:12, marginTop:6 }}>{Number(v).toFixed(2)}</div>
              </div>
            ))}
          </div>
        )
        : <div style={{ opacity:0.6 }}>（等待至少一局完成后生成画像）</div>
      }
    </div>
  );
}

function SeatTitle({ i }: { i:number }) {
  return <span style={{ fontWeight:700 }}>{['甲','乙','丙'][i]}</span>;
}

/* ====== 对局组件（Live） ====== */
type LiveProps = {
  rounds: number;
  startScore: number;
  seatDelayMs?: number[];
  enabled: boolean;
  rob: boolean;
  four2: Four2Policy;
  seats: BotChoice[];
  seatModels: string[];
  seatKeys: {
    openai?: string; gemini?: string; grok?: string; kimi?: string; qwen?: string; deepseek?: string;
    httpBase?: string; httpToken?: string;
  }[];
  farmerCoop: boolean;
  onTotals?: (totals:[number,number,number]) => void;
  onLog?: (lines: string[]) => void;
};

function Live(props: LiveProps) {
  const [hands, setHands] = useState<number[][]>([[], [], []]);
  const [plays, setPlays] = useState<any[]>([]);
  const [winner, setWinner] = useState<null|{ landlord:number; win:boolean }>(null);
  const [delta, setDelta] = useState<null|[number,number,number]>(null);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [log, setLog] = useState<string[]>([]);
  const [finishedCount, setFinishedCount] = useState<number>(0);
  const [totals, setTotals] = useState<[number,number,number]>([props.startScore||0, props.startScore||0, props.startScore||0]);

  // 画像累计
  const [aggStats, setAggStats] = useState<Score5[]|null>(null);
  const [aggCount, setAggCount] = useState<number>(0);

  // TrueSkill
  const [tsArr, setTsArr] = useState<Rating[]>([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);

  // refs
  const controllerRef = useRef<AbortController|null>(null);
  const handsRef = useRef<number[][]>([[],[],[]]);
  const playsRef = useRef<any[]>([]);
  const totalsRef = useRef<[number,number,number]>([0,0,0]);
  const finishedRef = useRef<number>(0);
  const lastReasonRef = useRef<(string|null)[]>([null, null, null]);
  const roundFinishedRef = useRef<boolean>(false);
  // ✅ 改为“按座位去重”
  const seenStatsRef = useRef<boolean[]>([false, false, false]);

  /* ===== TrueSkill 持久化 ===== */
  const applyTsFromStore = () => {
    try {
      const txt = localStorage.getItem('ts.overall');
      if (!txt) return;
      const arr = JSON.parse(txt) as Rating[];
      if (Array.isArray(arr) && arr.length===3) {
        setTsArr([{...arr[0]},{...arr[1]},{...arr[2]}]);
      }
    } catch {}
  };
  const persistOverallTs = (r:Rating[]) => {
    try { localStorage.setItem('ts.overall', JSON.stringify(r)); } catch {}
  };

  /* ===== 雷达图（画像）持久化 ===== */
  const persistOverallRadar = (scores: Score5[]|null, count:number) => {
    try {
      if (!scores) return;
      const payload = { version:'radar-1', updatedAt:new Date().toISOString(), count, scores };
      localStorage.setItem('radar.overall', JSON.stringify(payload));
    } catch {}
  };
  const applyRadarFromStore = () => {
    try {
      const txt = localStorage.getItem('radar.overall');
      if (!txt) return;
      const obj = JSON.parse(txt);
      if (obj && Array.isArray(obj.scores) && obj.scores.length===3) {
        setAggStats(obj.scores);
        setAggCount(Number(obj.count)||0);
        setLog(ls=>[...ls, `已从存档刷新画像（count=${Number(obj.count)||0}）`]);
      }
    } catch {}
  };

  /* ===== 启动/连接后端 ===== */
  useEffect(()=>{
    // ✅ 启停守卫：未启用就不连接
    if (!props.enabled) return;

    // 重置
    setHands([[], [], []]); setPlays([]);
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
    lastReasonRef.current = [null, null, null];

    // 从存档恢复 TrueSkill & 画像
    setTsArr([{...TS_DEFAULT},{...TS_DEFAULT},{...TS_DEFAULT}]);
    try { applyTsFromStore(); } catch {}
    setAggStats(null); setAggCount(0);
    try { applyRadarFromStore(); } catch {}

    controllerRef.current = new AbortController();

    const buildSeatSpecs = (): any[] => {
      return props.seats.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai': return { choice, model, apiKey: keys.openai || '' };
          case 'ai:gemini': return { choice, model, apiKey: keys.gemini || '' };
          case 'ai:grok':   return { choice, model, apiKey: keys.grok || '' };
          case 'ai:kimi':   return { choice, model, apiKey: keys.kimi || '' };
          case 'ai:qwen':   return { choice, model, apiKey: keys.qwen || '' };
          case 'ai:deepseek': return { choice, model, apiKey: keys.deepseek || '' };
          case 'http':      return { choice, model, baseUrl: keys.httpBase || '', token: keys.httpToken || '' };
          default:          return { choice };
        }
      });
    };

    const seatSummaryText = (specs: any[]) =>
      specs.map((s, i) => {
        const nm = s.model ? `｜${s.model}` : '';
        if (s.apiKey) return `${['甲','乙','丙'][i]}:${choiceLabel(props.seats[i])}${nm}`;
        if (s.baseUrl) return `${['甲','乙','丙'][i]}:HTTP${nm}`;
        return `${['甲','乙','丙'][i]}:${choiceLabel(props.seats[i])}`;
      }).join('，');

    const traceId = Math.random().toString(36).slice(2);

    (async ()=>{
      const specs = buildSeatSpecs();
      setLog(lines => [...lines, `启动一局：${seatSummaryText(specs)} | coop=${props.farmerCoop ? 'on' : 'off'} | trace=${traceId}`]);

      roundFinishedRef.current = false;
      seenStatsRef.current = [false,false,false]; // ✅ 每局重置

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // ✅ 多局：把 props.rounds 传给后端（原来是 1）
          rounds: props.rounds,
          startScore: props.startScore,
          seatDelayMs: props.seatDelayMs,
          enabled: props.enabled,
          rob: props.rob,
          four2: props.four2,
          seats: specs,
          clientTraceId: traceId,
          // （去掉 stop 字段；它是函数，JSON 会丢弃）
        }),
        signal: controllerRef.current?.signal,
      });

      const reader = r.body?.getReader();
      if (!reader) { setLog(ls=>[...ls,'! 无法连接后端（reader为空）']); return; }

      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream:true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx+1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            handleEvent(ev);
          } catch (e) {
            setLog(ls=>[...ls, `! JSON 解析失败: ${line.slice(0,120)}…`]);
          }
        }
      }
    })().catch(e=>{
      setLog(ls=>[...ls, `! 连接中断：${e?.message||e}`]);
    });

    return () => {
      controllerRef.current?.abort();
    };
// 依赖收敛：移除 seatModels/seatKeys，避免编辑输入触发重启
// 原：..., props.seatModels.join(','), JSON.stringify(props.seatKeys), ...
  }, [props.enabled, props.rounds, props.startScore, props.rob, props.four2, props.seatDelayMs?.join(','), props.seats.join(','), props.farmerCoop]);

  /* ===== 事件处理（保持原 UI 行为） ===== */
  function handleEvent(e:any) {
    switch (e.type) {
      case 'init': {
        setHands(e.hands);
        handsRef.current = e.hands.map((h:number[])=>[...h]);
        setPlays([]); playsRef.current = [];
        setWinner(null); setDelta(null); setMultiplier(1);
        lastReasonRef.current = [null, null, null];
        // ✅ 开局重置每座 stats 去重
        seenStatsRef.current = [false,false,false];
        setLog(ls => [...ls, `发牌：地主=[${'甲乙丙'[e.landlord]}]，底牌=${e.bottom?.length||0}张`]);
        break;
      }
      case 'play': {
        if (e.move==='play') {
          setHands(prev=>{
            const n = prev.map(h=>[...h]);
            const arr = n[e.seat];
            e.cards.forEach((c:number)=>{
              const p = arr.indexOf(c);
              if (p>=0) arr.splice(p,1);
            });
            return n;
          });
          handsRef.current[e.seat] = handsRef.current[e.seat].filter(x=>!e.cards.includes(x));
          setPlays(prev => [...prev, { seat:e.seat, move:'play', cards:e.cards, reason:e.reason||'-' }]);
          playsRef.current = [...playsRef.current, { seat:e.seat, move:'play', cards:e.cards, reason:e.reason||'-' }];
        } else {
          setPlays(prev => [...prev, { seat:e.seat, move:'pass', reason:e.reason||'-' }]);
          playsRef.current = [...playsRef.current, { seat:e.seat, move:'pass', reason:e.reason||'-' }];
        }
        if (e.mult) setMultiplier(e.mult);
        lastReasonRef.current[e.seat] = e.reason||null;
        break;
      }
      case 'stats': {
        // ✅ 每局“按座位”仅累计一次
        const i = e.seat;
        if (!Array.isArray(seenStatsRef.current)) seenStatsRef.current = [false,false,false];
        if (!seenStatsRef.current[i]) {
          setAggStats(prev=>{
            const base = prev || [
              {coop:0,agg:0,cons:0,eff:0,rob:0},
              {coop:0,agg:0,cons:0,eff:0,rob:0},
              {coop:0,agg:0,cons:0,eff:0,rob:0},
            ];
            const next = base.map(x=>({ ...x })) as Score5[];
            const s = e.scores || {};
            (['coop','agg','cons','eff','rob'] as (keyof Score5)[]).forEach(k=>{
              next[i][k] = (next[i][k]||0) + (Number(s[k])||0);
            });
            return next;
          });
          setAggCount(c=>c+1);
          seenStatsRef.current[i] = true;
        }
        break;
      }
      case 'win': {
        setWinner({ landlord:e.landlord, win:e.win });
        setDelta(e.delta);
        setTotals([e.after[0], e.after[1], e.after[2]]);
        setMultiplier(e.mult||1);
        setLog(ls => [...ls, `结算：地主=[${'甲乙丙'[e.landlord]}]，${e.win?'胜':'负'}，Δ=${e.delta.join('/')}, x${e.mult}`]);

        // TrueSkill：A=地主，B=两农民
        const r = [{...tsArr[0]},{...tsArr[1]},{...tsArr[2]}];
        const A = [e.landlord], B = [0,1,2].filter(x=>x!==e.landlord);
        tsUpdateTwoTeams(r, e.win? A : B, e.win? B : A);
        setTsArr(r);
        persistOverallTs(r);

        // 画像持久化（保持原逻辑）
        setTimeout(()=>persistOverallRadar(aggStats, aggCount), 0);

        roundFinishedRef.current = true;
        break;
      }
      case 'end': {
        if (!roundFinishedRef.current) {
          setLog(ls=>[...ls, '⚠ 结束事件收到，但未见 win；可能是后端提前终止或错误。']);
        }
        setFinishedCount(c => c + 1);
        break;
      }
      case 'log': { setLog(ls=>[...ls, e.message]); break; }
      default: { setLog(ls=>[...ls, `? 未知事件：${JSON.stringify(e).slice(0,140)}…`]); }
    }
  }

  /* ===== 画像 下载 / 上传 / 刷新（保持原交互） ===== */
  const fileInputRef = useRef<HTMLInputElement|null>(null);
  const downloadRadar = () => {
    const payload = {
      version: 'radar-1',
      updatedAt: new Date().toISOString(),
      count: aggCount,
      scores: aggStats || [
        { coop:0, agg:0, cons:0, eff:0, rob:0 },
        { coop:0, agg:0, cons:0, eff:0, rob:0 },
        { coop:0, agg:0, cons:0, eff:0, rob:0 },
      ],
    };
    try { localStorage.setItem('radar.overall', JSON.stringify(payload)); } catch {}
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `radar_${payload.count||0}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setLog(ls=>[...ls, `已下载画像存档（count=${payload.count||0}）`]);
  };
  const onUploadClick = () => fileInputRef.current?.click();
  const onFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!f) return;
    try {
      const txt = await f.text();
      const obj = JSON.parse(txt);
      const ok = obj && Array.isArray(obj.scores) && obj.scores.length===3;
      const valNum = (x:any) => typeof x === 'number' && isFinite(x);
      if (ok) {
        const s: Score5[] = obj.scores;
        const valid = s.every(x=> x && valNum(x.coop)&&valNum(x.agg)&&valNum(x.cons)&&valNum(x.eff)&&valNum(x.rob));
        if (!valid) throw new Error('scores 内存在非法值');
        setAggStats(s.map(x=>({ ...x })));
        setAggCount(Number(obj.count)||0);
        persistOverallRadar(s, Number(obj.count)||0);
        setLog(ls=>[...ls, `已导入画像存档：count=${Number(obj.count)||0}`]);
      } else {
        throw new Error('文件格式不正确（缺少 scores[3]）');
      }
    } catch (err:any) {
      setLog(ls=>[...ls, `! 画像存档导入失败：${err?.message||err}`]);
    }
  };
  const refreshFromStore = () => applyRadarFromStore();

  return (
    <>
      <Section title="对局">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
              <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}><SeatTitle i={i} />（{choiceLabel(props.seats[i])}）</div>
              <div style={{ fontSize:12, opacity:0.7, marginBottom:6 }}>
                模型：{(props.seatModels[i]||defaultModelFor(props.seats[i])) || '（无）'}
              </div>

              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:12, opacity:0.6, marginBottom:4 }}>手牌（{hands[i].length}）</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {hands[i].map((c:number, idx:number)=>(
                    <div key={idx} style={{ border:'1px solid #ddd', padding:'2px 6px', borderRadius:6 }}>{c}</div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize:12, opacity:0.6, marginBottom:4 }}>最近出牌</div>
                <div>
                  {plays.filter(p=>p.seat===i).slice(-3).map((p, k)=>(
                    <div key={k} style={{ fontSize:12, opacity:0.85, padding:'2px 0' }}>
                      {p.move==='play' ? `出：${p.cards.join(',')}`:'过'} ｜ 理由：{p.reason||'-'}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginTop:12 }}>
          <div style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>牌桌</div>
            <div style={{ marginBottom:6 }}>倍数：x{multiplier}</div>
            <div style={{ marginBottom:6 }}>结果：{winner ? `地主[${'甲乙丙'[winner.landlord]}] ${winner.win?'胜':'负'}` : '—'}</div>
            <div style={{ marginBottom:6 }}>Δ：{delta ? delta.join(' / ') : '—'}</div>
          </div>
          <div style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>总分</div>
            <div>甲：{totals[0]} ｜ 乙：{totals[1]} ｜ 丙：{totals[2]}</div>
          </div>
          <div style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>进度</div>
            <div>完成：{finishedCount} / {props.rounds} 局</div>
          </div>
        </div>
      </Section>

      <Section title="玩家画像（累计）">
        {/* 操作区：下载 / 上传 / 刷新 */}
        <div style={{ display:'flex', gap:8, marginBottom:10 }}>
          <button onClick={downloadRadar} style={{ padding:'4px 10px' }}>下载画像 JSON</button>
          <button onClick={onUploadClick} style={{ padding:'4px 10px' }}>上传画像 JSON</button>
          <button onClick={refreshFromStore} style={{ padding:'4px 10px' }}>从存档刷新</button>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={onFileChange} style={{ display:'none' }} />
        </div>

        {aggStats
          ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
              {[0,1,2].map(i=>(
                <RadarChart key={i} title={`${['甲','乙','丙'][i]}（累计）`} scores={aggStats[i]} />
              ))}
            </div>
          )
          : <div style={{ opacity:0.6 }}>（等待至少一局完成后生成累计画像；也可通过“上传画像 JSON”导入历史画像）</div>
        }
        <div style={{ fontSize:12, opacity:0.7, marginTop:8 }}>统计次数：{aggCount}</div>
      </Section>

      <Section title="运行日志">
        <div style={{ fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize:12, lineHeight:1.4, whiteSpace:'pre-wrap', maxHeight:260, overflow:'auto', background:'#fafafa', border:'1px solid #efefef', borderRadius:12, padding:12 }}>
          {log.map((l,i)=>(<div key={i}>{l}</div>))}
        </div>
      </Section>
    </>
  );
}

/* ====== 顶层页面（设置 → 对局/画像/日志） ====== */
const DEFAULTS = {
  enabled: true,
  rounds: 10,
  startScore: 100,
  rob: true,
  four2: 'both' as Four2Policy,
  farmerCoop: false,
  seatDelayMs: [300, 300, 300],
  seats: ['ai:qwen','ai:kimi','built-in:greedy-max'] as BotChoice[],
  seatModels: ['qwen-plus','kimi-k2-0905-preview',''] as string[],
  seatKeys: [{ openai:'' }, { gemini:'' }, { httpBase:'', httpToken:'' }] as any[],
};

function Home() {
  const [resetKey, setResetKey] = useState<number>(0);
  const [enabled, setEnabled] = useState<boolean>(DEFAULTS.enabled);
  const [rounds, setRounds] = useState<number>(DEFAULTS.rounds);
  const [startScore, setStartScore] = useState<number>(DEFAULTS.startScore);
  const [rob, setRob] = useState<boolean>(DEFAULTS.rob);
  const [four2, setFour2] = useState<Four2Policy>(DEFAULTS.four2);
  const [farmerCoop, setFarmerCoop] = useState<boolean>(DEFAULTS.farmerCoop);
  const [seatDelayMs, setSeatDelayMs] = useState<number[]>(DEFAULTS.seatDelayMs);
  const setSeatDelay = (i:number, v:number|string) => setSeatDelayMs(arr => { const n=[...arr]; n[i]=Math.max(0, Math.floor(Number(v)||0)); return n; });

  const [seats, setSeats] = useState<BotChoice[]>(DEFAULTS.seats);
  const [seatModels, setSeatModels] = useState<string[]>(DEFAULTS.seatModels);
  const [seatKeys, setSeatKeys] = useState<any[]>(DEFAULTS.seatKeys);

  const doResetAll = () => {
    setEnabled(DEFAULTS.enabled); setRounds(DEFAULTS.rounds); setStartScore(DEFAULTS.startScore);
    setRob(DEFAULTS.rob); setFour2(DEFAULTS.four2); setFarmerCoop(DEFAULTS.farmerCoop);
    setSeatDelayMs([...DEFAULTS.seatDelayMs]); setSeats([...DEFAULTS.seats]);
    setSeatModels([...DEFAULTS.seatModels]); setSeatKeys(DEFAULTS.seatKeys.map((x:any)=>({ ...x })));
    setLiveLog([]); setResetKey(k => k + 1);
  };

  const [liveLog, setLiveLog] = useState<string[]>([]);
  const appendLiveLog = (lines: string[]) => setLiveLog(ls=>[...ls, ...lines]);

  return (
    <div style={{ maxWidth: 1080, margin:'24px auto', padding:'0 16px' }}>
      <h1 style={{ fontSize:28, fontWeight:900, margin:'6px 0 16px' }}>斗地主 · Bot Arena</h1>

      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginBottom:16 }}>
        <div style={{ fontWeight:700, marginBottom:10 }}>对局设置</div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
              <div style={{ fontWeight:700, marginBottom:8 }}><SeatTitle i={i} />（提供商 / 模型 / 密钥）</div>

              <label style={{ display:'block', marginBottom:8 }}>
                提供商
                <select
                  value={seats[i]}
                  onChange={e=>{
                    const v = e.target.value as BotChoice;
                    setSeats(arr => { const n=[...arr]; n[i] = v; return n; });
                    setSeatModels(arr => { const n=[...arr]; n[i] = defaultModelFor(v); return n; });
                  }}
                  style={{ width:'100%' }}
                >
                  <optgroup label="内置">
                    <option value="built-in:greedy-max">Greedy Max</option>
                    <option value="built-in:greedy-min">Greedy Min</option>
                    <option value="built-in:random-legal">Random Legal</option>
                  </optgroup>
                  <optgroup label="AI">
                    <option value="ai:openai">OpenAI</option>
                    <option value="ai:gemini">Gemini</option>
                    <option value="ai:grok">Grok</option>
                    <option value="ai:kimi">Kimi</option>
                    <option value="ai:qwen">Qwen</option>
                    <option value="ai:deepseek">DeepSeek</option>
                    <option value="http">HTTP</option>
                  </optgroup>
                </select>
              </label>

              <label style={{ display:'block', marginBottom:6 }}>
                模型
                <input
                  value={seatModels[i]||''}
                  onChange={e=>{
                    const v = e.target.value;
                    setSeatModels(arr => { const n=[...arr]; n[i] = normalizeModelForProvider(seats[i], v) || v; return n; });
                  }}
                  placeholder={defaultModelFor(seats[i])}
                  style={{ width:'100%' }}
                />
              </label>

              {seats[i] === 'ai:openai' && (
                <label style={{ display:'block', marginBottom:6 }}>
                  OpenAI API Key
                  <input type="password" value={seatKeys[i]?.openai||''}
                    onChange={e=>{
                      const v = e.target.value;
                      setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), openai:v }; return n; });
                    }}
                    style={{ width:'100%' }} />
                </label>
              )}

              {seats[i] === 'ai:gemini' && (
                <label style={{ display:'block', marginBottom:6 }}>
                  Gemini API Key
                  <input type="password" value={seatKeys[i]?.gemini||''}
                    onChange={e=>{
                      const v = e.target.value;
                      setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), gemini:v }; return n; });
                    }}
                    style={{ width:'100%' }} />
                </label>
              )}

              {seats[i] === 'ai:grok' && (
                <label style={{ display:'block', marginBottom:6 }}>
                  Grok API Key
                  <input type="password" value={seatKeys[i]?.grok||''}
                    onChange={e=>{
                      const v = e.target.value;
                      setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), grok:v }; return n; });
                    }}
                    style={{ width:'100%' }} />
                </label>
              )}

              {seats[i] === 'ai:kimi' && (
                <label style={{ display:'block', marginBottom:6 }}>
                  Kimi API Key
                  <input type="password" value={seatKeys[i]?.kimi||''}
                    onChange={e=>{
                      const v = e.target.value;
                      setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), kimi:v }; return n; });
                    }}
                    style={{ width:'100%' }} />
                </label>
              )}

              {seats[i] === 'ai:qwen' && (
                <label style={{ display:'block', marginBottom:6 }}>
                  Qwen API Key
                  <input type="password" value={seatKeys[i]?.qwen||''}
                    onChange={e=>{
                      const v = e.target.value;
                      setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), qwen:v }; return n; });
                    }}
                    style={{ width:'100%' }} />
                </label>
              )}

              {seats[i] === 'ai:deepseek' && (
                <label style={{ display:'block', marginBottom:6 }}>
                  DeepSeek API Key
                  <input type="password" value={seatKeys[i]?.deepseek||''}
                    onChange={e=>{
                      const v = e.target.value;
                      setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), deepseek:v }; return n; });
                    }}
                    style={{ width:'100%' }} />
                </label>
              )}

              {seats[i] === 'http' && (
                <>
                  <label style={{ display:'block', marginBottom:6 }}>
                    HTTP Base URL
                    <input value={seatKeys[i]?.httpBase||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpBase:v }; return n; });
                      }}
                      placeholder="https://example.com/bot"
                      style={{ width:'100%' }} />
                  </label>
                  <label style={{ display:'block', marginBottom:6 }}>
                    HTTP Token
                    <input type="password" value={seatKeys[i]?.httpToken||''}
                      onChange={e=>{
                        const v = e.target.value;
                        setSeatKeys(arr => { const n=[...arr]; n[i] = { ...(n[i]||{}), httpToken:v }; return n; });
                      }}
                      style={{ width:'100%' }} />
                  </label>
                </>
              )}
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginTop:12 }}>
          <div style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>局数</div>
            <input type="number" min={1} value={rounds} onChange={e=>setRounds(Math.max(1, Math.floor(Number(e.target.value)||0)))} />
          </div>
          <div style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>初始分</div>
            <input type="number" value={startScore} onChange={e=>setStartScore(Math.floor(Number(e.target.value)||0))} />
          </div>
          <div style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
            <div style={{ fontWeight:700, marginBottom:6 }}>倍数/合作/四带二</div>
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <label><input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} /> 可抢地主</label>
              <label><input type="checkbox" checked={farmerCoop} onChange={e=>setFarmerCoop(e.target.checked)} /> 农民协作</label>
              <label>
                四带二
                <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)} style={{ marginLeft:6 }}>
                  <option value="both">都可</option>
                  <option value="2singles">带两单</option>
                  <option value="2pairs">带两对</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12, marginTop:12 }}>
          {[0,1,2].map(i=>(
            <div key={i} style={{ border:'1px solid #efefef', borderRadius:12, padding:12 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}><SeatTitle i={i} /> 延时（ms）</div>
              <input type="number" min={0} value={seatDelayMs[i]} onChange={e=>setSeatDelay(i, e.target.value)} style={{ width:'100%' }} />
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:12, marginTop:12 }}>
          <button onClick={()=>setEnabled(true)} style={{ padding:'6px 10px' }}>开始</button>
          <button onClick={()=>setEnabled(false)} style={{ padding:'6px 10px' }}>停止</button>
          <button onClick={doResetAll} style={{ padding:'6px 10px' }}>重置为默认</button>
        </div>
      </div>

      {/* 对局/画像/日志 */}
      <Live
        key={resetKey}
        rounds={rounds}
        startScore={startScore}
        seatDelayMs={seatDelayMs}
        enabled={enabled}
        rob={rob}
        four2={four2}
        seats={seats}
        seatModels={seatModels}
        seatKeys={seatKeys}
        farmerCoop={farmerCoop}
        onTotals={(t)=>setLiveLog(ls=>[...ls, `总分：${t.join(' / ')}`])}
        onLog={(lines)=>appendLiveLog(lines)}
      />

      <div style={{ border:'1px solid #eee', borderRadius:12, padding:14, marginTop:16 }}>
        <div style={{ fontWeight:700, marginBottom:10 }}>后台日志（汇总）</div>
        <div style={{ fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', fontSize:12, lineHeight:1.4, whiteSpace:'pre-wrap', maxHeight:260, overflow:'auto', background:'#fafafa', border:'1px solid #efefef', borderRadius:12, padding:12 }}>
          {liveLog.map((l,i)=>(<div key={i}>{l}</div>))}
        </div>
      </div>
    </div>
  );
}

export default Home;
