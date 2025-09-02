import type { BidView, Combo, PlayerView, Play, RoundLog, RuleConfig, Seat } from './types';
import { deal3, sortHand } from './cards';
import { enumerateAllCombos, enumerateResponses } from './combos';
import type { IBot } from './bots';

type Emitter = (ev: any)=>void;

export class Engine {
  rules: RuleConfig;
  emit: Emitter;
  constructor(rules: RuleConfig, emitter: Emitter){
    this.rules = rules; this.emit = emitter;
  }

  private async bidding(hands: [any,any,any], bots: IBot[]): Promise<{ landlord: Seat, baseScore: number } | null> {
    let history: Array<{seat:Seat, action:1|2|3|'pass'}> = [];
    let landlord: Seat | null = null;
    let base = 0;
    for (let s: Seat = 0 as Seat; s<=2; s=(s+1) as Seat) {
      const view: BidView = { seat:s, hand:hands[s], history };
      const res = await bots[s].bid(view);
      this.emit({ kind:'bid', seat:s, action: res });
      history.push({ seat:s, action: res });
      if (res!=='pass' && res>base) { base = res; landlord = s; }
    }
    if (landlord===null) return null;
    return { landlord, baseScore: base };
  }

  async playRound(bots: IBot[], roundIdx: number): Promise<RoundLog> {
    const pack = deal3();
    const hands = [sortHand(pack.hands[0]), sortHand(pack.hands[1]), sortHand(pack.hands[2])] as [any,any,any];
    const bottom = pack.bottom;
    this.emit({ kind:'deal', hands: hands.map(h=>h.map((c:any)=>c.face)), bottom: bottom.map(c=>c.face) });

    // bidding (re-deal if all pass)
    let info = await this.bidding(hands, bots);
    if (!info) {
      const pack2 = deal3();
      hands[0] = sortHand(pack2.hands[0]); hands[1] = sortHand(pack2.hands[1]); hands[2] = sortHand(pack2.hands[2]);
      info = await this.bidding(hands, bots);
      if (!info) info = { landlord: 0, baseScore: 1 };
    }
    const landlord = info.landlord;
    const baseScore = info.baseScore;
    // give bottom to landlord
    hands[landlord].push(...bottom);
    this.emit({ kind:'landlord', landlord, baseScore, bottom: bottom.map(c=>c.face) });

    // playing phase
    let turn: Seat = landlord;
    let require: Combo | null = null;
    let history: Play[] = [];
    const remains = [hands[0].length, hands[1].length, hands[2].length];
    let passesInRow = 0;
    let lastPlayer: Seat | null = null;

    while (true) {
      const lead = require===null;
      this.emit({ kind:'turn', seat: turn, lead, require: require? { type:require.type, mainRank: require.mainRank, length: require.length } : null });

      const view: PlayerView = { seat: turn, landlord, hand: hands[turn], bottom, history, lead, require };
      const action = await bots[turn].play(view);

      if (action.move==='play' && action.combo) {
        const legal = require? enumerateResponses(hands[turn], require) : enumerateAllCombos(hands[turn]);
        const ok = legal.find(c=> c.type===action.combo!.type && c.mainRank===action.combo!.mainRank && c.cards.length===action.combo!.cards.length);
        if (!ok) {
          if (lead) {
            if (legal.length) {
              const use = legal[0];
              for (const x of use.cards) {
                const idx = hands[turn].findIndex(c=> c===x);
                if (idx>=0) hands[turn].splice(idx,1);
              }
              history.push({ seat: turn, move:'play', combo: use, reason:'非法出牌已改为系统最小领出' });
              this.emit({ kind:'play', seat:turn, comboType: use.type, cards: use.cards.map(c=>c.face), reason:'非法出牌已改为系统最小领出' });
              require = use;
              passesInRow = 0;
              lastPlayer = turn;
              remains[turn]-= use.cards.length;
              if (remains[turn]===0) break;
              turn = ((turn+1)%3) as Seat;
              continue;
            } else {
              history.push({ seat: turn, move:'pass', reason:'无可出招，系统过' });
              this.emit({ kind:'play', seat:turn, move:'pass', reason:'无可出招，系统过' });
              passesInRow++;
              if (passesInRow>=2) { this.emit({ kind:'trick-reset', leader: lastPlayer }); require=null; turn=lastPlayer!; passesInRow=0; }
              else turn = ((turn+1)%3) as Seat;
              continue;
            }
          } else {
            history.push({ seat: turn, move:'pass', reason:'非法出牌，改为过' });
            this.emit({ kind:'play', seat:turn, move:'pass', reason:'非法出牌，改为过' });
            passesInRow++;
            if (passesInRow>=2) { this.emit({ kind:'trick-reset', leader: lastPlayer }); require=null; turn=lastPlayer!; passesInRow=0; }
            else turn = ((turn+1)%3) as Seat;
            continue;
          }
        } else {
          for (const x of ok.cards) {
            const idx = hands[turn].findIndex(c=> c===x);
            if (idx>=0) hands[turn].splice(idx,1);
          }
          history.push({ seat: turn, move:'play', combo: ok, reason: action.reason });
          this.emit({ kind:'play', seat:turn, comboType: ok.type, cards: ok.cards.map(c=>c.face), reason: action.reason });
          require = ok;
          passesInRow = 0;
          lastPlayer = turn;
          remains[turn]-= ok.cards.length;
          if (remains[turn]===0) {
            break;
          }
          turn = ((turn+1)%3) as Seat;
        }
      } else {
        if (require===null) {
          const legal = enumerateAllCombos(hands[turn]);
          const use = legal[0];
          for (const x of use.cards) {
            const idx = hands[turn].findIndex(c=> c===x);
            if (idx>=0) hands[turn].splice(idx,1);
          }
          history.push({ seat: turn, move:'play', combo: use, reason:'首家不能过，系统代打' });
          this.emit({ kind:'play', seat:turn, comboType: use.type, cards: use.cards.map(c=>c.face), reason:'首家不能过，系统代打' });
          require = use; passesInRow=0; lastPlayer=turn; remains[turn]-=use.cards.length;
          if (remains[turn]===0) break;
          turn = ((turn+1)%3) as Seat;
        } else {
          history.push({ seat: turn, move:'pass', reason: action.reason||'选择过' });
          this.emit({ kind:'play', seat:turn, move:'pass', reason: action.reason||'选择过' });
          passesInRow++;
          if (passesInRow>=2) { this.emit({ kind:'trick-reset', leader: lastPlayer }); require=null; turn=lastPlayer!; passesInRow=0; }
          else turn = ((turn+1)%3) as Seat;
        }
      }
    }

    const winnerSide = (hands[landlord].length===0)? 'landlord' : 'farmers';
    this.emit({ kind:'finish', winner: winnerSide });

    const base = Math.max(1, this.rules.startBaseScore||baseScore);
    let scores: [number,number,number] = [0,0,0];
    if (winnerSide==='landlord'){
      scores[landlord] = +2*base;
      scores[(landlord+1)%3] = -base;
      scores[(landlord+2)%3] = -base;
    }else{
      scores[landlord] = -2*base;
      scores[(landlord+1)%3] = +base;
      scores[(landlord+2)%3] = +base;
    }

    return { round: roundIdx, landlord, baseScore, scores, events: [] };
  }
}
