// lib/engine.ts
// 汇总导出斗地主引擎（兼容旧项目对 Label 的引用）

export {
  runOneGame,
  GreedyMax,
  GreedyMin,
  RandomLegal,
  classify,
  generateMoves,
  type Card,
  type MoveType,
  type Classified,
  type Require,
  type Four2Policy,
  type Policy,
  type PlayMove,
  type PassMove,
  type RobMove,
  type BotMove,
  type BotCtx,
  type BotFunc,
  type RunOptions,
  type GameEvent,
} from './doudizhu/engine';

// ✅ 兼容旧代码：有些地方会从 lib/engine.ts 导入 Label
// 如果你的项目里 Label 有更严格的语义，再把它收紧为联合字面量即可。
export type Label = string;
