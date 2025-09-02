import { Combo } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';
import type { IBot, PlayerView } from './bot_random';

export class BotGreedyMin implements IBot {
  label: string;
  constructor(label: string) { this.label = label; }
  async bid(): Promise<'pass'|1|2|3> { return 1; }
  async play(view: PlayerView): Promise<'pass'|Combo> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (legal.length===0) return 'pass';
    // 出最小可行
    let best = legal[0];
    for (const c of legal) {
      if (best.type==='rocket') break;
      if (c.type==='rocket') { best = c; break; }
      if (best.type!=='bomb' && c.type==='bomb') continue; // 尽量保炸
      if (c.mainRank < best.mainRank && c.type===best.type) best = c;
    }
    return best;
  }
}
