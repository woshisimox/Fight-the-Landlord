import { IBot, PlayerView, Combo } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';

export class BotRandom implements IBot {
  label: string;
  constructor(label='Random') { this.label = label; }

  async bid(): Promise<'pass'|1|2|3> {
    const r = Math.random();
    if (r < 0.4) return 'pass';
    if (r < 0.7) return 1;
    if (r < 0.9) return 2;
    return 3;
  }

  async play(view: PlayerView): Promise<'pass'|Combo> {
    if (view.lead || !view.require) {
      const legal = enumerateAllCombos(view.hand);
      if (!legal.length) return 'pass';
      return legal[Math.floor(Math.random()*legal.length)];
    } else {
      const resps = enumerateResponses(view.hand, view.require);
      if (!resps.length) return 'pass';
      return resps[Math.floor(Math.random()*resps.length)];
    }
  }
}
