import type { GameEngine, GameHistoryEntry, GameState, PlayerAgent } from './types';

export type MatchResult<State extends GameState, Action> = {
  winner: number | null;
  history: GameHistoryEntry<State, Action>[];
  finalState: State;
};

export async function runMatch<State extends GameState, Action>(
  game: GameEngine<State, Action>,
  players: PlayerAgent<Action>[],
  seed?: number
): Promise<MatchResult<State, Action>> {
  if (players.length !== game.maxPlayers) {
    throw new Error(`Expected ${game.maxPlayers} players, received ${players.length}`);
  }

  let state = game.initialState(seed);
  const history: GameHistoryEntry<State, Action>[] = [];

  while (!game.isTerminal(state)) {
    const currentPlayer = state.currentPlayer;
    const legal = game.legalActions(state);
    if (legal.length === 0) {
      throw new Error(`Game ${game.name} has no legal actions for player ${currentPlayer}`);
    }

    const observation = game.encodeState(state, currentPlayer);
    const decision = await Promise.resolve(players[currentPlayer].chooseAction(observation, legal));
    const nextState = game.nextState(state, decision);

    history.push({ player: currentPlayer, action: decision, state: nextState, turn: history.length });
    state = nextState;
  }

  return {
    winner: game.getWinner(state),
    history,
    finalState: state,
  };
}
