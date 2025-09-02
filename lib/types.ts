export type Suit = '♠'|'♥'|'♣'|'♦' | null; // Jokers have null suit
export type Rank = '3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A'|'2'|'SJ'|'BJ';

export interface Card {
  suit: Suit;
  rank: Rank;   // SJ/BJ for jokers
  face: string; // e.g. '♠K' or 'SJ'
  label: string; // rank-only for logs/compat (e.g. 'K','SJ')
  value: number; // for sorting (3..A=14, 2=15, SJ=16, BJ=17)
}

export type Seat = 0|1|2;

export type ComboType = 'single'|'pair'|'triple'|'bomb'|'rocket';

export interface Combo {
  type: ComboType;
  mainRank: number;
  length: number; // for serial types; here keep 1
  cards: Card[];
}

export interface RuleConfig {
  bidding: 'call-score'; // simplified
  startBaseScore?: number; // optional UI base
}

export interface BidView {
  seat: Seat;
  hand: Card[];
  history: Array<{seat:Seat, action: 1|2|3|'pass'}>;
}

export interface Play {
  seat: Seat;
  move: 'play'|'pass';
  combo?: Combo;
  reason?: string;
}

export interface PlayerView {
  seat: Seat;
  landlord: Seat;
  hand: Card[];
  bottom: Card[];
  history: Play[];
  lead: boolean;
  require: Combo|null;
}

export interface RoundLog {
  round: number;
  landlord: Seat;
  baseScore: number;
  scores: [number,number,number];
  events: any[];
}
