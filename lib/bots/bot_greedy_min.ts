import type { Combo } from '../types';
import type { IBot } from '../engine';
import type { PlayerView } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';

function scoreBid(view: PlayerView): number {
  const highs = view.hand.filter(c=>c.rank>=14).length;
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

  async play(view: PlayerView): Promise<Combo | {combo: Combo, reason?: string}> {
    const { require } = view;
    if (!require) {
      const combos = enumerateAllCombos(view.hand);
      combos.sort((a,b)=> (a.length??1)-(b.length??1) || (a.mainRank??0)-(b.mainRank??0));
      return { combo: combos[0], reason: '首家最小领出' };
    } else {
      const resps = enumerateResponses(view.hand, require);
      if (resps.length===0) return { combo: ({ type:'pass', cards: [] } as any), reason: '无法跟上，选择过' };
      resps.sort((a,b)=> (a.mainRank??0)-(b.mainRank??0) || (a.length??1)-(b.length??1));
      return { combo: resps[0], reason: '能压就打最小' };
    }
  }
}
