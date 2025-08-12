'use client';
import { create } from 'zustand';
import type { Card, Combo, Provider, ProviderChoice, Seat } from './lib/ddz-types';
import { makeDeck, shuffle, deal, detectCombo, removeCards, canBeat, sortByRank } from './lib/ddz-engine';
import { callProviderViaProxy, fallbackAI } from './lib/ddz-ai';

export type PlayRecord = { seat: Seat; combo: Combo; text: string; reason?: string; provider?: Provider };

export type GameState = {
  round: number;
  totalRounds: number;
  hands: [Card[],Card[],Card[]];
  bottom: Card[];
  turn: Seat;
  lastCombo: Combo | null;
  history: PlayRecord[];
  providers: ProviderChoice;
  seatKeys: { seat0: string; seat1: string; seat2: string };
  keyError: string | null;
  playing: boolean;
  passStreak: number;
  trickLeader: Seat;

  setTotalRounds(n: number): void;
  setProvider(seat: Seat, p: Provider): void;
  setSeatKey(seat: Seat, key: string): void;
  keysValid(): boolean;
  newRound(): void;
  stepPlay(auto?: boolean): Promise<void>;
};

export const useGame = create<GameState>((set,get)=>({
  round: 0,
  totalRounds: 3,
  hands: [[],[],[]],
  bottom: [],
  turn: 0,
  lastCombo: null,
  history: [],
  providers: { seat0:'fallback', seat1:'fallback', seat2:'fallback' },
  seatKeys: { seat0:'', seat1:'', seat2:'' },
  keyError: null,
  playing: false,
  passStreak: 0,
  trickLeader: 0,

  setTotalRounds(n){ set({ totalRounds: Math.max(1, Math.min(50, n|0)) }); },
  setProvider(seat,p){
    const key = seat===0?'seat0': seat===1?'seat1':'seat2';
    set({ providers: { ...get().providers, [key]: p } as any }, ()=>get().keysValid());
  },
  setSeatKey(seat, keyStr){
    const k = seat===0?'seat0': seat===1?'seat1':'seat2';
    set({ seatKeys: { ...get().seatKeys, [k]: keyStr } }, ()=>get().keysValid());
  },
  keysValid(){
    const st = get();
    const pv = st.providers;
    const sk = st.seatKeys;
    const pairs: Array<[string,string]> = [
      [pv.seat0, sk.seat0],
      [pv.seat1, sk.seat1],
      [pv.seat2, sk.seat2],
    ];
    const seen = new Map<string, Set<string>>();
    for (const [provider, key] of pairs){
      if (provider==='fallback' || !key) continue;
      if (!seen.has(provider)) seen.set(provider, new Set());
      const s = seen.get(provider)!;
      if (s.has(key)){
        set({ keyError: `同一 Provider (${provider}) 的 API Key 不可相同` });
        return false;
      }
      s.add(key);
    }
    set({ keyError: null });
    return true;
  },

  newRound(){
    const deck = shuffle(makeDeck());
    const [a,b,c,bot] = deal(deck);
    set({ round: get().round+1, hands:[a,b,c], bottom: bot, turn: 0, lastCombo:null, history:[], playing: true, passStreak:0, trickLeader:0 });
  },

  async stepPlay(auto=false){
    const st=get(); if (!st.playing) return;
    if (!st.keysValid()) return;

    const seat=st.turn; const hand=st.hands[seat];
    const isFreeLead = (st.lastCombo === null);

    const provider = seat===0? st.providers.seat0 : seat===1? st.providers.seat1 : st.providers.seat2;
    const apiKey  = seat===0? st.seatKeys.seat0   : seat===1? st.seatKeys.seat1   : st.seatKeys.seat2;

    const snapshot = { seat, hand: hand.map(c=>c.id), history: st.history.map(h=>({ seat:h.seat, combo: h.text })) };

    let aiRes:any;
    if (provider==='fallback' || !apiKey){
      aiRes = fallbackAI(snapshot);
    } else {
      aiRes = await callProviderViaProxy(provider, { apiKey }, snapshot);
    }

    const tiles = aiRes?.tileCodes || [];
    let chosen = hand.filter(c=> tiles.includes(c.id));
    let combo = detectCombo(chosen) || { type:'pass', main:3 as any, cards:[] };

    if (isFreeLead){
      if (combo.type==='pass'){
        const min = sortByRank(hand)[0];
        chosen = [min];
        combo = detectCombo(chosen)!;
      }
    } else {
      if (combo.type!=='pass' && st.lastCombo && !canBeat(combo, st.lastCombo)){
        combo = { type:'pass', main:3 as any, cards:[] };
      }
    }

    const newHands = [...st.hands] as [Card[],Card[],Card[]];
    newHands[seat] = combo.type==='pass'? hand : removeCards(hand, combo.cards);

    const text = combo.type==='pass'? 'PASS' : combo.type.toUpperCase()+': '+combo.cards.map(c=>c.id).join(' ');
    const newHistory = [...st.history, { seat, combo, text, reason: aiRes?.reason, provider }];

    let next: Seat = ((seat+1)%3) as Seat;
    let last = st.lastCombo;
    let leader = st.trickLeader;
    let pass = st.passStreak;

    if (combo.type==='pass'){
      if (!isFreeLead){
        pass += 1;
        if (pass >= 2){
          next = st.trickLeader;
          last = null;
          pass = 0;
        }
      }
    } else {
      pass = 0;
      leader = seat;
      last = combo;
    }

    const done = newHands[0].length===0 || newHands[1].length===0 || newHands[2].length===0;
    set({ hands:newHands, history:newHistory, turn:next, lastCombo:last, trickLeader:leader, passStreak:pass, playing:!done });

    if (!done && auto){
      await new Promise(r=>setTimeout(r,500));
      await get().stepPlay(true);
    }
  }
}));
