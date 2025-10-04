// pages/index.tsx
import React, { useMemo, useRef, useState } from 'react';

/** -------------------- 基础类型 -------------------- **/
type SeatStat = {
  rounds: number;
  overallAvg: number;
  lastAvg: number;
  best: number;
  worst: number;
  mean: number;
  sigma: number;
};

type TsStore = Record<string, any>;
type RadarStore = {
  players: Record<string, any>;
  [k: string]: any;
};

/** -------------------- 页面组件 -------------------- **/
export default function Page() {
  /** -------------------- 存档与图表数据（示例存储） -------------------- **/
  const [tsStore, setTsStore] = useState<TsStore>({});
  const tsStoreRef = useRef(tsStore); tsStoreRef.current = tsStore;

  const [radarStore, setRadarStore] = useState<RadarStore>({ players: {} });
  const radarStoreRef = useRef(radarStore); radarStoreRef.current = radarStore;

  // 三路评分序列（出牌评分时间线）
  const [scoreSeries, setScoreSeries] = useState<(number|null)[][]>([[],[],[]]);
  const scoreSeriesRef = useRef(scoreSeries); scoreSeriesRef.current = scoreSeries;

  // 轮次与地主（可选）
  const [roundCuts, setRoundCuts] = useState<number[]>([]);
  const roundCutsRef = useRef(roundCuts); roundCutsRef.current = roundCuts;

  const [roundLords, setRoundLords] = useState<number[]>([]);
  const roundLordsRef = useRef(roundLords); roundLordsRef.current = roundLords;

  // 评分统计与直方图
  const [scoreStats, setScoreStats] = useState<SeatStat[]>([
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
    { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
  ]);
  const [scoreDists, setScoreDists] = useState<number[][]>([[],[],[]]);

  // 日志
  const [log, setLog] = useState<string[]>([]);

  /** -------------------- 身份顺序（identity-only） -------------------- **/
  // 上传文件中的 identity 顺序会记录到这里；随后展示/导出都用该顺序
  const uploadIdentityOrderRef = useRef<string[] | null>(null);

  // 你项目内应提供 seat->identity 的方法；这里做个演示默认值（请替换为真实实现）
  const seatIdentity = (i: number) => `id_${i}`; // TODO: 替换为项目内实现

  // 你项目内应提供 seat->agentId 的方法；这里做个演示默认值（请替换为真实实现）
  const agentIdForIndex = (i: number) => `agent_${i}`; // TODO: 替换为项目内实现

  // 当前 identities（优先用上传顺序）
  const activeIds = (): string[] =>
    uploadIdentityOrderRef.current && uploadIdentityOrderRef.current.length === 3
      ? uploadIdentityOrderRef.current
      : [0,1,2].map(seatIdentity);

  const identityOfIndex = (i: number) => (activeIds()[i] ?? seatIdentity(i));

  /** -------------------- 由序列强制重算统计与直方图 -------------------- **/
  const recomputeStatsFromSeries = (series: (number|null)[][]): { stats: SeatStat[]; dists: number[][] } => {
    const stats: SeatStat[] = [];
    const dists: number[][] = [[],[],[]];
    for (let i=0;i<3;i++) {
      const xs = (series[i] || []).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
      const rounds = xs.length;
      if (!rounds) {
        stats[i] = { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 };
        dists[i] = [];
        continue;
      }
      const sum = xs.reduce((a,b)=>a+b, 0);
      const mean = sum / rounds;
      const lastK = Math.min(20, rounds);
      const lastAvg = xs.slice(-lastK).reduce((a,b)=>a+b,0) / lastK;
      const best = Math.max(...xs);
      const worst = Math.min(...xs);
      const variance = xs.reduce((a,b)=>a+(b-mean)*(b-mean), 0) / rounds;
      const sigma = Math.sqrt(variance);
      stats[i] = { rounds, overallAvg: mean, lastAvg, best, worst, mean, sigma };

      // 20 桶直方图
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const bins = 20;
      if (hi > lo) {
        const bw = (hi - lo) / bins;
        const hist = new Array(bins).fill(0);
        for (const v of xs) {
          let k = Math.floor((v - lo) / bw);
          if (k < 0) k = 0;
          if (k >= bins) k = bins-1;
          hist[k]++;
        }
        dists[i] = hist;
      } else {
        dists[i] = [rounds];
      }
    }
    return { stats, dists };
  };

  /** -------------------- TrueSkill 导出（修复 url 未定义） -------------------- **/
  const saveTrueSkill = () => {
    // 写入本地存档（示例：项目中可能是 writeStore(tsStoreRef.current)）
    setTsStore({ ...tsStoreRef.current });

    const blob = new Blob([JSON.stringify(tsStoreRef.current, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'trueskill_store.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1200);
    setLog(l => [...l, '【TS】已导出当前存档。']);
  };

  /** -------------------- 单独评分 导出（identity-only） -------------------- **/
  const handleScoreSave = () => {
    const identities = activeIds();
    const agents     = [0,1,2].map(agentIdForIndex);
    const n = Math.max(
      scoreSeriesRef.current[0]?.length||0,
      scoreSeriesRef.current[1]?.length||0,
      scoreSeriesRef.current[2]?.length||0
    );
    const rounds = Array.isArray(roundCutsRef.current) ? roundCutsRef.current.slice() : [];
    const seriesByIdentity: Record<string,(number|null)[]> = {};
    for (let i=0;i<3;i++){ seriesByIdentity[identities[i]] = (scoreSeriesRef.current[i]||[]).slice(); }

    const payload = {
      schema: 'ddz-scores@1',
      version: 2,
      createdAt: new Date().toISOString(),
      agents,
      rounds,
      n,
      identities,
      seriesByIdentity,
      landlords: Array.isArray(roundLordsRef.current) ? roundLordsRef.current.slice() : undefined,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'score_series.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1500);
    setLog(l => [...l, '【Score】已导出评分序列（identity-only）。']);
  };

  /** -------------------- 单独评分 上传（identity-only + 强制重算） -------------------- **/
  const scoreUploadRef = useRef<HTMLInputElement>(null);
  const handleScoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const j:any = JSON.parse(String(fr.result || '{}'));
          if (!j || typeof j.seriesByIdentity !== 'object') {
            setScoreSeries([[],[],[]]);
            setRoundCuts([]); setRoundLords([]);
            setScoreStats([
              { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
              { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
              { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
            ]);
            setScoreDists([[],[],[]]);
            setLog(l => [...l, '【Score】上传文件缺少 seriesByIdentity，已清空。']);
            return;
          }
          const ids: string[] = Array.isArray(j.identities)
            ? j.identities.slice(0,3)
            : Object.keys(j.seriesByIdentity || {}).slice(0,3);
          uploadIdentityOrderRef.current = ids.slice(0,3);

          const mapped:(number|null)[][] = [[],[],[]];
          for (let i=0;i<3;i++) {
            const id = ids[i];
            const arr = id ? j.seriesByIdentity[id] : undefined;
            mapped[i] = Array.isArray(arr) ? arr.slice() : [];
          }
          setScoreSeries(mapped);
          if (Array.isArray(j.rounds)) setRoundCuts(j.rounds.slice()); else setRoundCuts([]);
          if (Array.isArray(j.landlords)) setRoundLords(j.landlords.slice()); else setRoundLords([]);

          const { stats, dists } = recomputeStatsFromSeries(mapped);
          setScoreStats(stats); setScoreDists(dists);
          setLog(l => [...l, '【Score】已按 identity 对齐加载，并由序列强制重算统计/直方图。']);
        } catch (err:any) {
          setLog(l => [...l, `【Score】上传解析失败：${err?.message || err}`]);
        } finally {
          if (e.target) e.target.value = '';
        }
      };
      fr.onerror = () => {
        setLog(l => [...l, '【Score】文件读取失败']);
        if (e.target) e.target.value = '';
      };
      fr.readAsText(f);
    } catch (err) {
      console.error('[score upload] error', err);
    }
  };

  /** -------------------- ALL Bundle 类型（identity-only） -------------------- **/
  type AllBundle = {
    schema: 'ddz-all@1';
    createdAt: string;
    agents: string[];
    trueskill?: TsStore;
    radar?: RadarStore;
    scoreTimeline?: {
      n: number;
      rounds: number[];
      identities: string[];
      seriesByIdentity: Record<string, (number|null)[]>;
      landlords?: number[];
    };
    scoreStats?: {
      byIdentity: Record<string, SeatStat>;
      distsByIdentity: Record<string, number[]>;
    };
    ladder?: { schema:'ddz-ladder@1'; updatedAt:string; players: Record<string, any> } | null;
  };

  /** -------------------- 构建 ALL Bundle（identity-only + 强制重算） -------------------- **/
  const buildAllBundle = (): AllBundle => {
    const agents = [0,1,2].map(agentIdForIndex);
    const n = Math.max(
      scoreSeriesRef.current[0]?.length||0,
      scoreSeriesRef.current[1]?.length||0,
      scoreSeriesRef.current[2]?.length||0
    );
    const identities = activeIds();

    const seriesByIdentity: Record<string,(number|null)[]> = (() => {
      const m:any = {}; for (let i=0;i<3;i++) m[identities[i]] = (scoreSeriesRef.current[i]||[]).slice(); return m;
    })();

    const { stats: statsRecalc, dists: distsRecalc } = recomputeStatsFromSeries(scoreSeriesRef.current);
    const scoreStatsByIdentity: Record<string, SeatStat> = (() => {
      const m:any = {}; for (let i=0;i<3;i++) m[identities[i]] = statsRecalc[i]; return m;
    })();
    const distsByIdentity: Record<string, number[]> = (() => {
      const m:any = {}; for (let i=0;i<3;i++) m[identities[i]] = (distsRecalc[i]||[]).slice(); return m;
    })();

    const ladder = (function(){ try{
      const raw = localStorage.getItem('ddz_ladder_store_v1'); return raw? JSON.parse(raw): null
    }catch{return null} })();

    return {
      schema: 'ddz-all@1',
      createdAt: new Date().toISOString(),
      agents,
      trueskill: tsStoreRef.current,
      radar: radarStoreRef.current,
      ladder,
      scoreTimeline: { n, rounds: roundCutsRef.current.slice(), identities, seriesByIdentity, landlords: roundLordsRef.current.slice() },
      scoreStats: { byIdentity: scoreStatsByIdentity, distsByIdentity },
    };
  };

  /** -------------------- ALL 导出 -------------------- **/
  const handleAllSave = () => {
    try {
      const bundle = buildAllBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'ddz_all_stats.json'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1500);
      setLog(l => [...l, '【ALL】已导出统一统计文件。']);
    } catch (err) {
      console.error('[ALL] export error', err);
      setLog(l => [...l, '【ALL】导出失败。']);
    }
  };

  /** -------------------- ALL 上传（identity-only + 强制重算） -------------------- **/
  const allUploadRef = useRef<HTMLInputElement>(null);
  const handleAllUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const f = e.target.files?.[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const obj:any = JSON.parse(String(fr.result||'{}'));
          if (obj?.scoreTimeline?.seriesByIdentity) {
            const tl = obj.scoreTimeline;
            const ids: string[] = Array.isArray(tl.identities)
              ? tl.identities.slice(0,3)
              : Object.keys(tl.seriesByIdentity || {}).slice(0,3);
            uploadIdentityOrderRef.current = ids.slice(0,3);

            const mapped:(number|null)[][] = [[],[],[]];
            for (let i=0;i<3;i++) {
              const id = ids[i];
              const arr = id ? tl.seriesByIdentity[id] : undefined;
              mapped[i] = Array.isArray(arr) ? arr.slice() : [];
            }
            setScoreSeries(mapped);
            if (Array.isArray(tl.rounds)) setRoundCuts(tl.rounds.slice()); else setRoundCuts([]);
            if (Array.isArray(tl.landlords)) setRoundLords(tl.landlords.slice()); else setRoundLords([]);

            const { stats, dists } = recomputeStatsFromSeries(mapped);
            setScoreStats(stats); setScoreDists(dists);
            setLog(l => [...l, '【ALL】已按 identity 对齐加载，并由序列强制重算统计/直方图。']);
          } else {
            // 没有 identity 时间线：清空（不做 seat 兜底）
            setScoreSeries([[],[],[]]);
            setRoundCuts([]); setRoundLords([]);
            setScoreStats([
              { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
              { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
              { rounds:0, overallAvg:0, lastAvg:0, best:0, worst:0, mean:0, sigma:0 },
            ]);
            setScoreDists([[],[],[]]);
            setLog(l => [...l, '【ALL】上传文件缺少 seriesByIdentity，已清空。']);
          }
        } catch (err:any) {
          setLog(l => [...l, `【ALL】上传解析失败：${err?.message || err}`]);
        } finally {
          if (e.target) e.target.value = '';
        }
      };
      fr.onerror = () => {
        setLog(l => [...l, '【ALL】文件读取失败']);
        if (e.target) e.target.value = '';
      };
      fr.readAsText(f);
    } catch (err) {
      console.error('[ALL upload] error', err);
    }
  };

  /** -------------------- 简单 UI（演示） -------------------- **/
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Identity-only 导入/导出（强制重算）示例</h1>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap', margin:'16px 0' }}>
        <button onClick={saveTrueSkill}>导出 TrueSkill</button>

        <button onClick={handleScoreSave}>导出「出牌评分」(identity-only)</button>
        <button onClick={()=>scoreUploadRef.current?.click()}>导入「出牌评分」(identity-only)</button>
        <input ref={scoreUploadRef} type="file" accept="application/json" onChange={handleScoreUpload} style={{ display:'none' }} />

        <button onClick={handleAllSave}>导出 ALL（TS / Radar / Timeline / Stats，identity-only）</button>
        <button onClick={()=>allUploadRef.current?.click()}>导入 ALL（identity-only + 强制重算）</button>
        <input ref={allUploadRef} type="file" accept="application/json" onChange={handleAllUpload} style={{ display:'none' }} />
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>当前 identities 顺序</h3>
        <pre>{JSON.stringify(activeIds(), null, 2)}</pre>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>评分统计（实时）</h3>
        <pre>{JSON.stringify(scoreStats, null, 2)}</pre>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3>日志</h3>
        <ul>
          {log.map((s, i)=> <li key={i}>{s}</li>)}
        </ul>
      </div>
    </div>
  );
}
