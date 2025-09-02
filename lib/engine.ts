import { BidEvent, BidView, Card, DealEvent, FinishEvent, LandlordEvent, Play, PlayEvent, PlayerView, RoundLog, RuleConfig, Seat, TrickResetEvent, TurnEvent } from './types';
import { deal3, sortHand, labels } from './cards';
import { enumerateAllCombos, enumerateResponses } from './combos';
import type { IBot } from './bots';
type Emitter = (ev: any)=>void;
export class Engine {
  private rules: RuleConfig; private emit: Emitter;
  constructor(rules: RuleConfig, onEvent: Emitter){ this.rules = rules; this.emit = onEvent; }
  private async bidding(hands: [Card[],Card[],Card[]], bottom: Card[], bots: IBot[]){
    let bestScore = 0; let best: Seat | null = null;
    for (let s: Seat = 0 as Seat; s<3; s = ((s+1)%3) as Seat){ const view: BidView = { seat: s, hand: hands[s], bottom };
      const res = await bots[s].bid(view); const e: BidEvent = { kind:'bid', seat: s, action: res }; this.emit(e);
      if (res!=='pass' && res>bestScore) { bestScore = res; best = s; } }
    if (best===null) { best = 0; bestScore = 1; }
    const le: LandlordEvent = { kind:'landlord', landlord: best, baseScore: bestScore, bottom }; this.emit(le);
    hands[best] = sortHand(hands[best].concat(bottom)); return { landlord: best, baseScore: bestScore };
  }
  private removeCards(hand: Card[], play: any){ for (const c of play.cards){ const idx = hand.findIndex(x=>x===c); if (idx>=0) hand.splice(idx,1); } }
  async playRound(bots: IBot[], roundIdx: number): Promise<RoundLog> {
    const events: any[] = []; const emit = (ev:any)=>{ events.push(ev); this.emit(ev); };
    const pack = deal3(); const hands: [Card[],Card[],Card[]] = [ sortHand(pack.hands[0]), sortHand(pack.hands[1]), sortHand(pack.hands[2]) ]; const bottom = pack.bottom;
    emit({ kind:'deal', hands, bottom } as DealEvent);
    const bid = await this.bidding(hands, bottom, bots); if (!bid) throw new Error('bidding failed');
    const landlord = bid.landlord; const baseScore = bid.baseScore;
    let turn: Seat = landlord; let require: any = null; let lastPlayed: { seat: Seat, combo: any } | null = null; let passCount = 0;
    const history: Play[] = [];
    const viewOf = (seat: Seat): PlayerView => ({ seat, landlord, hand: hands[seat], bottom, history, lead: require===null, require, role: seat===landlord ? 'landlord' : 'farmer' });
    emit({ kind:'turn', seat: turn, lead: true, require: null } as TurnEvent);
    while (true){
      const view = viewOf(turn); const legal = require ? enumerateResponses(view.hand, require) : enumerateAllCombos(view.hand);
      let mv = await bots[turn].play(view);
      if (require===null && mv.move==='pass'){ if (legal.length>0) mv = { move:'play', combo: legal[0], reason: (mv as any).reason || '领出不可过，自动替换为最小可行招' }; }
      if (mv.move==='play' && mv.combo){
        const ok = legal.find(c=> c.type===mv.combo!.type && c.mainRank===mv.combo!.mainRank && c.cards.every(x=>mv.combo!.cards.includes(x)));
        if (!ok){ if (legal.length>0) mv = { move:'play', combo: legal[0], reason: (mv as any).reason ? (mv as any).reason + '（替换为最小可行）' : '替换为最小可行' }; else mv = { move:'pass', reason: '无合法可行解，过' }; }
      }
      if (mv.move==='pass'){
        history.push({ seat: turn, move:'pass', reason: mv.reason }); emit({ kind:'play', seat: turn, move:'pass', reason: mv.reason } as PlayEvent);
        if (require===null) passCount = 0; else passCount += 1;
      } else {
        const combo = mv.combo!; this.removeCards(hands[turn], combo);
        history.push({ seat: turn, move:'play', combo, reason: mv.reason });
        emit({ kind:'play', seat: turn, comboType: combo.type, cards: labels(combo.cards), reason: mv.reason } as PlayEvent);
        require = combo; lastPlayed = { seat: turn, combo }; passCount = 0;
        if (hands[turn].length===0){
          const winner = (turn===landlord) ? 'landlord' : 'farmers'; emit({ kind:'finish', winner } as FinishEvent);
          const scores: [number,number,number] = [0,0,0];
          if (winner==='landlord'){ scores[landlord] = baseScore*2; scores[(landlord+1)%3 as Seat] = -baseScore; scores[(landlord+2)%3 as Seat] = -baseScore; }
          else { scores[landlord] = -baseScore*2; scores[(landlord+1)%3 as Seat] = baseScore; scores[(landlord+2)%3 as Seat] = baseScore; }
          return { round: roundIdx, landlord, scores, events };
        }
      }
      if (passCount>=2 && lastPlayed){ require = null; passCount = 0; emit({ kind:'trick-reset', leader: lastPlayed.seat } as any);
        turn = lastPlayed.seat; emit({ kind:'turn', seat: turn, lead: true, require: null } as TurnEvent); continue; }
      turn = ((turn+1)%3) as Seat; emit({ kind:'turn', seat: turn, lead: require===null, require } as TurnEvent);
    }
  }
}