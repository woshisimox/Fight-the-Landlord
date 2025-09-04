export type Seat = 0|1|2;

export interface Card { id:number; label:string; rank:number; }
export type ComboType = 'pass'|'single'|'pair';

export interface Combo {
  type: ComboType;
  cards: Card[];
  length?: number;
  mainRank?: number;
}

export interface Play { seat: Seat; combo: Combo; reason?: string }

export interface PlayerView {
  seat: Seat;
  landlord: Seat;
  hand: Card[];
  bottom: Card[];
  history: Play[];
  lead: boolean;
  require: Combo | null;
}

export interface RoundLog {
  round: number;
  landlord: Seat;
  scores: [number, number, number];
  events: any[];
}

export type GameEvent =
  | { kind: 'deal', hands: string[][], bottom: string[] }
  | { kind: 'bid', seat: Seat, action: number | 'pass' | 'rob' | 'norob' }
  | { kind: 'landlord', landlord: Seat, baseScore: number, bottom: string[] }
  | { kind: 'turn', seat: Seat, lead: boolean, require: { type: string, mainRank?: number, length?: number } | null }
  | { kind: 'play', seat: Seat, comboType?: string, cards?: string[], move?: 'pass', reason?: string }
  | { kind: 'trick-reset', leader: Seat }
  | { kind: 'finish', winner: 'landlord' | 'farmers' }
  | { kind: 'score', totals: [number,number,number] }
  | { kind: 'terminated', reason: string, totals: [number,number,number], loser: Seat }
  | { kind: 'setup', players: any[], aiTimeoutMs?: number };
