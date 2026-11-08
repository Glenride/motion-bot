/**
 * Narrated mode — Edge-TTS voiceover synthesis.
 *
 * Ported from Automated Video Generator's src/lib/voice-generator.ts
 * (MIT), Edge-TTS path only. No Windows SAPI, no Kokoro/voicebox/
 * XTTS/OpenAI-local providers, no ffprobe-static / ffmpeg-static —
 * the iMac's system ffprobe/ffmpeg are used instead.
 *
 * Runs ON the iMac (edge-tts lives there). Resolution order for the
 * binary: EDGE_TTS_PATH env -> <repo>/.venv/bin/edge-tts ->
 * `edge-tts` on PATH.
 *
 * Cache rule (kept from AVG, it fixed a real staleness bug): a
 * generated MP3 is reused ONLY when its `.txt-hash` sidecar matches
 * the exact voiceover text; a stale file is deleted, never reused.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { parseEdgeTtsSubtitles } from "./captions";
import type { CaptionSegment } from "./types";

export interface VoiceConfig {
  voice: string;
  rate: string;
  pitch: string;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  voice: process.env.VIDEO_VOICE || "en-US-GuyNeural",
  rate: "+0%",
  pitch: "+0Hz",
};

export interface AudioResult {
  path: string;
  /** Whole-second duration (ceil of the real duration, min 3). */
  duration: number;
  captionSegments?: CaptionSegment[];
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/** Estimate from word count when ffprobe cannot read the file. */
export function estimateAudioDuration(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(3, Math.ceil(words / 2.2) + 1.5);
}

function getAudioDuration(filePath: string, text: string): number {
  try {
    const r = spawnSync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { encoding: "utf-8" },
    );
    if (r.status === 0) {
      const d = parseFloat((r.stdout || "").trim());
      if (!isNaN(d) && d > 0) return Math.max(3, Math.ceil(d));
    }
  } catch {
    /* fall through to estimate */
  }
  return estimateAudioDuration(text);
}

/** Strip characters that break edge-tts / SSML. */
export function cleanVoiceoverText(text: string): string {
  if (!text) return "";
  return text
    .replace(/"/g, "'")
    .replace(/\n/g, " ")
    .replace(/\r/g, "")
    .replace(/`/g, "'")
    .replace(/\$/g, "")
    .replace(/[<>|&^]/g, "")
    .trim();
}

function hashText(text: string): string {
  const slice = text.length > 4096 ? text.slice(0, 4096) : text;
  let h = 5381;
  for (let i = 0; i < slice.length; i++) {
    h = ((h << 5) + h + slice.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function audioHashPath(outputPath: string): string {
  return `${outputPath}.txt-hash`;
}

function writeAudioHashSidecar(outputPath: string, text: string): void {
  try {
    fs.writeFileSync(audioHashPath(outputPath), hashText(text), "utf8");
  } catch {
    /* sidecar is best-effort; missing sidecar only forces re-synthesis */
  }
}

function resolveExistingAudio(
  outputPath: string,
  text: string,
): AudioResult | null {
  if (!fs.existsSync(outputPath)) return null;
  try {
    const stats = fs.statSync(outputPath);
    if (stats.size > 1000) {
      const hp = audioHashPath(outputPath);
      if (
        fs.existsSync(hp) &&
        fs.readFileSync(hp, "utf8").trim() === hashText(text)
      ) {
        let captionSegments: CaptionSegment[] | undefined;
        const srtPath = outputPath.replace(/\.(mp3|wav|ogg|m4a)$/i, ".srt");
        try {
          captionSegments = parseEdgeTtsSubtitles(srtPath) ?? undefined;
        } catch {
          captionSegments = undefined;
        }
        return {
          path: outputPath,
          duration: getAudioDuration(outputPath, text),
          captionSegments,
        };
      }
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
      return null;
    }
  } catch {
    /* re-generate if cached file looks broken */
  }
  return null;
}

function assertGeneratedAudioFile(outputPath: string): void {
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Output file not created: ${outputPath}`);
  }
  const stats = fs.statSync(outputPath);
  if (stats.size < 1000) {
    fs.unlinkSync(outputPath);
    throw new Error(
      `Output file too small (${stats.size} bytes), likely corrupted`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Find the edge-tts binary. Throws when none is usable. */
export function resolveEdgeTts(): string {
  const candidates: string[] = [];
  if (process.env.EDGE_TTS_PATH) candidates.push(process.env.EDGE_TTS_PATH);
  // <repo>/.venv/bin/edge-tts — this file lives in src/narrated/,
  // so the repo root is two levels up from __dirname's parent... in
  // tsx the source dir is src/narrated; resolve from cwd instead,
  // which is always the repo root when the watcher invokes prepare.
  candidates.push(path.join(process.cwd(), ".venv", "bin", "edge-tts"));
  candidates.push("edge-tts");
  for (const c of candidates) {
    const r = spawnSync(c, ["--help"], { encoding: "utf-8", timeout: 15000 });
    if (r.status === 0) return c;
  }
  throw new Error(
    "edge-tts not found (checked EDGE_TTS_PATH, .venv/bin/edge-tts, PATH). " +
      "Create the venv: python3 -m venv .venv && .venv/bin/pip install edge-tts",
  );
}

/** Last resort: a silent WAV so a voice failure never aborts a render. */
export function makeSilentTrack(
  outputDir: string,
  sceneNumber: number,
  durationSeconds: number,
): AudioResult {
  const outputPath = path.join(
    outputDir,
    `scene_${sceneNumber}_voice_silent.wav`,
  );
  const dur = Math.max(3, Math.round(durationSeconds || 3));
  try {
    const r = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=1",
        "-t",
        String(dur),
        "-q:a",
        "0",
        outputPath,
      ],
      { encoding: "utf-8", timeout: 30000 },
    );
    if (r.status !== 0 || !fs.existsSync(outputPath)) {
      throw new Error("ffmpeg silent track failed");
    }
  } catch {
    // Hand-built 44-byte WAV header (silent, 1ch, 8kHz).
    const wav = Buffer.alloc(44);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(36, 4);
    wav.write("WAVE", 8, "ascii");
    wav.write("fmt ", 12, "ascii");
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(8000, 28);
    wav.writeUInt16LE(1, 32);
    wav.writeUInt16LE(8, 34);
    wav.write("data", 36, "ascii");
    wav.writeUInt32LE(0, 40);
    fs.writeFileSync(outputPath, wav);
  }
  return { path: outputPath, duration: dur };
}

/**
 * Synthesize one scene's voiceover with Edge-TTS. Writes
 * scene_N_voice.mp3 + scene_N_voice.srt (word boundaries) into
 * outputDir. Retries 3x; on final failure throws — the caller
 * decides whether to fall back to a silent track.
 */
export async function generateSceneVoiceover(
  sceneNumber: number,
  text: string,
  outputDir: string,
  config: VoiceConfig = DEFAULT_VOICE_CONFIG,
  edgeTts?: string,
): Promise<AudioResult> {
  const outputPath = path.join(outputDir, `scene_${sceneNumber}_voice.mp3`);
  const existing = resolveExistingAudio(outputPath, text);
  if (existing) return existing;

  const cleanText = cleanVoiceoverText(text);
  if (!cleanText) {
    return { path: "", duration: Math.max(3, estimateAudioDuration(text)) };
  }
  if (cleanText.length < 2) {
    throw new Error(`Scene ${sceneNumber} has empty or invalid text`);
  }

  const bin = edgeTts ?? resolveEdgeTts();
  const subtitlePath = outputPath.replace(/\.(mp3|wav|ogg|m4a)$/i, ".srt");

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const r = spawnSync(
        bin,
        [
          "--voice",
          config.voice,
          `--rate=${config.rate}`,
          `--pitch=${config.pitch}`,
          "--text",
          cleanText,
          "--write-media",
          outputPath,
          "--write-subtitles",
          subtitlePath,
        ],
        { encoding: "utf-8", timeout: 120000 },
      );
      if (r.status !== 0) {
        throw new Error(
          `edge-tts exited ${r.status}: ${((r.stderr || r.stdout || "") as string).trim().slice(-300)}`,
        );
      }
      assertGeneratedAudioFile(outputPath);
      writeAudioHashSidecar(outputPath, text);
      let captionSegments: CaptionSegment[] | undefined;
      try {
        captionSegments = parseEdgeTtsSubtitles(subtitlePath) ?? undefined;
      } catch {
        captionSegments = undefined;
      }
      return {
        path: outputPath,
        duration: getAudioDuration(outputPath, text),
        captionSegments,
      };
    } catch (error) {
      lastError = error as Error;
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          /* ignore */
        }
      }
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error(
    `Edge-TTS failed for scene ${sceneNumber} after ${MAX_RETRIES} retries: ${lastError?.message}`,
  );
}
