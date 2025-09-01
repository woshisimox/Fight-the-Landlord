import type { Combo } from '../types';
import type { IBot } from '../engine';
import type { PlayerView } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';

function scoreBid(view: PlayerView): number {
  const jokers = view.hand.filter(c=>c.rank>=16).length;
  const twos = view.hand.filter(c=>c.rank===15).length;
  const triples = new Map<number,number>();
  for (const c of view.hand) triples.set(c.rank, (triples.get(c.rank) ?? 0)+1);
  const tripleCnt = Array.from(triples.values()).filter(v=>v>=3).length;
  let s = 0;
  if (jokers>=1) s++;
  if (twos>=2) s++;
  if (tripleCnt>=2) s++;
  return Math.min(3, Math.max(0, s));
}

export class BotGreedyMax implements IBot {
  private _name: string;
  constructor(name='GreedyMax') { this._name = name; }
  name(): string { return this._name; }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const s = scoreBid(view);
    return s===0 ? 'pass' : s;
  }

  async play(view: PlayerView): Promise<Combo> {
    const { require } = view;
    if (!require) {
      const combos = enumerateAllCombos(view.hand);
      combos.sort((a,b)=> (b.length??1)-(a.length??1) || (b.mainRank??0)-(a.mainRank??0));
      return combos[0];
    } else {
      const resps = enumerateResponses(view.hand, require);
      if (resps.length===0) return { type:'pass', cards: [] } as any;
      resps.sort((a,b)=> (b.mainRank??0)-(a.mainRank??0) || (b.length??1)-(a.length??1));
      return resps[0];
    }
  }
}
