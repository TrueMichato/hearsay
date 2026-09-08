import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { USER_AGENT } from '../../src/config/branding.ts';
import { DOWNLOAD_DELAY_MS, REQUEST_DELAY_MS } from '../content.config.ts';

const API = 'https://commons.wikimedia.org/w/api.php';

/** On-disk cache root. Gitignored: it is a network cache, not source. */
export const CACHE_DIR = join(process.cwd(), '.cache', 'wikimedia');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
let lastDownloadAt = 0;

/**
 * Serialised, rate-limited GET against the Commons API with an on-disk cache.
 *
 * Three things matter here:
 *  1. `User-Agent` — Wikimedia answers UA-less requests with an *empty* body
 *     rather than an error, which looks exactly like "this category is empty".
 *  2. `maxlag=5` — the documented way to back off when the cluster is busy.
 *  3. The cache makes reruns free, which is what makes the script resumable.
 */
export async function apiGet(
  params: Record<string, string>,
  { cache = true }: { cache?: boolean } = {},
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  const url = `${API}?${query.toString()}`;
  const key = createHash('sha1').update(url).digest('hex');
  const cachePath = join(CACHE_DIR, `${key}.json`);

  if (cache) {
    try {
      return JSON.parse(await readFile(cachePath, 'utf8'));
    } catch {
      /* cache miss — fall through to the network */
    }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' } });
    const text = await res.text();

    if (!text.trim()) {
      throw new Error(
        `Empty response from Commons for ${url}\n` +
          `This almost always means the User-Agent header was rejected. Current UA: "${USER_AGENT}"`,
      );
    }

    const json = JSON.parse(text) as Record<string, unknown>;
    const error = json.error as { code?: string; info?: string } | undefined;
    if (error?.code === 'maxlag') {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (error) throw new Error(`Commons API error ${error.code}: ${error.info}`);

    if (cache) {
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, JSON.stringify(json));
    }
    return json;
  }
  throw new Error(`Commons API stayed lagged after 5 attempts: ${url}`);
}

export interface CategoryMember {
  pageid: number;
  title: string;
}

/** Exact file count for a category, via `prop=categoryinfo`. */
export async function categoryFileCount(iso: string): Promise<number> {
  const json = await apiGet({
    action: 'query',
    titles: `Category:Lingua Libre pronunciation-${iso}`,
    prop: 'categoryinfo',
  });
  const pages = (json.query as { pages?: Array<{ categoryinfo?: { files?: number } }> })?.pages ?? [];
  return pages[0]?.categoryinfo?.files ?? 0;
}

/**
 * Enumerate up to `limit` files in a language's category.
 *
 * Sampling strategy: draw half the pool from the newest uploads and half from
 * the oldest. A single-ended sample is dangerous because Lingua Libre content
 * arrives in *batches* with a shared character — during development, sampling
 * only the newest Russian uploads returned a batch that was 85% multi-word
 * phrases, starving the language of usable single words. Sampling both ends
 * makes any one batch a minority of the pool.
 */
export async function listCategoryFiles(iso: string, limit: number): Promise<CategoryMember[]> {
  const half = Math.ceil(limit / 2);
  const [newest, oldest] = await Promise.all([
    enumerate(iso, half, 'desc'),
    enumerate(iso, half, 'asc'),
  ]);

  // Deduplicate: a small category can be fully covered by both directions.
  const seen = new Set<number>();
  const out: CategoryMember[] = [];
  for (const member of [...newest, ...oldest]) {
    if (seen.has(member.pageid)) continue;
    seen.add(member.pageid);
    out.push(member);
  }
  return out.slice(0, limit);
}

async function enumerate(iso: string, limit: number, dir: 'asc' | 'desc'): Promise<CategoryMember[]> {
  const out: CategoryMember[] = [];
  let cont: string | undefined;

  while (out.length < limit) {
    const json = await apiGet({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:Lingua Libre pronunciation-${iso}`,
      cmtype: 'file',
      cmlimit: '500',
      cmsort: 'timestamp',
      cmdir: dir,
      ...(cont ? { cmcontinue: cont } : {}),
    });
    const members = (json.query as { categorymembers?: CategoryMember[] })?.categorymembers ?? [];
    out.push(...members);
    cont = (json.continue as { cmcontinue?: string } | undefined)?.cmcontinue;
    if (!cont || members.length === 0) break;
  }
  return out.slice(0, limit);
}

export interface FileInfo {
  title: string;
  url: string;
  size: number;
  mime: string;
  descriptionUrl: string;
  license: string;
  licenseUrl: string | null;
  artistRaw: string;
}

/** Strip the HTML Commons returns in `extmetadata` fields down to plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch URL + licensing for up to 50 files at a time (the API's batch ceiling).
 *
 * Licences genuinely vary per file across Lingua Libre — CC0 and CC BY-SA both
 * occur — so we record the licence of each individual recording rather than
 * assuming one blanket licence for the corpus.
 */
export async function fetchFileInfo(titles: string[]): Promise<Map<string, FileInfo>> {
  const result = new Map<string, FileInfo>();

  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const json = await apiGet({
      action: 'query',
      titles: batch.join('|'),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|UsageTerms',
    });

    type Page = {
      title: string;
      imageinfo?: Array<{
        url: string;
        size: number;
        mime: string;
        descriptionurl: string;
        extmetadata?: Record<string, { value: string }>;
      }>;
    };
    const pages = (json.query as { pages?: Page[] })?.pages ?? [];

    for (const page of pages) {
      const ii = page.imageinfo?.[0];
      if (!ii) continue;
      const em = ii.extmetadata ?? {};
      result.set(page.title, {
        title: page.title,
        // Commons appends analytics query params to `url`; strip them so the
        // cache key is stable across runs.
        url: ii.url.split('?')[0],
        size: ii.size,
        mime: ii.mime,
        descriptionUrl: ii.descriptionurl,
        license: em.LicenseShortName ? stripHtml(em.LicenseShortName.value) : 'unknown',
        licenseUrl: em.LicenseUrl ? stripHtml(em.LicenseUrl.value) : null,
        artistRaw: em.Artist ? stripHtml(em.Artist.value) : '',
      });
    }
  }
  return result;
}

/**
 * Download a file to `dest`, skipping the network if it is already cached.
 *
 * `upload.wikimedia.org` is a separate, stricter service from the API and does
 * return HTTP 429. We therefore use a slower dedicated delay and honour
 * `Retry-After` with exponential backoff, rather than reusing the API budget.
 */
export async function downloadFile(url: string, dest: string): Promise<void> {
  try {
    await stat(dest);
    return; // already cached — this is what makes reruns resumable
  } catch {
    /* not cached */
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = DOWNLOAD_DELAY_MS - (Date.now() - lastDownloadAt);
    if (wait > 0) await sleep(wait);
    lastDownloadAt = Date.now();

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, 1000 * 2 ** attempt);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`);

    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return;
  }
  throw new Error(`Download rate-limited after 6 attempts: ${url}`);
}
