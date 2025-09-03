import type { Combo } from '../types';
import type { IBot } from '../engine';
import type { PlayerView } from '../types';
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

  async play(view: PlayerView): Promise<Combo | {combo: Combo, reason?: string}> {
    const { require } = view;
    if (!require) {
      const combos = enumerateAllCombos(view.hand);
      const c = combos[Math.floor(Math.random()*combos.length)];
      return { combo: c, reason: '随机领出' };
    } else {
      const resps = enumerateResponses(view.hand, require);
      if (resps.length===0) return { combo: ({ type:'pass', cards: [] } as any), reason: '无法跟上，选择过' };
      const c = resps[Math.floor(Math.random()*resps.length)];
      return { combo: c, reason: '随机跟牌' };
    }
  }
}
