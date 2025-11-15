import Head from 'next/head';
import { useMemo, useState } from 'react';
import type { GameDefinition, GameId } from '../games';
import { GAME_REGISTRY, listGames } from '../games';

type RendererComponent = () => JSX.Element;

function useGameList(): GameDefinition<any, any>[] {
  return useMemo(() => listGames(), []);
}

export default function HomePage() {
  const games = useGameList();
  const defaultId = (games[0]?.id ?? 'ddz') as GameId;
  const [selectedGame, setSelectedGame] = useState<GameId>(defaultId);

  const current = GAME_REGISTRY[selectedGame] ?? GAME_REGISTRY[defaultId];
  const Renderer = (current?.renderer as RendererComponent) ?? (() => <div>Missing renderer</div>);

  return (
    <div className="min-h-screen bg-slate-50">
      <Head>
        <title>ai-gaming.online</title>
        <meta name="description" content="AI gaming arena with modular game plugins." />
      </Head>

      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">ai-gaming.online</h1>
            <p className="text-sm text-slate-600">Choose a game engine plugin to explore.</p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="game-select" className="text-sm font-medium text-slate-700">
              Game
            </label>
            <select
              id="game-select"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-slate-500 focus:outline-none focus:ring"
              value={selectedGame}
              onChange={(event) => setSelectedGame(event.target.value as GameId)}
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Renderer />
      </main>
    </div>
  );
}
