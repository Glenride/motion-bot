#!/usr/bin/env python3
"""Motion Bot Narrated mode — VM-side Pixabay stock fetch.

The Pixabay API key lives ONLY in authd on this VM (registered
connector custom.pixabay) — it cannot be read back and cannot be
copied to the iMac, so Pixabay fetching runs HERE, not on the
render host. This script enriches a narrated storyboard with
pre-downloaded Pixabay visuals, which the watcher ships to the
iMac with the storyboard; prepare.ts on the iMac uses them as-is
and falls back to the free ladder (Wikimedia / Internet Archive /
Openverse) only for scenes with no prefetched visual.

Usage:
  python3 watcher/narrated_stock.py <in-storyboard.json>
      <out-storyboard.json> <staging-dir> <job>

  <job> is the slug the iMac uses for the asset dir
  (public/narrated/<job>/); the watcher passes the task slug.

For each scene, in order:
  1. Pixabay videos: EVERY query (joined keywords, then each
     keyword alone) is searched; the best 2 hits per query are kept
     and downloads are tried in global tag-overlap score order, so
     one oversize or dead file does not abandon a good query. A
     downloaded video longer than the scene needs is trimmed +
     downscaled to 1280w on the VM before shipping.
  2. Pixabay images, same query order and scoring.
  3. Nothing found: the scene keeps no prefetchedVisual — the
     iMac free ladder covers it.

Relevance is scored by tag overlap with the scene's keywords
(score_hit): the API's own ranking is popularity-ish and the
first hit for a keyword soup is often unrelated (a book on a
beach for "glenride studies supply chains", a lipstick close-up
for "work make chain visible" — both observed 2026-10-26 before
scoring was added).

v2.1 semantics (concepts.py): queries are phrase-first — each
concept visual ("freight truck") is its own query before any
joined/single-word query — and scoring adds a concept-match bonus
on top of tag overlap. A hit matching ONLY a fragment word of a
mapped concept ("chain" for "supply chain") is rejected outright:
a wrong literal is worse than the free ladder, and the chainsaw
clip from the v2 proof is exactly that failure.

Downloads cap at 60MB with a 30s stall guard; video duration is
probed with ffprobe. The output storyboard is written only on
success; on any fatal error this script exits non-zero WITHOUT
touching the output, so the caller can proceed with the original
storyboard (free ladder on the iMac). Partial success (some scenes
prefetched, some not) still exits 0.

Prints a JSON summary to stdout. Never prints the key — the
helper carries it as a surrogate and never shows it.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from concepts import (  # noqa: E402
    find_concepts,
    referenced_hook_concept,
    score_hit_semantic,
)

PIXABAY_SEARCH = Path(os.path.expanduser(
    "~/workspace/custom-connectors/custom.pixabay/bin/pixabay_search.py"))
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
STALL_TIMEOUT_SECS = 30
MIN_VIDEO_WIDTH = 640
MAX_RENDER_WIDTH = 1280  # the render is 1280x720; 4K sources are dead weight
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")


def log(msg):
    print(f"[narrated-stock] {msg}", file=sys.stderr)


def search_pixabay(media_type, query, per_page=3):
    """One helper call. Returns the parsed JSON (totalHits + hits)."""
    r = subprocess.run(
        [sys.executable, str(PIXABAY_SEARCH), "--type", media_type,
         query, "--per-page", str(per_page)],
        capture_output=True, text=True, timeout=90,
    )
    if r.returncode != 0:
        raise RuntimeError(
            f"pixabay_search.py failed (exit {r.returncode}): "
            f"{(r.stderr or r.stdout or '').strip()[-300:]}")
    return json.loads(r.stdout)


def score_hit(hit, query_words):
    """Relevance score: how many of the scene's keywords appear in
    the hit's Pixabay tags. The API's own ranking is popularity-ish
    and the first hit for a 4-word keyword soup is often unrelated
    (a book on a beach for "glenride studies supply chains", a
    lipstick close-up for "work make chain visible" — both observed
    2026-10-26). Scoring by tag overlap picks the hit that is
    actually about the scene. Substring matches count when both
    sides are >= 4 chars (so "chain" matches "supply-chain" but
    "a" matches nothing)."""
    tags = (hit.get("tags") or "").lower()
    tag_words = set(re.split(r"[^a-z0-9]+", tags))
    score = 0
    for w in query_words:
        w = (w or "").lower().strip()
        if len(w) < 3:
            continue
        if w in tag_words:
            score += 2
            continue
        if len(w) >= 4 and any(len(t) >= 4 and (w in t or t in w)
                               for t in tag_words):
            score += 1
    return score


def download(url, dest_path):
    """Stream a URL to disk with a stall guard + size cap."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        if total > MAX_DOWNLOAD_BYTES:
            raise RuntimeError(f"download too large ({total} bytes): {url}")
        written = 0
        last_chunk = time.time()
        with open(dest_path, "wb") as f:
            while True:
                if time.time() - last_chunk > STALL_TIMEOUT_SECS:
                    raise RuntimeError(
                        f"download stalled after {STALL_TIMEOUT_SECS}s: {url}")
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                last_chunk = time.time()
                written += len(chunk)
                if written > MAX_DOWNLOAD_BYTES:
                    raise RuntimeError(
                        f"download exceeded {MAX_DOWNLOAD_BYTES} bytes: {url}")
                f.write(chunk)
    if written < 1000:
        raise RuntimeError(f"download too small ({written} bytes): {url}")
    return written


def probe_duration(path):
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries",
             "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        if r.returncode == 0:
            d = float((r.stdout or "").strip())
            if d > 0:
                return d
    except (ValueError, OSError):
        pass
    return 0


def ext_from_url(url, fallback):
    clean = url.split("?")[0].split("#")[0]
    m = re.search(r"\.([a-z0-9]{2,5})$", clean, re.I)
    if m:
        ext = m.group(1).lower()
        if ext in ("mp4", "webm", "mov", "jpg", "jpeg", "png", "webp"):
            return "." + ("jpg" if ext == "jpeg" else ext)
    return fallback


def estimate_scene_seconds(text):
    """Rough voiceover length: ~2.2 words/sec + 1.5s. prepare.ts
    replaces this with the real Edge-TTS duration; the estimate only
    sizes the VM-side trim."""
    words = len((text or "").split())
    return max(3, int(words / 2.2) + 2)


def trim_video(path, keep_seconds):
    """Trim a long source clip to the seconds a scene needs (+2s) and
    downscale to render width (1280 max), no audio (the render mutes
    stock video). A 19s 4K clip becomes ~10s of 720p — the rsync and
    the iMac render both get far cheaper. Returns (path, duration)
    of the trimmed file, or None when trimming fails (caller keeps
    the original)."""
    trimmed = path.with_name(path.stem + "_trim.mp4")
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", "0", "-i", str(path),
             "-t", str(max(3, int(keep_seconds))),
             "-vf", f"scale='min({MAX_RENDER_WIDTH},iw)':-2",
             "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
             "-an", "-movflags", "+faststart", str(trimmed)],
            capture_output=True, text=True, timeout=180,
        )
        if r.returncode != 0 or not trimmed.exists():
            return None
        if trimmed.stat().st_size < 1000:
            trimmed.unlink()
            return None
        path.unlink()
        return trimmed, probe_duration(trimmed) or keep_seconds
    except OSError:
        return None


def fetch_scene(scene, n, staging_dir, job, hook_concepts=None, used=None):
    """Pixabay for one scene. Returns (prefetchedVisual, detail) or
    (None, None).

    `used` is a set of hit ids already picked for earlier scenes
    — a scene never reuses another scene's clip (the v2.1 proof's
    scenes 1 and 3 both picked the same container terminal video;
    identical footage twice reads as a loop, not a story). Ids
    alone (not media-type pairs) are enough: skipping one
    same-id candidate in the other media type is harmless.

    Video phase first, images second. Within a phase EVERY query
    is searched and the best 2 hits per query are kept; downloads
    are tried in global semantic-score order, so one oversize or
    dead file does not abandon a good query. Queries are
    phrase-first: each concept visual ("freight truck") is its own
    query, then the joined single words, then each single word
    alone. A downloaded video longer than the scene needs is
    trimmed + downscaled on the VM before shipping."""
    keywords = scene.get("visualKeywords") or []
    voice_text = scene.get("voiceoverText") or ""
    # Concepts recomputed from the voiceover text (source of truth),
    # so LLM-built storyboards get the same correction as
    # deterministic ones even if they carry no concepts field. A
    # scene with no concept of its own also inherits the hook-level
    # concept its bare word refers back to ("chain" in scene 3 of
    # the Glenride hook -> "supply chains").
    concepts = find_concepts(voice_text)
    if hook_concepts:
        ref = referenced_hook_concept(voice_text, hook_concepts)
        if ref and ref[0] not in [p for p, _ in concepts]:
            concepts.append(ref)
        if not keywords and ref:
            keywords = list(ref[1])
    queries = []
    # EVERY keyword is its own query first — including multi-word
    # phrases. The v2.1 LLM keywords are phrases ("idle semi truck
    # at distribution yard"), and an earlier version of this loop
    # only queued concept visuals + single words, so a scene whose
    # keywords were all phrases searched nothing but "landscape".
    for kw in keywords:
        if kw and kw not in queries:
            queries.append(kw)
    # Concept visuals for stale briefs whose keywords predate them.
    for _phrase, visuals in concepts:
        for visual in visuals:
            if visual not in queries:
                queries.append(visual)
    single_words = [k for k in keywords if k and " " not in k]
    joined = " ".join(single_words).strip()
    if joined and joined not in queries:
        queries.append(joined)
    for k in single_words:
        if k not in queries:
            queries.append(k)
    if not queries:
        queries = ["landscape"]

    keep_seconds = estimate_scene_seconds(voice_text) + 5
    fragment_skipped = 0

    for media_type in ("videos", "images"):
        # Gather candidates across all queries, best 2 per query.
        candidates = []  # (score, query, totalHits, hit)
        for q in queries:
            try:
                result = search_pixabay(media_type, q, per_page=5)
            except Exception as e:
                log(f"scene {n}: pixabay {media_type} search '{q}' failed: {e}")
                continue
            scored = []
            for h in result.get("hits") or []:
                if not h.get("url"):
                    continue
                if used and h.get("id") in used:
                    continue
                if media_type == "videos" and (h.get("width") or 0) < MIN_VIDEO_WIDTH:
                    continue
                s, fragment = score_hit_semantic(h, keywords, concepts)
                if fragment:
                    # Misleading literal ("chain" for "supply
                    # chain"): never downloaded, even if nothing
                    # better exists — the free ladder beats it.
                    fragment_skipped += 1
                    continue
                scored.append((s, h))
            scored.sort(key=lambda item: item[0], reverse=True)
            for s, h in scored[:2]:
                candidates.append((s, q, result.get("totalHits"), h))
        candidates.sort(key=lambda item: item[0], reverse=True)

        for score, q, total_hits, hit in candidates:
            ext = ext_from_url(
                hit["url"], ".mp4" if media_type == "videos" else ".jpg")
            file_name = f"scene_{n}{ext}"
            dest = staging_dir / file_name
            try:
                size = download(hit["url"], dest)
            except Exception as e:
                log(f"scene {n}: download failed ({hit['url'][:60]}): {e}")
                if dest.exists():
                    dest.unlink()
                continue
            duration = 0
            final_name = file_name
            if media_type == "videos":
                duration = probe_duration(dest) or (hit.get("duration") or 0)
                if duration > keep_seconds:
                    trimmed = trim_video(dest, keep_seconds + 2)
                    if trimmed:
                        dest, duration = trimmed
                        final_name = dest.name
                        size = dest.stat().st_size
                        log(f"scene {n}: trimmed video to ~{int(duration)}s "
                            f"({size} bytes)")
            return {
                "type": "video" if media_type == "videos" else "image",
                "localPath": f"narrated/{job}/{final_name}",
                "width": hit.get("width") or 0,
                "height": hit.get("height") or 0,
                "videoDuration": duration,
                "source": "pixabay",
                "query": q,
            }, {"query": q, "totalHits": total_hits,
                "hitId": hit.get("id"), "bytes": size,
                "score": score,
                "fragmentSkipped": fragment_skipped,
                "tags": hit.get("tags")}
    return None, None


def main(argv):
    if len(argv) != 5:
        print(__doc__)
        return 2
    in_path, out_path, staging_dir, job = argv[1:5]
    staging_dir = Path(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)

    storyboard = json.loads(Path(in_path).read_text())
    scenes = storyboard.get("scenes") or []
    hook_concepts = find_concepts(storyboard.get("hook") or "")
    used = set()
    summary = {"job": job, "scenes": []}

    for i, scene in enumerate(scenes):
        n = i + 1
        entry = {"scene": n, "prefetched": False}
        summary["scenes"].append(entry)
        try:
            visual, detail = fetch_scene(scene, n, staging_dir, job,
                                         hook_concepts, used)
        except Exception as e:
            log(f"scene {n}: unexpected error: {e}")
            continue
        if visual:
            used.add((detail or {}).get("hitId"))
            scene["prefetchedVisual"] = visual
            entry["prefetched"] = True
            entry.update({k: v for k, v in (detail or {}).items()
                          if k in ("query", "totalHits", "hitId", "bytes",
                                   "score", "fragmentSkipped")})
            entry["source"] = "pixabay"
            entry["type"] = visual["type"]
            log(f"scene {n}: pixabay {visual['type']} "
                f"(query '{detail['query']}', {detail['totalHits']} hits, "
                f"id {detail['hitId']}, score {detail['score']}, "
                f"{detail['bytes']} bytes; tags: {(detail.get('tags') or '')[:120]})")
        else:
            log(f"scene {n}: no pixabay hit — iMac free ladder will cover it")

    tmp_path = Path(str(out_path) + ".tmp")
    tmp_path.write_text(json.dumps(storyboard, indent=2) + "\n")
    tmp_path.replace(out_path)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
