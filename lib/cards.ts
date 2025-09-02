import { Card } from './types';

const RANKS = ['3','4','5','6','7','8','9','T','J','Q','K','A','2'] as const;
const SUITS = ['S','H','C','D'] as const;

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  // 3..A,2 各四张
  for (const r of RANKS) {
    for (const s of SUITS) deck.push({ rank: toRank(r), suit: s, label: r + suitIcon(s) });
  }
  // Jokers
  deck.push({ rank:16, label:'SJ' });
  deck.push({ rank:17, label:'BJ' });
  return deck;
}

export function toRank(label: string): number {
  const map: Record<string, number> = {
    '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14,'2':15,
    'SJ':16,'BJ':17
  };
  return map[label] ?? 0;
}

export function rankLabel(rank: number): string {
  const map: Record<number,string> = {
    3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'SJ',17:'BJ'
  };
  return map[rank] ?? '?';
}

function suitIcon(s: 'S'|'H'|'C'|'D'): string {
  return { S:'♠', H:'♥', C:'♣', D:'♦' }[s];
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

export function deal(): { hands: [Card[],Card[],Card[]], bottom: Card[] } {
  const deck = shuffle(makeDeck());
  const hands: [Card[],Card[],Card[]] = [[],[],[]];
  for (let i=0;i<51;i++) hands[i%3].push(deck[i]);
  const bottom = deck.slice(51);
  // UI 里为了简洁，展示无花色短标
  hands.forEach(h=>h.sort((a,b)=>a.rank-b.rank));
  return { hands, bottom };
}
