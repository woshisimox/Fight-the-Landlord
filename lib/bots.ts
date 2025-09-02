import { Combo, PlayerView, BidView } from './types';
import { enumerateAllCombos, enumerateResponses } from './combos';
export interface IBot {
  name: string;
  bid(view: BidView): Promise<'pass'|1|2|3>;
  play(view: PlayerView): Promise<{ move:'pass', reason:string } | { move:'play', combo:Combo, reason?: string }>;
}
export class BotRandom implements IBot {
  constructor(public name: string) {}
  async bid(_view: BidView){ const arr: ('pass'|1|2|3)[] = ['pass',1,2,3]; return arr[Math.floor(Math.random()*arr.length)]; }
  async play(view: PlayerView){ const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (!legal.length) return { move:'pass', reason:'无法跟上，选择过' }; const pick = legal[Math.floor(Math.random()*legal.length)];
    const reason = view.lead ? '随机领出' : '随机跟牌'; return { move:'play', combo: pick, reason }; }
}
export class BotGreedyMin implements IBot {
  constructor(public name: string) {}
  async bid(_v: BidView){ return 1; }
  async play(view: PlayerView){ const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (!legal.length) return { move:'pass', reason:'无法跟上，选择过' }; legal.sort((a,b)=>a.mainRank-b.mainRank);
    const pick = legal[0]; const reason = view.lead ? '尽量小牌领出' : '能压就打最小'; return { move:'play', combo: pick, reason }; }
}
export class BotGreedyMax implements IBot {
  constructor(public name: string) {}
  async bid(_v: BidView){ return 2; }
  async play(view: PlayerView){ const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (!legal.length) return { move:'pass', reason:'无法跟上，选择过' }; legal.sort((a,b)=>b.mainRank-a.mainRank);
    const pick = legal[0]; const reason = view.lead ? '首家最大领出' : '能压就打最大'; return { move:'play', combo: pick, reason }; }
}