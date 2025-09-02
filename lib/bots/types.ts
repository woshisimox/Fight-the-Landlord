export interface IBot {
  name: string;
  play(
    hand: string[],
    lastPlay: string[] | null,
    history: Record<string, string[][]>
  ): Promise<string[]>;
}
