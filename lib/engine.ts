// lib/engine.ts
import {
  runSeries,
  type RunOptions,
  type Emit,
  GreedyMax,
  GreedyMin,
  RandomLegal,
} from "./doudizhu/engine";

/** 兼容旧调用：单局运行包装 */
export async function runOneGame(
  opts: Omit<RunOptions, "rounds">,
  emit: Emit
) {
  return runSeries({ rounds: 1, ...opts }, emit);
}

// 透出其余导出，保持原有用法
export { runSeries, GreedyMax, GreedyMin, RandomLegal };
