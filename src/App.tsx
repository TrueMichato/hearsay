import { useCallback, useEffect, useState } from 'react';
import { Home } from './pages/Home';
import { Play } from './pages/Play';
import { Stats } from './pages/Stats';
import { Credits } from './pages/Credits';
import { useProfile } from './hooks/useProfile';
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
  | { name: 'play'; difficulty: Difficulty; seed?: string; tutorial?: boolean }
  | { name: 'stats' }
  | { name: 'credits' };

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, tail, seed, flag] = path.split('/');
  if (head === 'play' && DIFFICULTIES.includes(tail as Difficulty)) {
    // An optional seed makes a board reproducible: the same seed always deals
    // the same sixteen clips. End-to-end tests rely on it, and it is what a
    // "share this board" or daily-challenge feature would be built on.
    //
    // The trailing `manual` flag opens the guided round. Keeping it in the URL
    // rather than in component state means the manual is linkable, reopenable
    // and testable, and that Play knows on its very first render whether to
    // show it — no flash of the ungated board while a database read resolves.
    return {
      name: 'play',
      difficulty: tail as Difficulty,
      seed: seed || undefined,
      tutorial: flag === 'manual',
    };
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

  // `undefined` means the profile read has not resolved yet; `tutorialSeenAt`
  // is null only for a player who has never been shown the manual.
  const profile = useProfile();
  const firstRun = profile !== undefined && profile.tutorialSeenAt === null;

  switch (route.name) {
    case 'play':
      // Whether this is someone's first round is a fact about the player, not
      // about the URL they arrived on. The repository is public and links get
      // shared, so a first-time visitor can land on `#/play/easy` directly and
      // must still be taught the game. The `manual` flag in the URL therefore
      // only *forces* the manual open (the `?` button, and re-opening it later);
      // a genuine first run opens it on its own however the player got here.
      //
      // The profile read is asynchronous, so we wait one beat for it rather
      // than rendering the board and flipping the manual on afterwards. Play
      // reads `tutorial` once, when it mounts, and remounting it to correct the
      // decision would deal a different board out from under the player.
      if (profile === undefined) return <div className="chassis min-h-dvh" />;
      return (
        <Play
          // Remounting on difficulty change resets all round state cleanly.
          key={`${route.difficulty}:${route.seed ?? ''}:${route.tutorial ? 'manual' : ''}`}
          difficulty={route.difficulty}
          initialSeed={route.seed}
          tutorial={route.tutorial || firstRun}
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
          // No `manual` flag needed: the play route works out a first run for
          // itself, so starting from home and deep-linking behave identically.
          onStart={(difficulty) => go(`/play/${difficulty}`)}
          onManual={() => go('/play/easy//manual')}
          onStats={() => go('/stats')}
          onCredits={() => go('/credits')}
        />
      );
  }
}
