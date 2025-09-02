import { IBot } from "./types";

export class BotRandom implements IBot {
  name: string;
  constructor(name: string) {
    this.name = name;
  }

  async play(hand: string[]): Promise<string[]> {
    if (hand.length === 0) return [];
    const idx = Math.floor(Math.random() * hand.length);
    return [hand[idx]];
  }
}
