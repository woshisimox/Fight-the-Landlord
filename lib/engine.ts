import { Card, Combo, Event, IBot, PlayerView, Play, RoundLog, RuleConfig, Seat } from './types';
import { makeDeck, handLabels } from './cards';
import { shuffleInPlace, removeCards } from './utils';

export class Engine {
  rules: RuleConfig = { bidding: 'call-score' };

  private viewFor(seat: Seat, landlord: Seat, hand: Card[], bottom: Card[], history: Play[], lead: boolean, require: Combo|null): PlayerView {
    return { seat, landlord, hand, bottom, history, lead, require };
  }

  private async bidding(hands: [Card[],Card[],Card[]], bottom: Card[], bots: IBot[]):
    Promise<{ landlord: Seat, baseScore: number } | null>
  {
    let best: { seat: Seat, score: 1|2|3 } | null = null;
    const events: Event[] = [];

    for (let s:Seat = 0 as Seat; s<3; s=(s+1)%3 as Seat) {
      const view = this.viewFor(s, 0, hands[s], bottom, [], false, null);
      const res = await bots[s].bid(view);
      events.push({ kind:'bid', seat: s, action: res });
      if (res === 'pass') { /* nothing */ }
      else {
        if (!best || res > best.score) best = { seat: s, score: res };
      }
      if (s===2) break; // one round of bidding (simple)
    }

    if (!best) return null;

    // Give bottom to landlord
    const landlord = best.seat;
    hands[landlord].push(...bottom);

    return { landlord, baseScore: best.score };
  }

  async runRound(bots: IBot[], roundIdx: number): Promise<RoundLog> {
    // Prepare deck and deal
    const deck = shuffleInPlace(makeDeck().slice());
    const hands: [Card[],Card[],Card[]] = [deck.slice(0,17), deck.slice(17,34), deck.slice(34,51)];
    const bottom: Card[] = deck.slice(51);
    const events: Event[] = [];
    events.push({ kind:'deal', hands: [handLabels(hands[0]), handLabels(hands[1]), handLabels(hands[2])], bottom: handLabels(bottom) });

    const bidRes = await this.bidding(hands, bottom, bots);
    if (!bidRes) {
      // redeal: simple fallback, landlord seat 0, base 1
      const landlord: Seat = 0;
      hands[landlord].push(...bottom);
      events.push({ kind:'landlord', landlord, baseScore: 1, bottom: handLabels(bottom) });
      return { round: roundIdx, landlord, scores: [0,0,0], events };
    }
    const { landlord, baseScore } = bidRes;
    events.push({ kind:'landlord', landlord, baseScore, bottom: handLabels(bottom) });

    // Play loop
    let turn: Seat = landlord;
    let require: Combo | null = null;
    let lead = true;
    let passes = 0;
    let lastWinner: Seat = landlord;
    const history: Play[] = [];

    while (true) {
      events.push({ kind:'turn', round: roundIdx, seat: turn, lead, require });

      const view = this.viewFor(turn, landlord, hands[turn], bottom, history, lead, require);
      const action = await bots[turn].play(view);

      if (action === 'pass') {
        history.push({ seat: turn, move:'pass', reason: lead ? '首家不能过（规则简化：改为随机小牌）' : '无法跟上，选择过' });
        events.push({ kind:'play', round: roundIdx, seat: turn, move:'pass', reason: lead ? '首家不能过（已被引擎拦截）' : '无法跟上，选择过' });
        if (lead) {
          // In standard rules, leader cannot pass. Force smallest single.
          const fallback = hands[turn].slice().sort((a,b)=>a.rank-b.rank)[0];
          const combo = { type:'single' as const, length:1, mainRank:fallback.rank, cards:[fallback] };
          removeCards(hands[turn], combo.cards);
          history.push({ seat: turn, comboType: combo.type, cards: combo.cards, reason:'首家不能过，自动出最小单' });
          events.push({ kind:'play', round: roundIdx, seat: turn, comboType: combo.type, cards: combo.cards.map(c=>c.label), reason:'首家不能过，自动出最小单' });
          require = combo;
          lastWinner = turn;
          passes = 0;
          lead = false;
        } else {
          passes += 1;
          if (passes >= 2) {
            // Trick ends, lastWinner leads
            events.push({ kind:'trick-reset', round: roundIdx, leader: lastWinner });
            turn = lastWinner;
            require = null;
            lead = true;
            passes = 0;
            // loop continues from new leader
          } else {
            turn = ((turn+1)%3) as Seat;
          }
        }
      } else {
        // play a combo
        removeCards(hands[turn], action.cards);
        history.push({ seat: turn, comboType: action.type, cards: action.cards, reason: lead ? '首家领出' : '跟牌' });
        events.push({ kind:'play', round: roundIdx, seat: turn, comboType: action.type, cards: action.cards.map(c=>c.label), reason: lead ? '首家领出' : '跟牌' });
        require = action;
        lastWinner = turn;
        passes = 0;
        lead = false;
        // win check
        if (hands[turn].length === 0) {
          const winner = (turn === landlord) ? 'landlord' : 'farmers';
          events.push({ kind:'finish', round: roundIdx, winner });
          const scores: [number,number,number] =
            winner==='landlord' ? (():[number,number,number]=>{
              const arr:[number,number,number] = [0,0,0];
              arr[landlord] = baseScore*2;
              arr[(landlord+1)%3] = -baseScore;
              arr[(landlord+2)%3] = -baseScore;
              return arr;
            })() : (():[number,number,number]=>{
              const arr:[number,number,number] = [0,0,0];
              arr[landlord] = -baseScore*2;
              arr[(landlord+1)%3] = baseScore;
              arr[(landlord+2)%3] = baseScore;
              return arr;
            })();
          return { round: roundIdx, landlord, scores, events };
        }
        // next seat
        turn = ((turn+1)%3) as Seat;
      }
    }
  }
}
