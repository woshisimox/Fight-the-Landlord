import { IBot, PlayerView } from '../engine';
import { Combo, ComboType } from '../game/types';
import { enumerateAllCombos, enumerateResponses } from '../game/combos';

export class BotGreedyMin implements IBot {
  private _name: string;
  constructor(name='GreedyMin') { this._name = name; }
  name(): string { return this._name; }

  bid(view: PlayerView): number | 'pass' | 'rob' | 'norob' {
    // Simple strength: count high ranks and jokers
    const high = view.hand.filter(c=>c.rank>=14).length;
    const bombs = new Set(view.hand.map(c=>c.rank)).size !== view.hand.length ? 1 : 0;
    const score = (high>=6?3:(high>=4?2:(high>=2?1:0)));
    return score===0 ? 'pass' : score;
  }

  play(view: PlayerView): Combo {
    const { require } = view;
    if (!require) {
      // lead: enumerate all combos and pick the "lightest" (min size then min mainRank)
      const combos = enumerateAllCombos(view.hand);
      combos.sort((a,b)=> (a.cards.length - b.cards.length) || ((a.mainRank ?? 99)-(b.mainRank ?? 99)));
      return combos[0];
    } else {
      const resps = enumerateResponses(view.hand, require);
      if (resps.length===0) return { type:'pass', cards: [] } as any;
      // pick the smallest winning response
      return resps[0];
    }
  }
}
