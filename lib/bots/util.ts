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

/**
 * 清洗外部凭据字符串：去除首尾空白，并移除控制字符及超出单字节范围的字符。
 * 这样可以避免将含有中文或全角字符的文本直接塞进 HTTP Header，
 * 触发 Node/undici 的 ByteString 校验错误，同时保留常见的空格等字符。
 */
export function sanitizeCredential(raw?: string | null): string {
  if (raw == null) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  let out = '';
  for (const ch of trimmed) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code <= 0xff) {
      out += ch;
    }
  }
  return out;
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
