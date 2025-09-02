import { Combo, Seat } from '../types';
import { enumerateAllCombos, enumerateResponses } from '../combos';

export interface PlayerView {
  seat: Seat;
  landlord: Seat;
  hand: any[];
  bottom: any[];
  history: any[];
  lead: boolean;
  require: Combo | null;
}

export interface IBot {
  label: string;
  bid(view: Omit<PlayerView,'require'>): Promise<'pass'|1|2|3>;
  play(view: PlayerView): Promise<'pass'|Combo>;
}

export class BotRandom implements IBot {
  label: string;
  constructor(label: string) { this.label = label; }
  async bid(): Promise<'pass'|1|2|3> {
    const r = Math.random();
    if (r<0.5) return 'pass';
    return (1 + Math.floor(Math.random()*3)) as 1|2|3;
  }
  async play(view: PlayerView): Promise<'pass'|Combo> {
    const legal = view.require ? enumerateResponses(view.hand, view.require) : enumerateAllCombos(view.hand);
    if (legal.length===0) return 'pass';
    return legal[Math.floor(Math.random()*legal.length)];
  }
}
