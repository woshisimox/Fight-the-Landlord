import { Card, Combo } from './types';

/** 将手牌按点数分组（忽略花色，用于形成对子/炸弹，但保留原卡对象） */
function groupByRank(cards: Card[]): Map<number, Card[]> {
  const m = new Map<number, Card[]>();
  for (const c of cards) {
    if (!m.has(c.rank)) m.set(c.rank, []);
    m.get(c.rank)!.push(c);
  }
  return m;
}

export function enumerateAllCombos(cards: Card[]): Combo[] {
  const res: Combo[] = [];
  const m = groupByRank(cards);
  for (const [rank, cs] of m.entries()) {
    if (rank===16 || rank===17) {
      // 单王
      res.push({ type:'single', length:1, mainRank:rank, cards:[cs[0]] });
      continue;
    }
    // 单张
    for (const c of cs) res.push({ type:'single', length:1, mainRank:rank, cards:[c] });
    // 对子
    if (cs.length>=2) res.push({ type:'pair', length:1, mainRank:rank, cards:[cs[0], cs[1]] });
    // 三张
    if (cs.length>=3) res.push({ type:'trio', length:1, mainRank:rank, cards:[cs[0], cs[1], cs[2]] });
    // 炸弹（四张）
    if (cs.length===4) res.push({ type:'bomb', length:1, mainRank:rank, cards:[cs[0], cs[1], cs[2], cs[3]] });
  }
  // 王炸
  const hasSJ = m.get(16)?.length ? true : false;
  const hasBJ = m.get(17)?.length ? true : false;
  if (hasSJ && hasBJ) {
    const SJ = m.get(16)![0], BJ = m.get(17)![0];
    res.push({ type:'rocket', length:1, mainRank:99, cards:[SJ,BJ] });
  }
  return dedup(res);
}

export function enumerateResponses(cards: Card[], require: Combo): Combo[] {
  const all = enumerateAllCombos(cards);
  return all.filter(c => canBeat(c, require));
}

export function canBeat(a: Combo, b: Combo): boolean {
  if (a.type==='rocket') return true;
  if (b.type==='rocket') return false;
  if (a.type==='bomb' && b.type!=='bomb') return true;
  if (a.type!==b.type) return false;
  if (a.length!==b.length) return false;
  // 基础版：只比较主点
  return a.mainRank > b.mainRank;
}

function dedup(arr: Combo[]): Combo[] {
  // 基于cards引用集合做去重
  const seen = new Set<string>();
  const out: Combo[] = [];
  for (const c of arr) {
    const key = c.type + ':' + c.cards.map(x=>x.label).sort().join(',');
    if (!seen.has(key)) { seen.add(key); out.push(c); }
  }
  return out;
}
