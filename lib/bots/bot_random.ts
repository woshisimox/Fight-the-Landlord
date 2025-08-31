import { IBot, PlayerView } from '../engine';
import { Combo } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';

export class BotRandom implements IBot {
  private _name: string;
  constructor(name='RandomLegal') { this._name = name; }
  name(): string { return this._name; }

  async bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'> {
    const r = Math.random();
    if (r<0.25) return 'pass';
    if (r<0.5) return 1;
    if (r<0.75) return 2;
    return 3;
  }

  async play(view: PlayerView): Promise<Combo> {
    const { require } = view;
    if (!require) {
      const combos = enumerateAllCombos(view.hand);
      return combos[Math.floor(Math.random()*combos.length)];
    } else {
      const resps = enumerateResponses(view.hand, require);
      if (resps.length===0) return { type:'pass', cards: [] } as any;
      return resps[Math.floor(Math.random()*resps.length)];
    }
  }
}
