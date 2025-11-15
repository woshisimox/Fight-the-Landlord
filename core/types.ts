export type Action = unknown;

export type GameStatus = 'pending' | 'running' | 'finished';

export interface GameState<TData = any> {
  currentPlayer: number;
  turn: number;
  status: GameStatus;
  data: TData;
}

export interface GameEngine<State extends GameState = GameState, ActionType = Action> {
  name: string;
  maxPlayers: number;
  initialState(seed?: number): State;
  legalActions(state: State): ActionType[];
  nextState(state: State, action: ActionType): State;
  isTerminal(state: State): boolean;
  getWinner(state: State): number | null;
  encodeState(state: State, player: number): string;
}

export interface PlayerAgent<ActionType = Action> {
  id?: string;
  name: string;
  chooseAction(observation: string, legalActions: ActionType[]): Promise<ActionType> | ActionType;
}

export type GameHistoryEntry<State extends GameState, ActionType> = {
  player: number;
  action: ActionType;
  state: State;
  turn: number;
};
