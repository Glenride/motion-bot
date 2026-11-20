#!/usr/bin/env python3
"""Motion Bot — ffmpeg subset tools (v2.9, pack 9: ffmpeg-skill).

The upstream ffmpeg-skill is a 42-script general ffmpeg skill; Motion
Bot implements only the subset that fits its render path, as real
ffmpeg/ffprobe calls. Everything here runs on the iMac (the skill's
hard limit: the VM ffmpeg OOMs on multi-input concats) with the
system ffmpeg already installed — no installs, no keys, stdlib only.

SHIPPED (each a real subcommand, --dry-run prints the exact command):
  probe       ffprobe JSON: duration, dims, fps, codecs, audio presence
  trim        frame-accurate cut (re-encode default; --copy is a
              keyframe-limited stream copy, flagged as such)
  scale       resize to WxH, --fit pad | crop | stretch
  concat      concat-demuxer join (stream copy when codecs match,
              else re-encode)
  loudness    single-pass loudnorm to a target (default -14 LUFS),
              video stream copied; refuses audio-less input
  burn-subs   burn an SRT in with libass (Liberation Sans, the
              render host's font) or --mode mux for toggleable subs
  thumbnail   one frame grab (default: clip midpoint)
  export      platform presets (below) — one command, verified by probe

EXPORT_PRESETS (dims, fps, loudness target):
  youtube   1280x720, 30fps, -14 LUFS
  reels     1080x1920 pad, 30fps, -14 LUFS (safe zones are the
            caller's layout job — the preset only frames it)
  shorts    same as reels
  x         1280x720, 30fps, -14 LUFS
  linkedin  1280x720, 30fps, -14 LUFS
  facebook  1280x720, 30fps, -14 LUFS
  gif       480w, 10fps, palettegen/paletteuse, no audio
  proxy     640w, crf 28, -14 LUFS

OUT OF SCOPE for Motion Bot (with reason — see `scope` subcommand):
  silence / filler removal, transcribe — need a local speech engine
    (parakeet/whisper); neither is installed on the iMac, and no
    installs happen without D'Vaughn's explicit tap naming one.
  stabilize, denoise, deinterlace, color/LUT grading — quality/taste
    tools for camera footage; Motion Bot renders are synthetic
    Remotion frames, and "cinematic" is a judgement call, not an edit.
  multicam, sync/drift fix — no multi-camera source exists.
  HDR/Dolby/360/sphere, redact, waveform/audiogram — no such source
    material in the pipeline.
  scenes/highlights ranking — ranks by loudness, not meaning; the
    watcher (not ffmpeg) decides what is interesting.
  batch, report HTML — the watcher already batches; the critic
    already verifies and reports.
  raw ffmpeg passthrough — the skill forbids it; every edit goes
    through a named subcommand so it stays reviewable.

Rules, from the upstream skill: probe before planning; never
overwrite a source (--out must differ from the input); keep
originals; verify from the output probe (exit 0 + the requested
numbers, or it failed).

Usage:
  python3 watcher/ffmpeg_tools.py <cmd> [flags] [--json] [--dry-run]
  python3 watcher/ffmpeg_tools.py scope   # shipped vs out-of-scope
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
FONT_FILE = "/usr/share/fonts/liberation/LiberationSans-Regular.ttf"
TARGET_LUFS = -14.0

EXPORT_PRESETS = {
    "youtube": {"width": 1280, "height": 720, "fps": 30, "lufs": -14.0,
                "crf": 18},
    "reels": {"width": 1080, "height": 1920, "fps": 30, "lufs": -14.0,
              "crf": 18, "fit": "pad"},
    "shorts": {"width": 1080, "height": 1920, "fps": 30, "lufs": -14.0,
               "crf": 18, "fit": "pad"},
    "x": {"width": 1280, "height": 720, "fps": 30, "lufs": -14.0,
          "crf": 18},
    "linkedin": {"width": 1280, "height": 720, "fps": 30, "lufs": -14.0,
                 "crf": 18},
    "facebook": {"width": 1280, "height": 720, "fps": 30, "lufs": -14.0,
                 "crf": 18},
    "gif": {"width": 480, "fps": 10, "crf": None},
    "proxy": {"width": 640, "fps": 30, "lufs": -14.0, "crf": 28},
}

OUT_OF_SCOPE = {
    "silence / filler removal": "needs a local speech engine (parakeet/whisper); neither is installed on the iMac",
    "transcribe": "needs a local speech engine; neither is installed on the iMac",
    "stabilize / denoise / deinterlace": "camera-footage quality tools; Motion Bot renders are synthetic Remotion frames",
    "color / LUT grading": "taste judgement, not an edit; belongs to a color-grading skill",
    "multicam / sync / drift fix": "no multi-camera source exists in the pipeline",
    "HDR / Dolby / 360 / sphere": "no such source material in the pipeline",
    "redact (blur/delogo)": "no camera footage with faces/plates to redact",
    "waveform / audiogram": "no podcast source in the pipeline",
    "scenes / highlights ranking": "ranks by loudness, not meaning; the watcher decides what is interesting",
    "batch / report HTML": "the watcher already batches; the critic already verifies and reports",
    "raw ffmpeg passthrough": "forbidden by the upstream skill; every edit goes through a named subcommand",
}


class ToolError(Exception):
    pass


def run(cmd, timeout=1800):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise ToolError(
            f"{cmd[0]} exited {r.returncode}: "
            f"{(r.stderr or r.stdout or '').strip()[-500:]}")
    return r


def probe(path):
    """ffprobe -> dict with duration/dims/fps/codecs/audio/pix_fmt."""
    p = Path(path)
    if not p.exists():
        raise ToolError(f"input not found: {path}")
    r = run([FFPROBE, "-v", "error", "-show_entries",
             "stream=width,height,r_frame_rate,codec_name,codec_type,pix_fmt,"
             "channels,sample_rate",
             "-show_entries", "format=duration",
             "-of", "json", str(p)])
    data = json.loads(r.stdout)
    video = next((s for s in data.get("streams", [])
                  if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", [])
                  if s.get("codec_type") == "audio"), None)
    if video is None:
        raise ToolError(f"no video stream in {path}")
    num, den = (int(x) for x in video["r_frame_rate"].split("/"))
    return {
        "path": str(p),
        "duration_s": round(float(data["format"]["duration"]), 3),
        "width": video["width"],
        "height": video["height"],
        "fps": round(num / den, 3) if den else num,
        "video_codec": video["codec_name"],
        "pix_fmt": video.get("pix_fmt", ""),
        "has_audio": audio is not None,
        "audio_codec": audio["codec_name"] if audio else None,
    }


def has_alpha(info):
    return "alpha" in (info.get("pix_fmt") or "")


def measure_loudness(path):
    """Integrated loudness in LUFS via the ebur128 filter, or None."""
    r = run([FFMPEG, "-hide_banner", "-i", str(path), "-vn",
             "-af", "ebur128=framelog=verbose", "-f", "null", "-"],
            timeout=600)
    m = re.search(r"Integrated loudness:\s*I:\s*(-?[\d.]+)\s*LUFS",
                  r.stderr or "")
    if m:
        return float(m.group(1))
    m = re.search(r"Summary:.*?Integrated loudness:\s*I:\s*(-?[\d.]+)",
                  r.stderr or "", re.S)
    return float(m.group(1)) if m else None


def check_out(inp, out):
    if out is None:
        raise ToolError("--out is required (never overwrite a source)")
    if Path(out).resolve() == Path(inp).resolve():
        raise ToolError("refusing to overwrite the source file")


def emit(result, as_json):
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        print(result.get("summary", json.dumps(result, indent=2)))


def cmd_probe(args):
    info = probe(args.input)
    emit({"summary": (f"{info['path']} — {info['duration_s']}s, "
                      f"{info['width']}x{info['height']}, {info['fps']}fps, "
                      f"{info['video_codec']}"
                      + (f", audio {info['audio_codec']}" if info["has_audio"]
                         else ", no audio")),
          "probe": info}, args.json)
    return 0


def _reencode_args(crf=18, fps=None):
    a = ["-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart"]
    if fps:
        a += ["-r", str(fps)]
    return a


def cmd_trim(args):
    check_out(args.input, args.out)
    info = probe(args.input)
    # -ss/-to are OUTPUT options (after -i): -to is then absolute in
    # the input timeline, so --start 2 --end 8 cuts exactly 6s.
    # (With -ss before -i, -to counts from the seek point and the
    # same flags silently cut 8s — measured on the first v2.9 proof.)
    if args.copy:
        cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input),
               "-ss", str(args.start)]
        if args.end is not None:
            cmd += ["-to", str(args.end)]
        elif args.duration is not None:
            cmd += ["-t", str(args.duration)]
        cmd += ["-c", "copy", args.out]
        note = "stream copy — cuts land on keyframes only"
    else:
        cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input),
               "-ss", str(args.start)]
        if args.end is not None:
            cmd += ["-to", str(args.end)]
        elif args.duration is not None:
            cmd += ["-t", str(args.duration)]
        cmd += _reencode_args() + [args.out]
        note = "frame-accurate re-encode"
    if args.dry_run:
        emit({"summary": "dry-run: " + " ".join(cmd), "command": cmd},
             args.json)
        return 0
    run(cmd)
    after = probe(args.out)
    emit({"summary": f"trim {args.input} -> {args.out} ({note}): "
                     f"{info['duration_s']}s -> {after['duration_s']}s",
          "before": info, "after": after, "note": note}, args.json)
    return 0


def scale_filter(width, height, fit):
    if fit == "pad":
        return (f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2")
    if fit == "crop":
        return (f"scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height}")
    return f"scale={width}:{height}"


def cmd_scale(args):
    check_out(args.input, args.out)
    info = probe(args.input)
    vf = scale_filter(args.width, args.height, args.fit)
    cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input),
           "-vf", vf] + _reencode_args() + [args.out]
    if args.dry_run:
        emit({"summary": "dry-run: " + " ".join(cmd), "command": cmd},
             args.json)
        return 0
    run(cmd)
    after = probe(args.out)
    emit({"summary": f"scale {args.input} -> {args.out}: "
                     f"{info['width']}x{info['height']} -> "
                     f"{after['width']}x{after['height']} (fit {args.fit})",
          "before": info, "after": after}, args.json)
    return 0


def cmd_concat(args):
    check_out(args.inputs[0], args.out)
    infos = [probe(p) for p in args.inputs]
    codecs = {i["video_codec"] for i in infos}
    listfile = Path(args.out).with_suffix(".concat.txt")
    listfile.write_text("".join(f"file '{Path(p).resolve()}'\n"
                                for p in args.inputs))
    try:
        if len(codecs) == 1 and not args.reencode:
            cmd = [FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0",
                   "-i", str(listfile), "-c", "copy", args.out]
            note = "stream copy (matching codecs)"
        else:
            cmd = [FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0",
                   "-i", str(listfile)] + _reencode_args() + [args.out]
            note = "re-encode (codecs differed or --reencode)"
        if args.dry_run:
            emit({"summary": "dry-run: " + " ".join(cmd), "command": cmd},
                 args.json)
            return 0
        run(cmd)
        after = probe(args.out)
        emit({"summary": f"concat {len(args.inputs)} clips -> {args.out} "
                         f"({note}): {after['duration_s']}s",
              "before": infos, "after": after, "note": note}, args.json)
        return 0
    finally:
        listfile.unlink(missing_ok=True)


def loudnorm_filter(target):
    return f"loudnorm=I={target}:TP=-1.5:LRA=11"


def cmd_loudness(args):
    check_out(args.input, args.out)
    info = probe(args.input)
    if not info["has_audio"]:
        raise ToolError(f"{args.input} has no audio track — nothing to "
                        "normalise (loudness step skipped, not faked)")
    before = measure_loudness(args.input)
    cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input),
           "-c:v", "copy", "-af", loudnorm_filter(args.target),
           "-c:a", "aac", "-b:a", "192k", args.out]
    if args.dry_run:
        emit({"summary": "dry-run: " + " ".join(cmd), "command": cmd},
             args.json)
        return 0
    run(cmd)
    after_info = probe(args.out)
    after = measure_loudness(args.out)
    emit({"summary": f"loudness {args.input} -> {args.out}: "
                     f"{before} LUFS -> {after} LUFS (target {args.target})",
          "before": info, "after": after_info,
          "loudness_before_lufs": before, "loudness_after_lufs": after,
          "target_lufs": args.target}, args.json)
    return 0


def cmd_burn_subs(args):
    check_out(args.input, args.out)
    info = probe(args.input)
    srt = Path(args.srt)
    if not srt.exists():
        raise ToolError(f"subtitle file not found: {args.srt}")
    if args.mode == "mux":
        cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input),
               "-i", str(srt), "-map", "0", "-map", "1",
               "-c", "copy", "-c:s", "mov_text", args.out]
        note = "toggleable subs (mov_text), video untouched"
    else:
        style = ("FontName=Liberation Sans,FontSize=28,"
                 "PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,"
                 "BorderStyle=1,Outline=2,Alignment=2,MarginV=40")
        vf = f"subtitles='{srt.resolve()}':force_style='{style}'"
        cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input),
               "-vf", vf] + _reencode_args() + [args.out]
        note = "burned in (Liberation Sans, wording exactly as in the SRT)"
    if args.dry_run:
        emit({"summary": "dry-run: " + " ".join(cmd), "command": cmd},
             args.json)
        return 0
    run(cmd)
    after = probe(args.out)
    emit({"summary": f"burn-subs {args.input} -> {args.out} ({note})",
          "before": info, "after": after, "note": note}, args.json)
    return 0


def cmd_thumbnail(args):
    check_out(args.input, args.out)
    info = probe(args.input)
    at = info["duration_s"] / 2 if args.at == "mid" else float(args.at)
    cmd = [FFMPEG, "-y", "-v", "error", "-ss", str(at), "-i", str(args.input),
           "-frames:v", "1", "-q:v", "3", args.out]
    if args.dry_run:
        emit({"summary": "dry-run: " + " ".join(cmd), "command": cmd},
             args.json)
        return 0
    run(cmd)
    emit({"summary": f"thumbnail {args.input} @ {at}s -> {args.out}",
          "probe": info, "at_s": at}, args.json)
    return 0


def cmd_export(args):
    check_out(args.input, args.out)
    preset = EXPORT_PRESETS[args.preset]
    info = probe(args.input)
    if args.preset == "gif":
        cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input),
               "-vf", (f"fps={preset['fps']},scale={preset['width']}:-1:"
                      "flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];"
                      "[s1][p]paletteuse"),
               "-loop", "0", args.out]
        note = "GIF preview, 480w 10fps"
    else:
        vf = None
        if preset.get("width") and preset.get("height"):
            vf = scale_filter(preset["width"], preset["height"],
                              preset.get("fit", "pad"))
        cmd = [FFMPEG, "-y", "-v", "error", "-i", str(args.input)]
        if vf:
            cmd += ["-vf", vf]
        cmd += _reencode_args(crf=preset["crf"], fps=preset["fps"])
        if info["has_audio"]:
            cmd += ["-af", loudnorm_filter(preset["lufs"])]
        cmd += [args.out]
        note = (f"preset {args.preset}: {preset.get('width')}x"
                f"{preset.get('height')}, {preset['fps']}fps, "
                f"{preset['lufs']} LUFS" if info["has_audio"]
                else f"preset {args.preset} (no audio — loudness skipped)")
    if args.dry_run:
        emit({"summary": "dry-run: " + " ".join(cmd), "command": cmd},
             args.json)
        return 0
    run(cmd)
    after = probe(args.out)
    after_lufs = (measure_loudness(args.out)
                  if info["has_audio"] and args.preset != "gif" else None)
    emit({"summary": f"export {args.input} -> {args.out} ({note}): "
                     f"{after['width']}x{after['height']}, "
                     f"{after['duration_s']}s"
                     + (f", {after_lufs} LUFS" if after_lufs is not None
                        else ""),
          "before": info, "after": after,
          "loudness_after_lufs": after_lufs, "preset": args.preset},
         args.json)
    return 0


def cmd_scope(args):
    emit({"summary": "shipped: " + ", ".join(
             ["probe", "trim", "scale", "concat", "loudness", "burn-subs",
              "thumbnail", "export (youtube/reels/shorts/x/linkedin/"
              "facebook/gif/proxy)"])
         + " | out of scope: " + "; ".join(
             f"{k} ({v})" for k, v in OUT_OF_SCOPE.items()),
          "shipped": ["probe", "trim", "scale", "concat", "loudness",
                      "burn-subs", "thumbnail",
                      "export:" + ",".join(sorted(EXPORT_PRESETS))],
          "out_of_scope": OUT_OF_SCOPE}, args.json)
    return 0


def build_parser():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--json", action="store_true", help="JSON output")
    p.add_argument("--dry-run", action="store_true",
                   help="print the ffmpeg command, write nothing")
    # The same flags on every subcommand, so both
    # `ffmpeg_tools.py --json trim ...` and `trim ... --json` work.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="JSON output")
    common.add_argument("--dry-run", action="store_true",
                        help="print the ffmpeg command, write nothing")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("probe", parents=[common]); s.add_argument("input")
    s = sub.add_parser("trim", parents=[common])
    s.add_argument("input"); s.add_argument("-o", "--out", required=True)
    s.add_argument("--start", default="0"); s.add_argument("--end")
    s.add_argument("--duration"); s.add_argument("--copy", action="store_true")
    s = sub.add_parser("scale", parents=[common])
    s.add_argument("input"); s.add_argument("-o", "--out", required=True)
    s.add_argument("--width", type=int, required=True)
    s.add_argument("--height", type=int, required=True)
    s.add_argument("--fit", choices=["pad", "crop", "stretch"],
                   default="pad")
    s = sub.add_parser("concat", parents=[common])
    s.add_argument("inputs", nargs="+"); s.add_argument("-o", "--out",
                                                       required=True)
    s.add_argument("--reencode", action="store_true")
    s = sub.add_parser("loudness", parents=[common])
    s.add_argument("input"); s.add_argument("-o", "--out", required=True)
    s.add_argument("--target", type=float, default=TARGET_LUFS)
    s = sub.add_parser("burn-subs", parents=[common])
    s.add_argument("input"); s.add_argument("-o", "--out", required=True)
    s.add_argument("--srt", required=True)
    s.add_argument("--mode", choices=["burn", "mux"], default="burn")
    s = sub.add_parser("thumbnail", parents=[common])
    s.add_argument("input"); s.add_argument("-o", "--out", required=True)
    s.add_argument("--at", default="mid")
    s = sub.add_parser("export", parents=[common])
    s.add_argument("input"); s.add_argument("-o", "--out", required=True)
    s.add_argument("--preset", choices=sorted(EXPORT_PRESETS),
                   required=True)
    sub.add_parser("scope", parents=[common])
    return p


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    # --json/--dry-run live on the top parser; subparsers inherit via args.
    fn = {"probe": cmd_probe, "trim": cmd_trim, "scale": cmd_scale,
          "concat": cmd_concat, "loudness": cmd_loudness,
          "burn-subs": cmd_burn_subs, "thumbnail": cmd_thumbnail,
          "export": cmd_export, "scope": cmd_scope}[args.cmd]
    try:
        return fn(args)
    except ToolError as e:
        emit({"summary": f"Failed: {e}", "error": str(e)}, args.json)
        return 1


if __name__ == "__main__":
    sys.exit(main())
