'use client';
import React from 'react';
import { useGame } from '../store';
import { Provider } from '../lib/ddz-types';

export default function Home(){
  const st = useGame();

  const providerSel = (label:string, seat:0|1|2) => {
    const value = seat===0? st.providers.seat0 : seat===1? st.providers.seat1 : st.providers.seat2;
    return (
      <div className="flex" style={{gap:8, alignItems:'center'}}>
        <label style={{width:60}}>{label}</label>
        <select value={value} onChange={(e)=>st.setProvider(seat, e.target.value as Provider)}>
          <option value="fallback">fallback</option>
          <option value="openai">chatgpt</option>
          <option value="kimi">kimi</option>
          <option value="grok">grok</option>
        </select>
      </div>
    );
  };

  const seatKeyInput = (label:string, seat:0|1|2) => {
    const pv = seat===0? st.providers.seat0 : seat===1? st.providers.seat1 : st.providers.seat2;
    const v  = seat===0? st.seatKeys.seat0   : seat===1? st.seatKeys.seat1   : st.seatKeys.seat2;
    const ph = pv==='fallback' ? '（fallback 无需 Key）' : `${pv} API Key`;
    return (
      <div className="flex" style={{gap:8, alignItems:'center'}}>
        <label style={{width:60}}>{label}</label>
        <input placeholder={ph} value={v} onChange={(e)=>st.setSeatKey(seat, e.target.value.trim())}/>
      </div>
    );
  };

  return (
    <div className="container">
      <h1>Dou Dizhu – AI Match</h1>
      <div className="row">
        <div className="card">
          <h2>Providers</h2>
          <div className="flex" style={{flexDirection:'column', gap:8}}>
            {providerSel('Seat 0', 0)}
            {providerSel('Seat 1', 1)}
            {providerSel('Seat 2', 2)}
          </div>
        </div>
        <div className="card">
          <h2>API Keys（每座位）</h2>
          <div className="flex" style={{flexDirection:'column', gap:8}}>
            {seatKeyInput('Seat 0', 0)}
            {seatKeyInput('Seat 1', 1)}
            {seatKeyInput('Seat 2', 2)}
            {st.keyError ? <div style={{color:'#b91c1c', fontSize:12}}>{st.keyError}</div> :
              <div className="small">同一 Provider 的 Key 不可重复；fallback 无需 Key。</div>}
          </div>
        </div>
        <div className="card">
          <h2>Match Settings</h2>
          <div className="flex">
            <label>Rounds</label>
            <input type="number" min={1} max={50} value={st.totalRounds} onChange={(e)=>st.setTotalRounds(parseInt(e.target.value||'1'))}/>
          </div>
          <div className="flex" style={{marginTop:8}}>
            <button onClick={()=>st.newRound()}>New Round</button>
            <button className="secondary" onClick={()=>st.stepPlay(true)} disabled={!!st.keyError || !st.playing}>Auto Play ▶</button>
            <button className="light" onClick={()=>st.stepPlay(false)} disabled={!!st.keyError || !st.playing}>Step ⏭</button>
          </div>
        </div>
      </div>

      <div className="row" style={{marginTop:12}}>
        {[0,1,2].map((i)=> (
          <div key={i} className="card">
            <div className="flex" style={{justifyContent:'space-between'}}>
              <h2>Seat {i}</h2>
              <span className="badge">{st.turn===i? 'TURN':''}</span>
            </div>
            <div className="wrap">
              {st.hands[i as 0|1|2].map((c)=> (<span key={c.id} className="tag">{c.id}</span>))}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{marginTop:12}}>
        <h2>Table History</h2>
        <ol>
          {st.history.map((h,idx)=> (
            <li key={idx}><span className="tag">S{h.seat}</span> {h.text} — <span className="small">{h.provider}</span> {h.reason? <em className="small"> ({h.reason})</em>: null}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
