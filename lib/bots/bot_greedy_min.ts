import { IBot, PlayerView } from '../engine';
import { Combo } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';

function scoreBid(view: PlayerView): number {
  const highs = view.hand.filter(c=>c.rank>=14).length; // A,2,SJ,BJ
  if (highs >= 6) return 3;
  if (highs >= 4) return 2;
  if (highs >= 2) return 1;
  return 0;
}

export class BotGreedyMin implements IBot {
  private _name: string;
  constructor(name='GreedyMin') { this._name = name; }
  name(): string { return this._name; }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const s = scoreBid(view);
    return s===0 ? 'pass' : s;
  }

  async play(view: PlayerView): Promise<Combo> {
    const { require } = view;
    if (!require) {
      const combos = enumerateAllCombos(view.hand);
      combos.sort((a,b)=>{
        const la = a.length ?? 1, lb = b.length ?? 1;
        if (la!==lb) return la - lb;
        const ma = a.mainRank ?? 0, mb = b.mainRank ?? 0;
        return (ma - mb);
      });
      return combos[0];
    } else {
      const resps = enumerateResponses(view.hand, require);
      if (resps.length===0) return { type:'pass', cards: [] } as any;
      resps.sort((a,b)=>{
        const ma = a.mainRank ?? 0, mb = b.mainRank ?? 0;
        if (ma!==mb) return ma - mb;
        const la = a.length ?? 1, lb = b.length ?? 1;
        return la - lb;
      });
      return resps[0];
    }
  }
}
