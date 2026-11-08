#!/usr/bin/env npx tsx
/**
 * Narrated mode — asset preparation (runs ON the iMac).
 *
 * Usage:
 *   npx tsx src/narrated/prepare.ts <input-storyboard.json> <output-storyboard.json>
 *
 * Reads a narrated storyboard from the Director (scenes with
 * voiceoverText + visualKeywords), and for each scene:
 *   1. Uses a VM-prefetched Pixabay visual when present, else
 *      fetches a free-ladder visual (Wikimedia/IA video ->
 *      Openverse/Wikimedia image -> placeholder) into
 *      public/narrated/<job>/.
 *   2. Synthesizes the voiceover with Edge-TTS (MP3 + word-boundary
 *      SRT) into the same dir.
 *   3. Groups word cues into short phrases; scene duration = ceil
 *      of the real audio length (min 3s).
 * Writes the enriched storyboard (render --props) plus a global
 * subtitles.srt/.vtt next to the output file.
 *
 * Env (read from <repo>/.env when present, else process env):
 *   VIDEO_VOICE     — Edge-TTS voice, default en-US-GuyNeural.
 *   EDGE_TTS_PATH   — edge-tts binary override.
 * Pixabay is NOT read here: the key lives in authd on the VM only,
 * so Pixabay fetching runs VM-side (watcher/narrated_stock.py) and
 * the files ship to the iMac with the storyboard as
 * `prefetchedVisual` per scene.
 *
 * A scene whose voiceover fails after retries gets a silent track
 * (the render still completes; the Critic's audio check will catch
 * it). A scene whose visual fetch fails gets the placeholder card.
 * prepare exits non-zero only when it cannot write its output.
 */

import * as fs from "fs";
import * as path from "path";
import { generateSceneVoiceover, makeSilentTrack, resolveEdgeTts, DEFAULT_VOICE_CONFIG, estimateAudioDuration } from "./voice";
import { fetchVisualForScene } from "./stock";
import { groupCaptionSegments, buildFallbackSegments, writeCaptionSidecars } from "./captions";
import type { NarratedStoryboardInput, NarratedStoryboard, NarratedScene, NarratedVisual } from "./types";

function loadDotEnv(repoRoot: string): void {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue; // real env wins
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("usage: npx tsx src/narrated/prepare.ts <input.json> <output.json>");
    process.exit(2);
  }
  const repoRoot = process.cwd();
  loadDotEnv(repoRoot);

  const input: NarratedStoryboardInput = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!input.narrated || !Array.isArray(input.scenes) || input.scenes.length === 0) {
    throw new Error("input is not a narrated storyboard (needs narrated:true + scenes[])");
  }

  const job = path.basename(inputPath).replace(/\.json$/i, "").replace(/-narrated$/, "");
  const assetDir = path.join(repoRoot, "public", "narrated", job);
  const publicRelDir = `narrated/${job}`;
  fs.mkdirSync(assetDir, { recursive: true });

  // Resolve the TTS binary once, up front — fail fast with a clear
  // error instead of failing scene by scene.
  let edgeTts: string | undefined;
  try {
    edgeTts = resolveEdgeTts();
    console.log(`[prepare] edge-tts: ${edgeTts}`);
  } catch (e) {
    console.log(`[prepare] WARNING: ${(e as Error).message} — scenes will be silent`);
  }
  console.log(`[prepare] pixabay: VM-side only (connector) — iMac ladder is wikimedia / archive.org / openverse`);
  console.log(`[prepare] job ${job}: ${input.scenes.length} scenes`);

  const scenes: NarratedScene[] = [];
  let totalSeconds = 0;

  for (let i = 0; i < input.scenes.length; i++) {
    const scene = input.scenes[i];
    const n = i + 1;
    console.log(`[prepare] scene ${n}/${input.scenes.length}: "${scene.voiceoverText.slice(0, 60)}"`);

    // --- visual ---
    let visual: NarratedVisual | null = null;
    // 0. VM-prefetched Pixabay file (shipped with the storyboard).
    //    The file must exist under public/ — otherwise fall through
    //    to the free ladder, never fail the scene on it.
    const prefetched = scene.prefetchedVisual;
    if (prefetched) {
      const diskPath = path.join(repoRoot, "public", prefetched.localPath);
      if (fs.existsSync(diskPath)) {
        visual = prefetched;
        console.log(`[prepare]   visual: prefetched ${prefetched.source} (${prefetched.type}) for "${prefetched.query}"`);
      } else {
        console.log(`[prepare]   visual: prefetched file "${prefetched.localPath}" missing on iMac — using free ladder`);
      }
    }
    const localAsset = scene.localAsset;
    if (!visual && localAsset) {
      // AVG trap fix: a named local file is used ONLY if it exists
      // under public/. A missing file is ignored, never searched as
      // stock keywords.
      const diskPath = path.join(repoRoot, "public", localAsset);
      if (fs.existsSync(diskPath)) {
        const ext = path.extname(localAsset).toLowerCase();
        const isVideo = [".mp4", ".webm", ".mov"].includes(ext);
        visual = {
          type: isVideo ? "video" : "image",
          localPath: localAsset,
          width: 0,
          height: 0,
          videoDuration: 0,
          source: "local",
          query: localAsset,
        };
        console.log(`[prepare]   visual: local ${localAsset}`);
      } else {
        console.log(`[prepare]   visual: local asset "${localAsset}" missing — ignoring, using stock`);
      }
    }
    if (!visual) {
      try {
        visual = await fetchVisualForScene(
          scene.visualKeywords,
          true,
          assetDir,
          publicRelDir,
          n,
          estimateAudioDuration(scene.voiceoverText) + 5,
        );
        console.log(`[prepare]   visual: ${visual.source} (${visual.type}) for "${visual.query}"`);
      } catch (e) {
        console.log(`[prepare]   visual fetch failed: ${(e as Error).message} — scene will render without a visual`);
        visual = null;
      }
    }

    // --- voiceover ---
    let audioPath = "";
    let durationSeconds = estimateAudioDuration(scene.voiceoverText);
    let captionSegments = buildFallbackSegments(scene.voiceoverText, durationSeconds);
    if (edgeTts) {
      try {
        const audio = await generateSceneVoiceover(n, scene.voiceoverText, assetDir, DEFAULT_VOICE_CONFIG, edgeTts);
        if (audio.path) {
          audioPath = `${publicRelDir}/${path.basename(audio.path)}`;
          durationSeconds = audio.duration;
          captionSegments =
            audio.captionSegments && audio.captionSegments.length > 0
              ? groupCaptionSegments(audio.captionSegments)
              : buildFallbackSegments(scene.voiceoverText, durationSeconds);
          console.log(`[prepare]   voice: ${audio.duration}s, ${captionSegments.length} caption cues`);
        }
      } catch (e) {
        console.log(`[prepare]   voice FAILED: ${(e as Error).message} — silent track`);
      }
    }
    if (!audioPath) {
      const silent = makeSilentTrack(assetDir, n, durationSeconds);
      audioPath = `${publicRelDir}/${path.basename(silent.path)}`;
      durationSeconds = silent.duration;
      captionSegments = buildFallbackSegments(scene.voiceoverText, durationSeconds);
    }

    totalSeconds += durationSeconds;
    scenes.push({
      voiceoverText: scene.voiceoverText,
      visualKeywords: scene.visualKeywords,
      durationSeconds,
      visual,
      audioPath,
      captionSegments,
    });
  }

  const enriched: NarratedStoryboard = {
    version: 1,
    narrated: true,
    hook: input.hook,
    project: input.project,
    subtitle: input.subtitle,
    lengthSeconds: totalSeconds,
    scenes,
    notes: [...(input.notes || []), `prepared on iMac: ${scenes.length} scenes, ${totalSeconds}s total`],
  };

  const outDir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2) + "\n");

  // Global caption sidecars next to the output storyboard (the watcher
  // pulls them back to the VM alongside the MP4 for the Critic).
  const sidecars = writeCaptionSidecars(
    outDir,
    scenes.map((s) => ({ text: s.voiceoverText, durationSeconds: s.durationSeconds, segments: s.captionSegments })),
    path.basename(outputPath).replace(/\.json$/i, ""),
  );
  console.log(`[prepare] wrote ${outputPath} (${totalSeconds}s, ${scenes.length} scenes)`);
  for (const s of sidecars) console.log(`[prepare] sidecar: ${s}`);
}

main().catch((e) => {
  console.error(`[prepare] FATAL: ${(e as Error).message}`);
  process.exit(1);
});
