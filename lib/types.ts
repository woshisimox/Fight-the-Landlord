export type Seat = 0 | 1 | 2;

export type ComboType = 'single' | 'pair' | 'trio' | 'bomb' | 'rocket';

export interface Card {
  rank: number;      // 3..15, 16(SJ),17(BJ)
  suit?: 'S'|'H'|'C'|'D';
  label: string;     // e.g. 'K♣' or 'K' (UI可自定义展示)
}

export interface Combo {
  type: ComboType;
  length: number;         // 连对/连三时长度；这里基础实现恒为1
  mainRank: number;       // 比较大小用
  cards: Card[];          // 实际出牌对象
}

export interface Play {
  seat: Seat;
  move: 'play' | 'pass';
  combo?: Combo;
  reason?: string;
}

export interface TurnInfo {
  seat: Seat;
  lead: boolean;
  require: Combo | null;
}

export type BidAction = 'pass' | 1 | 2 | 3;

export interface RoundLog {
  round: number;
  landlord: Seat;
  baseScore: number;
  scores: [number, number, number];
  events: any[]; // 事件NDJSON友好
}

export interface RuleConfig {
  bidding: 'call-score';
}

export interface ProviderSpec {
  kind: 'builtin' | 'openai' | 'gemini' | 'kimi' | 'grok';
  name?: 'Random' | 'GreedyMin' | 'GreedyMax';
  apiKey?: string;
  baseURL?: string; // 可覆盖
  timeoutMs?: number;
}
