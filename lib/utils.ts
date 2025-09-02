export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function removeCards(from: {id:string}[], cards: {id:string}[]): void {
  const set = new Set(cards.map(c=>c.id));
  for (let i=from.length-1;i>=0;i--) if (set.has(from[i].id)) from.splice(i,1);
}
