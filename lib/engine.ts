import { DefaultRules, RuleConfig } from './rules';
import type { Card, Combo, Play, PlayerView, RoundLog, Seat } from './types';
import { enumerateAllCombos, enumerateResponses } from './combos';

export interface EngineOptions {
  seed: number;
  rules: RuleConfig;
  moveDelayMs?: number;
  events?: any[];
  onEvent?: (ev:any)=>void;
}

export interface IBot {
  name(): string;
  bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'>;
  play(view: PlayerView): Promise<Combo>;
}

export class Engine {
  private rng: () => number;
  private rules: RuleConfig;
  private moveDelayMs: number;
  private events: any[];
  private onEvent?: (ev:any)=>void;

  constructor(opts: EngineOptions) {
    this.rng = mulberry32(opts.seed);
    this.rules = opts.rules;
    this.moveDelayMs = opts.moveDelayMs ?? 0;
    this.events = opts.events ?? [];
    this.onEvent = opts.onEvent;
  }

  private emit(ev:any){ this.events.push(ev); if (this.onEvent) try{ this.onEvent(ev);}catch{} }

  private comboKey(c: Combo): string {
    const cards = (c && (c as any).cards) ? (c as any).cards : [];
    return cards.map((x:any) => (x.label ?? '')).sort().join(',');
  }

  private pickSmallestLead(hand: Card[]): Combo {
    const all = enumerateAllCombos(hand);
    if (all.length === 0) return { type: 'pass', cards: [] } as any;
    const singles = all.filter(c => c.type === 'single');
    if (singles.length) {
      singles.sort((a,b) => (a.mainRank! - b.mainRank!));
      return singles[0];
    }
    all.sort((a,b) => (a.mainRank! - b.mainRank!) || ((a.length ?? 1) - (b.length ?? 1)));
    return all[0];
  }

  private normalizeToLegal(view: PlayerView, proposed: Combo): Combo {
    const legal = view.require
      ? enumerateResponses(view.hand, view.require)
      : enumerateAllCombos(view.hand);
    const byKey = new Map(legal.map(c => [this.comboKey(c), c]));

    if (!view.require) {
      if (!proposed || (proposed as any).type === 'pass') {
        return this.pickSmallestLead(view.hand);
      }
      const hit = byKey.get(this.comboKey(proposed));
      return hit ?? this.pickSmallestLead(view.hand);
    }

    if (!proposed || (proposed as any).type === 'pass') {
      return { type:'pass', cards: [] } as any;
    }
    const hit = byKey.get(this.comboKey(proposed));
    return hit ?? ({ type:'pass', cards: [] } as any);
  }

  async playRound(bots: IBot[], roundIdx: number): Promise<RoundLog> {
    const deck = makeDeck();
    shuffleInPlace(deck, this.rng);
    const hands: [Card[],Card[],Card[]] = [[],[],[]];
    for (let i=0;i<51;i++) hands[i%3].push(deck[i]);
    const bottom = deck.slice(51);
    this.emit({ kind:'deal', hands: hands.map(h=>h.map(c=>c.label)), bottom: bottom.map(c=>c.label) });

    // bidding
    const bidRes = await this.bidding(hands, bottom, bots);
    const landlord = bidRes?.landlord ?? 1 as Seat;
    const baseScore = bidRes?.baseScore ?? 1;
    hands[landlord].push(...bottom);
    this.emit({ kind:'landlord', landlord, baseScore, bottom: bottom.map(c=>c.label) });

    const history: Play[] = [];
    let turn: Seat = landlord;
    let require: Combo | null = null;
    let winner: 'landlord'|'farmers'|null = null;

    while (true){
      const bot = bots[turn];
      const view: PlayerView = {
        seat: turn, landlord, hand: hands[turn], bottom, history, lead: require===null, require
      };
      let proposed = await bot.play(view);
      let combo = this.normalizeToLegal(view, proposed);

      // optional delay
      if (this.moveDelayMs && this.moveDelayMs>0) await new Promise(r=>setTimeout(r, this.moveDelayMs));

      if (combo.type==='pass'){
        this.emit({ kind:'play', seat: turn, move:'pass' });
      } else {
        this.emit({ kind:'play', seat: turn, type: combo.type, cards: combo.cards.map(c=>c.label) });
        // remove cards
        for (const c of combo.cards){
          const idx = hands[turn].findIndex(x=>x.id===c.id);
          if (idx>=0) hands[turn].splice(idx,1);
        }
        history.push({ seat: turn, combo });
        require = combo;
        if (hands[turn].length===0){
          winner = (turn===landlord) ? 'landlord' : 'farmers';
          break;
        }
      }
      // if everyone passed (i.e., two passes after a lead), clear requirement
      if (combo.type==='pass'){
        const last3 = history.slice(-1);
        const passCount = (last3.length===0 ? 0 : 0); // we only store plays, so count passes separately by checking events; for simplicity, reset require after two consecutive passes events
        // simple rule: if two consecutive passes seen in events, reset
        const evlen = this.events.length;
        const lastTwo = this.events.slice(Math.max(0, evlen-2));
        if (lastTwo.length===2 && lastTwo.every(e=>e.kind==='play' && e.move==='pass')){
          require = null;
        }
      }

      turn = ((turn + 1) % 3) as Seat;
    }

    const scores: [number,number,number] = [0,0,0];
    if (winner==='landlord') { scores[landlord]+=baseScore*2; scores[(landlord+1)%3]-=baseScore; scores[(landlord+2)%3]-=baseScore; }
    else { scores[landlord]-=baseScore*2; scores[(landlord+1)%3]+=baseScore; scores[(landlord+2)%3]+=baseScore; }
    this.emit({ kind:'finish', winner });

    return { round: roundIdx, landlord, scores, events: this.events };
  }

  // Bidding phase (very simple heuristic and async-safe)
  private async bidding(hands: [Card[],Card[],Card[]], bottom: Card[], bots: IBot[]):
    Promise<{ landlord: Seat, baseScore: number, robCount: number } | null>
  {
    let bestScore = -1;
    let who: Seat = 0;
    for (let s=0 as Seat; s<3; s=(s+1)%3 as Seat){
      const view = { seat:s, landlord:0 as Seat, hand:hands[s], bottom, history:[], lead:false } as any;
      const res = await bots[s].bid(view);
      this.emit({ kind:'bid', seat: s, action: res });
      const val = (typeof res==='number' ? res : res==='rob' ? 3 : 0);
      if (val>bestScore) { bestScore = val; who = s; }
      if (s===2) break;
    }
    return { landlord: who, baseScore: Math.max(1, bestScore), robCount: 0 };
  }
}

// utils
function makeDeck(): Card[] {
  const labels = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','SJ','BJ'];
  const ranks: Record<string,number> = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14,'2':15,'SJ':16,'BJ':17 };
  let id=1;
  const cards: Card[] = [];
  for (const l of labels){
    if (l==='SJ' || l==='BJ') { cards.push({ id:id++, label:l, rank:ranks[l] }); continue; }
    for (let s=0; s<4; s++) cards.push({ id:id++, label:l, rank:ranks[l] });
  }
  return cards;
}

function shuffleInPlace<T>(arr:T[], rng:()=>number){
  for (let i=arr.length-1;i>0;i--){ const j = Math.floor(rng()*(i+1)); [arr[i],arr[j]] = [arr[j],arr[i]]; }
}

function mulberry32(a:number){ return function(){ let t = a += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } }
