import { useCallback, useEffect, useState } from 'react';
import { Home } from './pages/Home';
import { Play } from './pages/Play';
import { Stats } from './pages/Stats';
import { Credits } from './pages/Credits';
import type { Difficulty } from './game/types';

/**
 * Routing without a router.
 *
 * A router library exists to map URLs to screens. With four screens, the URL
 * hash (the part after `#`) does the job: changing it fires `hashchange`, and
 * the browser back button works for free. Hash routing also means the app is a
 * single static file, so it works when opened offline from the cache with no
 * server rewriting rules.
 */
type Route =
  | { name: 'home' }
  | { name: 'play'; difficulty: Difficulty; seed?: string }
  | { name: 'stats' }
  | { name: 'credits' };

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, tail, seed] = path.split('/');
  if (head === 'play' && DIFFICULTIES.includes(tail as Difficulty)) {
    // An optional seed makes a board reproducible: the same seed always deals
    // the same sixteen clips. End-to-end tests rely on it, and it is what a
    // "share this board" or daily-challenge feature would be built on.
    return { name: 'play', difficulty: tail as Difficulty, seed: seed || undefined };
  }
  if (head === 'stats') return { name: 'stats' };
  if (head === 'credits') return { name: 'credits' };
  return { name: 'home' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = useCallback((to: string) => {
    window.location.hash = to;
  }, []);

  const goHome = useCallback(() => go('/'), [go]);

  switch (route.name) {
    case 'play':
      return (
        <Play
          // Remounting on difficulty change resets all round state cleanly.
          key={`${route.difficulty}:${route.seed ?? ''}`}
          difficulty={route.difficulty}
          initialSeed={route.seed}
          onExit={goHome}
        />
      );
    case 'stats':
      return <Stats onBack={goHome} />;
    case 'credits':
      return <Credits onBack={goHome} />;
    default:
      return (
        <Home
          onStart={(difficulty) => go(`/play/${difficulty}`)}
          onStats={() => go('/stats')}
          onCredits={() => go('/credits')}
        />
      );
  }
}
