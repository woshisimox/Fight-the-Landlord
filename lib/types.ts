export type Suit = 'S' | 'H' | 'D' | 'C' | 'J'; // J for jokers

export type Seat = 0 | 1 | 2;

export type RankLabel = '3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A'|'2'|'SJ'|'BJ';

export const RANK_VALUE: Record<RankLabel, number> = {
  '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14,'2':15,'SJ':16,'BJ':17
};

export interface Card {
  id: string;      // unique physical id
  suit: Suit;      // S/H/D/C or J
  label: RankLabel;// '3'..'A','2','SJ','BJ'
  rank: number;    // 3..17
}

export type ComboType = 'single'|'pair'|'triple'|'bomb'|'king-bomb';

export interface Combo {
  type: ComboType;
  length: number;       // for future extensibility (sequences). Keep 1.
  mainRank: number;     // used for comparison within same type
  cards: Card[];
}

export interface Play {
  seat: Seat;
  move?: 'pass';
  comboType?: ComboType;
  cards?: Card[];
  reason: string;
}

export interface TurnEvent {
  kind: 'turn';
  round: number;
  seat: Seat;
  lead: boolean;
  require: Combo | null;
}

export type Event =
 | { kind:'deal', hands: [string[],string[],string[]], bottom: string[] }
 | { kind:'bid', seat: Seat, action: 'pass'|1|2|3 }
 | { kind:'landlord', landlord: Seat, baseScore: number, bottom: string[] }
 | TurnEvent
 | { kind:'play', round: number, seat: Seat, move?:'pass', comboType?:ComboType, cards?: string[], reason: string }
 | { kind:'trick-reset', round: number, leader: Seat }
 | { kind:'finish', round: number, winner: 'landlord'|'farmers' };

export interface PlayerView {
  seat: Seat;
  landlord: Seat;
  hand: Card[];
  bottom: Card[];
  history: Play[];
  lead: boolean;
  require: Combo | null;
}

export interface IBot {
  label: string;
  bid(view: Omit<PlayerView,'require'|'lead'>): Promise<'pass'|1|2|3>;
  play(view: PlayerView): Promise<'pass'|Combo>;
}

export interface RoundLog {
  round: number;
  landlord: Seat;
  scores: [number,number,number];
  events: Event[];
}

export interface RuleConfig {
  bidding: 'call-score';
}
