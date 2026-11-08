#!/usr/bin/env python3
"""Motion Bot — ffmpeg-skill verification lane (wired 2026-11-01).

Upstream: kajisho5/ffmpeg-skill (MIT), vendored under
skills/ffmpeg-skill/ — 42 FFmpeg tools, Python standard library
only, no cloud, no API keys. Motion Bot uses it in the
post-processing + verification lane ONLY:

  * probe.py  — structured probe (duration / fps / resolution /
    codec / pixel format / audio presence), alongside the existing
    ffprobe in skill_verify.py.
  * check.py  — platform delivery check (PASS/WARN/FAIL rows for a
    named platform, e.g. youtube). Advisory only.
  * look.py   — contact-sheet PNG, on demand, alongside the
    existing contact_sheet() in skill_verify.py.

Advisory by design: a ffmpeg-skill row (WARN/FAIL) NEVER changes
skill_verify's structural_ok. The existing resolution / fps /
duration probe remains the gate; this lane adds evidence. A clip
with no audio stream, for example, WARNs on check.py's audio row
and still passes structurally — silence is a property of the
brief, not a render failure.

NOT wired here, deliberately (see SKILLS.md "ffmpeg-skill"):
the MCP server (the watcher is a Python cron, not an MCP
client), the npx install path (for coding agents, not Motion
Bot), the alpha ProRes lower-third mux, the slideshow concat
with timed silent segments, any loudness-target change, and
any caption/voiceover rewriting. Finishing tools (fit, export,
silence, karaoke captions, loudness) are documented as opt-in
manual steps only; the watcher has no finishing execution step
and does not run them.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "skills" / "ffmpeg-skill" / "scripts"


def available() -> bool:
    """True when the vendored probe/check/look scripts are present."""
    return all((SCRIPTS_DIR / name).exists()
               for name in ("probe.py", "check.py", "look.py"))


def _run(script: str, args: list, timeout: int = 180) -> tuple:
    """Run one upstream script. Returns (returncode, stdout, stderr)."""
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / script)] + args,
            capture_output=True, text=True, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except Exception as e:  # noqa: BLE001 - tool failure is data, not fatal
        return -1, "", str(e)


def probe_clip(mp4_path: str) -> dict:
    """Structured probe via upstream probe.py. Returns {}-ish on failure."""
    rc, out, err = _run("probe.py", [mp4_path, "--json"])
    try:
        data = json.loads(out)
    except Exception:  # noqa: BLE001 - unparsable output is data
        return {"error": (err or out)[:300] or f"probe rc={rc}"}
    video = data.get("video") or {}
    return {
        "duration_s": data.get("duration"),
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": video.get("fps"),
        "codec": video.get("codec"),
        "pix_fmt": video.get("pix_fmt"),
        "nb_frames": video.get("nb_frames"),
        "audio_present": data.get("audio") is not None,
        "bitrate": data.get("bitrate"),
    }


def check_platform(mp4_path: str, platform: str = "youtube") -> dict:
    """Platform delivery check via upstream check.py.

    check.py exits 1 when anything FAILs; a parsed JSON body with
    rc 0 or 1 is still a valid result. Anything else is an error.
    """
    rc, out, err = _run("check.py",
                        [mp4_path, "--platform", platform, "--json"])
    try:
        data = json.loads(out)
    except Exception:  # noqa: BLE001 - unparsable output is data
        return {"platform": platform, "error": (err or out)[:300]
                or f"check rc={rc}"}
    rows = [{"check": r.get("check"), "status": r.get("status"),
             "value": r.get("value"), "expected": r.get("expected"),
             "fix": r.get("fix"), "reason": r.get("reason")}
            for r in data.get("checks", [])]
    return {
        "platform": platform,
        "ok": data.get("ok"),
        "failed": data.get("failed"),
        "warnings": data.get("warnings"),
        "rows": rows,
    }


def look_sheet(mp4_path: str, out_path: str) -> str | None:
    """Contact sheet via upstream look.py. Returns path or None."""
    rc, _out, _err = _run("look.py", [mp4_path, "-o", out_path])
    if rc != 0:
        return None
    return out_path if Path(out_path).exists() else None


def verify_with_ffmpeg_skill(mp4_path: str, platform: str = "youtube",
                             sheet_path: str | None = None) -> dict:
    """Probe + platform check (+ optional look sheet) for one clip.

    Never raises: every failure is reported in the returned dict.
    """
    if not available():
        return {"available": False,
                "error": f"ffmpeg-skill scripts missing under {SCRIPTS_DIR}"}
    result: dict = {"available": True}
    result["probe"] = probe_clip(mp4_path)
    result["check"] = check_platform(mp4_path, platform)
    if sheet_path:
        sheet = look_sheet(mp4_path, sheet_path)
        result["look"] = sheet
        if sheet is None:
            result.setdefault("errors", []).append("look sheet failed")
    return result
