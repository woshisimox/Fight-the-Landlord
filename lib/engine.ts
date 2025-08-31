import { Card, Combo, Play, Rank, RoundLog, Seat } from './types';
import { makeDeck, rankLabel } from './deck';
import { RNG } from './random';
import { detectCombo, enumerateAllCombos, enumerateResponses, sortByRankAsc, beats } from './combos';
import { RuleConfig, DefaultRules } from './rules';

export interface PlayerView {
  seat: Seat;
  landlord: Seat;
  hand: Card[];
  bottom: Card[];
  history: Play[];
  lead: boolean;
  require?: Combo; // current trick to follow
}

export interface IBot {
  name(): string;
  bid(view: PlayerView): Promise<number | 'pass' | 'rob' | 'norob'>;
  play(view: PlayerView): Promise<Combo>; // must return a legal combo (or pass)
}

export interface EngineOptions {
  seed: number;
  rules: RuleConfig;
  moveDelayMs?: number;
  events?: any[];
}

function seatName(s: Seat): string { return ['甲(A)','乙(B)','丙(C)'][s]; }

export class Engine {
  private rng: RNG;
  private rules: RuleConfig;
  private moveDelayMs: number;
  private events: any[];

  constructor(opts: EngineOptions) {
    this.rng = new RNG(opts.seed);
    this.rules = opts.rules;
    this.moveDelayMs = opts.moveDelayMs ?? 0;
    this.events = opts.events ?? [];
  }

  deal(): { hands: [Card[],Card[],Card[]]; bottom: Card[] } {
    const deck = makeDeck();
    this.rng.shuffle(deck);
    const hands: [Card[],Card[],Card[]] = [[],[],[]];
    for (let i=0;i<17;i++) {
      hands[0].push(deck[i*3+0]);
      hands[1].push(deck[i*3+1]);
      hands[2].push(deck[i*3+2]);
    }
    const bottom = deck.slice(51);
    for (const h of hands) h.sort((a,b)=>a.rank-b.rank || a.id-b.id);
    return { hands, bottom };
  }

  // Bidding phase
  private async bidding(hands: [Card[],Card[],Card[]], bottom: Card[], bots: IBot[]):
    Promise[{ landlord: Seat, baseScore: number, robCount: number } | null]
  {
    if (this.rules.bidding==='call-score') {
      let bestScore = 0;
      let bestSeat: Seat | null = null;
      for (let s=0 as Seat; s<=2; s=(s+1) as Seat) {
        const view: PlayerView = {
          seat: s, landlord: 0, hand: hands[s], bottom, history: [], lead: false
        };
        const res = await bots[s].bid(view);
        if (res==='pass') {
          // nothing
        } else if (typeof res==='number') {
          const sc = Math.max(1, Math.min(3, Math.floor(res)));
          if (sc>bestScore) { bestScore = sc; bestSeat = s; }
          if (sc===3) break;
        }
      }
      if (bestSeat===null) return null; // all pass => redeal
      return { landlord: bestSeat, baseScore: bestScore, robCount: 0 };
    } else {
      // rob mode
      let landlord: Seat | null = null;
      let robCount = 0;
      // first caller
      for (let s=0 as Seat; s<=2; s=(s+1) as Seat) {
        const view: PlayerView = { seat: s, landlord: 0, hand: hands[s], bottom, history: [], lead: false };
        const res = await bots[s].bid(view);
        const wantRob = (res==='rob') || (typeof res==='number' && res>0);
        if (wantRob) { landlord = s; robCount = 1; break; }
      }
      if (landlord===null) return null;
      // others may rob
      for (let step=1; step<3; step++) {
        const s = ((landlord + step) % 3) as Seat;
        const view: PlayerView = { seat: s, landlord, hand: hands[s], bottom, history: [], lead: false };
        const res = await bots[s].bid(view);
        const wantRob = (res==='rob') || (typeof res==='number' && res>0);
        if (wantRob) { landlord = s; robCount++; }
      }
      return { landlord, baseScore: 1, robCount };
    }
  }

  // Run one round; return RoundLog and seat scores
  async playRound(bots: IBot[], roundIndex: number): Promise<RoundLog | null> {
    const { hands, bottom } = this.deal();
    const bidRes = await this.bidding(hands, bottom, bots);
    if (!bidRes) return null;
    const { landlord, baseScore, robCount } = bidRes;

    // give bottom to landlord
    hands[landlord].push(...bottom);
    hands[landlord].sort((a,b)=>a.rank-b.rank || a.id-b.id);

    const plays: Play[] = [];
    const humanPlays: { seat: Seat; text: string; }[] = [];

    const landName = seatName(landlord);
    humanPlays.push({ seat: landlord, text: `地主确定: ${landName}, 底牌=${bottom.map(c=>c.label).join('')}, 基础分=${baseScore}` });
    this.events.push({ kind:'landlord', landlord, baseScore, bottom: bottom.map(c=>c.label) });

    let current: Combo | null = null;
    let leadSeat: Seat = landlord;
    let turn: Seat = landlord;
    let passCount = 0;
    let bombs = 0;
    let rocket = 0;
    const firstPlayCount = [0,0,0] as number[];
    const nonLandlordSeats: Seat[] = [0,1,2].filter(s=>s!==landlord) as Seat[];

    const getView = (s: Seat): PlayerView => ({
      seat: s,
      landlord,
      hand: hands[s],
      bottom,
      history: plays.slice(),
      lead: s===leadSeat,
      require: current ?? undefined,
    });

    // main loop
    while (true) {
      const view = getView(turn);
      const bot = bots[turn];
      let combo = await bot.play(view);
      // validate combo
      if (!combo) combo = { type:'pass', cards: [] } as Combo;
      if (combo.type!=='pass') {
        const det = detectCombo(combo.cards);
        if (!det || det.type!==combo.type || (det.length!==undefined && combo.length!==undefined && det.length!==combo.length)) {
          // auto-fix to pass if invalid
          combo = { type:'pass', cards: [] } as Combo;
        } else {
          combo = det;
        }
      }

      // check against requirement
      if (current) {
        // must beat or pass
        let legal = false;
        if (combo.type==='pass') legal = true;
        else {
          // same type/shape or bombs/rocket
          // direct import of beats at top
          legal = beats(current, combo);
        }
        if (!legal) combo = { type:'pass', cards: [] } as Combo;
      }

      // optional delay before applying play
      if (this.moveDelayMs && this.moveDelayMs > 0) { await new Promise(r => setTimeout(r, this.moveDelayMs)); }
      // apply play
      plays.push({ seat: turn, combo });
      if (combo.type==='pass') {
        humanPlays.push({ seat: turn, text: `${seatName(turn)}: 过` });
        this.events.push({ kind:'play', seat: turn, move:'pass' });
        passCount++;
      } else {
        // remove cards
        for (const c of combo.cards) {
          const idx = hands[turn].findIndex(x=>x.id===c.id);
          if (idx>=0) hands[turn].splice(idx,1);
        }
        firstPlayCount[turn]++;
        passCount = 0;
        current = combo;
        leadSeat = turn;
        const tag = combo.type.toUpperCase();
        if (combo.type==='bomb') bombs++;
        if (combo.type==='rocket') rocket++;
        humanPlays.push({ seat: turn, text: `${seatName(turn)}: ${tag} ${combo.cards.map(c=>c.label).join('')}` });
        this.events.push({ kind:'play', seat: turn, type: combo.type, cards: combo.cards.map(c=>c.label) });
      }

      // win check
      if (hands[turn].length===0) {
        const winner = (turn===landlord) ? 'landlord' : 'farmers';
        // spring
        let spring: 'none'|'spring'|'antispring' = 'none';
        if (winner==='landlord') {
          const totalFarmerPlays = firstPlayCount[nonLandlordSeats[0]] + firstPlayCount[nonLandlordSeats[1]];
          if (totalFarmerPlays===0) spring='spring';
        } else {
          if (firstPlayCount[landlord]===1) spring='antispring';
        }
        // final multiplier
        let multiplier = baseScore;
        // rob multiplier
        if (this.rules.bidding==='rob' && this.rules.robMultiplier) {
          multiplier *= (2 ** robCount);
        }
        // bombs & rocket doubling
        const bombTimes = bombs + rocket; // rocket also ×2
        multiplier *= (2 ** bombTimes);
        if (spring!=='none') multiplier *= 2;

        const scores: {[seat in Seat]: number} = { 0:0,1:0,2:0 };
        if (winner==='landlord') {
          scores[landlord] = +multiplier*2;
          for (const s of nonLandlordSeats) scores[s] = -multiplier;
        } else {
          scores[landlord] = -multiplier*2;
          for (const s of nonLandlordSeats) scores[s] = +multiplier;
        }

        this.events.push({ kind:'finish', winner });
        const roundLog: RoundLog = {
          deal: {
            0: hands[0].map(c=>c.label),
            1: hands[1].map(c=>c.label),
            2: hands[2].map(c=>c.label),
          },
          landlord, baseScore, robCount,
          bottom: bottom.map(c=>c.label),
          plays: humanPlays,
          winner, spring,
          bombs, rocket,
          finalMultiplier: multiplier,
          scores,
          events: this.events,
        };
        return roundLog;
      }

      // trick end if two passes
      if (passCount===2 && current) {
        // reset requirement
        current = null;
        passCount = 0;
        // next turn is the last non-pass (leadSeat), but it will advance by +1 below
        turn = leadSeat;
      }

      // next turn
      turn = ((turn + 1) % 3) as Seat;
    }
  }
}