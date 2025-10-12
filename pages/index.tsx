
<div style={{ display: 'flex', alignItems: 'center' }}>
  <label style={{ marginRight: 10 }}>启用对局</label>
  <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
  <button onClick={doResetAll} style={{ marginLeft: 10, padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>清空</button>

  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
    <label style={{ marginRight: 10 }}>局数</label>
    <input type="number" value={rounds} onChange={e => setRounds(Math.max(1, Math.floor(Number(e.target.value))))} />
  </div>
</div>
