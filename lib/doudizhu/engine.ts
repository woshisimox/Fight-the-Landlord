// lib/doudizhu/engine.ts
/* eslint-disable @typescript-eslint/no-use-before-define */

export type Label = '3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'|'A'|'2'|'x'|'X';
export type Suit  = 'S'|'H'|'D'|'C'|'BJ'|'RJ';
export type Four2Policy = 'both'|'2singles'|'2pairs';

export type Card = { label: Label; suit: Suit; code: string };

export type DealResult = {
  hands: Label[][];
  bottom: Label[];
  handsRich: Card[][];
  bottomRich: Card[];
};

export type TrickReq =
  | null
  | {
      type:
        | 'single' | 'pair' | 'triple'
        | 'tripleSingle' | 'triplePair'
        | 'straight' | 'doubleStraight' | 'tripleStraight'
        | 'planeSingle' | 'planePair'
        | 'fourTwoSingles' | 'fourTwoPairs'
        | 'bomb' | 'rocket';
      mainRank: number;    // 比较用主序（顺子/连对/飞机为最大那档；炸弹为四张牌的档）
      length?: number;     // 顺子/连对/飞机长度（张数/对数/三张组数）
      wings?: number;      // 飞机带翅膀时=三顺的组数
    };

export type EventObj =
  | { type: 'event', kind: 'deal', hands: Label[][], bottom: Label[] }
  | { type: 'event', kind: 'landlord', landlord: number, bottom: Label[], baseScore: number }
  | { type: 'event', kind: 'turn', seat: number, lead?: boolean, require?: TrickReq }
  | { type: 'event', kind: 'play', seat: number, move: 'play'|'pass', cards?: Label[], comboType?: string, reason?: string }
  | { type: 'event', kind: 'trick-reset' }
  | { type: 'score', totals: [number, number, number] }
  | { type: 'terminated' };

export type EngineOptions = {
  seed?: number;
  four2?: Four2Policy;       // 四带二规则
  delayMs?: number;          // 逐步输出时的延迟（给流式 API 用）
};

export type BotMove =
  | { move: 'pass' }
  | { move: 'play', cards: Label[] };

export type BotCtx = {
  seat: number;
  hands: Label[];
  require: TrickReq;
  canPass: boolean;
  policy: Four2Policy;
  lastNonPassSeat: number | null;
};

export type BotFunc = (ctx: BotCtx) => BotMove;

// 牌序：3..A(14), 2(16), 小王x(18), 大王X(19)
export const RANKS: Label[] = ['3','4','5','6','7','8','9','T','J','Q','K','A','2','x','X'];
export const RANK_IDX = Object.fromEntries(RANKS.map((l, i) => [l, i])) as Record<Label, number>;

// - - - - - 工具 - - - - -
function lcg(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0);
}
function shuffle<T>(arr: T[], rnd: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd() % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function copy<T>(a: T[]): T[] { return a.slice(); }
function sortDesc(labels: Label[]): Label[] {
  return labels.slice().sort((a, b) => RANK_IDX[b] - RANK_IDX[a]);
}
function counts(labels: Label[]): Map<Label, number> {
  const m = new Map<Label, number>();
  for (const l of labels) m.set(l, (m.get(l) || 0) + 1);
  return m;
}
function uniq<T>(a: T[]): T[] { return Array.from(new Set(a)); }

export function fullDeck(): Card[] {
  const out: Card[] = [];
  const suits: Suit[] = ['S','H','D','C'];
  for (const l of RANKS) {
    if (l === 'x') { out.push({ label: 'x', suit: 'BJ', code: 'J-B' }); continue; }
    if (l === 'X') { out.push({ label: 'X', suit: 'RJ', code: 'J-R' }); continue; }
    // 3..2 每档四张
    if (l !== 'x' && l !== 'X') {
      suits.forEach((s, i) => out.push({ label: l, suit: s, code: `${l}-${s}-${i+1}` }));
    }
  }
  return out;
}

export function deal(seed = 0): DealResult {
  const rnd = lcg(seed || 1);
  const deck = fullDeck();
  shuffle(deck, rnd);
  const handsRich: Card[][] = [[], [], []];
  for (let i = 0; i < 17; i++) {
    handsRich[0].push(deck[i*3 + 0]);
    handsRich[1].push(deck[i*3 + 1]);
    handsRich[2].push(deck[i*3 + 2]);
  }
  const bottomRich = deck.slice(51);
  const hands = handsRich.map(h => h.map(c => c.label));
  const bottom = bottomRich.map(c => c.label);
  return { hands, bottom, handsRich, bottomRich };
}

// - - - - - 组合判定 - - - - -
export function classify(labels: Label[], policy: Four2Policy): TrickReq {
  const n = labels.length;
  const cnt = counts(labels);
  // 火箭
  if (n === 2 && cnt.get('x') === 1 && cnt.get('X') === 1) {
    return { type: 'rocket', mainRank: RANK_IDX['X'] };
  }
  // 炸弹
  if (n === 4 && [...cnt.values()].includes(4)) {
    const lab = [...cnt.entries()].find(([, v]) => v === 4)![0];
    return { type: 'bomb', mainRank: RANK_IDX[lab] };
  }
  // 单张/对子/三张
  if (n === 1) return { type: 'single', mainRank: RANK_IDX[labels[0]] };
  if (n === 2 && [...cnt.values()][0] === 2) {
    const lab = [...cnt.keys()][0]; return { type: 'pair', mainRank: RANK_IDX[lab] };
  }
  if (n === 3 && [...cnt.values()][0] === 3) {
    const lab = [...cnt.keys()][0]; return { type: 'triple', mainRank: RANK_IDX[lab] };
  }
  // 三带一/三带二
  if (n === 4 && [...cnt.values()].includes(3)) {
    const lab = [...cnt.entries()].find(([, v]) => v === 3)![0];
    return { type: 'tripleSingle', mainRank: RANK_IDX[lab] };
  }
  if (n === 5 && [...cnt.values()].includes(3) && [...cnt.values()].includes(2)) {
    const lab = [...cnt.entries()].find(([, v]) => v === 3)![0];
    return { type: 'triplePair', mainRank: RANK_IDX[lab] };
  }
  // 顺子（>=5，不含2与王）
  const okStraight = (arr: Label[]): {len:number, max:number}|null => {
    if (arr.some(l => l === '2' || l === 'x' || l === 'X')) return null;
    const u = uniq(arr).sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    if (u.length !== arr.length) return null;
    for (let i=1;i<u.length;i++) if (RANK_IDX[u[i]]!==RANK_IDX[u[i-1]]+1) return null;
    if (u.length>=5) return {len:u.length,max:RANK_IDX[u[u.length-1]]};
    return null;
  };
  const st = okStraight(labels);
  if (st) return { type: 'straight', length: st.len, mainRank: st.max };

  // 连对（>=3对，不含2与王）
  const okDoubleStraight = (arr: Label[]): {pairs:number, max:number}|null => {
    const m = counts(arr);
    if ([...m.values()].some(v => v !== 2)) return null;
    const ks = [...m.keys()];
    if (ks.some(l => l === '2' || l === 'x' || l === 'X')) return null;
    ks.sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=1;i<ks.length;i++) if (RANK_IDX[ks[i]]!==RANK_IDX[ks[i-1]]+1) return null;
    if (ks.length>=3) return {pairs: ks.length, max: RANK_IDX[ks[ks.length-1]]};
    return null;
  };
  const ds = okDoubleStraight(labels);
  if (ds) return { type: 'doubleStraight', length: ds.pairs, mainRank: ds.max };

  // 飞机（纯三顺/带翅膀）
  const okTripleStraight = (arr: Label[]): {groups:number, max:number}|null => {
    const m = counts(arr);
    if ([...m.values()].every(v => v===3)) {
      const ks = [...m.keys()].sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
      if (ks.some(l => l==='2'||l==='x'||l==='X')) return null;
      for (let i=1;i<ks.length;i++) if (RANK_IDX[ks[i]]!==RANK_IDX[ks[i-1]]+1) return null;
      if (ks.length>=2) return {groups: ks.length, max: RANK_IDX[ks[ks.length-1]]};
    }
    return null;
  };
  const ts = okTripleStraight(labels);
  if (ts) return { type: 'tripleStraight', length: ts.groups, mainRank: ts.max };

  // 飞机带翅膀
  // 形如：三顺N组 + N个单牌  或  三顺N组 + N个对子
  const m = counts(labels);
  const triples = [...m.entries()].filter(([,v])=>v===3).map(([k])=>k as Label);
  triples.sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
  const isConsecutiveTriples = triples.length>=2
    && triples.every(l=>l!=='2' && l!=='x' && l!=='X')
    && triples.every((l,i)=> i===0 || RANK_IDX[l]===RANK_IDX[triples[i-1]]+1);
  if (isConsecutiveTriples) {
    const groups = triples.length;
    const rest: Label[] = [];
    for (const [k,v] of m) {
      const inTriples = triples.includes(k);
      const remain = v - (inTriples?3:0);
      for (let i=0;i<remain;i++) rest.push(k);
    }
    // N 单
    const singleOk = rest.length===groups && counts(rest).size===rest.length;
    if (singleOk) return { type:'planeSingle', wings: groups, length: groups, mainRank: RANK_IDX[triples[triples.length-1]] };
    // N 对
    const pairOk = rest.length===groups*2 && [...counts(rest).values()].every(v=>v===2);
    if (pairOk) return { type:'planePair', wings: groups, length: groups, mainRank: RANK_IDX[triples[triples.length-1]] };
  }

  // 四带二（两单或两对）
  if (n === 6 && policy!=='2pairs') {
    const has4 = [...cnt.values()].includes(4);
    if (has4) return { type:'fourTwoSingles', mainRank: RANK_IDX[[...cnt.entries()].find(([,v])=>v===4)![0]] };
  }
  if (n === 8 && policy!=='2singles') {
    const has4 = [...cnt.values()].includes(4);
    const rest = [...cnt.values()].filter(v=>v!==4);
    if (has4 && rest.every(v=>v===2) && rest.length===2) {
      return { type:'fourTwoPairs', mainRank: RANK_IDX[[...cnt.entries()].find(([,v])=>v===4)![0]] };
    }
  }

  return null;
}

// 比较（b 是否能大过 a）
// 注意：只判断“可比且更大”，不处理不可比/过牌（在生成走法时控制）
export function canBeat(a: TrickReq, b: TrickReq): boolean {
  if (!a || !b) return false;
  if (b.type === 'rocket') return true;
  if (a.type !== 'bomb' && b.type === 'bomb') return true;
  if (a.type !== b.type) return false;
  // 同类型还需结构匹配
  if (a.type === 'straight' || a.type === 'doubleStraight' || a.type === 'tripleStraight') {
    if (a.length !== b.length) return false;
  }
  if (a.type === 'planeSingle' || a.type === 'planePair') {
    if (a.length !== b.length || a.type !== b.type) return false;
  }
  return b.mainRank > a.mainRank;
}

// - - - - - 走法生成（必要子集，覆盖常见跟牌/领出） - - - - -
export function generateMoves(hand: Label[], require: TrickReq, policy: Four2Policy): Label[][] {
  const out: Label[][] = [];
  const m = counts(hand);
  const labs = sortDesc(uniq(hand));
  const pushIf = (arr: Label[]) => { if (classify(arr, policy)) out.push(arr); };

  // 帮助：找所有炸弹/火箭
  const bombs: Label[][] = [];
  for (const [k,v] of m) if (v===4) bombs.push([k,k,k,k]);
  const hasRocket = m.get('x')===1 && m.get('X')===1;

  if (!require) {
    // 领出：给出常见类型（单、对、三、顺、连对、三顺、三带、四带、炸弹/火箭）
    for (const l of labs) pushIf([l]);
    for (const [k,v] of m) if (v>=2) pushIf([k,k]);
    for (const [k,v] of m) if (v>=3) pushIf([k,k,k]);

    // 枚举顺子
    const seqBase = labs.filter(l=>l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i<seqBase.length;i++){
      for (let j=i+4;j<seqBase.length;j++){
        let ok=true; for (let t=i+1;t<=j;t++) if (RANK_IDX[seqBase[t]]!==RANK_IDX[seqBase[t-1]]+1){ok=false;break;}
        if (ok){ pushIf(seqBase.slice(i,j+1)); }
      }
    }
    // 连对
    const pairKeys = labs.filter(l=> (m.get(l)||0)>=2 && l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i<pairKeys.length;i++){
      for (let j=i+2;j<pairKeys.length;j++){
        let ok=true; for (let t=i+1;t<=j;t++) if (RANK_IDX[pairKeys[t]]!==RANK_IDX[pairKeys[t-1]]+1){ok=false;break;}
        if (ok){ pushIf(pairKeys.slice(i,j+1).flatMap(k=>[k,k])); }
      }
    }
    // 三顺（不带）
    const triKeys = labs.filter(l=> (m.get(l)||0)>=3 && l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i+1<triKeys.length;i++){
      for (let j=i+1;j<triKeys.length;j++){
        let ok=true; for (let t=i+1;t<=j;t++) if (RANK_IDX[triKeys[t]]!==RANK_IDX[triKeys[t-1]]+1){ok=false;break;}
        if (ok){ pushIf(triKeys.slice(i,j+1).flatMap(k=>[k,k,k])); }
      }
    }
    // 三带一 / 三带二
    for (const [k,v] of m){
      if (v>=3){
        // 带一
        for (const s of labs) if (s!==k) pushIf([k,k,k,s]);
        // 带二（一个对子）
        for (const [p,vp] of m) if (p!==k && vp>=2) pushIf([k,k,k,p,p]);
      }
    }
    // 四带二
    if (policy!=='2pairs'){
      for (const [k,v] of m) if (v===4){
        const singles = labs.filter(s=>s!==k);
        for (let i=0;i<singles.length;i++) for (let j=i+1;j<singles.length;j++)
          pushIf([k,k,k,k,singles[i], singles[j]]);
      }
    }
    if (policy!=='2singles'){
      for (const [k,v] of m) if (v===4){
        const pairs = labs.filter(p=>(m.get(p)||0)>=2 && p!==k);
        for (let i=0;i<pairs.length;i++) for (let j=i+1;j<pairs.length;j++)
          pushIf([k,k,k,k,pairs[i],pairs[i],pairs[j],pairs[j]]);
      }
    }
    // 炸弹/火箭
    out.push(...bombs);
    if (hasRocket) out.push(['x','X']);
    return uniqBy(out.map(sortDesc), a=>a.join(',')).sort(byComboStrength);
  }

  // 跟牌：先找同类型可大过的，再考虑炸弹/火箭
  const req = require;
  const addIfBeats = (arr: Label[]) => {
    const cl = classify(arr, policy); if (cl && canBeat(req, cl)) out.push(arr);
  };

  if (req.type==='single'){
    for (const l of labs) if (RANK_IDX[l]>req.mainRank) addIfBeats([l]);
  } else if (req.type==='pair'){
    for (const [k,v] of m) if (v>=2 && RANK_IDX[k]>req.mainRank) addIfBeats([k,k]);
  } else if (req.type==='triple'){
    for (const [k,v] of m) if (v>=3 && RANK_IDX[k]>req.mainRank) addIfBeats([k,k,k]);
  } else if (req.type==='tripleSingle'){
    for (const [k,v] of m) if (v>=3 && RANK_IDX[k]>req.mainRank) {
      for (const s of labs) if (s!==k) addIfBeats([k,k,k,s]);
    }
  } else if (req.type==='triplePair'){
    for (const [k,v] of m) if (v>=3 && RANK_IDX[k]>req.mainRank) {
      for (const [p,vp] of m) if (p!==k && vp>=2) addIfBeats([k,k,k,p,p]);
    }
  } else if (req.type==='straight'){
    const L = req.length!;
    const base = labs.filter(l=>l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i+L-1<base.length;i++){
      let ok=true; for (let t=1;t<L;t++) if (RANK_IDX[base[i+t]]!==RANK_IDX[base[i+t-1]]+1){ok=false;break;}
      if (ok){
        const seq = base.slice(i,i+L);
        if (RANK_IDX[seq[seq.length-1]]>req.mainRank) addIfBeats(seq);
      }
    }
  } else if (req.type==='doubleStraight'){
    const L = req.length!;
    const base = labs.filter(l=>(m.get(l)||0)>=2 && l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i+L-1<base.length;i++){
      let ok=true; for (let t=1;t<L;t++) if (RANK_IDX[base[i+t]]!==RANK_IDX[base[i+t-1]]+1){ok=false;break;}
      if (ok){
        const seq = base.slice(i,i+L).flatMap(k=>[k,k]);
        if (RANK_IDX[base[i+L-1]]>req.mainRank) addIfBeats(seq);
      }
    }
  } else if (req.type==='tripleStraight'){
    const L = req.length!;
    const base = labs.filter(l=>(m.get(l)||0)>=3 && l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i+L-1<base.length;i++){
      let ok=true; for (let t=1;t<L;t++) if (RANK_IDX[base[i+t]]!==RANK_IDX[base[i+t-1]]+1){ok=false;break;}
      if (ok){
        const seq = base.slice(i,i+L).flatMap(k=>[k,k,k]);
        if (RANK_IDX[base[i+L-1]]>req.mainRank) addIfBeats(seq);
      }
    }
  } else if (req.type==='planeSingle'){
    const L = req.length!;
    const triKeys = labs.filter(l=>(m.get(l)||0)>=3 && l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i+L-1<tr iKeys.length;i++){
      let ok=true; for (let t=1;t<L;t++) if (RANK_IDX[triKeys[i+t]]!==RANK_IDX[triKeys[i+t-1]]+1){ok=false;break;}
      if (!ok) continue;
      const maxRank = RANK_IDX[triKeys[i+L-1]];
      if (maxRank<=req.mainRank) continue;
      // 选择 L 个单牌
      const singles = labs.filter(s => {
        const c = (m.get(s)||0) - (triKeys.slice(i,i+L).includes(s) ? 3 : 0);
        return c>=1;
      });
      if (singles.length>=L) {
        const pick = singles.slice(0,L);
        addIfBeats(triKeys.slice(i,i+L).flatMap(k=>[k,k,k]).concat(pick));
      }
    }
  } else if (req.type==='planePair'){
    const L = req.length!;
    const triKeys = labs.filter(l=>(m.get(l)||0)>=3 && l!=='2'&&l!=='x'&&l!=='X').sort((a,b)=>RANK_IDX[a]-RANK_IDX[b]);
    for (let i=0;i+L-1<tr iKeys.length;i++){
      let ok=true; for (let t=1;t<L;t++) if (RANK_IDX[triKeys[i+t]]!==RANK_IDX[triKeys[i+t-1]]+1){ok=false;break;}
      if (!ok) continue;
      const maxRank = RANK_IDX[triKeys[i+L-1]];
      if (maxRank<=req.mainRank) continue;
      // 选择 L 个对子
      const pairs = labs.filter(p => {
        const c = (m.get(p)||0) - (triKeys.slice(i,i+L).includes(p) ? 3 : 0);
        return c>=2;
      });
      if (pairs.length>=L) {
        const pick = pairs.slice(0,L).flatMap(p=>[p,p]);
        addIfBeats(triKeys.slice(i,i+L).flatMap(k=>[k,k,k]).concat(pick));
      }
    }
  } else if (req.type==='fourTwoSingles'){
    for (const [k,v] of m) if (v===4 && RANK_IDX[k]>req.mainRank){
      const singles = labs.filter(s=>s!==k);
      for (let i=0;i<singles.length;i++) for (let j=i+1;j<singles.length;j++)
        addIfBeats([k,k,k,k,singles[i],singles[j]]);
    }
  } else if (req.type==='fourTwoPairs'){
    for (const [k,v] of m) if (v===4 && RANK_IDX[k]>req.mainRank){
      const pairs = labs.filter(p=>(m.get(p)||0)>=2 && p!==k);
      for (let i=0;i<pairs.length;i++) for (let j=i+1;j<pairs.length;j++)
        addIfBeats([k,k,k,k,pairs[i],pairs[i],pairs[j],pairs[j]]);
    }
  }

  // 炸弹/火箭兜底
  bombs.forEach(addIfBeats);
  if (hasRocket) addIfBeats(['x','X']);

  return uniqBy(out.map(sortDesc), a=>a.join(',')).sort(byComboStrength);
}

function uniqBy<T>(arr: T[], key: (x:T)=>string): T[] {
  const s = new Set<string>(); const out: T[] = [];
  for (const x of arr){ const k = key(x); if (!s.has(k)){ s.add(k); out.push(x); } }
  return out;
}
// 大致排序：按分类强度 + 主序
function byComboStrength(a: Label[], b: Label[]): number {
  const A = classify(a as Label[], 'both')!; const B = classify(b as Label[], 'both')!;
  const w = (t: TrickReq) => t.type==='rocket'?1000: t.type==='bomb'?900:
    t.type==='fourTwoPairs'||t.type==='fourTwoSingles'?500:
    t.type==='planePair'||t.type==='planeSingle'?420:
    t.type==='tripleStraight'?400:
    t.type==='doubleStraight'?300: t.type==='straight'?280:
    t.type==='triplePair'||t.type==='tripleSingle'?220:
    t.type==='triple'?200: t.type==='pair'?120: t.type==='single'?100:0;
  if (w(A)!==w(B)) return w(A)-w(B);
  if ((A.length||0)!==(B.length||0)) return (A.length||0)-(B.length||0);
  return A.mainRank - B.mainRank;
}

// - - - - - 简单 AI - - - - -
export const RandomLegal: BotFunc = ({hands, require, canPass, policy}) => {
  const moves = generateMoves(hands, require, policy);
  if (moves.length===0) return canPass?{move:'pass'}:{move:'play', cards:[hands[0]]};
  const idx = Math.floor(Math.random()*moves.length);
  return { move: 'play', cards: moves[idx] };
};
export const GreedyMin: BotFunc = ({hands, require, canPass, policy}) => {
  const moves = generateMoves(hands, require, policy);
  if (moves.length===0) return canPass?{move:'pass'}:{move:'play', cards:[hands[hands.length-1]]};
  return { move:'play', cards: moves[0] }; // 最弱
};
export const GreedyMax: BotFunc = ({hands, require, canPass, policy}) => {
  const moves = generateMoves(hands, require, policy);
  if (moves.length===0) return canPass?{move:'pass'}:{move:'play', cards:[hands[0]]};
  return { move:'play', cards: moves[moves.length-1] }; // 最强
};

// - - - - - 地主选择（简化：估分最高者当地主） - - - - -
function scoreHandForLandlord(labels: Label[]): number {
  const m = counts(labels);
  let s = 0;
  for (const l of labels) s += RANK_IDX[l];
  if (m.get('2')) s += 20*(m.get('2')||0);
  if ((m.get('x')||0)+(m.get('X')||0)===2) s += 80;
  for (const [k,v] of m) if (v===4) s += 60; // 炸弹
  return s;
}

// - - - - - 回合驱动 - - - - -
export type GameSetup = {
  hands: Label[][];
  bottom: Label[];
  landlord: number;
};
export function makeGame(seed=0): GameSetup {
  const {hands, bottom} = deal(seed);
  // 选地主
  const scores = hands.map(h=>scoreHandForLandlord(h));
  let landlord = 0; let best = -1;
  for (let i=0;i<3;i++) if (scores[i]>best){best=scores[i]; landlord=i;}
  // 地主拿底牌
  hands[landlord] = sortDesc(hands[landlord].concat(bottom));
  return { hands: hands.map(sortDesc), bottom, landlord };
}

export type MatchOptions = EngineOptions & {
  players: [BotFunc, BotFunc, BotFunc];   // 三家 AI
  rounds?: number;
};

export async function* runOneGame(opts: MatchOptions): AsyncGenerator<EventObj> {
  const delay = async () => { if (opts.delayMs) await new Promise(r=>setTimeout(r, opts.delayMs)); };

  const g = makeGame(opts.seed||0);
  yield { type:'event', kind:'deal', hands: g.hands.map(h=>h.slice()), bottom: g.bottom };
  yield { type:'event', kind:'landlord', landlord: g.landlord, bottom: g.bottom.slice(), baseScore: 3 };

  const hands: Label[][] = g.hands.map(h=>h.slice());
  const bots = opts.players;

  let turn = g.landlord; // 当前行动位
  let req: TrickReq = null;
  let canPass = false;
  let lastNonPassSeat: number | null = null;
  let passCount = 0;

  while (true) {
    yield { type:'event', kind:'turn', seat: turn, lead: !canPass, require: req || undefined };
    const mv = bots[turn]({
      seat: turn, hands: hands[turn].slice(), require: req, canPass, policy: opts.four2||'both',
      lastNonPassSeat
    });

    if (mv.move==='pass') {
      if (!canPass) {
        // 领出不能过，强制出最小单
        const force = generateMoves(hands[turn], null, opts.four2||'both')[0] || [hands[turn][hands[turn].length-1]];
        yield { type:'event', kind:'play', seat: turn, move:'play', cards: force, comboType: classify(force, opts.four2||'both')?.type||'play' };
        removeLabels(hands[turn], force);
        req = classify(force, opts.four2||'both')!;
        lastNonPassSeat = turn;
        passCount = 0;
      } else {
        yield { type:'event', kind:'play', seat: turn, move:'pass', reason:'过' };
        passCount++;
        if (passCount===2 && lastNonPassSeat!=null) {
          // 一轮结束
          yield { type:'event', kind:'trick-reset' };
          turn = lastNonPassSeat;
          canPass = false;
          req = null;
          passCount = 0;
          continue;
        }
      }
    } else {
      // 出牌合法性校验
      const c = classify(mv.cards, opts.four2||'both');
      if (!c || (req && !canBeat(req, c))) {
        // 非法，降级为最小合法组合
        const legal = generateMoves(hands[turn], req, opts.four2||'both');
        const pick = legal[0] || (canPass? null : [hands[turn][hands[turn].length-1]]);
        if (!pick) {
          yield { type:'event', kind:'play', seat: turn, move:'pass', reason:'无牌可接' };
          passCount++;
        } else {
          const cc = classify(pick, opts.four2||'both')!;
          yield { type:'event', kind:'play', seat: turn, move:'play', cards: pick, comboType: cc.type };
          removeLabels(hands[turn], pick);
          req = cc;
          lastNonPassSeat = turn;
          passCount = 0;
        }
      } else {
        yield { type:'event', kind:'play', seat: turn, move:'play', cards: mv.cards, comboType: c.type };
        removeLabels(hands[turn], mv.cards);
        req = c;
        lastNonPassSeat = turn;
        passCount = 0;
      }
    }

    await delay();

    // 胜负判定
    if (hands[turn].length===0) {
      // 简单计分：胜者+10
      const totals: [number,number,number] = [0,0,0];
      totals[turn] = 10;
      yield { type:'score', totals };
      yield { type:'terminated' };
      return;
    }

    // 下一家
    turn = (turn + 1) % 3;
    if (!lastNonPassSeat) canPass = false;
    else canPass = true;
  }
}

function removeLabels(hand: Label[], labels: Label[]) {
  for (const l of labels) {
    const k = hand.indexOf(l);
    if (k>=0) hand.splice(k,1);
  }
}
