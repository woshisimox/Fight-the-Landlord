// lib/engine.ts
// 新的统一入口：暴露核心类型、通用对局调度器，以及默认注册的斗地主插件。

export type {
  Action,
  GameEngine,
  GameHistoryEntry,
  GameState,
  GameStatus,
  PlayerAgent,
} from '../core/types';
export { runMatch } from '../core/game-runner';

export { ddzEngine } from '../games/ddz/game';
export type { DdzAction, DdzHistoryEvent, DdzState } from '../games/ddz/game';

// 兼容旧版斗地主引擎导出，方便已有 bot / API 继续工作。
export {
  runOneGame,
  GreedyMax,
  GreedyMin,
  RandomLegal,
  AdvancedHybrid,
} from './doudizhu/engine';
export type {
  Four2Policy,
  Label,
  BotMove,
  BotCtx,
  BotFunc,
  BotFunc as IBot,
} from './doudizhu/engine';
