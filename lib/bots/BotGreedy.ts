import { IBot } from "./types";

export class BotGreedy implements IBot {
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  async play(hand: string[], lastPlay: string[] | null): Promise<string[]> {
    if (!lastPlay || lastPlay.length === 0) {
      return [hand[0]];
    }
    const candidate = hand.find((c) => c > lastPlay[0]);
    return candidate ? [candidate] : [];
  }
}
