/**
 * Narrated mode — caption engine (NODE-ONLY).
 *
 * SRT parsing, global-timeline flattening, and SRT/VTT sidecar
 * writing. Uses fs/path and @remotion/captions — importable ONLY
 * from Node code (prepare.ts, voice.ts). NEVER import this file
 * from a Remotion composition: Webpack bundles compositions for
 * the browser and `fs` breaks the bundle ("Can't resolve 'fs'").
 * Compositions use the pure helpers in caption-cues.ts instead.
 *
 * Ported from Automated Video Generator's src/lib/captions.ts (MIT).
 */

import * as fs from "fs";
import * as path from "path";
import { parseSrt, serializeSrt, type Caption } from "@remotion/captions";
import type { CaptionSegment } from "./types";
import {
  buildFallbackSegments,
  groupCaptionSegments,
  syllableWordTimings,
  activeSegmentAt,
} from "./caption-cues";

// Re-export the pure helpers so Node callers import from one place.
export {
  buildFallbackSegments,
  groupCaptionSegments,
  syllableWordTimings,
  activeSegmentAt,
};
export type { CaptionSegment };

/**
 * Parse an Edge-TTS `--write-subtitles` SRT file into scene-relative
 * caption segments. Returns null when the file is missing, empty, or
 * unparseable so the caller can fall back to a scene-length cue.
 */
export function parseEdgeTtsSubtitles(srtPath: string): CaptionSegment[] | null {
  try {
    if (!fs.existsSync(srtPath)) return null;
    const raw = fs.readFileSync(srtPath, "utf8").trim();
    if (!raw) return null;
    const { captions } = parseSrt({ input: raw });
    const segments = captions
      .filter((c) => typeof c.text === "string" && c.text.trim().length > 0)
      .map((c) => ({
        text: c.text.trim(),
        startMs: Math.max(0, c.startMs),
        endMs: Math.max(0, c.endMs),
      }));
    return segments.length > 0 ? segments : null;
  } catch {
    return null;
  }
}

interface TimelineScene {
  startMs: number;
  segments?: CaptionSegment[];
  fallbackText?: string;
  durationSeconds?: number;
}

/**
 * Flatten per-scene caption segments onto a single global timeline
 * of `@remotion/captions` Caption cues, offsetting each scene's cues
 * by its start.
 */
export function buildGlobalCaptions(scenes: TimelineScene[]): Caption[] {
  const captions: Caption[] = [];
  for (const scene of scenes) {
    const segments =
      scene.segments && scene.segments.length > 0
        ? scene.segments
        : buildFallbackSegments(
            scene.fallbackText ?? "",
            scene.durationSeconds ?? 0,
          );
    for (const seg of segments) {
      const startMs = scene.startMs + seg.startMs;
      const endMs = scene.startMs + seg.endMs;
      captions.push({
        text: seg.text,
        startMs,
        endMs,
        timestampMs: Math.round((startMs + endMs) / 2),
        confidence: null,
      });
    }
  }
  return captions;
}

/** Serialize global captions to SRT using @remotion/captions. */
export function serializeCaptionsToSrt(captions: Caption[]): string {
  if (captions.length === 0) return "";
  return serializeSrt({ lines: captions.map((c) => [c]) });
}

function msToVttTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** Serialize global captions to WebVTT. */
export function serializeCaptionsToVtt(captions: Caption[]): string {
  const header = "WEBVTT\n";
  if (captions.length === 0) return header + "\n";
  const cues = captions
    .map((c, i) => {
      const start = msToVttTimestamp(c.startMs);
      const end = msToVttTimestamp(c.endMs);
      return `${i + 1}\n${start} --> ${end}\n${c.text}`;
    })
    .join("\n\n");
  return `${header}\n${cues}\n`;
}

/**
 * Write sidecar caption files next to the rendered MP4. Always emits
 * both `subtitles.srt` and `subtitles.vtt`. Returns the list of
 * written file paths. Skips writing entirely when no scene has any
 * text.
 */
export function writeCaptionSidecars(
  outputDir: string,
  scenes: { text: string; durationSeconds: number; segments?: CaptionSegment[] }[],
  baseName = "subtitles",
): string[] {
  let startMs = 0;
  const timeline: TimelineScene[] = [];
  for (const scene of scenes) {
    timeline.push({
      startMs,
      fallbackText: scene.text,
      durationSeconds: scene.durationSeconds,
      segments: scene.segments,
    });
    startMs += Math.max(0, Math.round((scene.durationSeconds || 0) * 1000));
  }
  const captions = buildGlobalCaptions(timeline);
  if (captions.length === 0) return [];
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const srtPath = path.join(outputDir, `${baseName}.srt`);
  const vttPath = path.join(outputDir, `${baseName}.vtt`);
  fs.writeFileSync(srtPath, serializeCaptionsToSrt(captions));
  fs.writeFileSync(vttPath, serializeCaptionsToVtt(captions));
  return [srtPath, vttPath];
}
