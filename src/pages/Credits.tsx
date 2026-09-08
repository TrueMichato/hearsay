import { useMemo } from 'react';
import manifestJson from '../content/manifest.json';
import type { ClipSource, ContentManifest } from '../content/types';
import { BRANDING } from '../config/branding';

const manifest = manifestJson as ContentManifest;

/**
 * Attribution page.
 *
 * Every recording carries its own licence — the corpus mixes CC0, CC BY 4.0 and
 * CC BY-SA 4.0. CC BY and CC BY-SA both *require* crediting the author and
 * linking the licence, so this page is a legal obligation, not a courtesy.
 *
 * A tile is an utterance assembled from three separate Commons files, so the
 * unit of attribution is `clip.sources[]`, never the tile. Crediting the tile
 * would silently drop two recordings out of every three and would misreport the
 * licence of the two it dropped, since a tile is filed under the most
 * restrictive licence among its parts. Recordings are grouped by language then
 * speaker to stay readable, but each one keeps its own link and its own
 * licence.
 */
export function Credits({ onBack }: { onBack: () => void }) {
  const groups = useMemo(() => {
    return manifest.languages
      .map((language) => {
        const sources = manifest.clips
          .filter((c) => c.language === language.id)
          .flatMap((c) => c.sources);
        const bySpeaker = new Map<string, ClipSource[]>();
        for (const source of sources) {
          const list = bySpeaker.get(source.speaker) ?? [];
          list.push(source);
          bySpeaker.set(source.speaker, list);
        }
        return {
          language,
          sources,
          speakers: [...bySpeaker.entries()]
            .map(([speaker, list]) => ({ speaker, sources: list }))
            .sort((a, b) => b.sources.length - a.sources.length),
        };
      })
      .filter((g) => g.sources.length > 0);
  }, []);

  const totalSources = useMemo(
    () => manifest.clips.reduce((sum, clip) => sum + clip.sources.length, 0),
    [],
  );

  const licenceTally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const clip of manifest.clips) {
      for (const source of clip.sources) {
        counts.set(source.license, (counts.get(source.license) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  return (
    <div className="chassis grain mx-auto min-h-full w-full max-w-lg space-y-3 p-4 pb-10">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="legend panel rounded-lg px-3 py-2 text-[color:var(--color-legend)]"
        >
          ← Back
        </button>
        <h1 className="nameplate text-2xl text-[color:var(--color-ink)]">Credits &amp; licences</h1>
      </header>

      <section className="panel space-y-2 rounded-lg p-4 text-sm leading-relaxed text-[color:var(--color-legend)]">
        <p>
          Every word you hear in {BRANDING.name} was recorded by a volunteer native speaker for{' '}
          <a
            className="text-[color:var(--color-signal)] underline"
            href="https://lingualibre.org/"
            target="_blank"
            rel="noreferrer"
          >
            Lingua Libre
          </a>
          , a Wikimedia project, and published on{' '}
          <a
            className="text-[color:var(--color-signal)] underline"
            href="https://commons.wikimedia.org/"
            target="_blank"
            rel="noreferrer"
          >
            Wikimedia Commons
          </a>
          .
        </p>
        <p>
          {totalSources} recordings across {groups.length} languages, assembled into{' '}
          {manifest.clips.length} tiles of three words each. Audio was trimmed, loudness-normalised
          and joined with a short pause, then re-encoded to Opus; the words themselves are
          unaltered.
        </p>
        <ul className="readout text-xs text-[color:var(--color-legend-dim)]">
          {licenceTally.map(([license, count]) => (
            <li key={license}>
              {license} — {count} recordings
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-[color:var(--color-legend-dim)]">
          Each recording keeps the licence it carries on Commons. Because the files here are
          modified, recordings under CC BY-SA 4.0 are redistributed under CC BY-SA 4.0 in turn, as
          ShareAlike requires. These terms cover the audio; {BRANDING.name}’s own code is licensed
          separately.
        </p>
      </section>

      {groups.map(({ language, sources, speakers }) => (
        <details key={language.id} className="panel rounded-lg p-3">
          <summary className="nameplate cursor-pointer text-lg text-[color:var(--color-ink)]">
            {language.name}{' '}
            <span className="legend text-[color:var(--color-legend-dim)]">
              · {sources.length} recordings · {speakers.length} speakers
            </span>
          </summary>
          <ul className="mt-2 space-y-3">
            {speakers.map(({ speaker, sources: speakerSources }) => (
              <li key={speaker}>
                <p className="text-xs font-semibold text-[color:var(--color-ink)]">
                  {speaker}{' '}
                  <span className="font-normal text-[color:var(--color-legend-dim)]">
                    ({speakerSources.length} recordings)
                  </span>
                </p>
                <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                  {speakerSources.map((source) => (
                    <li key={source.sourceUrl} className="text-[11px]">
                      <a
                        className="text-[color:var(--color-signal)] underline decoration-[color:var(--color-signal)]/40 underline-offset-2"
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`${source.word} — ${source.license}`}
                      >
                        {source.word}
                      </a>
                      <span className="text-[color:var(--color-legend-dim)]">
                        {' '}
                        {source.licenseUrl ? (
                          <a
                            className="underline decoration-[color:var(--color-hairline)] underline-offset-2"
                            href={source.licenseUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.license}
                          </a>
                        ) : (
                          source.license
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ))}

      <p className="text-center text-[11px] text-[color:var(--color-legend-dim)]">
        Manifest generated {new Date(manifest.generatedAt).toLocaleDateString()}.
      </p>
    </div>
  );
}
