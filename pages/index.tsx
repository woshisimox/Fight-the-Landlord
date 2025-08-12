'use client';
import React from 'react';
import { useGame } from '../lib/store';
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
          <h2>API Keys</h2>
          <div className="flex" style={{flexDirection:'column', gap:8}}>
            <input placeholder="OpenAI (ChatGPT) API Key" onChange={(e)=>st.setProviderKeys({ openaiKey: e.target.value.trim() })} />
            <input placeholder="Kimi (Moonshot) API Key" onChange={(e)=>st.setProviderKeys({ kimiKey: e.target.value.trim() })} />
            <input placeholder="Grok (xAI) API Key" onChange={(e)=>st.setProviderKeys({ grokKey: e.target.value.trim() })} />
            <div className="small">Keys are only used to call /api/ai proxy in this session.</div>
          </div>
        </div>

        <div className="card">
          <h2>Match Settings</h2>
          <div className="flex">
            <label>Rounds</label>
            <input type="number" min={1} max={50} value={st.totalRounds}
              onChange={(e)=>st.setTotalRounds(parseInt(e.target.value||'1'))}/>
          </div>
          <div className="flex" style={{marginTop:8}}>
            <button onClick={()=>st.newRound()}>New Round</button>
            <button className="secondary" onClick={()=>st.stepPlay(true)} disabled={!st.playing}>Auto Play ▶</button>
            <button className="light" onClick={()=>st.stepPlay(false)} disabled={!st.playing}>Step ⏭</button>
          </div>
          <div className="small" style={{marginTop:8}}>Round: {st.round} / {st.totalRounds} {st.playing? '(playing)':''}</div>
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
