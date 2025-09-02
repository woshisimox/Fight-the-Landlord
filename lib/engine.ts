import { Card, Combo, Play, ProviderSpec, RoundLog, RuleConfig, Seat } from './types';
import { deal, rankLabel } from './cards';
import { enumerateAllCombos, enumerateResponses, canBeat } from './combos';
import { BotRandom, IBot } from './bots/bot_random';
import { BotGreedyMax } from './bots/bot_greedy_max';
import { BotGreedyMin } from './bots/bot_greedy_min';
import { BotOpenAI } from './providers';

type Event = any;

export class Engine {
  rules: RuleConfig;
  onEvent: (e: Event)=>void;

  constructor(rules: RuleConfig, onEvent: (e:Event)=>void) {
    this.rules = rules;
    this.onEvent = onEvent;
  }
  private emit(e: Event) { this.onEvent({ type:'event', ...e }); }

  private async bidding(hands: [Card[],Card[],Card[]], bottom: Card[], bots: IBot[]):
    Promise<{ landlord: Seat, baseScore: number } | null>
  {
    // 叫分 1..3，最高者当地主；无人叫分则重发（此处简单：若都pass则默认手2最多者为地主 baseScore=1）
    let bestScore = 0, bestSeat: Seat | null = null;
    for (let s=0 as Seat; s<3; s=(s+1)%3 as Seat) {
      const view = { seat: s, landlord: 0 as Seat, hand: hands[s], bottom, history: [] as any[], lead: false };
      const res = await bots[s].bid(view);
      this.emit({ round:0, kind:'bid', seat: s, action: res });
      if (res!=='pass' && res>bestScore) { bestScore = res; bestSeat = s; }
      if (s===2) break; // 只叫一轮即可
    }
    const landlord = (bestSeat ?? 0) as Seat;
    const baseScore = bestScore || 1;
    return { landlord, baseScore };
  }

  async playRound(bots: IBot[], roundIdx: number): Promise<RoundLog> {
    const { hands, bottom } = deal();
    this.emit({ round: roundIdx, kind:'deal', hands: hands.map(h=>h.map(c=>rankLabel(c.rank))) , bottom: bottom.map(c=>rankLabel(c.rank)) });
    const bid = await this.bidding(hands, bottom, bots);
    if (!bid) throw new Error('bidding failed');
    const landlord = bid.landlord;
    hands[landlord].push(...bottom);
    this.emit({ round: roundIdx, kind:'landlord', landlord, baseScore: bid.baseScore, bottom: bottom.map(c=>rankLabel(c.rank)) });

    let turn: Seat = landlord;
    let require: Combo|null = null;
    let passes = 0;
    let lastWinner: Seat = landlord;
    let winner: 'landlord'|'farmers'|null = null;

    while (true) {
      const view = {
        seat: turn, landlord, hand: hands[turn], bottom,
        history: [], lead: require===null, require
      };
      this.emit({ round: roundIdx, kind:'turn', seat: turn, lead: view.lead, require: require? { type:require.type, mainRank: require.mainRank, length:require.length } : null });

      // 询问 bot 出牌
      const play = await bots[turn].play(view);
      let reason = (view as any).__reason || '';
      if (play==='pass') {
        // 只有非首家可过
        if (require===null) {
          // 首家不能过：出一张最小
          const legal = enumerateAllCombos(hands[turn]);
          if (legal.length===0) break;
          legal.sort((a,b)=>a.mainRank-b.mainRank);
          const chosen = legal[0];
          hands[turn] = removeCards(hands[turn], chosen.cards);
          require = chosen;
          passes = 0;
          lastWinner = turn;
          reason = reason || '首家不得过，改为最小领出';
          this.emit({ round: roundIdx, kind:'play', seat: turn, comboType: chosen.type, cards: chosen.cards.map(c=>rankLabel(c.rank)), reason });
        } else {
          passes++;
          this.emit({ round: roundIdx, kind:'play', seat: turn, move: 'pass', reason: reason || '无法跟上，选择过' });
        }
      } else {
        // 校验合法
        const legal = require ? enumerateResponses(hands[turn], require) : enumerateAllCombos(hands[turn]);
        const ok = legal.some(c => sameCombo(c, play));
        if (!ok) {
          passes++;
          this.emit({ round: roundIdx, kind:'play', seat: turn, move: 'pass', reason: '非法出牌，按过处理' });
        } else {
          // 出牌
          hands[turn] = removeCards(hands[turn], play.cards);
          require = require ? (canBeat(play, require) ? play : require) : play;
          if (!require || canBeat(play, require)) { require = play; lastWinner = turn; }
          passes = 0;
          this.emit({ round: roundIdx, kind:'play', seat: turn, comboType: play.type, cards: play.cards.map(c=>rankLabel(c.rank)), reason: reason || (view.lead ? '随机领出' : '随机跟牌') });
          // 胜负
          if (hands[turn].length===0) {
            winner = turn===landlord ? 'landlord' : 'farmers';
            break;
          }
        }
      }

      // 两家过，重启新圈由 lastWinner 领出
      if (passes>=2) {
        require = null;
        turn = lastWinner;
        this.emit({ round: roundIdx, kind:'trick-reset', leader: lastWinner });
      } else {
        turn = ((turn+1)%3) as Seat;
      }
    }

    const base = bid.baseScore;
    let scores: [number,number,number];
    if (winner==='landlord') {
      const sL = 2*base, sF = -base;
      scores = [0,0,0]; scores[landlord] = sL; scores[(landlord+1)%3 as Seat] = sF; scores[(landlord+2)%3 as Seat] = sF;
    } else {
      const sL = -2*base, sF = base;
      scores = [0,0,0]; scores[landlord] = sL; scores[(landlord+1)%3 as Seat] = sF; scores[(landlord+2)%3 as Seat] = sF;
    }
    this.emit({ round: roundIdx, kind:'finish', winner });
    return { round: roundIdx, landlord, baseScore: base, scores, events: [] };
  }
}

function removeCards(hand: Card[], cards: Card[]): Card[] {
  const a = hand.slice();
  for (const c of cards) {
    const i = a.findIndex(x=>x===c);
    if (i>=0) a.splice(i,1);
  }
  return a;
}

function sameCombo(a: Combo, b: Combo): boolean {
  if (a.type!==b.type || a.length!==b.length || a.mainRank!==b.mainRank) return false;
  if (a.cards.length!==b.cards.length) return false;
  // 比较引用集合
  const setA = new Set(a.cards);
  for (const c of b.cards) if (!setA.has(c)) return false;
  return true;
}

// 工具：根据配置创建bot
export function makeBot(spec: ProviderSpec, seatIdx: number): IBot {
  const label = '甲乙丙'[seatIdx] + '';
  if (spec.kind==='builtin') {
    if (spec.name==='GreedyMin') return new BotGreedyMin(label + '(内置:GreedyMin)');
    if (spec.name==='GreedyMax') return new BotGreedyMax(label + '(内置:GreedyMax)');
    return new BotRandom(label + '(内置:Random)');
  }
  return new BotOpenAI(spec, label + '(' + spec.kind + ')');
}
