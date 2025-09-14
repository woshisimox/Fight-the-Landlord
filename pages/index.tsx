function LivePanel(props: LiveProps) {
  const [running, setRunning] = useState(false);

  const [hands, setHands] = useState<string[][]>([[],[],[]]);
  const [landlord, setLandlord] = useState<number|null>(null);
  const [plays, setPlays] = useState<{seat:number; move:'play'|'pass'; cards?:string[]; reason?:string}[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [winner, setWinner] = useState<number|null>(null);
  const [delta, setDelta] = useState<[number,number,number] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [totals, setTotals] = useState<[number,number,number]>([
    props.startScore || 0, props.startScore || 0, props.startScore || 0,
  ]);
  const [finishedCount, setFinishedCount] = useState(0);

  // ===== TrueSkill + “上局积分” =====
  const [tsRatings, setTsRatings] = useState<{mu:number;sigma:number;cr:number}[]>([
    { mu:25, sigma:25/3, cr: 25 - 3*(25/3) },
    { mu:25, sigma:25/3, cr: 25 - 3*(25/3) },
    { mu:25, sigma:25/3, cr: 25 - 3*(25/3) },
  ]);
  const [lastRoundScore, setLastRoundScore] = useState<[number,number,number]>([0,0,0]);

  // 累计画像
  const [aggMode, setAggMode] = useState<'mean'|'ewma'>('ewma');
  const [alpha, setAlpha] = useState<number>(0.35);
  const [aggStats, setAggStats] = useState<Score5[] | null>(null);
  const [aggCount, setAggCount] = useState<number>(0);

  useEffect(() => { props.onTotals?.(totals); }, [totals]);
  useEffect(() => { props.onLog?.(log); }, [log]);

  // ---- Refs（保持读写原子） ----
  const controllerRef   = useRef<AbortController|null>(null);
  const handsRef        = useRef(hands);           useEffect(()=>{ handsRef.current=hands; }, [hands]);
  const playsRef        = useRef(plays);           useEffect(()=>{ playsRef.current=plays; }, [plays]);
  const totalsRef       = useRef(totals);          useEffect(()=>{ totalsRef.current=totals; }, [totals]);
  const finishedRef     = useRef(finishedCount);   useEffect(()=>{ finishedRef.current=finishedCount; }, [finishedCount]);
  const logRef          = useRef(log);             useEffect(()=>{ logRef.current=log; }, [log]);
  const landlordRef     = useRef(landlord);        useEffect(()=>{ landlordRef.current=landlord; }, [landlord]);
  const winnerRef       = useRef(winner);          useEffect(()=>{ winnerRef.current=winner; }, [winner]);
  const deltaRef        = useRef(delta);           useEffect(()=>{ deltaRef.current=delta; }, [delta]);
  const multiplierRef   = useRef(multiplier);      useEffect(()=>{ multiplierRef.current=multiplier; }, [multiplier]);

  const aggStatsRef     = useRef(aggStats);        useEffect(()=>{ aggStatsRef.current=aggStats; }, [aggStats]);
  const aggCountRef     = useRef(aggCount);        useEffect(()=>{ aggCountRef.current=aggCount; }, [aggCount]);
  const aggModeRef      = useRef(aggMode);         useEffect(()=>{ aggModeRef.current=aggMode; }, [aggMode]);
  const alphaRef        = useRef(alpha);           useEffect(()=>{ alphaRef.current=alpha; }, [alpha]);

  const roundsRef       = useRef(props.rounds);    useEffect(()=>{ roundsRef.current = props.rounds; }, [props.rounds]);

  // 标记“本局是否已计入 finishedCount”，避免 double count
  const roundCountedRef = useRef(false);
  const lastReasonRef   = useRef<(string|null)[]>([null,null,null]);

  // —— 工具：把对象 pretty JSON 拆成多行日志（避免一行太长）
  const dumpJSONLines = (obj: any, label?: string, maxLines = 200) => {
    try {
      const pretty = JSON.stringify(obj, (_k, v) => (typeof v === 'number' && !Number.isFinite(v)) ? String(v) : v, 2);
      const lines = (label ? [`—— ${label} ——`] : []).concat(pretty.split('\n').map(l => `│ ${l}`));
      return lines.slice(0, maxLines).concat(lines.length > maxLines ? ['│ ...（已截断）'] : []);
    } catch { return label ? [`—— ${label}（无法序列化） ——`] : ['（无法序列化）']; }
  };

  // —— 工具：把 provider/model/搜索等策略细节尽可能展开
  const strategyToLogs = (m: any): string[] => {
    const out: string[] = [];
    if (m.strategy) out.push(...dumpJSONLines(m.strategy, '策略详情'));
    if (m.analysis) out.push(...dumpJSONLines(m.analysis, '分析'));
    if (m.search)   out.push(...dumpJSONLines(m.search,   '搜索'));
    if (m.candidates) out.push(...dumpJSONLines(m.candidates, '候选'));
    if (m.scores)     out.push(...dumpJSONLines(m.scores,     '打分'));
    if (m.meta)       out.push(...dumpJSONLines(m.meta,       '元信息'));
    if (m.reason && typeof m.reason === 'string') {
      out.push('—— 决策理由 ——', ...m.reason.split('\n').map((s:string)=>`│ ${s}`));
    }
    return out;
  };

  const start = async () => {
    if (running) return;
    if (!props.enabled) { setLog(l => [...l, '【前端】未启用对局：请在设置中勾选“启用对局”。']); return; }

    // 全局初始化
    setRunning(true);
    setLandlord(null); setHands([[], [], []]); setPlays([]);
    setWinner(null); setDelta(null); setMultiplier(1);
    setLog([]); setFinishedCount(0);
    setTotals([props.startScore || 0, props.startScore || 0, props.startScore || 0]);
    lastReasonRef.current = [null, null, null];
    setAggStats(null); setAggCount(0);
    setTsRatings([
      { mu:25, sigma:25/3, cr: 25 - 3*(25/3) },
      { mu:25, sigma:25/3, cr: 25 - 3*(25/3) },
      { mu:25, sigma:25/3, cr: 25 - 3*(25/3) },
    ]);
    setLastRoundScore([0,0,0]);

    const buildSeatSpecs = (): any[] => {
      return props.seats.slice(0,3).map((choice, i) => {
        const normalized = normalizeModelForProvider(choice, props.seatModels[i] || '');
        const model = normalized || defaultModelFor(choice);
        const keys = props.seatKeys[i] || {};
        switch (choice) {
          case 'ai:openai': return { choice, model, apiKey: keys.openai || '' };
          case 'ai:gemini': return { choice, model, apiKey: keys.gemini || '' };
          case 'ai:grok':   return { choice, model, apiKey: keys.grok   || '' };
          case 'ai:kimi':   return { choice, model, apiKey: keys.kimi   || '' };
          case 'ai:qwen':   return { choice, model, apiKey: keys.qwen   || '' };
          case 'http':      return { choice, model, baseUrl: keys.httpBase || '', token: keys.httpToken || '' };
          default:          return { choice };
        }
      });
    };

    const seatSummaryText = (specs: any[]) =>
      specs.map((s, i) => {
        const nm = seatName(i);
        if (s.choice.startsWith('built-in')) return `${nm}=${choiceLabel(s.choice as BotChoice)}`;
        if (s.choice === 'http') return `${nm}=HTTP(${s.baseUrl ? 'custom' : 'default'})`;
        return `${nm}=${choiceLabel(s.choice as BotChoice)}(${s.model || defaultModelFor(s.choice as BotChoice)})`;
      }).join(', ');

    const playOneGame = async (labelRoundNo: number) => {
      controllerRef.current?.abort(); // 保险：先取消任何遗留连接
      controllerRef.current = new AbortController();
      roundCountedRef.current = false;

      setLog(l => [...l, `【前端】开始第 ${labelRoundNo} 局 | 座位: ${seatSummaryText(buildSeatSpecs())} | coop=${props.farmerCoop ? 'on' : 'off'} | trace=${Math.random().toString(36).slice(2,10)}`]);

      const r = await fetch('/api/stream_ndjson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rounds: 1,
          startScore: props.startScore,
          seatDelayMs: props.seatDelayMs,
          enabled: props.enabled,
          rob: props.rob,
          four2: props.four2,
          seats: buildSeatSpecs(),
          clientTraceId: Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36),
          stopBelowZero: true,
          farmerCoop: props.farmerCoop,
        }),
        signal: controllerRef.current!.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      const rewrite = makeRewriteRoundLabel(labelRoundNo);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx: number;
        const batch: any[] = [];
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try { batch.push(JSON.parse(line)); } catch {}
        }

        if (!batch.length) continue;

        // 快照
        let nextHands = handsRef.current.map(x => [...x]);
        let nextPlays = [...playsRef.current];
        let nextTotals = [...totalsRef.current] as [number, number, number];
        let nextFinished = finishedRef.current;
        let nextLog = [...logRef.current];
        let nextLandlord = landlordRef.current;
        let nextWinner = winnerRef.current as number | null;
        let nextDelta = deltaRef.current as [number, number, number] | null;
        let nextMultiplier = multiplierRef.current;
        let nextAggStats = aggStatsRef.current;
        let nextAggCount = aggCountRef.current;

        for (const raw of batch) {
          const m: any = raw;
          try {
            // ===== TrueSkill
            if (m.type === 'ts') {
              if (Array.isArray(m.ratings)) setTsRatings(m.ratings);
              continue;
            }

            if (m.type === 'event' && m.kind === 'round-start') {
              nextLog = [...nextLog, `【边界】round-start #${m.round}`];
              roundCountedRef.current = false; // 新一局开始
              continue;
            }

            if (m.type === 'event' && m.kind === 'round-end') {
              nextLog = [...nextLog, `【边界】round-end #${m.round}｜seenWin=${!!m.seenWin}｜seenStats=${!!m.seenStats}`];
              // 兜底：如未在 win 分支计数，在 round-end 处计一次
              if (!roundCountedRef.current) {
                nextFinished += 1;
                roundCountedRef.current = true;
                // 若达到目标，立即中止本流
                if (nextFinished >= roundsRef.current) {
                  nextLog = [...nextLog, '【前端】目标局数已完成（在 round-end），自动停止本轮连接。'];
                  controllerRef.current?.abort();
                }
              }
              continue;
            }

            const rh = m.hands ?? m.payload?.hands ?? m.state?.hands ?? m.init?.hands;
            const hasHands = Array.isArray(rh) && rh.length === 3 && Array.isArray(rh[0]);

            if (hasHands) {
              nextPlays = []; nextWinner = null; nextDelta = null; nextMultiplier = 1;
              const decorated: string[][] = (rh as string[][]).map(decorateHandCycle);
              nextHands = decorated;
              const lord = m.landlord ?? m.payload?.landlord ?? m.state?.landlord ?? m.init?.landlord ?? null;
              nextLandlord = lord;
              nextLog = [...nextLog, `发牌完成，${lord != null ? seatName(lord) : '?'}为地主`];
              lastReasonRef.current = [null, null, null];
              continue;
            }

            if (m.type === 'event' && m.kind === 'bot-call') {
              nextLog = [...nextLog, `AI调用｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜阶段=${m.phase || 'unknown'}${m.need ? `｜需求=${m.need}` : ''}`];
              if (m.prompt) nextLog.push(...dumpJSONLines(m.prompt, 'Prompt'));
              continue;
            }

            if (m.type === 'event' && m.kind === 'bot-done') {
              nextLog = [
                ...nextLog,
                `AI完成｜${seatName(m.seat)}｜${m.by}${m.model ? `(${m.model})` : ''}｜耗时=${m.tookMs}ms`,
                ...(m.reason ? [`AI理由｜${seatName(m.seat)}：${m.reason}`] : []),
              ];
              // —— 全量策略/搜索细节 ——（多行）
              nextLog.push(...strategyToLogs(m));
              lastReasonRef.current[m.seat] = m.reason || null;
              continue;
            }

            if (m.type === 'event' && (m.kind === 'analysis' || m.kind === 'debug')) {
              nextLog = [...nextLog, `AI${m.kind === 'analysis' ? '分析' : '调试'}｜${seatName(m.seat ?? -1)}`];
              nextLog.push(...dumpJSONLines(m.payload ?? m, '内容'));
              continue;
            }

            if (m.type === 'event' && m.kind === 'rob') {
              nextLog = [...nextLog, `${seatName(m.seat)} ${m.rob ? '抢地主' : '不抢'}`];
              continue;
            }

            if (m.type === 'event' && m.kind === 'trick-reset') {
              nextLog = [...nextLog, '一轮结束，重新起牌'];
              nextPlays = [];
              continue;
            }

            if (m.type === 'event' && m.kind === 'play') {
              if (m.move === 'pass') {
                const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                lastReasonRef.current[m.seat] = null;
                nextPlays = [...nextPlays, { seat: m.seat, move: 'pass', reason }];
                nextLog = [...nextLog, `${seatName(m.seat)} 过${reason ? `（${reason}）` : ''}`];
              } else {
                const pretty: string[] = [];
                const seat = m.seat as number;
                const cards: string[] = m.cards || [];
                const nh = (nextHands && (nextHands as any[]).length === 3 ? nextHands : [[], [], []]).map((x: any) => [...x]);
                for (const rawCard of cards) {
                  const options = candDecorations(rawCard);
                  const chosen = options.find((d: string) => nh[seat].includes(d)) || options[0];
                  const k = nh[seat].indexOf(chosen);
                  if (k >= 0) nh[seat].splice(k, 1);
                  pretty.push(chosen);
                }
                const reason = (m.reason ?? lastReasonRef.current[m.seat]) || undefined;
                lastReasonRef.current[m.seat] = null;

                nextHands = nh;
                nextPlays = [...nextPlays, { seat: m.seat, move: 'play', cards: pretty, reason }];
                nextLog = [...nextLog, `${seatName(m.seat)} 出牌：${pretty.join(' ')}${reason ? `（理由：${reason}）` : ''}`];
              }
              continue;
            }

            // 结算（按座位顺序显示“上局积分”）
            if (m.type === 'event' && m.kind === 'win') {
              const L = (nextLandlord ?? 0) as number;
              const ds = Array.isArray(m.deltaScores) ? m.deltaScores as [number,number,number] : [0,0,0];
              const rot: [number,number,number] = [
                ds[(0 - L + 3) % 3],
                ds[(1 - L + 3) % 3],
                ds[(2 - L + 3) % 3],
              ];
              nextWinner     = m.winner;
              nextMultiplier = m.multiplier;
              nextDelta      = rot;
              setLastRoundScore(rot);
              nextTotals     = [ nextTotals[0] + rot[0], nextTotals[1] + rot[1], nextTotals[2] + rot[2] ] as any;
              nextLog = [
                ...nextLog,
                `胜者：${seatName(m.winner)}，倍数 x${m.multiplier}，当局积分（按座位） ${rot.join(' / ')}｜原始（相对地主） ${ds.join(' / ')}｜地主=${seatName(L)}`
              ];

              if (!roundCountedRef.current) {
                nextFinished += 1;
                roundCountedRef.current = true;
                if (nextFinished >= roundsRef.current) {
                  nextLog = [...nextLog, '【前端】目标局数已完成（在 win），自动停止本轮连接。'];
                  controllerRef.current?.abort();
                }
              }
              continue;
            }

            // 后端的 stats（每局都会来）→ 累计雷达图
            if (m.type === 'event' && m.kind === 'stats' && Array.isArray(m.perSeat)) {
              const s3 = [0,1,2].map(i=>{
                const rec = m.perSeat.find((x:any)=>x.seat===i);
                const sc = rec?.scaled || {};
                return {
                  coop: Number(sc.coop ?? 2.5),
                  agg : Number(sc.agg  ?? 2.5),
                  cons: Number(sc.cons ?? 2.5),
                  eff : Number(sc.eff  ?? 2.5),
                  rob : Number(sc.rob  ?? 2.5),
                };
              }) as Score5[];

              const mode  = aggModeRef.current;
              const a     = alphaRef.current;

              if (!nextAggStats) {
                nextAggStats = s3.map(x=>({ ...x }));
                nextAggCount = 1;
              } else {
                nextAggStats = nextAggStats.map((prev, idx) => mergeScore(prev, s3[idx], mode, nextAggCount, a));
                nextAggCount = nextAggCount + 1;
              }

              const msg = s3.map((v, i)=>`${seatName(i)}：Coop ${v.coop}｜Agg ${v.agg}｜Cons ${v.cons}｜Eff ${v.eff}｜Rob ${v.rob}`).join(' ｜ ');
              nextLog = [...nextLog, `战术画像（本局）：${msg}（已累计 ${nextAggCount} 局）`];
              continue;
            }

            // 兼容：直接收到 deltaScores（按座位顺序）
            if (m.type === 'deltaScores' && Array.isArray(m.deltaScores)) {
              const ds = m.deltaScores as [number,number,number];
              setLastRoundScore(ds);
              continue;
            }

            if (m.type === 'log' && typeof m.message === 'string') {
              nextLog = [...nextLog, rewrite(m.message)];
              continue;
            }
          } catch (e) { console.error('[ingest:batch]', e, raw); }
        }

        // 批量提交
        setHands(nextHands); setPlays(nextPlays);
        setTotals(nextTotals); setFinishedCount(nextFinished);
        setLog(nextLog); setLandlord(nextLandlord);
        setWinner(nextWinner); setMultiplier(nextMultiplier); setDelta(nextDelta);
        setAggStats(nextAggStats || null); setAggCount(nextAggCount || 0);
      }

      setLog(l => [...l, `—— 本局流结束 ——`]);
    };

    try {
      // ✅ 动态停：只要已完成局数 >= 目标，就不再开启新局
      while (finishedRef.current < roundsRef.current) {
        const labelNo = finishedRef.current + 1;
        await playOneGame(labelNo);
        if (finishedRef.current >= roundsRef.current) break;

        const hasNegative = Array.isArray(totalsRef.current) && totalsRef.current.some(v => (v as number) < 0);
        if (hasNegative) { setLog(l => [...l, '【前端】检测到总分 < 0，停止连打。']); break; }

        await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 800)));
      }

      // 循环退出时，如还在运行（例如刚好最后一局），统一写入说明
      if (finishedRef.current >= roundsRef.current) {
        setLog(l => [...l, `【前端】目标局数 ${roundsRef.current} 已全部完成。`]);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') setLog(l => [...l, '已停止（Abort）。']);
      else setLog(l => [...l, `错误：${e?.message || e}`]);
    } finally {
      setRunning(false);
      controllerRef.current = null;
    }
  };

  const stop = () => { controllerRef.current?.abort(); setRunning(false); };

  const remainingGames = Math.max(0, (props.rounds || 1) - finishedCount);

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
        <span style={{ display:'inline-flex', alignItems:'center', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8, fontSize:12, background:'#fff' }}>
          剩余局数：{remainingGames}
        </span>
      </div>

      {/* 积分、TS、手牌、出牌、结果、画像、按钮、日志 —— 保持你现有的 JSX，不变 */}
      {/* 下面省略：直接沿用你页面里这部分 UI（之前我给的 index.tsx 里那段即可）。 */}
      {/* 该组件只改变了运行循环和日志输出的逻辑，UI 无需调整。 */}
    </div>
  );
}
