// 关键响应头（尽量保留你原有的）
res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
res.setHeader('Cache-Control', 'no-cache, no-transform');
res.setHeader('X-Accel-Buffering', 'no'); // 关闭代理层缓冲（若使用）
/* 如果是 Edge Runtime 不支持 res.write，请切 Node.js Runtime:
export const config = { runtime: 'nodejs' };
*/

function writeLine(obj: any) {
  res.write(JSON.stringify(obj) + '\n');
}

// —— 单局 ——
// 强制单局，避免长连占用 Vercel 时间
const iter = runOneGame({
  seats: bots,                    // 保留你现有的 bot 选择与键/模型传递
  rob, four2, enabled,
  seatDelayMs,
  seatModels,
  seatKeys,
} as any);

// 逐条把引擎事件写成 NDJSON，遇到 win 就立即结束
try {
  let sentInit = false;
  for await (const ev of iter as any) {
    // 如果你的引擎会有多种 init 形态，可照旧做兼容处理：
    if (!sentInit && (ev?.hands || ev?.state?.hands || ev?.payload?.hands || ev?.init?.hands)) {
      sentInit = true;
    }
    writeLine(ev);

    if (ev?.type === 'event' && ev?.kind === 'win') {
      // 单局结束，立刻收尾
      break;
    }
  }
} catch (e:any) {
  writeLine({ type:'log', message:`error: ${e?.message || String(e)}` });
} finally {
  res.end(); // ★ 确保单局结束就关闭连接
}
