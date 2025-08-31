import { IBot, PlayerView } from '../game/engine';
import { Combo } from '../game/types';
import { enumerateAllCombos, enumerateResponses } from '../game/combos';

export class BotGreedyMax implements IBot {
  private _name: string;
  constructor(name='GreedyMax') { this._name = name; }
  name(): string { return this._name; }

  bid(view: PlayerView): number | 'pass' | 'rob' | 'norob' {
    const jokers = view.hand.filter(c=>c.rank>=16).length;
    const twos = view.hand.filter(c=>c.rank===15).length;
    const triples = new Map<number,number>();
    for (const c of view.hand) {
      const k = c.rank; triples.set(k, (triples.get(k) ?? 0)+1);
    }
    const hasBomb = [...triples.values()].some(v=>v===4);
    const triCnt = [...triples.values()].filter(v=>v===3).length;
    let score = 0;
    if (jokers===2 || hasBomb || triCnt>=2) score = 3;
    else if (jokers===1 || twos>=2 || triCnt>=1) score = 2;
    else if (twos>=1) score = 1;
    return score===0 ? 'pass' : score;
  }

  play(view: PlayerView): Combo {
    const { require } = view;
    if (!require) {
      // lead: prefer control — use bigger combos if available
      const combos = enumerateAllCombos(view.hand);
      combos.sort((a,b)=> (b.cards.length - a.cards.length) || ((b.mainRank ?? -1)-(a.mainRank ?? -1)));
      return combos[0];
    } else {
      const resps = enumerateResponses(view.hand, require);
      if (resps.length===0) return { type:'pass', cards: [] } as any;
      // choose a bit stronger than minimal: pick the middle one
      return resps[Math.floor(resps.length/2)];
    }
  }
}
