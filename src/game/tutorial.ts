export interface CoachFacts {
  /** Stations the player has played at least once. */
  heard: number;
  /** Stations filed into a group. */
  placed: number;
  /** Stations currently held back. */
  held: number;
  shopOpened: boolean;
}

export interface TutorialStep {
  title: string;
  body: string;
  /** When true, the player has done the thing and the step advances itself. */
  done?: (facts: CoachFacts) => boolean;
}

/**
 * The guided first round.
 *
 * The game shipped with no onboarding of any kind: a new player met sixteen
 * identical grey squares, three language names, an unexplained coin badge and a
 * disabled button. Nothing said the tiles made sound.
 *
 * This teaches by watching instead of lecturing. Every step that asks for an
 * action advances when the player performs it on the real board — there is no
 * fake board and no forced click target, so a player who ignores the prompt and
 * explores still makes progress. The two steps that explain rather than ask
 * (holding, and the clue economy) carry a Next button.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Sixteen stations',
    body: 'Each tile is a recording of one word, spoken by a native speaker. Press one to hear it.',
    done: (f) => f.heard >= 1,
  },
  {
    title: 'Listening is free',
    body: 'Nothing got filed — listening never commits you. Hear two more and compare.',
    done: (f) => f.heard >= 3,
  },
  {
    title: 'File what you hear',
    body: 'Recognise the language? Press it in the bank below to file the tuned station.',
    done: (f) => f.placed >= 1,
  },
  {
    title: 'Two at once',
    body: 'Two stations, same language? Hold each one, then a single group press files both.',
  },
  {
    title: 'Coins buy clues',
    body: 'Scoring well earns coins. Clues spend them — the word, its romanisation, or the answer.',
    done: (f) => f.shopOpened,
  },
  {
    title: 'Then transmit',
    body: 'File what you can, then transmit. A skipped station costs nothing; a wrong guess does.',
  },
];
