import { useMemo } from 'react';
import manifestJson from '../content/manifest.json';
import type { ContentManifest } from '../content/types';
import { BRANDING } from '../config/branding';

const manifest = manifestJson as ContentManifest;

/**
 * Attribution page.
 *
 * Every clip in the manifest carries its own licence — the corpus mixes CC0,
 * CC BY 4.0 and CC BY-SA 4.0. CC BY and CC BY-SA both *require* crediting the
 * author and linking the licence, so this page is a legal obligation, not a
 * courtesy. Clips are grouped by language then speaker to stay readable, but
 * every individual recording keeps a link to its Commons file page.
 */
export function Credits({ onBack }: { onBack: () => void }) {
  const groups = useMemo(() => {
    return manifest.languages
      .map((language) => {
        const clips = manifest.clips.filter((c) => c.language === language.id);
        const bySpeaker = new Map<string, typeof clips>();
        for (const clip of clips) {
          const list = bySpeaker.get(clip.speaker) ?? [];
          list.push(clip);
          bySpeaker.set(clip.speaker, list);
        }
        return {
          language,
          clips,
          speakers: [...bySpeaker.entries()]
            .map(([speaker, list]) => ({ speaker, clips: list }))
            .sort((a, b) => b.clips.length - a.clips.length),
        };
      })
      .filter((g) => g.clips.length > 0);
  }, []);

  const licenceTally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const clip of manifest.clips) {
      counts.set(clip.license, (counts.get(clip.license) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 pb-10">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-2 py-1 text-sm text-slate-300 hover:text-white"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold">Credits &amp; licences</h1>
      </header>

      <section className="space-y-2 rounded-2xl bg-slate-800/50 p-4 text-sm text-slate-300">
        <p>
          Every word you hear in {BRANDING.name} was recorded by a volunteer native speaker for{' '}
          <a
            className="text-sky-300 underline"
            href="https://lingualibre.org/"
            target="_blank"
            rel="noreferrer"
          >
            Lingua Libre
          </a>
          , a Wikimedia project, and published on{' '}
          <a
            className="text-sky-300 underline"
            href="https://commons.wikimedia.org/"
            target="_blank"
            rel="noreferrer"
          >
            Wikimedia Commons
          </a>
          .
        </p>
        <p>
          {manifest.clips.length} recordings across {groups.length} languages. Audio was trimmed and
          loudness-normalised, then re-encoded to Opus; the words themselves are unaltered.
        </p>
        <ul className="text-xs text-slate-400">
          {licenceTally.map(([license, count]) => (
            <li key={license}>
              {license} — {count} recordings
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-400">
          Each recording keeps the licence it carries on Commons. Because the files here are
          modified, recordings under CC BY-SA 4.0 are redistributed under CC BY-SA 4.0 in turn, as
          ShareAlike requires. These terms cover the audio; {BRANDING.name}’s own code is licensed
          separately.
        </p>
      </section>

      {groups.map(({ language, clips, speakers }) => (
        <details key={language.id} className="rounded-2xl bg-slate-800/50 p-3">
          <summary className="cursor-pointer text-sm font-bold">
            {language.name}{' '}
            <span className="font-normal text-slate-400">
              · {clips.length} recordings · {speakers.length} speakers
            </span>
          </summary>
          <ul className="mt-2 space-y-3">
            {speakers.map(({ speaker, clips: speakerClips }) => (
              <li key={speaker}>
                <p className="text-xs font-semibold text-slate-200">
                  {speaker}{' '}
                  <span className="font-normal text-slate-400">
                    ({speakerClips.length} recordings)
                  </span>
                </p>
                <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                  {speakerClips.map((clip) => (
                    <li key={clip.id} className="text-[11px]">
                      <a
                        className="text-sky-300 underline decoration-sky-300/40 underline-offset-2"
                        href={clip.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`${clip.word} — ${clip.license}`}
                      >
                        {clip.word}
                      </a>
                      <span className="text-slate-400">
                        {' '}
                        {clip.licenseUrl ? (
                          <a
                            className="underline decoration-slate-500 underline-offset-2"
                            href={clip.licenseUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {clip.license}
                          </a>
                        ) : (
                          clip.license
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

      <p className="text-center text-[11px] text-slate-400">
        Manifest generated {new Date(manifest.generatedAt).toLocaleDateString()}.
      </p>
    </div>
  );
}
