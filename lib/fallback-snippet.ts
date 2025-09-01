// lib/fallback-snippet.ts（可选，仅供你复制粘贴）
export function formatFallbackReason(move: any, detail: string, error?: string) {
  const head = error ? `LLM错误/超时：${error}` : 'LLM无效/超时';
  return (move === 'pass')
    ? `${head}；默认过`
    : `${head}；改用内置策略：${detail}`;
}
