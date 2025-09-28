export function extractFirstJsonObject(text:string){try{return JSON.parse(text)}catch{}const s=text.indexOf('{');const e=text.lastIndexOf('}');if(s>=0&&e>s){try{return JSON.parse(text.slice(s,e+1))}catch{}}return null;} export function nonEmptyReason(r?:string,p?:string){const s=(r??'').trim();return s||((p?p:'AI')+' 已调用');}

/** 返回一行“已出牌：…”的调试文本；不依赖任何类型 */
export function formatSeenLine(ctx:any): string {
  const arr = Array.isArray((ctx as any)?.seen) ? (ctx as any).seen as string[] : [];
  return `已出牌：${arr.length ? arr.join('') : '无'}`;
}
