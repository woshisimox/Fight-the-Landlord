// lib/bots/util.ts
export function extractFirstJsonObject(text: string): any | null {
  if (!text) return null;
  // Remove code fences if present
  const cleaned = text.replace(/^```[a-zA-Z]*\n?|```$/g, '');
  // Try direct parse
  try { return JSON.parse(cleaned.trim()); } catch {}
  // Fallback: find first {...} block
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  // Very last fallback: naive replace single quotes (risky)
  try {
    const fixed = cleaned.replace(/(['\s])([a-zA-Z0-9_]+)\1:/g, '"$2":').replace(/'/g, '"');
    return JSON.parse(fixed);
  } catch {}
  return null;
}
export function nonEmptyReason(r?: string, provider?: string): string {
  const s = (r ?? '').toString().trim();
  if (s) return s;
  return provider ? `${provider} 已调用` : 'AI 已调用';
}