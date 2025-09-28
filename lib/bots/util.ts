export function extractFirstJsonObject(text:string){try{return JSON.parse(text)}catch{}const s=text.indexOf('{');const e=text.lastIndexOf('}');if(s>=0&&e>s){try{return JSON.parse(text.slice(s,e+1))}catch{}}return null;} export function nonEmptyReason(r?:string,p?:string){const s=(r??'').trim();return s||((p?p:'AI')+' 已调用');}

/** 返回一行“已出牌：…”的调试文本；不依赖任何类型 */
export function formatSeenLine(ctx:any): string {
  const arr = Array.isArray((ctx as any)?.seen) ? (ctx as any).seen as string[] : [];
  return `已出牌：${arr.length ? arr.join('') : '无'}`;
}


/** 返回一行“座位：我=… 地主=… 首家=… 轮次=…”；零依赖类型 */
export function formatSeatLine(ctx:any): string {
  return `座位：我=${ctx?.seat} 地主=${ctx?.landlord} 首家=${ctx?.leader} 轮次=${ctx?.trick}`;
}

/** 返回一行“按座位已出牌：S0=… | S1=… | S2=…”；零依赖类型 */
export function formatSeenBySeatLine(ctx:any): string {
  const arr: string[][] = Array.isArray(ctx?.seenBySeat) ? ctx.seenBySeat : [[],[],[]];
  const s0 = arr[0]?.join('') || '';
  const s1 = arr[1]?.join('') || '';
  const s2 = arr[2]?.join('') || '';
  return `按座位已出牌：S0=${s0} | S1=${s1} | S2=${s2}`;
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
