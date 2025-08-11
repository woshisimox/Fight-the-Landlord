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

        const { ok, reason: why, combo, next } = applyMove(s, who, moveCards);
        if (!ok){
          const { next: forceNext } = applyMove(s, who, []);
          s = forceNext; log.events.push({ who, pv, tried: moveCards, reason: reason||why||'illegal', forced:'PASS' });
        } else {
          s = next; log.events.push({ who, pv, play: combo, reason });
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

// Minimal baseline: try beat single; else pass (keep simple)
const orderMap: Record<string, number> = { '3':0,'4':1,'5':2,'6':3,'7':4,'8':5,'9':6,'10':7,'J':8,'Q':9,'K':10,'A':11,'2':12,'SJ':13,'BJ':14 };
function rank(card:string){ return (card==='SJ'||card==='BJ') ? card : (card.match(/10|[2-9JQKA]/)?.[0]||'3'); }
function rankOrder(r:string){ return orderMap[r] ?? -1; }
function lowest(hand:string[]){ return hand.slice().sort((a,b)=>rankOrder(rank(a))-rankOrder(rank(b)))[0]; }

function baselineMove(hand:string[], last:any){
  if (!last || !last.cards || last.type==='PASS') return { cards: [lowest(hand)] };
  if (last.type!=='SINGLE') return { cards: [] };
  const idx = hand.findIndex(c => rankOrder(rank(c)) > rankOrder(rank(last.cards[0])));
  return idx>=0 ? { cards:[hand[idx]] } : { cards: [] };
}
