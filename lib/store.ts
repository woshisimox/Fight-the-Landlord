'use client';
import { create } from 'zustand';
import { Card, Combo, Provider, ProviderConfig, ProviderChoice, Seat } from './ddz-types';
import { makeDeck, shuffle, deal, detectCombo, removeCards, canBeat } from './ddz-engine';
import { callProviderViaProxy, fallbackAI } from './ddz-ai';

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
  providerKeys: ProviderConfig;
  playing: boolean;

  setTotalRounds(n: number): void;
  setProvider(seat: Seat, p: Provider): void;
  setProviderKeys(k: ProviderConfig): void;
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
  providerKeys: {},
  playing: false,

  setTotalRounds(n){ set({ totalRounds: Math.max(1, Math.min(50, n|0)) }); },
  setProvider(seat,p){ const key = seat===0?'seat0': seat===1?'seat1':'seat2'; set({ providers: { ...get().providers, [key]: p } as any }); },
  setProviderKeys(k){ set({ providerKeys: { ...get().providerKeys, ...k } }); },

  newRound(){
    const deck = shuffle(makeDeck());
    const [a,b,c,bot] = deal(deck);
    set({ round: get().round+1, hands:[a,b,c], bottom: bot, turn: 0, lastCombo:null, history:[], playing: true });
  },

  async stepPlay(auto=false){
    const st=get(); if (!st.playing) return;
    const seat=st.turn; const hand=st.hands[seat];
    const snapshot = { seat, hand: hand.map(c=>c.id), history: st.history.map(h=>({ seat:h.seat, combo: h.text })) };

    const provider = seat===0? st.providers.seat0 : seat===1? st.providers.seat1 : st.providers.seat2;
    let aiRes;
    if (provider==='fallback' || (!st.providerKeys.openaiKey && !st.providerKeys.kimiKey && !st.providerKeys.grokKey)){
      aiRes = fallbackAI(snapshot);
    } else {
      aiRes = await callProviderViaProxy(provider, st.providerKeys, snapshot);
    }

    const chosenIds = aiRes.tileCodes || [];
    const chosen = hand.filter(c=> chosenIds.includes(c.id));
    let combo = detectCombo(chosen) || { type:'pass', main:3 as any, cards:[] };
    if (combo.type!=='pass' && st.lastCombo && !canBeat(combo, st.lastCombo)) {
      combo = { type:'pass', main:3 as any, cards:[] };
    }

    const newHands = [...st.hands] as [Card[],Card[],Card[]];
    newHands[seat] = combo.type==='pass' ? hand : removeCards(hand, combo.cards);

    const text = combo.type==='pass'? 'PASS' : combo.type.toUpperCase()+': '+combo.cards.map(c=>c.id).join(' ');
    const newHistory=[...st.history, { seat, combo, text, reason: aiRes.reason, provider: aiRes.meta.provider }];
    const next = ((seat+1)%3) as Seat;
    const last = combo.type==='pass'? st.lastCombo : combo;
    const done = newHands[0].length===0 || newHands[1].length===0 || newHands[2].length===0;

    set({ hands:newHands, history:newHistory, turn:next, lastCombo:last, playing:!done });

    if (!done && auto){ await new Promise(r=>setTimeout(r,500)); await get().stepPlay(true); }
  }
}));
