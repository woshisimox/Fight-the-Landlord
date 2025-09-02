export type Seat = 0 | 1 | 2;
export type Suit = '♠' | '♥' | '♦' | '♣' | 'JOKER';
export interface Card { rank: number; suit: Suit; label: string; isJoker?: boolean; }
export type ComboType = 'single'|'pair'|'bomb'|'rocket';
export interface Combo { type: ComboType; length: number; mainRank: number; cards: Card[]; }
export interface Play { seat: Seat; move: 'play' | 'pass'; combo?: Combo; reason?: string; }
export interface TurnEvent { kind: 'turn'; seat: Seat; lead: boolean; require: Combo|null; }
export interface DealEvent { kind: 'deal'; hands: [Card[],Card[],Card[]]; bottom: Card[]; }
export interface BidEvent { kind: 'bid'; seat: Seat; action: 'pass' | 1 | 2 | 3; }
export interface LandlordEvent { kind: 'landlord'; landlord: Seat; baseScore: number; bottom: Card[]; }
export interface PlayEvent { kind: 'play'; seat: Seat; move?: 'pass'; comboType?: ComboType; cards?: string[]; reason?: string; }
export interface TrickResetEvent { kind: 'trick-reset'; leader: Seat; }
export interface FinishEvent { kind: 'finish'; winner: 'landlord' | 'farmers'; }
export type GameEvent = DealEvent | BidEvent | LandlordEvent | TurnEvent | PlayEvent | TrickResetEvent | FinishEvent;
export interface BidView { seat: Seat; hand: Card[]; bottom: Card[]; }
export interface PlayerView {
  seat: Seat; landlord: Seat; hand: Card[]; bottom: Card[];
  history: Play[]; lead: boolean; require: Combo|null; role: 'landlord'|'farmer';
}
export interface RuleConfig { bidding: 'call-score'; baseScore: number; leadDelayMs?: number; playDelayMs?: number; }
export interface RoundLog { round: number; landlord: Seat; scores: [number, number, number]; events: GameEvent[]; }