import React, { useEffect, useRef, useState } from 'react';

/* ===================== NDJSON 前端调试注入（只打日志，不改行为） ===================== */
(function () {
  if (typeof window === 'undefined') return;
  if ((window as any).__NDJSON_FE_TRACER__) return;  // 避免重复注入
  (window as any).__NDJSON_FE_TRACER__ = true;

  const on = () => sessionStorage.getItem('ndjson.debug') === '1';
  const log = (...a: any[]) => { if (on()) console.debug('[NDJSON/FE]', ...a); };

  // 1) fetch 打点
  const oldFetch = window.fetch;
  window.fetch = async (...args: any[]) => {
    const res = await oldFetch(...args as any);
    try { log('fetch', { url: args?.[0], ok: res.ok, status: res.status }); } catch {}
    return res;
  };

  // 2) ReadableStream.getReader().read 打点
  const RS: any = (window as any).ReadableStream;
  if (RS && RS.prototype && RS.prototype.getReader) {
    const oldGetReader = RS.prototype.getReader;
    RS.prototype.getReader = function (...args: any[]) {
      const reader = oldGetReader.apply(this, args);
      if (reader && typeof reader.read === 'function') {
        const oldRead = reader.read.bind(reader);
        reader.read = async (...rargs: any[]) => {
          const ret = await oldRead(...rargs);
          try { log('read', { done: !!ret?.done, bytes: ret?.value?.length || 0 }); } catch {}
          return ret;
        };
      }
      return reader;
    };
  }

  // 3) TextDecoder.decode 打点
  const TD: any = (window as any).TextDecoder;
  if (TD && TD.prototype) {
    const oldDecode = TD.prototype.decode;
    TD.prototype.decode = function (...args: any[]) {
      const out = oldDecode.apply(this, args as any);
      try {
        const src = args[0]; const stream = args?.[1]?.stream;
        log('decode', { inBytes: src?.length || 0, stream: !!stream, outLen: typeof out === 'string' ? out.length : 0 });
      } catch {}
      return out;
    };
  }

  // 4) 便捷面包屑：window.ndjsonMark('tag', {meta})
  (window as any).ndjsonMark = (tag: string, meta?: any) => log('mark', { tag, ...meta });

  log('injected');
})();
/* ===================== NDJSON 前端调试注入（完） ===================== */

type Label = string;
type ComboType =
  | 'single' | 'pair' | 'triple' | 'bomb' | 'rocket'
  | 'straight' | 'pair-straight' | 'plane'
  | 'triple-with-single' | 'triple-with-pair'
  | 'four-with-two-singles' | 'four-with-two-pairs';
type Four2Policy = 'both' | '2singles' | '2pairs';

type EventObj =
  | { type:'state'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'init'; landlord:number; hands: Label[][] }
  | { type:'event'; kind:'play'; seat:number; move:'play'|'pass'; cards?:Label[]; comboType?:ComboType; reason?:string }
  | { type:'event'; kind:'rob'; seat:number; rob:boolean }
  | { type:'event'; kind:'trick-reset' }
  | { type:'event'; kind:'win'; winner:number; multiplier:number; deltaScores:[number,number,number] }
  | { type:'log'; message:string }
  | { type:'ka'; ts:string };

type BotChoice =
  | 'built-in:greedy-max'
  | 'built-in:greedy-min'
  | 'built-in:random-legal'
  | 'ai:openai' | 'ai:gemini' | 'ai:grok' | 'ai:kimi' | 'ai:qwen'
  | 'http';

type SeatSpec = { choice: BotChoice; model?: string; apiKey?: string; baseUrl?: string; token?: string };

type StartPayload = {
  seats: SeatSpec[];                     // 3 items
  seatDelayMs?: number[];
  rounds?: number;
  rob?: boolean;
  four2?: 'both' | '2singles' | '2pairs';
  stopBelowZero?: boolean;
  debug?: boolean;
  seatModels?: { E?:string; S?:string; W?:string; } | null;
  seatKeys?: { E?:string; S?:string; W?:string; } | null;
};

const ALL_LABELS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'] as const;
const orderIndex = (l: Label) => ALL_LABELS.indexOf(l as any);
const rankOf = (l: Label) => (l==='T'?'10':(l==='x'?'SJ':(l==='X'?'BJ':l)));
const seats = ['甲','乙','丙'];

function prettyCards(cs: Label[]): string {
  const SUITS = ['♠','♥','♣','♦'];
  let idx = 0;
  return cs.map(l=>{
    if (l==='x' || l==='X') return `${rankOf(l)}`;
    const suit = SUITS[idx % SUITS.length]; idx++;
    return `${suit}${rankOf(l)}`;
  }).join(' ');
}

function useStable<T>(v: T){ const r = useRef(v); r.current = v; return r; }

export default function Home() {
  const [rounds, setRounds] = useState<number>(10);
  const [seatDelayE, setSeatDelayE] = useState<number>(0);
  const [seatDelayS, setSeatDelayS] = useState<number>(0);
  const [seatDelayW, setSeatDelayW] = useState<number>(0);
  const [rob, setRob] = useState<boolean>(true);
  const [four2, setFour2] = useState<Four2Policy>('both');
  const [stopBelowZero, setStopBelowZero] = useState<boolean>(false);
  const [debug, setDebug] = useState<boolean>(false);

  const [choiceE, setChoiceE] = useState<BotChoice>('built-in:greedy-max');
  const [choiceS, setChoiceS] = useState<BotChoice>('built-in:greedy-min');
  const [choiceW, setChoiceW] = useState<BotChoice>('built-in:random-legal');

  const [modelE, setModelE] = useState<string>('gpt-4o-mini');
  const [modelS, setModelS] = useState<string>('gemini-1.5-flash');
  const [modelW, setModelW] = useState<string>('glm-4-flash');

  const [keyOpenAI, setKeyOpenAI] = useState<string>('');
  const [keyGemini, setKeyGemini] = useState<string>('');
  const [keyGrok, setKeyGrok] = useState<string>('');
  const [keyKimi, setKeyKimi] = useState<string>('');
  const [keyQwen, setKeyQwen] = useState<string>('');

  const [httpBase, setHttpBase] = useState<string>('');
  const [httpToken, setHttpToken] = useState<string>('');

  const [hands, setHands] = useState<Label[][]>([[],[],[]]);
  const [plays, setPlays] = useState<Array<{seat:number; move:'play'|'pass'; cards?:Label[]; comboType?:ComboType; reason?:string;}>>([]);
  const [totals, setTotals] = useState<[number,number,number]>([0,0,0]);
  const [finished, setFinished] = useState<number>(0);
  const [log, setLog] = useState<string[]>([]);
  const [landlord, setLandlord] = useState<number>(0);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number]|null>(null);
  const [multiplier, setMultiplier] = useState<number>(1);
  const multiplierRef = useStable(multiplier);

  const controllerRef = useRef<AbortController>(new AbortController());
  const runningRef = useRef<boolean>(false);

  const handsRef = useStable(hands);
  const playsRef = useStable(plays);
  const totalsRef = useStable(totals);
  const finishedRef = useStable(finished);
  const logRef = useStable(log);
  const landlordRef = useStable(landlord);
  const winnerRef = useStable(winner);
  const deltaRef = useStable(delta);

  useEffect(()=>{
    const ss = window.sessionStorage;
    try {
      setRounds( Number(ss.getItem('rounds') || '10') );
      setSeatDelayE( Number(ss.getItem('delayE') || '0') );
      setSeatDelayS( Number(ss.getItem('delayS') || '0') );
      setSeatDelayW( Number(ss.getItem('delayW') || '0') );
      setRob( (ss.getItem('rob') || 'true') === 'true' );
      setFour2( (ss.getItem('four2') as Four2Policy) || 'both' );
      setStopBelowZero( (ss.getItem('stopBelowZero') || 'false') === 'true' );
      setDebug( (ss.getItem('debug') || 'false') === 'true' );

      setChoiceE( (ss.getItem('choiceE') as BotChoice) || 'built-in:greedy-max' );
      setChoiceS( (ss.getItem('choiceS') as BotChoice) || 'built-in:greedy-min' );
      setChoiceW( (ss.getItem('choiceW') as BotChoice) || 'built-in:random-legal' );
      setModelE( ss.getItem('modelE') || 'gpt-4o-mini' );
      setModelS( ss.getItem('modelS') || 'gemini-1.5-flash' );
      setModelW( ss.getItem('modelW') || 'glm-4-flash' );

      setKeyOpenAI( ss.getItem('k_openai') || '' );
      setKeyGemini( ss.getItem('k_gemini') || '' );
      setKeyGrok( ss.getItem('k_grok') || '' );
      setKeyKimi( ss.getItem('k_kimi') || '' );
      setKeyQwen( ss.getItem('k_qwen') || '' );

      setHttpBase( ss.getItem('http_base') || '' );
      setHttpToken( ss.getItem('http_token') || '' );
    } catch {}
  }, []);

  useEffect(()=>{
    const ss = window.sessionStorage;
    try {
      ss.setItem('rounds', String(rounds));
      ss.setItem('delayE', String(seatDelayE));
      ss.setItem('delayS', String(seatDelayS));
      ss.setItem('delayW', String(seatDelayW));
      ss.setItem('rob', String(rob));
      ss.setItem('four2', String(four2));
      ss.setItem('stopBelowZero', String(stopBelowZero));
      ss.setItem('debug', String(debug));

      ss.setItem('choiceE', String(choiceE));
      ss.setItem('choiceS', String(choiceS));
      ss.setItem('choiceW', String(choiceW));
      ss.setItem('modelE', String(modelE));
      ss.setItem('modelS', String(modelS));
      ss.setItem('modelW', String(modelW));

      ss.setItem('k_openai', keyOpenAI);
      ss.setItem('k_gemini', keyGemini);
      ss.setItem('k_grok', keyGrok);
      ss.setItem('k_kimi', keyKimi);
      ss.setItem('k_qwen', keyQwen);

      ss.setItem('http_base', httpBase);
      ss.setItem('http_token', httpToken);
    } catch {}
  }, [rounds, seatDelayE, seatDelayS, seatDelayW, rob, four2, stopBelowZero, debug, choiceE, choiceS, choiceW, modelE, modelS, modelW, keyOpenAI, keyGemini, keyGrok, keyKimi, keyQwen, httpBase, httpToken]);

  async function start() {
    if (runningRef.current) return;
    runningRef.current = true;
    setPlays([]); setTotals([0,0,0]); setFinished(0); setLog([]); setWinner(null); setDelta(null); setMultiplier(1);

    controllerRef.current?.abort?.();
    controllerRef.current = new AbortController();

    try {
      const payload: StartPayload = {
        seats: [
          { choice: choiceE, model: modelE, apiKey: keyOpenAI, baseUrl: httpBase, token: httpToken },
          { choice: choiceS, model: modelS, apiKey: keyGemini, baseUrl: httpBase, token: httpToken },
          { choice: choiceW, model: modelW, apiKey: keyQwen,  baseUrl: httpBase, token: httpToken },
        ],
        seatDelayMs: [ seatDelayE, seatDelayS, seatDelayW ],
        rounds, rob, four2, stopBelowZero,
        debug,
        seatModels: { E: modelE, S: modelS, W: modelW },
        seatKeys: { E: keyOpenAI, S: keyGemini, W: keyQwen },
      };

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controllerRef.current.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';

      const pump = async (): Promise<void> => {
        while (true) {
          const batch: any[] = [];
          const { value, done } = await reader.read();

          if (!done) {
            buf += decoder.decode(value, { stream:true });
            let idx: number;
            while ((idx = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, idx);
              buf = buf.slice(idx + 1);
              if (!line.trim()) continue;
              try { batch.push(JSON.parse(line)); } catch {}
            }
          } else {
            const tail = buf;
            buf = '';
            if (tail && tail.trim()) { try { batch.push(JSON.parse(tail)); } catch {} }
          }

          if (batch.length) {
            let nextHands = handsRef.current.map(x => [...x]);
            let nextPlays = [...playsRef.current];
            let nextTotals = [...totalsRef.current] as [number,number,number];
            let nextFinished = finishedRef.current;
            let nextLog = [...logRef.current];
            let nextLandlord = landlordRef.current;
            let nextWinner = winnerRef.current as number|null;
            let nextDelta = deltaRef.current as [number,number,number]|null;
            let nextMultiplier = multiplierRef.current;

            for (const raw of batch) {
              const m: any = raw;
              try {
                const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
                const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);

                if (hasHands) {
                  nextPlays = [];
                  nextWinner = null;
                  nextDelta = null;
                  nextMultiplier = 1;
                  nextHands = [
                    [...(rh[0] || [])],
                    [...(rh[1] || [])],
                    [...(rh[2] || [])],
                  ];
                  nextLog.push(`【新局】起始牌：甲(${rh[0]?.length||0}) 乙(${rh[1]?.length||0}) 丙(${rh[2]?.length||0})`);
                  if (typeof m.landlord === 'number') nextLandlord = m.landlord;
                }

                if (m.type === 'event' && m.kind === 'rob') {
                  nextLog.push(`【抢地主】${seats[m.seat]}：${m.rob ? '要' : '不要'}`);
                  if (m.rob) nextLandlord = m.seat;
                }

                if (m.type === 'event' && m.kind === 'play') {
                  if (m.move === 'pass') {
                    nextPlays.push({ seat: m.seat, move:'pass', reason: m.reason });
                    nextLog.push(`【过】${seats[m.seat]}：${m.reason || ''}`);
                  } else {
                    const cards: Label[] = (m.cards || []).slice().sort((a:Label,b:Label)=>orderIndex(a)-orderIndex(b));
                    nextPlays.push({ seat: m.seat, move:'play', cards, comboType: m.comboType, reason: m.reason });
                    const remove = [...(m.cards||[])];
                    nextHands[m.seat] = nextHands[m.seat].filter(x=>{
                      const i = remove.indexOf(x);
                      if (i>=0) { remove.splice(i,1); return false; }
                      return true;
                    });
                    nextLog.push(`【出】${seats[m.seat]}：${prettyCards(m.cards||[])}${m.comboType?`（${m.comboType}）`:''}${m.reason?` — ${m.reason}`:''}`);
                  }
                }

                if (m.type === 'event' && m.kind === 'trick-reset') {
                  nextPlays = [];
                  nextLog.push(`【轮空清空】上一轮结束`);
                }

                if (m.type === 'event' && m.kind === 'win') {
                  nextWinner = m.winner;
                  nextDelta = m.deltaScores;
                  nextMultiplier = m.multiplier || 1;
                  nextTotals = [ nextTotals[0]+m.deltaScores[0], nextTotals[1]+m.deltaScores[1], nextTotals[2]+m.deltaScores[2] ] as [number,number,number];
                  nextFinished = Math.min(rounds, nextFinished + 1);
                  nextLog.push(`【胜】${seats[m.winner]} 胜；倍数 x${nextMultiplier}；本局积分 Δ(${m.deltaScores.join(', ')})`);
                }

                if (m.type === 'log') nextLog.push(m.message);
                if (m.type === 'ka') { /* keep-alive */ }
              } catch {}
            }

            setHands(nextHands);
            setPlays(nextPlays);
            setTotals(nextTotals);
            setFinished(nextFinished);
            setLog(nextLog);
            setLandlord(nextLandlord);
            setWinner(nextWinner);
            setDelta(nextDelta);
            setMultiplier(nextMultiplier);
          }

          if (done) break;
        }
      };

      await pump();
    } catch (e:any) {
      setLog(prev => [...prev, `【前端错误】${e?.message||String(e)}`]);
    } finally {
      runningRef.current = false;
    }
  }

  function stop() {
    try { controllerRef.current?.abort?.(); } catch {}
    runningRef.current = false;
  }

  // ====== UI（保持原样，不改动） ======
  return (
    <div style={{ padding: 16, fontFamily: 'ui-sans-serif, system-ui, -apple-system' }}>
      <h2>斗地主 AI 比赛</h2>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div style={{ border:'1px solid #ddd', borderRadius:8, padding:12 }}>
          <h3>对局设置</h3>
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center' }}>
            <label>局数</label>
            <input type="number" value={rounds} min={1} max={200} onChange={e=>setRounds(Number(e.target.value||1))} />

            <label>每位延迟 (ms)</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              <input type="number" value={seatDelayE} onChange={e=>setSeatDelayE(Number(e.target.value||0))} placeholder="甲(E)" />
              <input type="number" value={seatDelayS} onChange={e=>setSeatDelayS(Number(e.target.value||0))} placeholder="乙(S)" />
              <input type="number" value={seatDelayW} onChange={e=>setSeatDelayW(Number(e.target.value||0))} placeholder="丙(W)" />
            </div>

            <label>抢地主</label>
            <input type="checkbox" checked={rob} onChange={e=>setRob(e.target.checked)} />

            <label>四带二策略</label>
            <select value={four2} onChange={e=>setFour2(e.target.value as Four2Policy)}>
              <option value="both">both</option>
              <option value="2singles">2singles</option>
              <option value="2pairs">2pairs</option>
            </select>

            <label>积分 < 0 提前终止</label>
            <input type="checkbox" checked={stopBelowZero} onChange={e=>setStopBelowZero(e.target.checked)} />

            <label>调试模式</label>
            <input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)} />
          </div>
        </div>

        <div style={{ border:'1px solid #ddd', borderRadius:8, padding:12 }}>
          <h3>玩家与模型</h3>
          <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:8, alignItems:'center' }}>
            <label>甲(E)</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <select value={choiceE} onChange={e=>setChoiceE(e.target.value as BotChoice)}>
                <option value="built-in:greedy-max">内置：GreedyMax</option>
                <option value="built-in:greedy-min">内置：GreedyMin</option>
                <option value="built-in:random-legal">内置：Random</option>
                <option value="ai:openai">AI：OpenAI</option>
                <option value="ai:gemini">AI：Gemini</option>
                <option value="ai:grok">AI：Grok</option>
                <option value="ai:kimi">AI：Kimi</option>
                <option value="ai:qwen">AI：Qwen</option>
                <option value="http">HTTP</option>
              </select>
              <input value={modelE} onChange={e=>setModelE(e.target.value)} placeholder="模型/自定义标识" />
            </div>

            <label>乙(S)</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <select value={choiceS} onChange={e=>setChoiceS(e.target.value as BotChoice)}>
                <option value="built-in:greedy-max">内置：GreedyMax</option>
                <option value="built-in:greedy-min">内置：GreedyMin</option>
                <option value="built-in:random-legal">内置：Random</option>
                <option value="ai:openai">AI：OpenAI</option>
                <option value="ai:gemini">AI：Gemini</option>
                <option value="ai:grok">AI：Grok</option>
                <option value="ai:kimi">AI：Kimi</option>
                <option value="ai:qwen">AI：Qwen</option>
                <option value="http">HTTP</option>
              </select>
              <input value={modelS} onChange={e=>setModelS(e.target.value)} placeholder="模型/自定义标识" />
            </div>

            <label>丙(W)</label>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              <select value={choiceW} onChange={e=>setChoiceW(e.target.value as BotChoice)}>
                <option value="built-in:greedy-max">内置：GreedyMax</option>
                <option value="built-in:greedy-min">内置：GreedyMin</option>
                <option value="built-in:random-legal">内置：Random</option>
                <option value="ai:openai">AI：OpenAI</option>
                <option value="ai:gemini">AI：Gemini</option>
                <option value="ai:grok">AI：Grok</option>
                <option value="ai:kimi">AI：Kimi</option>
                <option value="ai:qwen">AI：Qwen</option>
                <option value="http">HTTP</option>
              </select>
              <input value={modelW} onChange={e=>setModelW(e.target.value)} placeholder="模型/自定义标识" />
            </div>

            <label>OpenAI Key</label>
            <input value={keyOpenAI} onChange={e=>setKeyOpenAI(e.target.value)} placeholder="sk-..." />
            <label>Gemini Key</label>
            <input value={keyGemini} onChange={e=>setKeyGemini(e.target.value)} placeholder="..." />
            <label>Grok Key</label>
            <input value={keyGrok} onChange={e=>setKeyGrok(e.target.value)} placeholder="..." />
            <label>Kimi Key</label>
            <input value={keyKimi} onChange={e=>setKeyKimi(e.target.value)} placeholder="..." />
            <label>Qwen Key</label>
            <input value={keyQwen} onChange={e=>setKeyQwen(e.target.value)} placeholder="..." />

            <label>HTTP Base</label>
            <input value={httpBase} onChange={e=>setHttpBase(e.target.value)} placeholder="http://127.0.0.1:9000" />
            <label>HTTP Token</label>
            <input value={httpToken} onChange={e=>setHttpToken(e.target.value)} placeholder="Bearer ..." />
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16 }}>
        <div style={{ border:'1px solid #ddd', borderRadius:8, padding:12 }}>
          <h3>对局</h3>
          <div>地主：{typeof landlord==='number' ? seats[landlord] : '-'}</div>
          <div>倍数：x{multiplier}</div>
          <div>总分：甲 {totals[0]} ｜ 乙 {totals[1]} ｜ 丙 {totals[2]}</div>
          <div>已完成：{finished} / {rounds}</div>

          <div style={{ marginTop:8 }}>
            <div>甲：{hands[0].join(' ')}</div>
            <div>乙：{hands[1].join(' ')}</div>
            <div>丙：{hands[2].join(' ')}</div>
          </div>

          <div style={{ marginTop:8 }}>
            <strong>当前出牌堆：</strong>
            <ul>
              {plays.map((p,idx)=><li key={idx}>
                {seats[p.seat]}：{p.move==='pass'?'过':prettyCards(p.cards||[])} {p.comboType?`（${p.comboType}）`:''} {p.reason?` — ${p.reason}`:''}
              </li>)}
            </ul>
          </div>

          <div style={{ marginTop:8 }}>
            <strong>本局结果：</strong>
            <div>胜者：{winner===null?'-':seats[winner]}</div>
            <div>本局积分Δ：{delta?delta.join(', '):'-'}</div>
          </div>

          <div style={{ display:'flex', gap:8, marginTop:8 }}>
            <button onClick={start} disabled={runningRef.current}>开始</button>
            <button onClick={stop}>停止</button>
          </div>
        </div>

        <div style={{ border:'1px solid #ddd', borderRadius:8, padding:12 }}>
          <h3>运行日志</h3>
          <div style={{ fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas', whiteSpace:'pre-wrap', height:360, overflow:'auto', background:'#fafafa', padding:8 }}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
