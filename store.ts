'use client';
import { create } from 'zustand';
import type { Card, Combo, Provider, ProviderConfig, ProviderChoice, Seat } from './lib/ddz-types';
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
  providerKeys: ProviderConfig;
  playing: boolean;
  passStreak: number;   // 连续 PASS 次数（不含领出者）
  trickLeader: Seat;    // 当前圈的领出者

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
  passStreak: 0,
  trickLeader: 0,

  setTotalRounds(n){ set({ totalRounds: Math.max(1, Math.min(50, n|0)) }); },
  setProvider(seat,p){ const key = seat===0?'seat0': seat===1?'seat1':'seat2'; set({ providers: { ...get().providers, [key]: p } as any }); },
  setProviderKeys(k){ set({ providerKeys: { ...get().providerKeys, ...k } }); },

  newRound(){
    const deck = shuffle(makeDeck());
    const [a,b,c,bot] = deal(deck);
    set({
      round: get().round+1,
      hands:[a,b,c],
      bottom: bot,
      turn: 0,
      lastCombo: null,
      history: [],
      playing: true,
      passStreak: 0,
      trickLeader: 0
    });
  },

  async stepPlay(auto=false){
    const st=get(); if (!st.playing) return;

    // 保险丝，避免任何异常造成的无限循环
    const maxSteps = 1000;
    if (st.history.length > maxSteps) { set({ playing: false }); return; }

    const seat = st.turn;
    const hand = st.hands[seat];
    const isFreeLead = (st.lastCombo === null); // 自由出牌轮（无上一手）

    // 提供给 AI 的快照
    const snapshot = {
      seat,
      hand: hand.map(c=>c.id),
      history: st.history.map(h=>({ seat: h.seat, combo: h.text }))
    };

    // 选择 provider 并调用
    const provider = seat===0? st.providers.seat0 : seat===1? st.providers.seat1 : st.providers.seat2;
    let aiRes: any;
    const noKeys = !st.providerKeys.openaiKey && !st.providerKeys.kimiKey && !st.providerKeys.grokKey;
    if (provider==='fallback' || noKeys){
      aiRes = fallbackAI(snapshot);
    } else {
      aiRes = await callProviderViaProxy(provider, st.providerKeys, snapshot);
    }

    // 解析 AI 结果并校验
    const tiles = aiRes?.tileCodes || [];
    let chosen = hand.filter(c=> tiles.includes(c.id));
    let combo = detectCombo(chosen) || { type:'pass', main:3 as any, cards:[] };

    if (isFreeLead) {
      // 自由出牌：不允许 PASS，强制出最小单张
      if (combo.type === 'pass') {
        const min = sortByRank(hand)[0];
        chosen = [min];
        combo = detectCombo(chosen)!;
      }
    } else {
      // 非自由轮：如果不能压过上一手，强制 PASS
      if (combo.type!=='pass' && st.lastCombo && !canBeat(combo, st.lastCombo)) {
        combo = { type:'pass', main:3 as any, cards:[] };
      }
    }

    // 扣除手牌 / 记录历史
    const newHands = [...st.hands] as [Card[],Card[],Card[]];
    newHands[seat] = combo.type==='pass'? hand : removeCards(hand, combo.cards);

    const text = combo.type==='pass'? 'PASS' : combo.type.toUpperCase()+': '+combo.cards.map(c=>c.id).join(' ');
    const newHistory: PlayRecord[] = [
      ...st.history,
      { seat, combo, text, reason: aiRes?.reason, provider: aiRes?.meta?.provider }
    ];

    // 轮转、两 PASS 清盘规则
    let nextTurn: Seat = ((seat+1)%3) as Seat;
    let nextLast: Combo | null = st.lastCombo;
    let nextLeader: Seat = st.trickLeader;
    let nextPassStreak = st.passStreak;

    if (combo.type === 'pass') {
      if (!isFreeLead) {
        nextPassStreak += 1;
        if (nextPassStreak >= 2) {
          // 两家连续 PASS：清盘，回到领出者重新领出
          nextTurn = st.trickLeader;
          nextLast = null;
          nextPassStreak = 0;
        }
      }
    } else {
      nextPassStreak = 0;
      nextLeader = seat;
      nextLast = combo;
    }

    const done = newHands[0].length===0 || newHands[1].length===0 || newHands[2].length===0;

    set({
      hands: newHands,
      history: newHistory,
      turn: nextTurn,
      lastCombo: nextLast,
      trickLeader: nextLeader,
      passStreak: nextPassStreak,
      playing: !done
    });

    if (!done && auto){
      await new Promise(r=>setTimeout(r,500));
      await get().stepPlay(true);
    }
  }
}));
