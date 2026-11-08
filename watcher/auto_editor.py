"""Auto-Editor silence-cut — OPT-IN ONLY (wired Nov 3 2026).

Auto-Editor 29.3.1 is installed on the iMac (render host) via
`uv tool install auto-editor`; the binary is ~/.local/bin/auto-editor.
It is NEVER part of the default render path: the watcher calls it only
when a task's details carry the explicit label `Silence-cut: on`
(parse_labels lowercases label names, so the key is "silence-cut").

Behavior: cut silent sections from an already-rendered MP4 using
auto-editor's defaults (`--edit audio`, silence cut, 0.2s margin).
The original clip is always kept; on any failure the caller falls back
to the original and records the failure — a finishing step must never
block or silently degrade a task (no voiceless/silent fallback).

This module has no watcher globals: it builds the CLI command and
verifies VM-side files with ffprobe. The watcher hook (Harness route,
after critic PASS, before mark-done) runs the command on the iMac,
copies the cut back, and verifies before swapping the delivered file.
"""

import json
import shlex
import subprocess

LABEL_KEY = "silence-cut"
LABEL_VALUE = "on"


def enabled(labels: dict) -> bool:
    """True only for the explicit opt-in label `Silence-cut: on`."""
    return str(labels.get(LABEL_KEY, "")).strip().lower() == LABEL_VALUE


def command(input_rel: str, output_rel: str) -> str:
    """auto-editor CLI for the iMac render host (tool defaults kept)."""
    return (
        "auto-editor " + shlex.quote(input_rel)
        + " --edit audio --no-open -o " + shlex.quote(output_rel)
    )


def _probe(path: str) -> dict:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=60, check=True).stdout
        data = json.loads(out)
    except Exception as e:  # noqa: BLE001 - probe failure is data, not fatal
        return {"error": str(e)}
    streams = data.get("streams", [])
    return {
        "duration_s": round(float(data.get("format", {}).get("duration", 0)), 2),
        "has_video": any(s.get("codec_type") == "video" for s in streams),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def verify(before_path: str, after_path: str) -> tuple:
    """Check a silence cut: shorter-or-equal, video kept, audio kept
    when the source had it. Returns (ok, detail dict)."""
    before = _probe(before_path)
    after = _probe(after_path)
    if "error" in before or "error" in after:
        return False, {"before": before, "after": after,
                       "reason": "ffprobe failed"}
    if not after["has_video"]:
        return False, {"before": before, "after": after,
                       "reason": "cut has no video stream"}
    if before["has_audio"] and not after["has_audio"]:
        return False, {"before": before, "after": after,
                       "reason": "cut dropped the audio stream"}
    if not (0 < after["duration_s"] <= before["duration_s"]):
        return False, {"before": before, "after": after,
                       "reason": "cut duration out of range"}
    return True, {"before": before, "after": after,
                  "seconds_removed": round(
                      before["duration_s"] - after["duration_s"], 2)}
