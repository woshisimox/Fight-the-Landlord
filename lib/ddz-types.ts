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

export type AiResult = { tileCodes: string[]; reason: string; meta: { usedApi: boolean; provider: Provider; detail?: string } };

export const RANK_ORDER: Rank[] = [3,4,5,6,7,8,9,10,11,12,13,14,15,16,17];
export const SUITS: Suit[] = ['♣','♦','♥','♠','🃏'];

export function code(c: Card): string {
  return c.rank >= 16 ? (c.rank===16?'SJ':'BJ') : `${rankStr(c.rank)}${c.suit}`;
}
export function rankStr(r: Rank): string {
  if (r<=10) return String(r);
  if (r===11) return 'J'; if (r===12) return 'Q'; if (r===13) return 'K'; if (r===14) return 'A'; if (r===15) return '2';
  if (r===16) return 'SJ'; if (r===17) return 'BJ';
  return String(r);
}
export function fromCode(s: string): Card {
  if (s==='SJ') return { id:'SJ', rank:16, suit:'🃏' };
  if (s==='BJ') return { id:'BJ', rank:17, suit:'🃏' };
  const m = s.match(/^(10|[2-9JQKA])(♣|♦|♥|♠)$/);
  if (!m) throw new Error('Bad code:'+s);
  const r = (m[1]==='J'?11 : m[1]==='Q'?12 : m[1]==='K'?13 : m[1]==='A'?14 : m[1]==='2'?15 : parseInt(m[1],10)) as Rank;
  return { id:s, rank:r, suit:m[2] as Suit };
}
export function sortByRank(cards: Card[]): Card[] {
  return [...cards].sort((a,b)=> a.rank===b.rank ? a.suit.localeCompare(b.suit) : a.rank-b.rank);
}
