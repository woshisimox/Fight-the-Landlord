import { IBot, PlayerView, Combo } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';

export class BotGreedyMax implements IBot {
  label: string;
  constructor(label='GreedyMax') { this.label = label; }

  async bid(): Promise<'pass'|1|2|3> {
    return 2;
  }

  async play(view: PlayerView): Promise<'pass'|Combo> {
    const pick = (xs: Combo[]): Combo => xs.sort((a,b)=>b.mainRank-a.mainRank)[0];
    if (view.lead || !view.require) {
      const legal = enumerateAllCombos(view.hand);
      if (!legal.length) return 'pass';
      return pick(legal);
    } else {
      const resps = enumerateResponses(view.hand, view.require);
      if (!resps.length) return 'pass';
      return pick(resps);
    }
  }
}

export class BotGreedyMin implements IBot {
  label: string;
  constructor(label='GreedyMin') { this.label = label; }

  async bid(): Promise<'pass'|1|2|3> {
    return 1;
  }

  async play(view: PlayerView): Promise<'pass'|Combo> {
    const pick = (xs: Combo[]): Combo => xs.sort((a,b)=>a.mainRank-b.mainRank)[0];
    if (view.lead || !view.require) {
      const legal = enumerateAllCombos(view.hand);
      if (!legal.length) return 'pass';
      return pick(legal);
    } else {
      const resps = enumerateResponses(view.hand, view.require);
      if (!resps.length) return 'pass';
      return pick(resps);
    }
  }
}
