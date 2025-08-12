export type Rank = 3|4|5|6|7|8|9|10|11|12|13|14|15|16|17;
export type Suit = '♣'|'♦'|'♥'|'♠'|'🃏';
export type Card = { id: string; rank: Rank; suit: Suit };

export type ComboType =
  | 'single' | 'pair' | 'triple' | 'triple1' | 'triple2'
  | 'straight' | 'pairs' | 'air' | 'airWings'
  | 'bomb' | 'rocket' | 'pass';

export type Combo = { type: ComboType; main: Rank; cards: Card[]; };

export type Seat = 0|1|2;
export type Provider = 'fallback'|'openai'|'kimi'|'grok';

export type ProviderConfig = { openaiKey?: string; kimiKey?: string; grokKey?: string; };
export type ProviderChoice = { seat0: Provider; seat1: Provider; seat2: Provider; };

export type Snapshot = {
  seat: Seat;
  hand: string[];
  history: { seat: Seat; combo: string }[];
};

export type AiResult = { tileCodes: string[], reason: string, meta: { usedApi: boolean; provider: Provider; detail?: string } };

export function rankStr(r: Rank): string {
  if (r<=10) return String(r);
  if (r===11) return 'J'; if (r===12) return 'Q'; if (r===13) return 'K'; if (r===14) return 'A'; if (r===15) return '2';
  if (r===16) return 'SJ'; if (r===17) return 'BJ';
  return String(r);
}
export function sortByRank(cards: Card[]): Card[] { return [...cards].sort((a,b)=> a.rank===b.rank ? a.suit.localeCompare(b.suit) : a.rank-b.rank); }
