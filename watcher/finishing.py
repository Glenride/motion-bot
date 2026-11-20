#!/usr/bin/env python3
"""Motion Bot — ffmpeg finishing pass (v2.9, pack 8: ffmpeg-finishing).

Runs AFTER a render, on the iMac only (the skill's hard limit: the
VM ffmpeg OOMs on multi-input concats; this pass is single-input,
but the rule stands — finishing lives where the render lives).
One command, one verified output, never overwrites the source.

Steps, in the skill's chain order (colour -> cut -> join -> silence
-> fit -> caption/overlay -> sync -> audio -> loudness -> export —
only the steps that apply to a finished Motion Bot render run):
  1. probe the source (ffprobe JSON — plan from real numbers).
  2. fit (only with --preset): reframe to the platform delivery
     dims (reels/shorts pad to 1080x1920; youtube/x/linkedin/
     facebook keep 1280x720). No preset = dims unchanged.
  3. fade in/out, video (tfade) + audio (afade) when an audio
     track exists. Default 0.5s. --no-fade skips it.
  4. loudness to -14 LUFS (single-pass loudnorm, video copied).
     Skipped with a note when the clip has no audio track —
     Motion Bot renders usually have none, and a loudness step
     on silence would be faked, not measured.
  5. thumbnail: one frame grab at the clip midpoint.
  6. verify: probe the output (duration within 0.15s of source,
     dims as expected, fps unchanged), measure loudness when audio
     exists. Exit 0 + the requested numbers, or it failed.

Hard limits (from skills/ffmpeg-finishing/SKILL.md):
  - Never touches the alpha ProRes lower-third mux or the
    slideshow concat: inputs with an alpha channel are refused.
  - Never overwrites the source: --out must differ; the default
    output is <stem>-finished.mp4 next to the input.
  - Caption wording comes only from the brief or an existing SRT —
    this pass never writes captions; burn-in is ffmpeg_tools.py
    `burn-subs`, a separate labeled step.
  - The narrated voiceover level is NOT changed by this pass
    unless a brief explicitly requests the loudness step — the
    pass runs only when a brief carries `Finish:` (watcher) or a
    human runs it by hand (or render.sh ... finish).

Usage:
  python3 watcher/finishing.py <mp4> [--preset reels|youtube|...]
      [--fade 0.5 | --no-fade] [--loudness -14] [--thumbnail]
      [--out finished.mp4] [--json] [--dry-run]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ffmpeg_tools import (  # noqa: E402
    EXPORT_PRESETS, ToolError, check_out, loudnorm_filter, measure_loudness,
    probe, run, scale_filter, has_alpha,
)


def finish(inp, out=None, preset=None, fade=0.5, target_lufs=-14.0,
           thumbnail=True, dry_run=False):
    info = probe(inp)
    if has_alpha(info):
        raise ToolError(
            f"{inp} carries an alpha channel — the ProRes lower-third "
            "mux path is never finished over; refusing")
    if out is None:
        p = Path(inp)
        out = str(p.with_name(p.stem + "-finished" + p.suffix))
    check_out(inp, out)
    steps = []
    skipped = []

    # Build one ffmpeg command: fit -> fade -> loudness, video
    # re-encoded only when a filter touches it.
    vf = []
    if preset:
        spec = EXPORT_PRESETS[preset]
        if spec.get("width") and spec.get("height"):
            vf.append(scale_filter(spec["width"], spec["height"],
                                   spec.get("fit", "pad")))
        steps.append(f"fit preset {preset}: "
                     f"{spec.get('width')}x{spec.get('height')}")
    if fade and fade > 0:
        dur = info["duration_s"]
        vf.append(f"fade=t=in:st=0:d={fade},"
                  f"fade=t=out:st={dur - fade}:d={fade}")
        steps.append(f"video fade in/out {fade}s")
    af = []
    if fade and fade > 0 and info["has_audio"]:
        dur = info["duration_s"]
        af.append(f"afade=t=in:st=0:d={fade},"
                  f"afade=t=out:st={dur - fade}:d={fade}")
        steps.append(f"audio fade in/out {fade}s")
    if info["has_audio"]:
        af.append(loudnorm_filter(target_lufs))
        steps.append(f"loudness to {target_lufs} LUFS (single-pass loudnorm)")
    else:
        skipped.append("loudness — no audio track, nothing to normalise")
        if fade and fade > 0:
            skipped.append("audio fade — no audio track")
    if not fade:
        skipped.append("fade — --no-fade")

    # One ffmpeg command: fit -> fade -> loudness. Video re-encodes
    # only when a video filter touches it; audio re-encodes only
    # when an audio filter touches it; otherwise streams copy.
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(inp)]
    if vf:
        cmd += ["-vf", ",".join(vf)]
    if af:
        cmd += ["-af", ",".join(af)]
    if vf:
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18",
                "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-c:v", "copy"]
    if af:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    elif info["has_audio"]:
        cmd += ["-c:a", "copy"]
    cmd += ["-movflags", "+faststart", out]

    thumb_path = None
    if thumbnail:
        thumb_path = str(Path(out).with_suffix(".jpg"))
        steps.append(f"thumbnail at midpoint -> {thumb_path}")

    if dry_run:
        return {"summary": "dry-run: " + " ".join(cmd), "command": cmd,
                "steps": steps, "skipped": skipped,
                "before": info, "output": out,
                "thumbnail": thumb_path}

    loud_before = (measure_loudness(inp) if info["has_audio"] else None)
    run(cmd)
    after = probe(out)
    if abs(after["duration_s"] - info["duration_s"]) > 0.15:
        raise ToolError(
            f"verify failed: duration drifted {info['duration_s']}s -> "
            f"{after['duration_s']}s")
    if preset:
        spec = EXPORT_PRESETS[preset]
        if (after["width"], after["height"]) != (spec["width"],
                                                 spec["height"]):
            raise ToolError(
                f"verify failed: preset {preset} expected "
                f"{spec['width']}x{spec['height']}, got "
                f"{after['width']}x{after['height']}")
    elif (after["width"], after["height"]) != (info["width"],
                                               info["height"]):
        raise ToolError("verify failed: dimensions changed without a preset")
    loud_after = (measure_loudness(out) if info["has_audio"] else None)
    if thumbnail:
        run(["ffmpeg", "-y", "-v", "error", "-ss",
             str(after["duration_s"] / 2), "-i", out,
             "-frames:v", "1", "-q:v", "3", thumb_path])
    summary = (f"finished {inp} -> {out}: "
               + "; ".join(steps)
               + (f" | skipped: {'; '.join(skipped)}" if skipped else "")
               + f" | {after['width']}x{after['height']}, "
               f"{after['duration_s']}s"
               + (f", {loud_before} -> {loud_after} LUFS"
                  if loud_after is not None else ""))
    return {"summary": summary, "steps": steps, "skipped": skipped,
            "before": info, "after": after, "output": out,
            "thumbnail": thumb_path,
            "loudness_before_lufs": loud_before,
            "loudness_after_lufs": loud_after,
            "target_lufs": target_lufs}


def main(argv=None):
    p = argparse.ArgumentParser(description="Motion Bot finishing pass")
    p.add_argument("input")
    p.add_argument("--out")
    p.add_argument("--preset", choices=sorted(EXPORT_PRESETS))
    p.add_argument("--fade", type=float, default=0.5)
    p.add_argument("--no-fade", action="store_true")
    p.add_argument("--loudness", type=float, default=-14.0)
    p.add_argument("--no-thumbnail", action="store_true")
    p.add_argument("--json", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    try:
        result = finish(
            args.input, out=args.out, preset=args.preset,
            fade=0.0 if args.no_fade else args.fade,
            target_lufs=args.loudness,
            thumbnail=not args.no_thumbnail, dry_run=args.dry_run)
    except ToolError as e:
        result = {"summary": f"Failed: {e}", "error": str(e)}
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(result["summary"])
        return 1
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(result["summary"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
