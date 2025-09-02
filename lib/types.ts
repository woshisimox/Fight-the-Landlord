// lib/types.ts
export type Suit = '♠'|'♥'|'♣'|'♦'|'🃏';
export type Rank = 3|4|5|6|7|8|9|10|11|12|13|14|15|16|17; // 11=J,12=Q,13=K,14=A,15=2,16=SJ,17=BJ

export interface Card {
  id: string;      // unique physical card id
  suit: Suit;
  label: string;   // e.g. "♠A" | "♥K" | "SJ" | "BJ"
  rank: Rank;      // compare by rank (not suit)
}

// Keep previous naming to avoid breaking other files
export type Seat = 0|1|2;

export type ComboType =
  | 'single'
  | 'pair'
  | 'triple'
  | 'bomb'
  | 'joker-bomb';

export interface Combo {
  type: ComboType;
  cards: Card[];
  mainRank: Rank;  // the rank used to compare (e.g., pair of 9 => 9)
  length: number;  // for sequences, else 1
}
