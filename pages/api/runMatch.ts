import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { startState, applyMove, isGameOver, GameStateSnap } from '@/lib/ddz';

const ReqSchema = z.object({
  rounds: z.number().int().min(1).max(50),
  keys: z.object({ openai: z.string().optional(), kimi: z.string().optional(), grok: z.string().optional() }),
});

type Provider = 'openai'|'kimi'|'grok';
const providers: Provider[] = ['openai','kimi','grok'];

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  try{
    const { rounds, keys } = ReqSchema.parse(req.body);
    const logs: any[] = [];
    const scoreboard: Record<Provider, number> = { openai:0, kimi:0, grok:0 };

    for (let seed=1; seed<=rounds; seed++){
      const state = startState(seed);
      const seats: Provider[] = rotateProviders(seed);
      const log = { seed, seats, events: [] as any[] };

      let s: GameStateSnap = state; let winner: number | null = null; let guard=0;
      while ((winner=isGameOver(s))===null && guard++ < 400){
        const who = s.currentPlayer;
        const pv = seats[who];
        const key = (keys as any)[pv];
        const snapshot = { landlord: s.landlord, currentPlayer: s.currentPlayer, lastCombo: s.lastCombo, handCount: s.hands.map(h=>h.length) };
        const hand = s.hands[who];

        let moveCards: string[] = [];
        let reason = '';

        if (!key){
          const { cards } = baselineMove(hand, s.lastCombo);
          moveCards = cards; reason = 'baseline';
        } else {
          const baseURL = `${req.headers['x-forwarded-proto']? 'https': 'http'}://${req.headers.host}`;
          const r = await fetch(`${baseURL}/api/llmMove`,{
            method:'POST', headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ provider: pv, apiKey: key, hand, snapshot })
          });
          const data:any = await r.json();
          if (data?.ok) { moveCards = data.move.cards; reason = data.move.reason; }
          else { const { cards } = baselineMove(hand, s.lastCombo); moveCards = cards; reason = `fallback: ${data?.error||'unknown'}`; }
        }

        const handBefore = hand.slice();
        const lastBefore = s.lastCombo;
        const { ok, reason: why, combo, next } = applyMove(s, who, moveCards);
        if (!ok){
          const { next: forceNext } = applyMove(s, who, []);
          s = forceNext; log.events.push({ who, pv, hand: handBefore, last: lastBefore, tried: moveCards, reason: reason||why||'illegal', forced:'PASS' });
        } else {
          s = next; log.events.push({ who, pv, hand: handBefore, last: lastBefore, play: combo, reason });
        }
      }
      const w = winner as number; const wp = seats[w];
      scoreboard[wp]++;
      log.events.push({ result: { winnerSeat: w, winnerProvider: wp }});
      logs.push(log);
    }

    return res.status(200).json({ ok:true, scoreboard, logs });
  }catch(e:any){
    return res.status(200).json({ ok:false, error: e?.message || 'unknown' });
  }
}

function rotateProviders(seed:number){
  const base: Provider[] = ['openai','kimi','grok'];
  const r = seed % 3; return [...base.slice(r), ...base.slice(0,r)];
}


// Minimal ranking helpers
const orderMap: Record<string, number> = { '3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,'J':8,'Q':9,'K':10,'A':11,'2':12,'SJ':13,'BJ':14 };
function cardRank(card:string){ return (card==='SJ'||card==='BJ') ? card : (card.match(/10|[2-9JQKA]/)?.[0]||'3'); }
function ro(r:string){ return orderMap[r] ?? -1; }
function sortAsc(a:string,b:string){ return ro(cardRank(a))-ro(cardRank(b)); }

function byRank(hand:string[]): Map<string, string[]>{
  const m = new Map<string,string[]>();
  for (const c of hand){ const r = cardRank(c); if (!m.has(r)) m.set(r, []); m.get(r)!.push(c); }
  for (const v of m.values()) v.sort(sortAsc);
  return m;
}

// Build a straight of given length whose top rank > baseTop; exclude 2/jokers; return [] if none
function findStraight(hand:string[], len:number, baseTop:string|null){
  const m = byRank(hand);
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A'];
  const idxTop = baseTop ? ranks.indexOf(baseTop) : -1;
  for (let end=idxTop+1+ (len-1); end<ranks.length; end++){
    const start = end-(len-1);
    const window = ranks.slice(start, end+1);
    if (window.every(r=> (m.get(r)||[]).length>=1)){
      // assemble the first available suits
      const cards:string[] = [];
      for (const r of window){ cards.push(m.get(r)!.shift()!); }
      return cards;
    }
  }
  return [];
}

// Consecutive pairs >=3
function findConsecPairs(hand:string[], pairsLen:number, baseTop:string|null){
  const m = byRank(hand);
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A'];
  const idxTop = baseTop ? ranks.indexOf(baseTop) : -1;
  for (let end=idxTop+1+ (pairsLen-1); end<ranks.length; end++){
    const start = end-(pairsLen-1);
    const window = ranks.slice(start, end+1);
    if (window.every(r=> (m.get(r)||[]).length>=2)){
      const cards:string[] = [];
      for (const r of window){ const arr = m.get(r)!; cards.push(arr[0], arr[1]); }
      return cards;
    }
  }
  return [];
}

// Airplane (no wings) length>=2
function findAirplane(hand:string[], length:number, baseTop:string|null){
  const m = byRank(hand);
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A'];
  const idxTop = baseTop ? ranks.indexOf(baseTop) : -1;
  for (let end=idxTop+1+ (length-1); end<ranks.length; end++){
    const start = end-(length-1);
    const window = ranks.slice(start, end+1);
    if (window.every(r=> (m.get(r)||[]).length>=3)){
      const cards:string[] = [];
      for (const r of window){ const arr = m.get(r)!; cards.push(arr[0], arr[1], arr[2]); }
      return cards;
    }
  }
  return [];
}

function hasRocket(hand:string[]){ return hand.includes('SJ') && hand.includes('BJ'); }
function findAnyBomb(hand:string[], baseTop:string|null){
  const m = byRank(hand);
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  for (const r of ranks){
    const arr = m.get(r)||[];
    if (arr.length>=4 && (!baseTop || ro(r)>ro(baseTop))) return arr.slice(0,4);
  }
  return [];
}

function lowestOfCount(hand:string[], need:number, greaterThan:string|null=null){
  const m = byRank(hand);
  const ranks = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  for (const r of ranks){
    if (greaterThan && ro(r) <= ro(greaterThan)) continue;
    const arr = m.get(r)||[];
    if (arr.length>=need) return arr.slice(0,need);
  }
  return [];
}

// baselineMove tries to beat last using richer combos; if starting, plays a small but composite hand if possible.
function baselineMove(hand:string[], last:any){
  // If no constraint: try better shapes to reduce card count
  if (!last || !last.cards || last.type==='PASS'){
    // prefer straight (>=5), then consecutive pairs (>=3), then airplane (>=2), then triple, pair, single; avoid bombs early
    let cards = findStraight(hand, 5, null); if (cards.length) return { cards };
    cards = findConsecPairs(hand, 3, null); if (cards.length) return { cards };
    cards = findAirplane(hand, 2, null); if (cards.length) return { cards };
    cards = lowestOfCount(hand, 3); if (cards.length) return { cards };
    cards = lowestOfCount(hand, 2); if (cards.length) return { cards };
    return { cards: [ hand.slice().sort(sortAsc)[0] ] };
  }

  const lastType = last.type;
  const lastCards = last.cards||[];
  const lastTop = last.mainRank ? last.mainRank : (lastCards.length? cardRank(lastCards[lastCards.length-1]) : null);
  const len = last.length || (lastCards.length);

  switch(lastType){
    case 'SINGLE':{
      const sorted = hand.slice().sort(sortAsc);
      for (const c of sorted){ if (ro(cardRank(c)) > ro(cardRank(lastCards[0]))) return { cards:[c] }; }
      break;
    }
    case 'PAIR':{
      const cards = lowestOfCount(hand, 2, cardRank(lastCards[0])); if (cards.length) return { cards };
      break;
    }
    case 'TRIPLE':{
      const cards = lowestOfCount(hand, 3, cardRank(lastCards[0])); if (cards.length) return { cards };
      break;
    }
    case 'TRIPLE_WITH_SINGLE':{
      const triple = lowestOfCount(hand, 3, lastTop); if (triple.length){
        const remain = hand.filter(c=>!triple.includes(c));
        const single = [remain.slice().sort(sortAsc)[0]].filter(Boolean);
        if (single.length) return { cards:[...triple, ...single] };
      }
      break;
    }
    case 'TRIPLE_WITH_PAIR':{
      const triple = lowestOfCount(hand, 3, lastTop); if (triple.length){
        const remain = hand.filter(c=>!triple.includes(c));
        const pair = lowestOfCount(remain, 2); if (pair.length) return { cards:[...triple, ...pair] };
      }
      break;
    }
    case 'STRAIGHT':{
      const cards = findStraight(hand, len, lastTop); if (cards.length) return { cards };
      break;
    }
    case 'CONSECUTIVE_PAIRS':{
      const cards = findConsecPairs(hand, len, lastTop); if (cards.length) return { cards };
      break;
    }
    case 'AIRPLANE':
    case 'AIRPLANE_SINGLE':
    case 'AIRPLANE_PAIR':{
      const cards = findAirplane(hand, len, lastTop); if (cards.length) return { cards };
      break;
    }
    case 'BOMB':{
      // need a bigger bomb or rocket
      let cards = findAnyBomb(hand, cardRank(lastCards[0])); if (cards.length) return { cards };
      if (hasRocket(hand)) return { cards: ['SJ','BJ'] };
      return { cards: [] };
    }
  }

  // couldn't beat in-type: try bomb, then rocket
  let bomb = findAnyBomb(hand, null); if (bomb.length) return { cards: bomb };
  if (hasRocket(hand)) return { cards: ['SJ','BJ'] };
  return { cards: [] };
}

