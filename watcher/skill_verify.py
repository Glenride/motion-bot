#!/usr/bin/env python3
"""Motion Bot — skill verify loop (v2.2, mirrors iart-ai tools/verify).

The iart-ai verify loop is: render a frame -> screenshot -> check,
instead of hoping. This module is the MP4 half of that loop, run on
the VM after a clip is copied back from the iMac:

  * probe: ffprobe duration / fps / resolution / codec (the iart
    probe-mp4.sh check, in Python so the watcher can read it as JSON).
  * contact_sheet: ffmpeg tile of N frames across the clip (the iart
    contact-sheet.sh check) so a human eye — or the next critic pass —
    can see the whole clip at a glance instead of one frame.

Pure checks, never a gate on their own: a probe mismatch (wrong
resolution, short duration) is a structural failure; a contact sheet
is evidence attached to the critic report, not a verdict.
"""

import json
import subprocess
from pathlib import Path

FFPROBE = ["ffprobe", "-v", "quiet", "-print_format", "json",
           "-show_format", "-show_streams"]


def probe(mp4_path: str) -> dict:
    """ffprobe a clip. Returns {} on any failure (caller decides)."""
    try:
        out = subprocess.run(FFPROBE + [mp4_path], capture_output=True,
                             text=True, timeout=60, check=True).stdout
        data = json.loads(out)
    except Exception as e:  # noqa: BLE001 - probe failure is data, not fatal
        return {"error": str(e)}
    video = next((s for s in data.get("streams", [])
                  if s.get("codec_type") == "video"), {})
    fmt = data.get("format", {})
    fps = None
    if video.get("avg_frame_rate") and "/" in video["avg_frame_rate"]:
        num, den = video["avg_frame_rate"].split("/")
        fps = round(int(num) / int(den), 2) if int(den) else None
    return {
        "duration_s": round(float(fmt.get("duration", 0)), 2),
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": fps,
        "codec": video.get("codec_name"),
        "size_bytes": int(fmt.get("size", 0)) if fmt.get("size") else None,
    }


def contact_sheet(mp4_path: str, out_path: str, tiles: int = 6) -> str | None:
    """Tile `tiles` evenly-spaced frames into one PNG. Returns path or None."""
    info = probe(mp4_path)
    dur = info.get("duration_s") or 0
    if not dur:
        return None
    # fps filter: 1 frame per (dur/tiles) seconds, tiled 3-wide.
    cols = 3
    rows = (tiles + cols - 1) // cols
    filt = (f"fps=1/{dur / tiles:.3f},scale=320:-1,tile={cols}x{rows}")
    try:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", mp4_path,
                        "-vf", filt, "-frames:v", "1", out_path],
                       capture_output=True, timeout=120, check=True)
    except Exception:  # noqa: BLE001 - sheet failure is non-fatal
        return None
    return out_path if Path(out_path).exists() else None


def verify(mp4_path: str, expected: dict | None = None,
           ffmpeg_skill: bool = True, ffmpeg_platform: str = "youtube",
           ffmpeg_sheet_path: str | None = None) -> dict:
    """Probe + structural check against expected width/height/duration.

    expected: {"width": int, "height": int, "min_duration_s": float}
    Returns {"probe": {...}, "structural_ok": bool, "mismatches": [...],
             "ffmpeg_skill": {...}}.

    The ffmpeg_skill lane (watcher/ffmpeg_skill_verify.py, upstream
    kajisho5/ffmpeg-skill probe + platform check + optional look
    sheet) is ADVISORY ONLY: its rows never change structural_ok,
    which stays decided by the ffprobe above. Pass
    ffmpeg_skill=False to skip it; pass ffmpeg_sheet_path to also
    write a look.py contact sheet.
    """
    info = probe(mp4_path)
    mismatches = []
    if info.get("error"):
        mismatches.append(f"probe failed: {info['error']}")
    elif expected:
        if expected.get("width") and info.get("width") != expected["width"]:
            mismatches.append(f"width {info.get('width')} != {expected['width']}")
        if expected.get("height") and info.get("height") != expected["height"]:
            mismatches.append(f"height {info.get('height')} != {expected['height']}")
        if expected.get("min_duration_s") and (info.get("duration_s") or 0) < expected["min_duration_s"]:
            mismatches.append(f"duration {info.get('duration_s')}s < {expected['min_duration_s']}s")
    result: dict = {"probe": info, "structural_ok": not mismatches,
                    "mismatches": mismatches}
    if ffmpeg_skill:
        try:
            from ffmpeg_skill_verify import verify_with_ffmpeg_skill
            result["ffmpeg_skill"] = verify_with_ffmpeg_skill(
                mp4_path, platform=ffmpeg_platform,
                sheet_path=ffmpeg_sheet_path)
        except Exception as e:  # noqa: BLE001 - lane failure is data
            result["ffmpeg_skill"] = {"available": False, "error": str(e)}
    return result


def has_alpha(mp4_path: str) -> bool:
    """True when the video stream's pixel format carries an alpha channel."""
    try:
        out = subprocess.run(FFPROBE + [mp4_path], capture_output=True,
                             text=True, timeout=60, check=True).stdout
        data = json.loads(out)
    except Exception:  # noqa: BLE001 - probe failure means no alpha proof
        return False
    video = next((s for s in data.get("streams", [])
                  if s.get("codec_type") == "video"), {})
    pix_fmt = (video.get("pix_fmt") or "")
    return "yuva" in pix_fmt or pix_fmt.endswith("a")
