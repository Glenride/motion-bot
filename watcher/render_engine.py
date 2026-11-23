#!/usr/bin/env python3
"""Engine lane — HyperFrames / huashu-motion renders for Motion Bot.

Label-only lane: a brief carrying `engine: hyperframes` or
`engine: huashu-motion` renders on THIS VM (not the iMac) with the
proven toolchains, then goes through the same skill_verify +
Critic + mark_done path as the Harness route. Any engine failure
falls back to the Harness route; a critic STRUCTURAL failure
blocks the task, same as Harness.

No telemetry, ever. HYPERFRAMES_NO_TELEMETRY=1 and DO_NOT_TRACK=1
are set on every subprocess, and the HyperFrames usage-beacon
command (`hyperframes events ...`) is never run — the user said
"no telemetry" Nov 23, 2026, and `hyperframes telemetry disable`
is recorded in ~/.hyperframes/config.json. The skill files still
carry the beacon instruction; this module is the override.

Environment facts (verified Nov 23, 2026 on this VM):
- Node 24, FFmpeg 8.1.2, Chrome Headless Shell via
  `hyperframes browser ensure` into REPO/.hyperframes-cache.
- /tmp is a 512M tmpfs: TMPDIR must point under the workspace.
- The Hatch Chrome at /opt/meta-chromium/chrome exits with a
  WebGL domain policy error; huashu needs OM_CHROME pointed at
  the Headless Shell.
- Full git clones stall on this VM; the skills were installed by
  sparse blobless clone into ~/workspace/custom-skills/.
"""

import glob
import html
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO / ".hyperframes-cache"
WORK_DIR = REPO / "out" / ".engine-work"
HYPERFRAMES_VERSION = "0.9.86"
OM_BIN = (Path.home() / "workspace" / "custom-skills"
          / "huashu-motion" / "bin" / "om")
ENGINES = ("hyperframes", "huashu-motion")

# HyperFrames lane composition: the blank scaffold's title, plus a
# burnt-sienna bar sweeping the full 10 s so frames differ across
# the whole clip (a static title fails the Critic's frames_differ
# check). One paused root timeline, fromTo only, per the
# /hyperframes contract. Written after `hyperframes init`, then
# checked with `npm run check` before any render.
HYPERFRAMES_INDEX = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1280, height=720" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root {{
        --ground: #111111;
        --ink: #ffffff;
        --accent: #b34a27;
        --font-display: sans-serif;
      }}
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{
        margin: 0; width: 1280px; height: 720px;
        overflow: hidden; background: var(--ground);
      }}
      #root {{
        width: 100%; height: 100%; display: flex;
        align-items: center; justify-content: center;
        font-family: var(--font-display); position: relative;
      }}
      #title {{
        color: var(--ink); font-size: 56px; font-weight: 600;
        letter-spacing: -0.03em; max-width: 1100px; text-align: center;
      }}
      #bar {{
        position: absolute; left: 0; bottom: 100px;
        width: 360px; height: 64px; background: var(--accent);
      }}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="10"
      data-width="1280"
      data-height="720"
    >
      <h1 id="title" class="clip" data-start="0" data-duration="10" data-track-index="0">{title}</h1>
      <div id="bar"></div>
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      tl.fromTo("#title", {{ opacity: 0, filter: "blur(8px)" }}, {{ opacity: 1, filter: "blur(0px)", duration: 0.4, ease: "power4.out" }}, 0);
      tl.fromTo("#title", {{ y: 40 }}, {{ y: -40, duration: 10, ease: "none" }}, 0);
      tl.fromTo("#bar", {{ x: -360 }}, {{ x: 1280, duration: 10, ease: "none" }}, 0);
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
"""


def _run(cmd, cwd=None, env=None, timeout=600):
    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True,
                       text=True, timeout=timeout)
    if r.returncode != 0:
        tail = ((r.stderr or "") + (r.stdout or "")).strip()[-500:]
        raise RuntimeError(f"command failed ({' '.join(map(str, cmd[:3]))}): {tail}")
    return r


def headless_shell():
    """Path to the Chrome Headless Shell, ensuring it once."""
    matches = sorted(CACHE_DIR.glob(
        "chrome/chrome-headless-shell/linux-*/"
        "chrome-headless-shell-linux64/chrome-headless-shell"))
    if matches:
        return str(matches[-1])
    # Seed from the Nov 23 HyperFrames test cache (same shell) so a
    # fresh lane never has to download it through `browser ensure`,
    # whose permission check trips on this VM's group-writable home.
    seed = sorted((Path.home() / "workspace" / "repos"
                   / "hyperframes-test" / ".hyperframes-cache").glob(
        "chrome/chrome-headless-shell/linux-*/"
        "chrome-headless-shell-linux64/chrome-headless-shell"))
    if seed:
        dest = (CACHE_DIR / "chrome" / "chrome-headless-shell"
                / seed[0].parent.parent.name
                / "chrome-headless-shell-linux64")
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(seed[0], dest / "chrome-headless-shell")
        os.chmod(dest / "chrome-headless-shell", 0o755)
        return str(dest / "chrome-headless-shell")
    _run(["npx", "-y", f"hyperframes@{HYPERFRAMES_VERSION}",
          "browser", "ensure"], env=base_env())
    matches = sorted(CACHE_DIR.glob(
        "chrome/chrome-headless-shell/linux-*/"
        "chrome-headless-shell-linux64/chrome-headless-shell"))
    if not matches:
        raise RuntimeError("hyperframes browser ensure left no headless shell")
    return str(matches[-1])


def base_env():
    """Env for every engine subprocess: workspace caches, no telemetry."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CACHE_DIR, 0o700)
    (CACHE_DIR / "tmp").mkdir(parents=True, exist_ok=True)
    os.chmod(CACHE_DIR / "tmp", 0o700)
    env = dict(os.environ)
    env["HYPERFRAMES_CACHE_DIR"] = str(CACHE_DIR)
    env["HYPERFRAMES_EXTRACT_CACHE_DIR"] = str(CACHE_DIR)
    env["TMPDIR"] = str(CACHE_DIR / "tmp")
    env["HYPERFRAMES_NO_TELEMETRY"] = "1"
    env["DO_NOT_TRACK"] = "1"
    return env


def _display_title(title):
    t = (title or "").strip()
    return t if len(t) <= 80 else t[:77] + "..."


def render_hyperframes(title, slug):
    """Blank HyperFrames project + hook title -> out/<slug>-engine-hyperframes.mp4."""
    env = base_env()
    env["OM_CHROME"] = headless_shell()
    proj = WORK_DIR / f"{slug}-hyperframes"
    if proj.exists():
        shutil.rmtree(proj)
    proj.parent.mkdir(parents=True, exist_ok=True)
    _run(["npx", "-y", f"hyperframes@{HYPERFRAMES_VERSION}", "init",
          str(proj), "--skip-skills", "--non-interactive"], env=env)
    (proj / "index.html").write_text(
        HYPERFRAMES_INDEX.format(title=html.escape(_display_title(title))))
    _run(["npm", "run", "check"], cwd=proj, env=env)
    _run(["npm", "run", "render"], cwd=proj, env=env)
    rendered = sorted((proj / "renders").glob("*.mp4"))
    if not rendered:
        raise RuntimeError("hyperframes render produced no mp4")
    out = REPO / "out" / f"{slug}-engine-hyperframes.mp4"
    shutil.copyfile(rendered[-1], out)
    return out


def render_huashu(title, subtitle, slug):
    """Blank huashu project + title/subtitle variables -> out/<slug>-engine-huashu.mp4."""
    env = base_env()
    env["OM_CHROME"] = headless_shell()
    proj = WORK_DIR / f"{slug}-huashu"
    if proj.exists():
        shutil.rmtree(proj)
    proj.parent.mkdir(parents=True, exist_ok=True)
    om = str(OM_BIN) if OM_BIN.exists() else "om"
    _run([om, "new", str(proj), "--template", "blank"], env=env)
    sub = (subtitle or "").strip() or "A film in motion"
    _run([om, "set", f"title={_display_title(title)}",
          f"subtitle={sub[:60]}", f"statLabel={sub[:60]}", str(proj)], env=env)
    # End card: the blank template ends on a tiny "made with
    # huashu-motion" credit, which the Critic reads as no text at
    # sample resolution. Recap the hook big instead — the tool's
    # own "Made with huashu-motion" signature still overlays the
    # last 1.2 s, so the credit is not lost.
    _idx = proj / "index.html"
    _html = _idx.read_text()
    _old_end = ('<section id="s-end" class="end" data-om-id="end">'
                "<span>made with <b>huashu-motion</b></span></section>")
    _new_end = ('<section id="s-end" class="end" data-om-id="end">'
                '<span style="font-size:110px;letter-spacing:-2px;'
                'font-weight:900">'
                + html.escape(_display_title(title)) + "</span></section>")
    if _old_end in _html:
        _idx.write_text(_html.replace(_old_end, _new_end))
    else:
        raise RuntimeError("huashu blank end card not found — template changed")
    _run([om, "check", str(proj)], env=env)
    _run([om, "render", str(proj), "--silent"], env=env)
    rendered = sorted((proj / "out").glob("*.mp4"))
    if not rendered:
        raise RuntimeError("huashu render produced no mp4")
    out = REPO / "out" / f"{slug}-engine-huashu.mp4"
    # House standard is 1280x720 (the Critic's probe check allows
    # only 1280x720 / 720x1280); huashu renders 1920x1080, so scale.
    tmp = REPO / "out" / f".{slug}-engine-huashu-720.mp4"
    _run(["ffmpeg", "-y", "-v", "error", "-i", str(rendered[-1]),
          "-vf", "scale=1280:720", "-c:a", "copy", str(tmp)], env=env)
    shutil.move(str(tmp), str(out))
    return out


ENGINE_PALETTES = {
    "hyperframes": {"background": "#111111", "surface": "#111111",
                    "text": "#FFFFFF", "accent": "#B34A27",
                    "accentDeep": "#7A321B"},
    "huashu-motion": {"background": "#F3EEE4", "surface": "#F3EEE4",
                      "text": "#1D1B18", "accent": "#D9480F",
                      "accentDeep": "#8F2F08"},
}

ENGINE_DURATIONS = {"hyperframes": 10, "huashu-motion": 9}


def engine_storyboard(engine, title, subtitle):
    """Minimal storyboard for the Critic: real palette, real length,
    one scene carrying the hook's words. Never mentions Motion Bot
    (the Critic's no-self-mention check fails on it)."""
    words = _display_title(title).split()
    return {
        "hook": _display_title(title),
        "subtitle": (subtitle or "").strip(),
        "engine": engine,
        "lengthSeconds": ENGINE_DURATIONS[engine],
        "format": "landscape",
        "palette": ENGINE_PALETTES[engine],
        "scenes": [{"words": words,
                    "durationSeconds": ENGINE_DURATIONS[engine]}],
    }


def render_engine(engine, title, subtitle, slug):
    """engine in ('hyperframes', 'huashu-motion') -> Path to the mp4 in out/."""
    if engine == "hyperframes":
        return render_hyperframes(title, slug)
    if engine == "huashu-motion":
        return render_huashu(title, subtitle, slug)
    raise ValueError(f"unknown engine: {engine}")


if __name__ == "__main__":
    # Usage: render_engine.py <hyperframes|huashu-motion> <title> <slug> [subtitle]
    eng = sys.argv[1]
    _title = sys.argv[2]
    _slug = sys.argv[3]
    _sub = sys.argv[4] if len(sys.argv) > 4 else ""
    print(json.dumps({"mp4": str(render_engine(eng, _title, _sub, _slug))}))
