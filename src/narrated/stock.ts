/**
 * Narrated mode — stock media fetcher.
 *
 * A SIMPLIFIED port of Automated Video Generator's
 * src/lib/visual-fetcher/search.ts (MIT) provider ladder. What was
 * deliberately left behind: Pexels (API closed to new keys, verified
 * 2026-10-26), Pinterest, Ollama/Gemini keyword optimization, the
 * JSON result cache, and the media verifier. Pixabay is NOT here
 * either — the key lives in authd on the VM only and cannot be
 * copied to the iMac, so Pixabay runs VM-side
 * (watcher/narrated_stock.py) and the files ship to the iMac with
 * the storyboard as `prefetchedVisual` (see prepare.ts). What
 * remains on the iMac is a straight free ladder over plain `fetch`:
 *
 *   1. Free video: Wikimedia Commons, then Internet Archive
 *   2. Free image: Openverse, then Wikimedia Commons
 *   3. ffmpeg gradient placeholder card with the keyword burned on
 *
 * Videos are preferred (preferVideo=true); when no video is found
 * the ladder falls through to images, and vice versa. Every
 * candidate is downloaded to the job's asset dir and probed with
 * the system ffprobe for its real duration. Downloads cap at
 * 150MB with a 30s stall guard — a hung download never hangs the
 * job (the AVG matrix-QA hang was exactly this failure).
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import type { NarratedVisual } from "./types";

export const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;
const STALL_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MIN_VIDEO_WIDTH = 640;

interface Candidate {
  type: "video" | "image";
  url: string;
  width: number;
  height: number;
  videoDuration: number;
  source: string;
  title?: string;
  /** File size in bytes when the provider reports it (0 = unknown). */
  size: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string, params?: Record<string, string>): Promise<unknown> {
  const u = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) u.searchParams.set(k, v);
    }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(u.toString(), {
      headers: { "User-Agent": UA },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${u.host}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(Math.min(800 * 2 ** i, 5000));
    }
  }
  throw new Error(`${label} failed after ${attempts} tries: ${(last as Error)?.message || last}`);
}

// ------------------------------------------------------- Wikimedia Commons
// API pattern copied from AVG's free-video/providers/wikimedia.ts.

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    size?: number;
    width?: number;
    height?: number;
    duration?: number;
    mime?: string;
  }>;
}

async function searchCommons(
  query: string,
  filetype: "video" | "bitmap",
  count = 5,
): Promise<Candidate[]> {
  const data = (await fetchJson("https://commons.wikimedia.org/w/api.php", {
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:${filetype} ${query}`,
    gsrnamespace: "6",
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iiurlwidth: "1280",
    formatversion: "2",
  })) as { query?: { pages?: CommonsPage[] } };
  const out: Candidate[] = [];
  for (const page of data.query?.pages || []) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    if (filetype === "video") {
      if (!info.mime?.startsWith("video/")) continue;
      // Chrome (Remotion's renderer) plays mp4 + webm, not ogg/theora.
      if (!/mp4|webm/.test(info.mime)) continue;
      // A scene needs seconds, not a feature film: skip anything
      // over 60MB at search time (the download cap is 150MB).
      if (info.size && info.size > 60 * 1024 * 1024) continue;
      out.push({
        type: "video",
        url: info.url,
        width: info.width || 0,
        height: info.height || 0,
        videoDuration: typeof info.duration === "number" ? info.duration : 0,
        source: "wikimedia",
        title: page.title.replace(/^File:/, ""),
        size: info.size || 0,
      });
    } else {
      if (!info.mime?.startsWith("image/")) continue;
      if (info.size && info.size > MAX_DOWNLOAD_BYTES) continue;
      out.push({
        type: "image",
        url: info.thumburl || info.url,
        width: info.width || 0,
        height: info.height || 0,
        videoDuration: 0,
        source: "wikimedia",
        title: page.title.replace(/^File:/, ""),
        size: info.size || 0,
      });
    }
    if (out.length >= count) break;
  }
  return out;
}

// ---------------------------------------------------------- Internet Archive
// API pattern copied from AVG's free-video/providers/archive.ts.

interface ArchiveDoc {
  identifier: string;
  title?: string;
}

async function searchArchiveVideos(query: string, count = 3): Promise<Candidate[]> {
  const search = (await fetchJson("https://archive.org/advancedsearch.php", {
    q: `mediatype:movies AND (${query})`,
    "fl[]": "identifier,title",
    rows: "15",
    page: "1",
    output: "json",
  })) as { response?: { docs?: ArchiveDoc[] } };
  const out: Candidate[] = [];
  for (const doc of search.response?.docs || []) {
    if (out.length >= count) break;
    try {
      const meta = (await fetchJson(`https://archive.org/metadata/${doc.identifier}`)) as {
        server?: string;
        dir?: string;
        files?: Array<{ name: string; format?: string; size?: string; source?: string; length?: string }>;
      };
      const videos = (meta.files || []).filter((f) =>
        /\.(mp4|webm)$/i.test(f.name),
      );
      if (videos.length === 0 || !meta.server || !meta.dir) continue;
      videos.sort((a, b) => {
        const aMp4 = /\.mp4$/i.test(a.name) ? 0 : 1;
        const bMp4 = /\.mp4$/i.test(b.name) ? 0 : 1;
        if (aMp4 !== bMp4) return aMp4 - bMp4;
        return (parseInt(a.size || "0", 10) || 0) - (parseInt(b.size || "0", 10) || 0);
      });
      const best = videos[0];
      const size = parseInt(best.size || "0", 10) || 0;
      if (size > 60 * 1024 * 1024) continue;
      const url = `https://${meta.server}${meta.dir}/${encodeURIComponent(best.name).replace(/%2F/g, "/")}`;
      out.push({
        type: "video",
        url,
        width: 0,
        height: 0,
        videoDuration: best.length ? parseFloat(best.length) : 0,
        source: "archive.org",
        title: doc.title || doc.identifier,
        size,
      });
    } catch {
      continue;
    }
  }
  return out;
}

// ----------------------------------------------------------------- Openverse
// API pattern copied from AVG's src/lib/openverse-fetcher.ts.

async function searchOpenverseImages(query: string, count = 5): Promise<Candidate[]> {
  const data = (await fetchJson("https://api.openverse.engineering/v1/images/", {
    q: query,
    page: "1",
    page_size: String(Math.min(count, 20)),
  })) as { results?: Array<{ url: string; width?: number; height?: number; creator?: string }> };
  const out: Candidate[] = [];
  for (const r of data.results || []) {
    if (!r.url || !/^https?:\/\//.test(r.url)) continue;
    out.push({
      type: "image",
      url: r.url,
      width: r.width || 0,
      height: r.height || 0,
      videoDuration: 0,
      source: "openverse",
      size: 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ download

function extFromUrl(url: string, fallback: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const m = clean.match(/\.([a-z0-9]{2,5})$/i);
  if (m) {
    const ext = m[1].toLowerCase();
    if (["mp4", "webm", "mov", "jpg", "jpeg", "png", "webp"].includes(ext)) {
      return `.${ext === "jpeg" ? "jpg" : ext}`;
    }
  }
  return fallback;
}

/**
 * Stream a URL to disk with a stall guard: abort if no chunk arrives
 * for 30s (a stall guard, not a total timeout — a slow-but-alive
 * large video survives). Throws on HTTP errors and oversize files.
 */
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const ctrl = new AbortController();
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.google.com/" },
    signal: ctrl.signal,
  });
  if (!r.ok || !r.body) {
    throw new Error(`download HTTP ${r.status} for ${url}`);
  }
  const total = Number(r.headers.get("content-length") || 0);
  if (total > MAX_DOWNLOAD_BYTES) {
    throw new Error(`download too large (${total} bytes) for ${url}`);
  }
  const writer = fs.createWriteStream(destPath);
  let written = 0;
  let lastChunk = Date.now();
  const stallTimer = setInterval(() => {
    if (Date.now() - lastChunk > STALL_TIMEOUT_MS) {
      ctrl.abort();
    }
  }, 5000);
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastChunk = Date.now();
      written += value.length;
      if (written > MAX_DOWNLOAD_BYTES) {
        throw new Error(`download exceeded ${MAX_DOWNLOAD_BYTES} bytes: ${url}`);
      }
      await new Promise<void>((resolve, reject) => {
        writer.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    clearInterval(stallTimer);
    await new Promise<void>((resolve) => writer.end(() => resolve()));
  }
  if (written < 1000) {
    throw new Error(`download too small (${written} bytes): ${url}`);
  }
}

function probeVideoDuration(filePath: string): number {
  try {
    const r = spawnSync(
      "ffprobe",
      ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { encoding: "utf-8", timeout: 30000 },
    );
    if (r.status === 0) {
      const d = parseFloat((r.stdout || "").trim());
      if (!isNaN(d) && d > 0) return d;
    }
  } catch {
    /* unknown duration */
  }
  return 0;
}

/**
 * Trim a long source video down to the seconds a scene actually
 * needs (+2s headroom), re-encoded to mp4. Stock sources serve
 * whole films, not clips — without this a 3s scene carries a
 * 100MB+ file into the render. Returns the trimmed path + duration,
 * or null when trimming fails (caller keeps the original).
 */
function trimVideo(
  filePath: string,
  keepSeconds: number,
): { path: string; duration: number } | null {
  const trimmed = filePath.replace(/\.[a-z0-9]+$/i, "_trim.mp4");
  try {
    const r = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-ss",
        "0",
        "-i",
        filePath,
        "-t",
        String(Math.max(3, Math.ceil(keepSeconds))),
        "-c:v",
        "libx264",
        "-crf",
        "23",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        trimmed,
      ],
      { encoding: "utf-8", timeout: 180000 },
    );
    if (r.status !== 0 || !fs.existsSync(trimmed)) return null;
    const stat = fs.statSync(trimmed);
    if (stat.size < 1000) {
      fs.unlinkSync(trimmed);
      return null;
    }
    fs.unlinkSync(filePath);
    const duration = probeVideoDuration(trimmed);
    return { path: trimmed, duration: duration || keepSeconds };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- placeholder

const PLACEHOLDER_FONTS = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

function placeholderFont(): string | null {
  for (const f of PLACEHOLDER_FONTS) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** ffmpeg gradient card with the keyword burned on — the last resort. */
export function generatePlaceholder(
  query: string,
  assetDir: string,
  sceneNumber: number,
): NarratedVisual {
  fs.mkdirSync(assetDir, { recursive: true });
  const fileName = `scene_${sceneNumber}_placeholder.png`;
  const out = path.join(assetDir, fileName);
  const label = (query || "scene").slice(0, 28).replace(/'/g, "");
  const font = placeholderFont();
  const args = [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x0F2A43:s=1280x720,format=yuv420p",
    "-frames:v",
    "1",
  ];
  if (font) {
    args.push(
      "-vf",
      `drawtext=fontfile='${font}':text='${label}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2`,
    );
  }
  args.push(out);
  const r = spawnSync("ffmpeg", args, { encoding: "utf-8", timeout: 30000 });
  if (r.status !== 0 || !fs.existsSync(out)) {
    throw new Error("placeholder generation failed");
  }
  return {
    type: "image",
    localPath: fileName, // caller prefixes the public-relative dir
    width: 1280,
    height: 720,
    videoDuration: 0,
    source: "placeholder",
    query,
  };
}

// --------------------------------------------------------------------- ladder

/**
 * Fetch one scene's visual: search the ladder, download the first
 * usable candidate, probe video duration. Returns a NarratedVisual
 * whose localPath is relative to public/ (caller passes the
 * public-relative dir). Never returns null — the placeholder is the
 * last resort; throws only if even the placeholder fails.
 */
export async function fetchVisualForScene(
  keywords: string[],
  preferVideo: boolean,
  assetDir: string,
  publicRelDir: string,
  sceneNumber: number,
  /** Seconds the scene needs; longer videos are trimmed to this + 2s. */
  maxSeconds?: number,
): Promise<NarratedVisual> {
  fs.mkdirSync(assetDir, { recursive: true });
  const query = (keywords || []).join(" ").trim() || "landscape";
  const queries = [...new Set(keywords.map((k) => k.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()).filter(Boolean))];
  if (queries.length === 0) queries.push(query);

  const tryCandidates = async (
    searchers: Array<(q: string) => Promise<Candidate[]>>,
    preferSmallVideo: boolean,
  ): Promise<Candidate | null> => {
    for (const q of queries) {
      for (const search of searchers) {
        try {
          const results = await withRetry(() => search(q), `${q}`);
          if (results.length > 0) {
            // Smallest video first: a 3s background wants the
            // lightest file that still clears the width bar, not a
            // feature film. Images keep provider order (relevance).
            if (preferSmallVideo && results[0].type === "video") {
              results.sort((a, b) => (a.size || Infinity) - (b.size || Infinity));
            }
            return results[0];
          }
        } catch (e) {
          console.log(`  [stock] ${(e as Error).message}`);
        }
      }
    }
    return null;
  };

  const download = async (c: Candidate): Promise<NarratedVisual | null> => {
    const ext = extFromUrl(c.url, c.type === "video" ? ".mp4" : ".jpg");
    const fileName = `scene_${sceneNumber}${ext}`;
    const dest = path.join(assetDir, fileName);
    await downloadToFile(c.url, dest);
    let finalPath = dest;
    let finalName = fileName;
    let duration =
      c.type === "video" ? probeVideoDuration(dest) || c.videoDuration : 0;
    // Trim long videos to what the scene needs (+2s). A whole film
    // behind a 3s scene is dead weight in the render.
    if (
      c.type === "video" &&
      duration > 0 &&
      maxSeconds !== undefined &&
      duration > maxSeconds + 5
    ) {
      const trimmed = trimVideo(dest, maxSeconds + 2);
      if (trimmed) {
        finalPath = trimmed.path;
        finalName = path.basename(trimmed.path);
        duration = trimmed.duration;
        console.log(`  [stock] trimmed ${c.source} video ${Math.round(c.videoDuration || duration)}s -> ${Math.round(duration)}s`);
      }
    }
    return {
      type: c.type,
      localPath: `${publicRelDir}/${finalName}`,
      width: c.width,
      height: c.height,
      videoDuration: duration,
      source: c.source,
      query,
    };
  };

  // Ladder, in order. Video first when preferred, then images, then
  // the opposite type, then the placeholder.
  const videoSearchers = [
    (q: string) => searchCommons(q, "video"),
    searchArchiveVideos,
  ];
  const imageSearchers = [
    searchOpenverseImages,
    (q: string) => searchCommons(q, "bitmap"),
  ];

  const firstPass = preferVideo ? videoSearchers : imageSearchers;
  const secondPass = preferVideo ? imageSearchers : videoSearchers;

  for (const pass of [firstPass, secondPass]) {
    const candidate = await tryCandidates(pass, pass === videoSearchers);
    if (candidate) {
      try {
        const visual = await download(candidate);
        if (visual) return visual;
      } catch (e) {
        console.log(`  [stock] download failed (${candidate.source}): ${(e as Error).message}`);
      }
    }
  }

  console.log(`  [stock] no visual found for "${query}" — placeholder card`);
  const ph = generatePlaceholder(query, assetDir, sceneNumber);
  return { ...ph, localPath: `${publicRelDir}/${ph.localPath}` };
}
