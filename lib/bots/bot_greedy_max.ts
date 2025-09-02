import { Combo, Seat } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';
import type { IBot, PlayerView } from './bot_random';

export class BotGreedyMax implements IBot {
  label: string;
  constructor(label: string) { this.label = label; }
  async bid(): Promise<'pass'|1|2|3> {
    // 依据手里高牌数估分
    return 2;
  }
  async play(view: PlayerView): Promise<'pass'|Combo> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (legal.length===0) return 'pass';
    // 取最大
    let best = legal[0];
    for (const c of legal) {
      if (c.type==='rocket') return c;
      if (c.type==='bomb' && best.type!=='rocket' && best.type!=='bomb') best = c;
      if (c.type===best.type && c.mainRank > best.mainRank) best = c;
    }
    return best;
  }
}
