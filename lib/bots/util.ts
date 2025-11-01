// lib/bots/util.ts — consolidated, single-definition helpers

/** 从一段文本中提取第一个顶层 JSON 对象（宽松解析） */
export function extractFirstJsonObject(text: string): any | null {
  try {
    if (!text) return null;
    // 快速路径：已是纯 JSON
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try { return JSON.parse(trimmed); } catch {}
    }
    // 宽松扫描第一对大括号并尝试解析
    let depth = 0, start = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') { if (depth === 0) start = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          const cand = text.slice(start, i + 1);
          try { return JSON.parse(cand); } catch {}
        }
      }
    }
  } catch {}
  return null;
}

/** 兜底理由，若为空则返回“{provider} 已调用” */
export function nonEmptyReason(r?: string, provider?: string): string {
  const s = (r ?? '').trim();
  return s || `${provider ? provider : 'AI'} 已调用`;
}

export type PromptMode = 'normal' | 'safe' | 'minimal';

const joinCards = (value: string[]) => {
  if (!Array.isArray(value) || !value.length) return '';
  return value.map((v) => String(v ?? '')).filter(Boolean).join(' ');
};

const trimSeen = (value: string[], max = 150) => {
  if (!Array.isArray(value) || !value.length) return '无';
  const joined = joinCards(value);
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
};

const DEFAULT_SYSTEM_PROMPTS: Record<PromptMode, string> = {
  normal: 'Only reply with a strict JSON object for the move.',
  safe: 'You are a safe assistant for a friendly Dou Dizhu card game. Only reply with a strict JSON object describing the move.',
  minimal: 'Return only a JSON object with the requested move. Avoid any sensitive content.'
};

const seatNames = ['甲', '乙', '丙'];

const labelSeat = (seat: any, mode: PromptMode) => {
  if (!Number.isInteger(seat) || seat < 0) return mode === 'safe' ? 'S?' : '座位?';
  if (seat > 2) return mode === 'safe' ? `S${seat}` : `座位${seat}`;
  return mode === 'safe' ? `S${seat}` : seatNames[seat];
};

const describeHistoryEntry = (entry: any, mode: PromptMode) => {
  if (!entry) return null;
  const seat = labelSeat(entry.seat, mode);
  const trickTag = Number.isFinite(entry?.trick) ? `#${entry.trick}` : '';
  const prefix = `${seat}${trickTag}`;
  if (entry.move === 'play') {
    const cards = joinCards(Array.isArray(entry.cards) ? entry.cards : []);
    if (mode === 'safe') return `${prefix}:${cards || 'play []'}`;
    return `${prefix}:${cards || '出空'}`;
  }
  if (entry.move === 'pass') {
    return mode === 'safe' ? `${prefix}:pass` : `${prefix}:过`;
  }
  if (typeof entry.move === 'string') {
    return `${prefix}:${entry.move}`;
  }
  return null;
};

const formatHistoryLine = (ctx: any, mode: PromptMode, limit = 6) => {
  const history = Array.isArray(ctx?.history) ? ctx.history : [];
  if (!history.length) return mode === 'safe' ? 'History: none' : '历史出牌：无';
  const recent = history.slice(-limit);
  const rendered = recent
    .map((entry: any) => describeHistoryEntry(entry, mode))
    .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0);
  if (!rendered.length) return null;
  return mode === 'safe'
    ? `History: ${rendered.join(' | ')}`
    : `历史出牌：${rendered.join('｜')}`;
};

const formatCurrentTrickLine = (ctx: any, mode: PromptMode) => {
  const trickEntries = Array.isArray(ctx?.currentTrick) ? ctx.currentTrick : [];
  if (!trickEntries.length) return null;
  const rendered = trickEntries
    .map((entry: any) => describeHistoryEntry(entry, mode))
    .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0);
  if (!rendered.length) return null;
  return mode === 'safe'
    ? `CurrentTrick: ${rendered.join(' | ')}`
    : `当前出牌：${rendered.join('｜')}`;
};

const formatHandCounts = (ctx: any, mode: PromptMode) => {
  const counts = Array.isArray(ctx?.handsCount) ? ctx.handsCount : [];
  if (counts.length < 3) return null;
  if (mode === 'safe') {
    return `HandCounts: S0=${counts[0]} S1=${counts[1]} S2=${counts[2]}`;
  }
  return `剩余手牌数：甲=${counts[0]} 乙=${counts[1]} 丙=${counts[2]}`;
};

export function buildDouPrompts(
  ctx: any,
  phase: 'bid' | 'double' | 'play',
  mode: PromptMode,
  overrides?: {
    system?: Partial<Record<PromptMode, string>>;
  }
): { system: string; user: string } {
  const handsStr = Array.isArray(ctx?.hands) ? joinCards(ctx.hands) : '';
  const seenArr = Array.isArray(ctx?.seen) ? ctx.seen : [];
  const seenBySeat = Array.isArray(ctx?.seenBySeat) ? ctx.seenBySeat : [[], [], []];
  const seatLineNormal = `座位：我=${ctx?.seat} 地主=${ctx?.landlord} 首家=${ctx?.leader} 轮次=${ctx?.trick}`;
  const seatLineSafe = `Seat info: self=${ctx?.seat} landlord=${ctx?.landlord} lead=${ctx?.leader} turn=${ctx?.trick}`;
  const seatLine = mode === 'safe' ? seatLineSafe : seatLineNormal;

  const requirement = ctx?.require ? JSON.stringify(ctx.require) : 'null';
  const historyLine = formatHistoryLine(ctx, mode);
  const trickLine = formatCurrentTrickLine(ctx, mode);
  const countsLine = formatHandCounts(ctx, mode);

  const buildBidPrompt = () => {
    const info = ctx?.bid || {};
    const score = typeof info.score === 'number' ? info.score.toFixed(2) : (mode === 'safe' ? 'unknown' : '未知');
    const mult = typeof info.multiplier === 'number'
      ? info.multiplier
      : (typeof info.bidMultiplier === 'number' ? info.bidMultiplier : 1);
    const attempt = typeof info.attempt === 'number' ? info.attempt + 1 : 1;
    const total = typeof info.maxAttempts === 'number' ? info.maxAttempts : 5;
    const bidders = Array.isArray(info.bidders)
      ? info.bidders.map((b: any) => `S${b.seat}`).join(',')
      : (mode === 'safe' ? 'none' : '无');
    if (mode === 'minimal') {
      return [
        'Reply with strict JSON only: {"phase":"bid","bid":true|false,"reason":"note"}.',
        `Hand:${handsStr}`,
        'Stay concise and family friendly.'
      ].join('\n');
    }
    if (mode === 'safe') {
      return [
        'You are a harmless assistant for the Dou Dizhu card game. Reply with a strict JSON object only.',
        '{"phase":"bid","bid":true|false,"reason":"short note"}',
        `Hand: ${handsStr}`,
        `HeuristicScore: ${score}｜Multiplier: ${mult}｜Bidders: ${bidders}`,
        `Attempt: ${attempt}/${total}`,
        seatLine,
        'Answer with JSON only. bid=true means take the landlord role.'
      ].join('\n');
    }
    return [
      '你是斗地主决策助手，目前阶段是抢地主。必须只输出一个 JSON 对象：{"phase":"bid","bid":true|false,"reason":"简要说明"}。',
      `手牌：${handsStr}`,
      `启发分参考：${score}｜当前倍数：${mult}｜已抢座位：${bidders}`,
      `这是第 ${attempt}/${total} 次尝试，请结合手牌、顺位与公共信息，自主判断是否抢地主，并给出简要理由。`,
      seatLine,
      '回答必须是严格的 JSON，bid=true 表示抢地主，false 表示不抢。'
    ].join('\n');
  };

  const buildDoublePrompt = () => {
    const info = ctx?.double || {};
    const role = info?.role || (mode === 'safe' ? 'farmer' : 'farmer');
    const base = typeof info?.baseMultiplier === 'number' ? info.baseMultiplier : 1;
    const farmerInfo = info?.info?.farmer || {};
    const landlordInfo = info?.info?.landlord || {};
    const dLhat = typeof farmerInfo.dLhat === 'number' ? farmerInfo.dLhat.toFixed(2) : (mode === 'safe' ? 'unknown' : '未知');
    const counter = typeof farmerInfo.counter === 'number' ? farmerInfo.counter.toFixed(2) : (mode === 'safe' ? 'unknown' : '未知');
    const delta = typeof landlordInfo.delta === 'number' ? landlordInfo.delta.toFixed(2) : undefined;
    if (mode === 'minimal') {
      return [
        'Reply with strict JSON only: {"phase":"double","double":true|false,"reason":"note"}.',
        `Role:${role}`,
        `Hand:${handsStr}`,
        'Stay concise and family friendly.'
      ].join('\n');
    }
    if (mode === 'safe') {
      return [
        'You are a harmless assistant for the Dou Dizhu card game. Reply with JSON only.',
        '{"phase":"double","double":true|false,"reason":"short note"}',
        `Role: ${role}｜BaseMultiplier: ${base}`,
        (role !== 'landlord' ? `Farmer heuristics Δ̂=${dLhat}｜counter=${counter}` : ''),
        (role === 'landlord' && delta ? `Landlord bonus delta≈${delta}` : ''),
        seatLine,
        'Return strict JSON. double=true means double the multiplier.'
      ].filter(Boolean).join('\n');
    }
    return [
      '你是斗地主决策助手，目前阶段是明牌后的加倍决策。必须只输出一个 JSON 对象：{"phase":"double","double":true|false,"reason":"简要说明"}。',
      `角色：${role}｜基础倍数：${base}`,
      role === 'landlord' && delta ? `地主底牌增益Δ≈${delta}` : '',
      role !== 'landlord' ? `估计Δ̂=${dLhat}｜counter=${counter}` : '',
      '请结合公开信息与手牌，自主判断是否加倍，并给出简要理由。',
      seatLine,
      '回答必须是严格的 JSON，double=true 表示加倍，false 表示不加倍。'
    ].filter(Boolean).join('\n');
  };

  const buildPlayPrompt = () => {
    if (mode === 'minimal') {
      return [
        'Reply with strict JSON only: {"move":"play|pass","cards":["3"],"reason":"note"}.',
        `Hand:${handsStr}`,
        `Required:${requirement}`,
        `CanPass:${ctx?.canPass ? 'true' : 'false'}`,
        'Keep it family friendly and concise.'
      ].join('\n');
    }
    const seen0 = trimSeen(seenBySeat[0] || []);
    const seen1 = trimSeen(seenBySeat[1] || []);
    const seen2 = trimSeen(seenBySeat[2] || []);
    if (mode === 'safe') {
      return [
        'You are helping with the Chinese card game Dou Dizhu. Keep responses safe and only output JSON.',
        '{"move":"play|pass","cards":["A","A"],"reason":"short note"}',
        `Hand: ${handsStr}`,
        `RequiredPlay: ${requirement}`,
        `MayPass: ${ctx?.canPass ? 'true' : 'false'}`,
        `PolicyHint: ${ctx?.policy}`,
        seatLine,
        historyLine || undefined,
        countsLine || undefined,
        trickLine || undefined,
        `SeenBySeat: S0=${seen0} | S1=${seen1} | S2=${seen2}`,
        `SeenAll: ${trimSeen(seenArr)}`,
        'Choose only legal combinations. Reply with strict JSON and stay within the family-friendly context of this card game.'
      ].join('\n');
    }
    return [
      '你是斗地主出牌助手。必须只输出一个 JSON 对象：',
      '{ "move": "play|pass", "cards": ["A","A"], "reason": "简要理由" }',
      `手牌：${handsStr}`,
      `需跟：${requirement}`,
      '点数大小：3<4<5<6<7<8<9<T<J<Q<K<A<2<x<X（2 大于 K）',
      `可过：${ctx?.canPass ? 'true' : 'false'}`,
      `策略：${ctx?.policy}`,
      seatLine,
      historyLine || undefined,
      countsLine || undefined,
      trickLine || undefined,
      `按座位已出牌：S0=${seen0} | S1=${seen1} | S2=${seen2}`,
      `已出牌：${trimSeen(seenArr)}`,
      '只能出完全合法的牌型；若必须跟牌则给出能压住的最优解。请仅返回严格的 JSON：{"move":"play"|"pass","cards":string[],"reason":string}。'
    ].join('\n');
  };

  const user = phase === 'bid' ? buildBidPrompt() : phase === 'double' ? buildDoublePrompt() : buildPlayPrompt();
  const systemOverrides = overrides?.system || {};
  const system = systemOverrides[mode] || DEFAULT_SYSTEM_PROMPTS[mode];
  return { system, user };
}

/** 统一格式：座位行 */
export function formatSeatLine(ctx: any): string {
  return `座位：我=${ctx?.seat} 地主=${ctx?.landlord} 首家=${ctx?.leader} 轮次=${ctx?.trick}`;
}

/** 统一格式：按座位已出牌行 */
export function formatSeenBySeatLine(ctx: any): string {
  const arr: string[][] = Array.isArray(ctx?.seenBySeat) ? ctx.seenBySeat : [[],[],[]];
  const s0 = arr[0]?.join('') || '';
  const s1 = arr[1]?.join('') || '';
  const s2 = arr[2]?.join('') || '';
  return `按座位已出牌：S0=${s0} | S1=${s1} | S2=${s2}`;
}

/** 统一格式：摘要计数（便于日志快速确认） */
export function formatSeenCounts(ctx: any): string {
  const all: string[] = Array.isArray(ctx?.seen) ? ctx.seen : [];
  const by: string[][] = Array.isArray(ctx?.seenBySeat) ? ctx.seenBySeat : [[],[],[]];
  const lens = by.map(a => (Array.isArray(a) ? a.length : 0)).join('/');
  return `seen=${all.length} seenBySeat=${lens}`;
}

/** 打印上下文日志（服务端 console） */
export function logCtxSeatSeen(ctx: any) {
  try {
    // eslint-disable-next-line no-console
    console.debug('[CTX]', formatSeatLine(ctx), '|', formatSeenCounts(ctx));
  } catch {}
}

/** 打印决策日志（服务端 console） */
export function logDecision(ctx: any, dec: any) {
  try {
    const cards = Array.isArray(dec?.cards) ? dec.cards.join('') : '';
    // eslint-disable-next-line no-console
    console.debug('[DECISION]', `seat=${ctx?.seat}`, `move=${dec?.move}`, `cards=${cards}`, `reason=${dec?.reason || ''}`);
  } catch {}
}
