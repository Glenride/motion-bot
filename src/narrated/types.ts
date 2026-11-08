/**
 * Narrated mode — shared types.
 *
 * A narrated storyboard is built by the Director
 * (watcher/harness_director.py: build_narrated_storyboard) from a
 * Mission Control task, enriched on the iMac by
 * src/narrated/prepare.ts (stock fetch + Edge-TTS + captions), and
 * rendered by the Narrated composition (src/Narrated.tsx).
 */

export interface CaptionSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface NarratedVisual {
  /** "video" | "image" — always a local file under public/. */
  type: "video" | "image";
  /** Path relative to public/, e.g. "narrated/task-1-foo/scene_1.mp4". */
  localPath: string;
  width: number;
  height: number;
  /** Source video duration in seconds (video only; 0 for images). */
  videoDuration: number;
  /** Where the visual came from, e.g. "pixabay", "wikimedia", "openverse". */
  source: string;
  /** The search query that found it (for the honesty note). */
  query: string;
}

/** One scene as the Director writes it (before prepare). */
export interface NarratedSceneInput {
  /** Words spoken in this scene — the ONLY copy, from the hook. */
  voiceoverText: string;
  /** Search keywords for stock, from the scene's content words. */
  visualKeywords: string[];
  /** Optional local asset under public/ (exists on disk only). */
  localAsset?: string;
  /**
   * Pixabay visual pre-fetched on the VM (watcher/narrated_stock.py)
   * and shipped to the iMac with the storyboard. The key lives in
   * authd on the VM only, so Pixabay never runs on the iMac.
   */
  prefetchedVisual?: NarratedVisual;
}

/** One scene after prepare.ts enriches it. */
export interface NarratedScene {
  voiceoverText: string;
  visualKeywords: string[];
  /** Audio-driven duration in whole seconds (min 3). */
  durationSeconds: number;
  visual: NarratedVisual | null;
  /** Path relative to public/, e.g. "narrated/<job>/scene_1_voice.mp3". */
  audioPath: string;
  /** Speech-timed cues, grouped into short phrases, scene-relative ms. */
  captionSegments: CaptionSegment[];
}

/** Input storyboard (Director output, briefs/<slug>-narrated.json). */
export interface NarratedStoryboardInput {
  version: 1;
  narrated: true;
  hook: string;
  project?: string;
  subtitle?: string;
  scenes: NarratedSceneInput[];
  notes?: string[];
}

/** Enriched storyboard (prepare.ts output, render --props). */
export interface NarratedStoryboard {
  version: 1;
  narrated: true;
  hook: string;
  project?: string;
  subtitle?: string;
  /** Total length in seconds = sum of scene durations. */
  lengthSeconds: number;
  scenes: NarratedScene[];
  notes?: string[];
}
