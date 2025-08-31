export type Seat = 0 | 1 | 2; // 0:甲(A), 1:乙(B), 2:丙(C)

export type Rank =
  | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 // 3..A
  | 15 // 2
  | 16 // 小王
  | 17 // 大王
;

export interface Card {
  id: number;   // unique id in [0..53]
  rank: Rank;   // 3..17
  label: string;// e.g. '3','4',...,'A','2','SJ','BJ'
}

export type ComboType =
  | 'pass'
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple1'
  | 'triple2'
  | 'straight'   // >= 5, no 2/Jokers
  | 'pairseq'    // >= 3 pairs, no 2/Jokers
  | 'plane'      // >= 2 triplets contiguous, no wings
  | 'plane1'     // plane with single wings
  | 'plane2'     // plane with pair wings
  | 'four2'      // four with two singles
  | 'four2pairs' // four with two pairs
  | 'bomb'
  | 'rocket'
;

export interface Combo {
  type: ComboType;
  mainRank?: Rank; // for comparison; for sequences: the MIN triplet/pair/single rank
  length?: number; // for sequences length (singles in straight, pairs in pairseq, triplets in plane)
  cards: Card[];   // actual cards composing the play
}

export interface Play {
  seat: Seat;
  combo: Combo;
}

export interface RoundLog {
  deal: { [seat in Seat]: string[] };     // labels
  landlord: Seat;
  baseScore: number;
  robCount: number;
  bottom: string[];
  plays: { seat: Seat; text: string; }[]; // human readable play log
  winner: 'landlord' | 'farmers';
  spring: 'none' | 'spring' | 'antispring';
  bombs: number;
  rocket: number;
  finalMultiplier: number;
  scores: { [seat in Seat]: number }; // + for win, - for lose, per seat
}
