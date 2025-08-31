export type Seat = 0 | 1 | 2;

export type Rank =
  | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
  | 15 | 16 | 17;

export interface Card { id:number; rank:Rank; label:string; }

export type ComboType =
  | 'pass' | 'single' | 'pair' | 'triple' | 'triple1' | 'triple2'
  | 'straight' | 'pairseq' | 'plane' | 'plane1' | 'plane2'
  | 'four2' | 'four2pairs' | 'bomb' | 'rocket';

export interface Combo { type: ComboType; mainRank?:Rank; length?:number; cards: Card[]; }
export interface Play { seat:Seat; combo:Combo; }

export interface RoundLog {
  deal: { [seat in Seat]: string[] };
  landlord: Seat;
  baseScore: number;
  robCount: number;
  bottom: string[];
  plays: { seat: Seat; text: string; }[];
  winner: 'landlord' | 'farmers';
  spring: 'none' | 'spring' | 'antispring';
  bombs: number;
  rocket: number;
  finalMultiplier: number;
  scores: { [seat in Seat]: number };
  events?: any[]; // stepwise events for UI
}

export interface PlayerView {
  seat: Seat;
  landlord: Seat;
  hand: Card[];
  bottom: Card[];
  history: Play[];
  lead: boolean;
  require?: Combo;
}

export type GameEvent =
  | { kind: 'deal', hands: string[][], bottom: string[] }
  | { kind: 'bid', seat: Seat, action: number | 'pass' | 'rob' | 'norob' }
  | { kind: 'landlord', landlord: Seat, baseScore: number, bottom: string[] }
  | { kind: 'play', seat: Seat, type?: ComboType, cards?: string[] | null, move?: 'pass' }
  | { kind: 'finish', winner: 'landlord' | 'farmers' };
