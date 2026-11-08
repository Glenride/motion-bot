/**
 * Narrated mode — caption cues (BROWSER-SAFE).
 *
 * Pure functions only: no fs, no path, no Node APIs. This module is
 * imported by the Remotion composition (subtitle-overlay.tsx), which
 * Webpack bundles for the browser — a single Node import there
 * breaks the whole render with "Can't resolve 'fs'". The file-I/O
 * half (SRT parsing, sidecar writing) lives in captions.ts, which
 * only prepare.ts (Node/tsx) ever imports.
 */

import type { CaptionSegment } from "./types";

export type { CaptionSegment };

/**
 * Build a fallback single cue spanning the whole scene when no word
 * boundaries are available. Duration is in seconds.
 */
export function buildFallbackSegments(
  text: string,
  durationSeconds: number,
): CaptionSegment[] {
  const clean = (text || "").trim();
  if (!clean) return [];
  const endMs = Math.max(500, Math.round((durationSeconds || 0) * 1000));
  return [{ text: clean, startMs: 0, endMs }];
}

/**
 * Group word-level cues into short readable phrases (max 6 words or
 * ~1.6s per cue). Edge-TTS emits one cue per word; burning one word
 * at a time flickers. Grouping keeps speech timing while the overlay
 * reads like real captions.
 */
export function groupCaptionSegments(
  segments: CaptionSegment[],
  maxWords = 6,
  maxMs = 1600,
): CaptionSegment[] {
  if (!segments || segments.length === 0) return [];
  const out: CaptionSegment[] = [];
  let cur: CaptionSegment | null = null;
  let words = 0;
  for (const seg of segments) {
    const n = seg.text.split(/\s+/).filter(Boolean).length;
    if (
      cur &&
      (words + n > maxWords || seg.endMs - cur.startMs > maxMs)
    ) {
      out.push(cur);
      cur = null;
      words = 0;
    }
    if (!cur) {
      cur = { text: seg.text, startMs: seg.startMs, endMs: seg.endMs };
      words = n;
    } else {
      cur.text = `${cur.text} ${seg.text}`;
      cur.endMs = seg.endMs;
      words += n;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Offline word-timing heuristic: ~165ms per syllable, clamped to
 * [120ms, 600ms] per word, stretched to fill `durationMs`. Used when
 * a voice engine returns audio but NO word boundaries. No network,
 * no native binary, zero cost.
 */
export function syllableWordTimings(
  text: string,
  durationMs: number,
): CaptionSegment[] {
  const clean = (text || "").trim();
  if (!clean) return [];
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const dur = Math.max(400, Math.round(durationMs));

  const est = (w: string) => {
    const syl = Math.max(
      1,
      (w.toLowerCase().match(/[aeiouyà-ÿ]+/g) || []).length,
    );
    return Math.min(600, Math.max(120, syl * 165));
  };
  const weights = words.map(est);
  let raw = weights.reduce((a, b) => a + b, 0) + 40 * (words.length - 1);
  if (raw <= 0) raw = words.length;
  const scale = dur / raw;

  const segs: CaptionSegment[] = [];
  let cur = 0;
  for (let i = 0; i < words.length; i++) {
    const w = weights[i] * scale;
    const start = Math.round(cur);
    const end = Math.round(cur + w);
    segs.push({
      text: words[i],
      startMs: start,
      endMs: Math.max(end, start + 80),
    });
    cur = end + 40 * scale;
  }
  if (segs.length) {
    segs[segs.length - 1].endMs = Math.max(
      segs[segs.length - 1].endMs,
      dur,
    );
  }
  return segs;
}

/**
 * Return the caption segment active at a given time offset (ms)
 * within a scene, or null if none is active. Used by the render
 * overlay. Clamps to the last cue past the final boundary to avoid
 * flicker at scene tail.
 */
export function activeSegmentAt(
  segments: CaptionSegment[] | undefined,
  timeMs: number,
): CaptionSegment | null {
  if (!segments || segments.length === 0) return null;
  for (const seg of segments) {
    if (timeMs >= seg.startMs && timeMs < seg.endMs) return seg;
  }
  const last = segments[segments.length - 1];
  if (last && timeMs >= last.endMs) return last;
  return segments[0] ?? null;
}
