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
  play(view: PlayerView): Promise<Combo | { combo: Combo, reason?: string }>;
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
      // Leading: must play something (pick smallest if invalid/pass)
      if (!proposed || (proposed as any).type === 'pass') {
        return this.pickSmallestLead(view.hand);
      }
      return byKey.get(this.comboKey(proposed)) ?? this.pickSmallestLead(view.hand);
    }

    // Following: if invalid or pass, auto pick minimal legal if any; else pass
    if (!proposed || (proposed as any).type === 'pass') {
      return legal.length ? legal[0] : ({ type:'pass', cards: [] } as any);
    }
    return byKey.get(this.comboKey(proposed)) ?? (legal.length ? legal[0] : ({ type:'pass', cards: [] } as any));
  }

  private unpackDecision(dec: any): { combo: Combo, reason?: string } {
    if (dec && typeof dec==='object' && 'combo' in dec) return dec as {combo:Combo, reason?:string};
    return { combo: dec as Combo };
  }

  async playRound(bots: IBot[], roundIdx: number): Promise<RoundLog> {
    // Deal
    const deck = makeDeck();
    shuffleInPlace(deck, this.rng);
    const hands: [Card[],Card[],Card[]] = [[],[],[]];
    for (let i=0;i<51;i++) hands[i%3].push(deck[i]);
    const bottom = deck.slice(51);
    this.emit({ kind:'deal', hands: hands.map(h=>h.map(c=>c.label)), bottom: bottom.map(c=>c.label) });

    // Bidding
    const bidRes = await this.bidding(hands, bottom, bots);
    const landlord = (bidRes?.landlord ?? 1) as Seat;
    const baseScore = bidRes?.baseScore ?? 1;
    hands[landlord].push(...bottom);
    this.emit({ kind:'landlord', landlord, baseScore, bottom: bottom.map(c=>c.label) });

    // Play loop
    const history: Play[] = [];
    let turn: Seat = landlord;
    let require: Combo | null = null;
    let winner: 'landlord'|'farmers'|null = null;
    let lastPlaySeat: Seat | null = null;
    let passesSinceLastPlay = 0;

    while (true) {
      this.emit({ kind:'turn', seat: turn, lead: (require===null), require: require? { type: require.type, mainRank: require.mainRank, length: require.length } : null });

      const bot = bots[turn];
      const view: PlayerView = { seat: turn, landlord, hand: hands[turn], bottom, history, lead: require===null, require };
      const decision = this.unpackDecision(await bot.play(view));
      let combo = this.normalizeToLegal(view, decision.combo);
      let reason = decision.reason as (string|undefined);
      if (!view.require && (decision.combo as any)?.type==='pass') {
        reason = reason || '首家必须领出，系统改为最小领出';
      }
      // If following and normalized differs from proposed, annotate fallback reason
      if (view.require) {
        const k1 = this.comboKey(decision.combo as any);
        const k2 = this.comboKey(combo as any);
        if (k1 !== k2 && combo.type !== 'pass') {
          reason = reason || 'AI无效/非法，系统改为最小可跟';
        }
      }

      if (this.moveDelayMs && this.moveDelayMs>0) await new Promise(r=>setTimeout(r, this.moveDelayMs));

      if (combo.type==='pass') {
        this.emit({ kind:'play', seat: turn, move:'pass', reason });
        passesSinceLastPlay += 1;
        if (passesSinceLastPlay >= 2) {
          if (lastPlaySeat===null) lastPlaySeat = turn; // safety
          require = null;
          passesSinceLastPlay = 0;
          this.emit({ kind:'trick-reset', leader: lastPlaySeat });
          turn = lastPlaySeat; // leader continues to lead a new trick
        } else {
          turn = ((turn + 1) % 3) as Seat;
        }
        continue;
      }

      this.emit({ kind:'play', seat: turn, comboType: combo.type, cards: combo.cards.map(c=>c.label), reason });
      // remove cards
      for (const c of combo.cards) {
        const idx = hands[turn].findIndex(x=>x.id===c.id);
        if (idx>=0) hands[turn].splice(idx,1);
      }
      history.push({ seat: turn, combo, reason });
      require = combo;
      lastPlaySeat = turn;
      passesSinceLastPlay = 0;

      if (hands[turn].length===0) {
        winner = (turn===landlord) ? 'landlord' : 'farmers';
        break;
      }

      turn = ((turn + 1) % 3) as Seat;
    }

    const scores: [number,number,number] = [0,0,0];
    if (winner==='landlord') { scores[landlord]+=baseScore*2; scores[(landlord+1)%3]-=baseScore; scores[(landlord+2)%3]-=baseScore; }
    else { scores[landlord]-=baseScore*2; scores[(landlord+1)%3]+=baseScore; scores[(landlord+2)%3]+=baseScore; }
    this.emit({ kind:'finish', winner });

    return { round: roundIdx, landlord, scores, events: this.events };
  }

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
  const suits: Array<'H'|'D'|'S'|'C'> = ['H','D','S','C']; // ♥♦♠♣
  let id=1;
  const cards: Card[] = [];
  for (const l of labels){
    if (l==='SJ' || l==='BJ') {
      cards.push({ id:id++, label:l, rank:ranks[l], code:l });
      continue;
    }
    for (let i=0; i<4; i++) {
      const suit = suits[i];
      const code = l + suit; // like '7H', 'QC' etc.
      cards.push({ id:id++, label:l, rank:ranks[l], suit, code });
    }
  }
  return cards;
}

function shuffleInPlace<T>(arr:T[], rng:()=>number){
  for (let i=arr.length-1;i>0;i--){ const j = Math.floor(rng()*(i+1)); [arr[i],arr[j]] = [arr[j],arr[i]]; }
}

function mulberry32(a:number){ return function(){ let t = a += 0x6D2B79F5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } }
