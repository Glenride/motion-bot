#!/usr/bin/env python3
"""Motion Bot watcher — turn open Mission Control tasks into rendered clips.

Each run:
  1. GET /api/workspace from Mission Control.
  2. Find tasks with status "open" where projectId == 56 (Motion Bot
     project) or ownerId == 2 (Motion Bot person).
  3. For each task, FIRST PATCH it to in_progress (claim it, so no task is
     ever rendered twice), then render it on the iMac, copy the MP4 back,
     md5-verify at each hop, and PATCH the task done with a completion
     note naming the video file.
  4. Rendering route: the Harness is the default for non-Signalwood
     tasks — the Director (harness_director.py) reads the FULL title +
     details into a storyboard (named colors, mood, scenes, motif,
     camera plan) and the Harness composition renders it. If the
     storyboard step or the Harness render fails, the watcher falls
     back to the old Generic brief render and logs the fallback reason
     in the completion note — a render is never blocked by the Harness
     step alone. Signalwood tasks still use the Signalwood composition.
     NARRATED tasks (title/details contain "narrated" or "voiceover",
     not negated — "no voiceover" does not trigger) go through a
     third route first. BEFORE claiming, the question gate
     (question_gate.py) checks for a genuine creative fork (no
     concrete visual concept, an ambiguous word, an explicit tone
     fork, a missing project/subtitle): on a fork the task is left
     OPEN and unclaimed with one posted question, never re-asked.
     Then the Director emits a narrated storyboard — the LLM
     Director (llm_director.py, Studio model) first when
     LLM_DIRECTOR=1 (default), the deterministic Director on any
     model failure or when the flag is 0 — Pixabay stock is fetched
     + downloaded ON THIS VM (the key lives in authd here — it can
     never go to the iMac) and shipped to the iMac with the
     storyboard, prepare runs on the iMac (free-ladder fallback for
     scenes with no prefetched visual + Edge-TTS + captions), and
     the Narrated composition renders it. A narrated-step failure
     falls back to the Harness the same way; a narrated Critic
     STRUCTURAL failure blocks the task like a Harness one.
     After a Harness render the Critic (harness_critic.py) verifies
     the clip with numbers; a structural critic failure (identical
     frames / blank frames / wrong probe) blocks the task, a cosmetic
     one (palette / contrast / OCR) is noted in the completion note.
  5. On failure after claiming: PATCH the task blocked with the error in
     blockingReason. A task with no usable message text (empty title) is
     blocked with a note asking D'Vaughn for the hook — brief details are
     never invented.
  6. Self-heal stale claims: a Motion Bot task left in_progress with no
     fresh watcher claim and a missing or 3h+ old updatedAt is recovered
     — if its MP4 already exists in out/, the task is marked done;
     otherwise it is reset to open so the next run picks it up. Claim
     times are recorded locally (claims.json) because Mission Control
     PATCHes do not reliably set updatedAt; a fresh local claim always
     protects a mid-render task from being reset. Stale claims are
     reported in the summary.
  7. Story gate (v2.5, his call 2026-11-03): a task with no story no
     longer waits on him — the watcher builds a 3-beat story from the
     task's own words, writes it visibly into the task details as a
     Story: block, and renders. The question gate (genuine visual forks
     on narrated tasks only) still asks; that gate is unchanged.

Prints one machine-readable JSON summary to stdout.

The Mission Control API password is read at runtime from
~/workspace/goals/mission-control-dashboard/hidden_files/mc-api-password
(or $MC_API_PASSWORD_FILE). It is never printed, logged, or written to
any file by this script.

Free tier only. Never renders on the InstaBox box — renders run on the
iMac (~/projects/motion-bot) via SSH; file sync uses rsync --partial
with retries because the tsconnect proxy drops sustained transfers.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness_director import (  # noqa: E402
    build_storyboard,
    build_narrated_storyboard,
    is_narrated_task,
)
from llm_director import run_llm_via_imac  # noqa: E402
from harness_writer import write_beats  # noqa: E402
from skill_router import route as skill_route, craft_notes, load_skill_text  # noqa: E402
from skill_verify import verify as skill_verify, has_alpha  # noqa: E402
from harness_director import parse_data_rows, parse_labels, draft_data_rows  # noqa: E402
from phase1_router import route as phase1_route  # noqa: E402
from phase1_history import append_run as phase1_append_run  # noqa: E402
from harness_director import (  # noqa: E402
    ad_beat_scenes,
    build_ad_variant,
    build_everest_panel,
    build_explainer,
    build_product_demo,
    build_whatif,
    pick_canvas_style,
)
from broll_timing import build_segments as build_broll_segments  # noqa: E402
from question_gate import (  # noqa: E402
    ASKED_PATH,
    check_question,
    clear_asked,
    is_asked,
    post_question_to_mc,
    record_asked,
)
from story_gate import STORY_ASKED_PATH, auto_story, check_story  # noqa: E402
import hq_bridge  # noqa: E402

# ---------------------------------------------------------------- config
API_BASE = "https://mission-control-hq-api.mwszghdkkf.workers.dev"
PASSWORD_FILE = Path(
    os.environ.get(
        "MC_API_PASSWORD_FILE",
        os.path.expanduser(
            "~/workspace/goals/mission-control-dashboard/"
            "hidden_files/mc-api-password"
        ),
    )
)
REPO = Path(os.path.expanduser("~/workspace/repos/motion-bot"))
IMAC_REPO = "~/projects/motion-bot"
IMAC_SSH = os.path.expanduser("~/workspace/.imac-ssh.sh")
IMAC_RSYNC_SSH = os.path.expanduser("~/workspace/.imac-rsync-ssh.sh")
IMAC_HOST = "housedv@100.81.149.115"
MOTION_BOT_PROJECT_ID = 56
MOTION_BOT_PERSON_ID = 2
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
STALE_CLAIM_SECONDS = 3 * 3600  # claims older than this are recovered
RENDER_TIMEOUT_SECS = 900
PREPARE_TIMEOUT_SECS = 600  # stock fetch + TTS on the iMac
RSYNC_ATTEMPTS = 3

BRIEF_DEFAULTS = {
    "hook": "Something worth seeing.",
    "lengthSeconds": 12,
}
# NOTE: there is deliberately NO "project" default here. An explicit
# `Project:` label in the task details is the ONLY source of the
# on-screen project name. A Motion Bot task with no explicit label gets
# NO project in the brief — never "Motion Bot", never "Untitled Project"
# — so the bot never names itself on screen.

HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
LENGTH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b", re.I)
LABEL_RE = re.compile(
    r"(?im)^\s*(project|subtitle|tagline|end card|background|accent|text|image|images|length|duration|name|role|pills|source|chart|unit|mode|product|everest|style|finish)\s*[:\-=]\s*(.+?)\s*$"
)
# NOTE (v2.8 fix): this LABEL_RE used to list only the translate_to_brief
# keys, so the Harness route's `Name:` (lower-thirds rung) and `Chart:
# d3` (D3 rung) labels could never parse — both rungs were dead
# through the watcher. The keys above are the rung-relevant labels;
# the director's own LABEL_RE (harness_director.py) stays the full set.
# v2.10: `Pills:` / `Source:` added — the lower-third rung passes them
# into the standalone overlay brief.


# ---------------------------------------------------------------- helpers
def log(msg):
    print(f"[watcher] {msg}", file=sys.stderr)


def read_password():
    return PASSWORD_FILE.read_text().strip()


def api(method, path, password, body=None):
    """One Mission Control API call via curl (normal UA: Cloudflare
    rejects Python's default UA; curl also handles the large workspace
    payload reliably). Returns parsed JSON. Raises on HTTP errors."""
    cmd = [
        "curl", "-sS", "--fail-with-body",
        "-H", f"User-Agent: {USER_AGENT}",
        "-H", f"Authorization: Bearer {password}",
        "-X", method,
    ]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json",
                "--data", json.dumps(body)]
    cmd.append(API_BASE + path)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(
            f"{method} {path} failed (exit {r.returncode}): "
            f"{(r.stdout or r.stderr or '').strip()[-500:]}"
        )
    return json.loads(r.stdout)


def patch_task(password, task_id, fields):
    return api("PATCH", f"/api/tasks/{task_id}", password, fields)


def mark_done(password, task_id, report):
    """Mark a task done ONLY if it is still this watcher's claim.

    Race guard (Nov 3 2026): the 10:06 run's done PATCH overwrote a
    hold placed mid-run for tasks 237/238, and its completionSteps
    replace destroyed all three Anti-Slop beat sheets. So a done
    PATCH now re-GETs the task first: if its status is no longer
    in_progress, the task is left untouched and the race is logged.
    And when the existing completionSteps carries a beat sheet
    ([BEAT markers — the task's own process), the report is APPENDED
    after a separator instead of replacing it. Returns True when the
    done PATCH was applied.
    """
    try:
        resp = api("GET", f"/api/tasks/{task_id}", password)
        current = resp.get("data") if isinstance(resp, dict) else None
        if not isinstance(current, dict):
            current = resp if isinstance(resp, dict) else {}
    except Exception as e:
        log(f"task {task_id}: done-guard GET failed ({e}); not marking done")
        return False
    if current.get("status") != "in_progress":
        log(f"task {task_id}: done-guard: status is "
            f"{current.get('status')}, not in_progress — leaving untouched "
            f"(possible hold race)")
        return False
    existing = current.get("completionSteps") or ""
    steps = (existing.rstrip("\n") + "\n\n---\n" + report
             if "[BEAT" in existing else report)
    patch_task(password, task_id, {"status": "done",
                                   "completionSteps": steps})
    return True


# ------------------------------------------------------- claim records
# Local record of when THIS watcher claimed each task (claims.json beside
# this script). Mission Control's updatedAt is unreliable: PATCHes do not
# always set it, so in_progress tasks with no updatedAt used to be
# skipped by stale recovery forever (Nov 3: tasks 236-238). Claim
# records give stale recovery a clock it controls. Records self-expire
# (older than 7 days are pruned on load), so a stale record can never
# protect a task forever — and a fresh record never lets a mid-render
# task be reset by another run.
CLAIMS_PATH = Path(__file__).resolve().parent / "claims.json"


def _parse_ts(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def load_claims():
    try:
        data = json.loads(CLAIMS_PATH.read_text())
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    now = datetime.now(timezone.utc)
    kept = {}
    for k, v in data.items():
        ts = _parse_ts(v)
        if ts is not None and (now - ts).total_seconds() < 7 * 86400:
            kept[k] = v
    return kept


def record_claim(task_id):
    try:
        claims = load_claims()
        claims[str(task_id)] = datetime.now(timezone.utc).isoformat()
        CLAIMS_PATH.write_text(json.dumps(claims))
    except Exception as e:
        log(f"record_claim failed: {e}")


def is_stale_claim(task, claims, now):
    """True when an in_progress Motion Bot task should be recovered.

    A fresh watcher claim (< 3h) always protects the task — this is
    what stops a mid-render reset when updatedAt is old or missing.
    Otherwise: missing/unparseable updatedAt with no fresh claim is
    stale (the Nov 3 trap: created-in_progress tasks with no timestamp
    were skipped forever), and a parsed updatedAt older than 3h is stale.
    """
    claim_ts = _parse_ts(claims.get(str(task.get("id"))))
    if claim_ts is not None:
        if (now - claim_ts).total_seconds() < STALE_CLAIM_SECONDS:
            return False
    updated_ts = _parse_ts(task.get("updatedAt") or "")
    if updated_ts is None:
        return True
    return (now - updated_ts).total_seconds() >= STALE_CLAIM_SECONDS


def slugify(text, max_len=50):
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    slug = re.sub(r"-+", "-", slug)
    return slug[:max_len].strip("-") or "clip"


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd, timeout=300):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def rsync_to_imac(local_path, remote_rel, attempts=RSYNC_ATTEMPTS):
    """rsync one file to the iMac with --partial + retries; md5-verify."""
    dest = f"{IMAC_HOST}:{IMAC_REPO}/{remote_rel}"
    last_err = ""
    for attempt in range(1, attempts + 1):
        r = run(
            ["rsync", "--partial", "-az", "--no-owner", "--no-group",
             "-e", IMAC_RSYNC_SSH,
             str(local_path), dest],
            timeout=300,
        )
        if r.returncode == 0:
            break
        last_err = (r.stderr or r.stdout or "").strip()[-500:]
        log(f"rsync to iMac attempt {attempt} failed: {last_err}")
        time.sleep(5)
    else:
        raise RuntimeError(f"rsync to iMac failed after {attempts} attempts: {last_err}")
    want = md5(local_path)
    r = run([IMAC_SSH, f"md5sum {IMAC_REPO}/{remote_rel}"], timeout=120)
    got = (r.stdout or "").split()[0] if r.returncode == 0 and r.stdout else ""
    if got != want:
        raise RuntimeError(
            f"md5 mismatch after rsync to iMac: local {want} remote {got or 'unreadable'}"
        )


def rsync_from_imac(remote_rel, local_path, attempts=RSYNC_ATTEMPTS):
    """rsync one file back from the iMac with --partial + retries; md5-verify."""
    src = f"{IMAC_HOST}:{IMAC_REPO}/{remote_rel}"
    last_err = ""
    for attempt in range(1, attempts + 1):
        r = run(
            ["rsync", "--partial", "-az", "--no-owner", "--no-group",
             "-e", IMAC_RSYNC_SSH,
             src, str(local_path)],
            timeout=600,
        )
        if r.returncode == 0:
            break
        last_err = (r.stderr or r.stdout or "").strip()[-500:]
        log(f"rsync from iMac attempt {attempt} failed: {last_err}")
        time.sleep(5)
    else:
        raise RuntimeError(
            f"rsync from iMac failed after {attempts} attempts: {last_err}"
        )
    r = run([IMAC_SSH, f"md5sum {IMAC_REPO}/{remote_rel}"], timeout=120)
    want = (r.stdout or "").split()[0] if r.returncode == 0 and r.stdout else ""
    if not want:
        raise RuntimeError("could not read remote md5 for verification")
    if md5(local_path) != want:
        raise RuntimeError("md5 mismatch after rsync from iMac")


def render_on_imac(brief_rel, composition, output_rel, codec=None):
    codec_arg = f" {codec}" if codec else ""
    cmd = (
        f"cd {IMAC_REPO} && ./render.sh {brief_rel} {composition} {output_rel}{codec_arg}"
    )
    r = run([IMAC_SSH, cmd], timeout=RENDER_TIMEOUT_SECS)
    tail = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()[-1500:]
    if r.returncode != 0:
        raise RuntimeError(f"render failed on iMac (exit {r.returncode}): {tail}")
    return tail


def prepare_on_imac(brief_rel, enriched_rel):
    """Run the narrated asset prep on the iMac (stock fetch + Edge-TTS
    + captions). Writes the enriched storyboard next to the brief."""
    cmd = (
        f"cd {IMAC_REPO} && npx tsx src/narrated/prepare.ts "
        f"{brief_rel} {enriched_rel}"
    )
    r = run([IMAC_SSH, cmd], timeout=PREPARE_TIMEOUT_SECS)
    tail = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()[-1500:]
    if r.returncode != 0:
        raise RuntimeError(f"prepare failed on iMac (exit {r.returncode}): {tail}")
    return tail


def fetch_stock_on_vm(storyboard_path, staging_dir, job, timeout=600):
    """VM-side Pixabay fetch for a narrated storyboard.

    Runs watcher/narrated_stock.py, which calls the Pixabay
    connector (the key lives in authd on this VM only) and downloads
    the chosen files into staging_dir. Enriches the storyboard in
    place with prefetchedVisual per scene. Returns the script's
    summary dict. Raises on a hard failure — the caller logs it and
    proceeds with the unenriched storyboard (the iMac free ladder
    covers the scenes instead)."""
    script = Path(__file__).resolve().parent / "narrated_stock.py"
    r = subprocess.run(
        [sys.executable, str(script), str(storyboard_path),
         str(storyboard_path), str(staging_dir), job],
        capture_output=True, text=True, timeout=timeout,
    )
    tail = ((r.stdout or "") + "\n" + (r.stderr or "")).strip()[-1500:]
    if r.returncode != 0:
        raise RuntimeError(
            f"narrated_stock.py failed (exit {r.returncode}): {tail}")
    try:
        return json.loads(r.stdout)
    except ValueError:
        return {"raw": tail}


def rsync_dir_to_imac(local_dir, remote_rel, attempts=RSYNC_ATTEMPTS, bwlimit=None):
    """Delta-sync a directory (src/) to the iMac so the Harness code the
    watcher renders with is the code on disk here. Additive only.
    bwlimit (KB/s) throttles the transfer: the tsconnect proxy drops
    sustained full-speed transfers (BlockingIOError mid-file), and
    --bwlimit=400 got 17MB of Pixabay stock through after unthrottled
    rsync failed 8x in a row (2026-10-26). Use it for large dirs."""
    src = str(local_dir).rstrip("/") + "/"
    dest = f"{IMAC_HOST}:{IMAC_REPO}/{remote_rel}/"
    last_err = ""
    for attempt in range(1, attempts + 1):
        cmd = ["rsync", "--partial", "-az", "--no-owner", "--no-group"]
        if bwlimit:
            cmd += ["--bwlimit", str(bwlimit)]
        cmd += ["-e", IMAC_RSYNC_SSH, src, dest]
        r = run(cmd, timeout=300)
        if r.returncode == 0:
            return
        last_err = (r.stderr or r.stdout or "").strip()[-500:]
        log(f"rsync dir to iMac attempt {attempt} failed: {last_err}")
        time.sleep(5)
    raise RuntimeError(
        f"rsync dir to iMac failed after {attempts} attempts: {last_err}")


# Checks whose failure means the video itself is broken (block the task)
# vs cosmetic (note in the completion, keep the render).
CRITIC_STRUCTURAL = ("probe", "frames_differ", "not_blank")
CRITIC_STRUCTURAL_NARRATED = (
    "probe", "frames_differ", "not_blank", "audio_present", "captions_present")


def run_critic(mp4_path, storyboard_path, imac_mp4_rel, srt_path=None,
               picks=None):
    """Run harness_critic.py on a rendered clip. Returns its report dict.
    Never raises for a FAIL verdict — only for a critic crash (no report
    file), which the caller treats as a Harness-step failure. picks
    (a Phase 1 route record) runs Check 8, the variety gate; without
    it the gate SKIPs and the live watcher behaves as before."""
    critic_path = Path(__file__).resolve().parent / "harness_critic.py"
    cmd = [sys.executable, str(critic_path), str(mp4_path),
           str(storyboard_path), "--imac-mp4",
           f"~/projects/motion-bot/{imac_mp4_rel}"]
    if srt_path is not None:
        cmd += ["--srt", str(srt_path)]
    if picks is not None:
        picks_path = Path(mp4_path).with_suffix(".picks.json")
        picks_path.write_text(json.dumps(picks, indent=2) + "\n")
        cmd += ["--picks", str(picks_path),
                "--history",
                str(Path(__file__).resolve().parent / "history.jsonl")]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    report_path = Path(str(mp4_path).replace(".mp4", ".critic.json"))
    if report_path.exists():
        return json.loads(report_path.read_text())
    raise RuntimeError(
        f"critic crashed (exit {r.returncode}): "
        f"{((r.stdout or '') + (r.stderr or '')).strip()[-500:]}"
    )


def critic_summary(report):
    """One-line summary for completionSteps, e.g.
    'critic: PASS (frame diffs 22.4/5.3/6.3, contrast 17.3)'.
    Narrated reports add the voice level + caption cue count."""
    checks = report.get("checks", {})
    diffs = checks.get("frames_differ", {}).get("numbers", {})
    contrast = checks.get("text_contrast", {}).get("number", "?")
    diff_str = "/".join(str(v) for v in diffs.values()) or "?"
    summary = (f"critic: {report.get('overall', '?')} "
               f"(frame diffs {diff_str}, contrast {contrast})")
    if "audio_present" in checks:
        audio = checks["audio_present"].get("number", "?")
        cues = checks.get("captions_present", {}).get("number", "?")
        summary += f" [narrated: voice {audio} dB, {cues} caption cues]"
    return summary


# ------------------------------------------------------- Phase 1 routing
# (Nov 22): the Harness route uses the Phase 1 router (registry +
# LRU rotation, draft-first) instead of skill_route + task-id
# rotation. The rung chain still keys off skill-pack names, so the
# route's style pick maps to the pack the rung expects; the narrated
# path keeps skill_route.
PHASE1_STYLE_SKILLS = {
    "product.demo": ["ecommerce-video-skills"],
    "ad.template": ["ad-video-skills"],
    "canvas.cut-paper": ["animate-canvas"],
    "canvas.crosshatch": ["animate-canvas"],
    "broll.cut-on-noun": ["b-roll-skills"],
    "explainer.diagram": ["explainer-video-skills"],
    "explainer.whiteboard": ["explainer-video-skills"],
    "explainer.isometric": ["explainer-video-skills"],
    "whatif.rig": ["what-if-animation"],
}


def phase1_skills_for(style):
    """Phase 1 style id -> skill-pack names the rung chain expects."""
    if not style:
        return []
    if style in PHASE1_STYLE_SKILLS:
        return list(PHASE1_STYLE_SKILLS[style])
    if style.startswith("everest."):
        return [f"everest-{style.split('.', 1)[1]}"]
    if style.startswith("canvas."):
        return ["animate-canvas"]
    if style.startswith("explainer."):
        return ["explainer-video-skills"]
    return []


def phase1_craft_notes(route):
    """One-line craft note from a Phase 1 route record."""
    parts = []
    if route.get("labelled"):
        parts.append(f"labelled: {route.get('label_source') or ''}")
    approx = route.get("approximation")
    if approx:
        note = approx.get("note") if isinstance(approx, dict) else str(approx)
        parts.append(f"APPROXIMATION: {note}")
    if route.get("reason"):
        parts.append(str(route["reason"]))
    for a in route.get("assumptions", []):
        parts.append(f"assumption: {a}")
    for p in route.get("placeholders", []):
        parts.append(f"placeholder: {p}")
    return "\n".join(parts) if parts else "phase1 route (registry rotation)"


# ------------------------------------------------------- brief translation
def parse_labels(details):
    """Explicit `Label: value` lines from the task details."""
    labels = {}
    for m in LABEL_RE.finditer(details or ""):
        labels[m.group(1).lower().replace(" ", "_")] = m.group(2).strip()
    return labels


def translate_to_brief(task, public_images):
    """Task -> (brief dict, composition, notes). Never invents details:
    anything not present in the task falls back to the schema defaults
    (which render.sh/Remotion apply when the field is omitted).

    Project name: ONLY an explicit `Project:` label in the task details
    ("Project: Reynard"). The Mission Control project title is NOT used
    — a task in the Motion Bot project (id 56) or assigned to the Motion
    Bot person (id 2) would otherwise render "Motion Bot" on screen.
    With no explicit label the brief carries NO project at all (never
    "Motion Bot", never "Untitled Project") and Generic renders no
    project name: the hook scene takes the extra time and the end card
    shows only the subtitle, if any."""
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    labels = parse_labels(details)

    brief = {"hook": title}

    # Project: explicit label only — see the docstring above.
    project = (labels.get("project") or "").strip()
    if project:
        brief["project"] = project

    # Subtitle: only from an explicit label — never from free text.
    subtitle = labels.get("subtitle") or labels.get("tagline") or labels.get("end_card")
    if subtitle:
        brief["subtitle"] = subtitle

    # Length: "Ns" / "N seconds" in the details (or a Length: label).
    length = None
    if labels.get("length") or labels.get("duration"):
        m = LENGTH_RE.search(labels.get("length") or labels.get("duration"))
        length = float(m.group(1)) if m else None
    if length is None:
        m = LENGTH_RE.search(details)
        length = float(m.group(1)) if m else None
    if length is not None:
        length = max(3, min(60, length))
        brief["lengthSeconds"] = int(length) if float(length).is_integer() else length

    # Colors: labeled hex codes win ("Background: #0F2A43"). Unlabeled hex
    # codes, only when no labels exist at all, fill background -> accent
    # -> text in order of appearance.
    colors = {}
    for key in ("background", "accent", "text"):
        if labels.get(key):
            m = HEX_RE.search(labels[key])
            if m:
                colors[key] = m.group(0).upper()
    if not colors:
        hexes = [h.upper() for h in HEX_RE.findall(details)]
        for key, value in zip(("background", "accent", "text"), hexes):
            colors[key] = value
    if colors:
        brief["colors"] = colors

    # Images: filenames in the details that actually exist under public/.
    # Only the first is used by the composition.
    images = []
    image_label = labels.get("image") or labels.get("images")
    candidates = []
    if image_label:
        candidates = re.findall(r"[\w\-.]+\.(?:jpg|jpeg|png|webp)", image_label, re.I)
    if not candidates:
        candidates = re.findall(
            r"[\w\-.]+\.(?:jpg|jpeg|png|webp)", details, re.I
        )
    for name in candidates:
        if name in public_images and name not in images:
            images.append(name)
    if images:
        brief["images"] = images

    # Composition: Signalwood only when the EXPLICIT project names it
    # ("Project: Signalwood"); otherwise Generic.
    composition = (
        "Signalwood" if "signalwood" in project.lower() else "Generic"
    )
    return brief, composition


# ------------------------------------------------------- Bot HQ interface
# Direct channel: D'Vaughn talks to Motion Bot on Bot HQ without
# filtering through Janine. Verbatim passthrough — HQ messages become
# tasks (or corrections) exactly as written. Runs BEFORE the queue
# loop so HQ tasks join this run's queue. Fail-silent throughout: an
# HQ outage, a missing key, or a bad message must never break renders.
HQ_USAGE = (
    "Send me a story or a task and I'll render it. "
    "To correct a clip, name it (task-NNN) and say what to change — "
    "I'll record it word for word and re-render. 'status' for the queue."
)


def _hq_status_text(snapshot_tasks):
    mine = [t for t in snapshot_tasks
            if t.get("projectId") == MOTION_BOT_PROJECT_ID
            or t.get("ownerId") == MOTION_BOT_PERSON_ID]
    counts = {}
    for t in mine:
        counts[t.get("status") or "?"] = counts.get(t.get("status") or "?", 0) + 1
    latest = ""
    try:
        import memory as _memory
        renders = _memory.load().get("renders") or []
        if renders:
            r = renders[-1]
            latest = (f" Latest render: {r.get('title')} "
                      f"(critic: {r.get('critic')}).")
    except Exception:
        pass
    return ("Motion Bot queue — " +
            ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())) +
            "." + latest)


def _find_verbatim_task(password, title, body, project_id, seen_task_ids):
    """Find an OPEN task in this bot's project with this exact title
    AND verbatim details, not already linked to another HQ message.
    Crash-window dedup (fix 2026-11-14): when a POST /api/tasks
    response is lost to the proxy, or the process dies before
    mark_seen, a retry must adopt the existing task, never create a
    second one. A live read-back, not the snapshot — the task may
    have been created seconds ago by this same run. Title-only
    matching is NOT enough: two different messages can share a
    first line. Status must be open (an in_progress task is already
    being worked). Tasks already in seen for another HQ message are
    excluded: they belong to that message. Raises on a failed /
    unparseable workspace read: the caller keeps the message
    pending rather than creating a possible duplicate."""
    resp = api("GET", "/api/workspace", password)
    ws = resp.get("data") if isinstance(resp, dict) else None
    if not isinstance(ws, dict) or not isinstance(ws.get("tasks"), list):
        raise RuntimeError("workspace read-back missing task list")
    for t in ws["tasks"]:
        if (t.get("projectId") == project_id
                and (t.get("title") or "") == title
                and (t.get("details") or "") == body
                and t.get("status") == "open"
                and t.get("id") not in seen_task_ids):
            return t
    return None


def _hq_handle_message(password, msg, origin, summary, status_text):
    """One HQ message -> command reply / correction / new task.
    Returns True when fully handled (safe to drop from pending)."""
    key = hq_bridge.load_key()
    hq_id = msg["id"]
    body = msg.get("body") or ""
    if key is None:
        return False
    # Idempotency: a message already in seen was fully handled once
    # (task created / correction applied / command answered). A crash
    # between handling and dropping pending must never duplicate it.
    if str(hq_id) in hq_bridge.load_seen():
        hq_bridge.drop_pending(hq_id)
        return True

    def _reply(text):
        hq_bridge.send_message(key, text, in_reply_to=hq_id)

    if hq_bridge.is_command(body, "status"):
        try:
            _reply(status_text)
        except Exception as e:
            log(f"HQ {hq_id}: status reply failed ({e})")
            return False
        hq_bridge.drop_pending(hq_id)
        hq_bridge.mark_seen(hq_id, None)
        summary["hq"].append({"hq_id": hq_id, "action": "status_reply"})
        return True

    if hq_bridge.is_command(body, "help"):
        try:
            _reply(HQ_USAGE)
        except Exception as e:
            log(f"HQ {hq_id}: help reply failed ({e})")
            return False
        hq_bridge.drop_pending(hq_id)
        hq_bridge.mark_seen(hq_id, None)
        summary["hq"].append({"hq_id": hq_id, "action": "help_reply"})
        return True

    corr = hq_bridge.correction_task_id(body)
    if corr is not None:
        try:
            from memory import record_correction
            record_correction(corr, body, applies_to=f"hq-{hq_id}")
        except Exception:
            pass
        try:
            resp = api("GET", f"/api/tasks/{corr}", password)
            cur = resp.get("data") if isinstance(resp, dict) else resp
            if not isinstance(cur, dict) or not cur.get("title"):
                raise RuntimeError("task not found")
            new_details = ((cur.get("details") or "").rstrip("\n")
                           + "\n\nCorrection from Bot HQ (verbatim):\n" + body)
            patch_task(password, corr, {"details": new_details,
                                        "status": "open",
                                        "blockingReason": ""})
        except Exception as e:
            log(f"HQ {hq_id}: correction for task-{corr} failed ({e})")
            try:
                _reply(f"Couldn't apply that correction to task-{corr} "
                       f"({e}). It stays as-is — nothing was changed.")
                hq_bridge.drop_pending(hq_id)
                hq_bridge.mark_seen(hq_id, corr)
                return True
            except Exception:
                return False
        origin[corr] = hq_id
        hq_bridge.drop_pending(hq_id)
        hq_bridge.mark_seen(hq_id, corr)
        summary["hq"].append({"hq_id": hq_id, "action": "correction",
                              "task_id": corr})
        return True

    title = hq_bridge.split_title(body)
    if not title:
        try:
            _reply("Empty message — nothing to task.")
        except Exception:
            return False
        hq_bridge.drop_pending(hq_id)
        hq_bridge.mark_seen(hq_id, None)
        summary["hq"].append({"hq_id": hq_id, "action": "empty_ignored"})
        return True

    # Crash-window dedup (fix 2026-11-14): a task with this exact
    # title AND verbatim body may already exist (the create landed
    # but the response was lost, or the process died before
    # mark_seen). Adopt it instead of creating a second task. A
    # read failure keeps the message pending — never create blind.
    seen_task_ids = set()
    for rec in hq_bridge.load_seen().values():
        tid = rec.get("task_id") if isinstance(rec, dict) else rec
        if tid:
            seen_task_ids.add(tid)
    try:
        existing = _find_verbatim_task(password, title, body,
                                       MOTION_BOT_PROJECT_ID,
                                       seen_task_ids)
    except Exception as e:
        log(f"HQ {hq_id}: verbatim check failed ({e}); kept in pending")
        return False
    if existing:
        tid = existing["id"]
        origin[tid] = hq_id
        hq_bridge.drop_pending(hq_id)
        hq_bridge.mark_seen(hq_id, tid)
        summary["hq"].append({"hq_id": hq_id, "action": "task_adopted",
                              "task_id": tid})
        return existing

    try:
        resp = api("POST", "/api/tasks", password, {
            "title": title, "status": "open", "priority": "normal",
            "projectId": MOTION_BOT_PROJECT_ID,
            "details": body, "completionSteps": body,
        })
    except Exception as e:
        log(f"HQ {hq_id}: task create failed ({e}); kept in pending")
        return False
    data = resp.get("data") if isinstance(resp, dict) else resp
    tid = data.get("id") if isinstance(data, dict) else None
    if not tid:
        # The create may have succeeded server-side while the
        # response was lost. Adopt the verbatim task instead of
        # creating a duplicate.
        try:
            adopted = _find_verbatim_task(password, title, body,
                                          MOTION_BOT_PROJECT_ID,
                                          seen_task_ids)
        except Exception as e:
            log(f"HQ {hq_id}: adopt check failed ({e}); kept in pending")
            return False
        if adopted:
            tid = adopted["id"]
            log(f"HQ {hq_id}: create response lost; adopted task {tid}")
        else:
            log(f"HQ {hq_id}: task create returned no id; kept in pending")
            return False
    # Created: record it BEFORE verifying, so a verify hiccup can never
    # duplicate the task on retry.
    origin[tid] = hq_id
    hq_bridge.drop_pending(hq_id)
    hq_bridge.mark_seen(hq_id, tid)
    try:
        resp = api("GET", f"/api/tasks/{tid}", password)
        cur = resp.get("data") if isinstance(resp, dict) else resp
        if isinstance(cur, dict) and cur.get("title"):
            queued_task = cur
        else:
            raise RuntimeError("verify read-back missing title")
    except Exception as e:
        log(f"HQ {hq_id}: task {tid} created but verify failed ({e}); "
            f"queued from the create response")
        queued_task = {"id": tid, "title": title, "status": "open",
                       "projectId": MOTION_BOT_PROJECT_ID,
                       "details": body, "completionSteps": body}
    summary["hq"].append({"hq_id": hq_id, "action": "task_created",
                          "task_id": tid})
    return queued_task


def _hq_step(password, snapshot_tasks, queued, summary):
    """Poll Bot HQ, task its messages, return {task_id: hq_id} for the
    reply step. Never raises."""
    origin = {}
    for hq_id, rec in hq_bridge.load_seen().items():
        tid = rec.get("task_id") if isinstance(rec, dict) else rec
        if tid:
            origin[tid] = hq_id
    key = hq_bridge.load_key()
    if key is None:
        log("HQ key missing; skipping HQ poll")
        return origin
    try:
        hq_bridge.heartbeat(key, detail="watcher run")
    except Exception as e:
        log(f"HQ heartbeat failed ({e}); continuing")
    status_text = _hq_status_text(snapshot_tasks)
    for msg in hq_bridge.load_pending():
        created = _hq_handle_message(password, msg, origin, summary,
                                     status_text)
        if isinstance(created, dict):
            queued.append(created)
            queued.sort(key=lambda t: t.get("id", 0))
    try:
        inbox = hq_bridge.poll_inbox(key)
    except Exception as e:
        log(f"HQ inbox poll failed ({e}); pending retries next run")
        return origin
    for msg in inbox:
        hq_bridge.add_pending(msg)
        created = _hq_handle_message(password, msg, origin, summary,
                                     status_text)
        if isinstance(created, dict):
            queued.append(created)
            queued.sort(key=lambda t: t.get("id", 0))
    return origin


# ------------------------------------------------------------------- main
def main():
    password = read_password()
    summary = {"tasks": [], "stale_in_progress": [], "errors": [],
               "hq": []}

    try:
        workspace = api("GET", "/api/workspace", password)["data"]
    except Exception as e:
        summary["errors"].append(f"GET /api/workspace failed: {e}")
        print(json.dumps(summary, indent=2))
        return 1

    tasks = workspace.get("tasks", [])
    public_images = {p.name for p in (REPO / "public").iterdir() if p.is_file()}

    queued = [
        t for t in tasks
        if t.get("status") == "open"
        and (t.get("projectId") == MOTION_BOT_PROJECT_ID
             or t.get("ownerId") == MOTION_BOT_PERSON_ID)
    ]
    queued.sort(key=lambda t: t.get("id", 0))

    # --- Bot HQ inbox (direct channel; never breaks renders) ---
    try:
        hq_origin = _hq_step(password, tasks, queued, summary)
    except Exception as e:
        log(f"HQ step failed ({e}); continuing without HQ")
        hq_origin = {}

    # --- recover stale claims from crashed runs (older than 3h) ---
    # A task is stale when no fresh watcher claim covers it AND its
    # updatedAt is missing or older than 3h (see is_stale_claim). A
    # missing updatedAt alone no longer skips the task forever.
    now = datetime.now(timezone.utc)
    claims = load_claims()
    for t in tasks:
        if t.get("status") != "in_progress":
            continue
        if not (t.get("projectId") == MOTION_BOT_PROJECT_ID
                or t.get("ownerId") == MOTION_BOT_PERSON_ID):
            continue
        if not is_stale_claim(t, claims, now):
            continue
        stale = {"task_id": t["id"], "title": t.get("title"),
                 "updatedAt": t.get("updatedAt")}
        existing = sorted((REPO / "out").glob(f"task-{t['id']}-*.mp4"))
        try:
            if existing:
                _done = mark_done(password, t["id"], (
                    "Motion Bot rendered (recovered stale claim): "
                    f"out/{existing[-1].name} — video file: "
                    f"~/workspace/repos/motion-bot/out/{existing[-1].name}"
                ))
                stale["recovery"] = ("marked done; mp4 already existed"
                                     if _done else
                                     "done skipped (status changed mid-run)")
                stale["mp4"] = str(existing[-1])
            else:
                patch_task(password, t["id"], {"status": "open"})
                stale["recovery"] = "reset to open for re-render"
        except Exception as e:
            stale["recovery"] = f"FAILED: {e}"
            summary["errors"].append(f"stale claim task {t['id']}: {e}")
        summary["stale_in_progress"].append(stale)

    # --- process the queue ---
    for task in queued:
        tid = task["id"]
        title = (task.get("title") or "").strip()
        entry = {"task_id": tid, "title": title or None,
                 "outcome": None, "mp4": None, "error": None}
        summary["tasks"].append(entry)
        try:
            # 0a. Story gate (v2.5, all tasks) — BEFORE claiming: a
            # task with no story NO LONGER waits on him. The bot
            # builds a 3-beat story from the task's own words,
            # writes it visibly into the task details as a Story:
            # block (labeled bot-built, so he can correct it), and
            # renders. Any v2.4 asked-record for the task is cleared.
            story_q = check_story(task)
            if story_q is not None:
                beats = auto_story(task)
                story_block = (
                    "\n\nStory (built by Motion Bot — no human story "
                    "supplied):\nStory: " + " | ".join(beats)
                )
                new_details = (task.get("details") or "") + story_block
                patch_task(password, tid, {"details": new_details})
                task["details"] = new_details
                entry["story_auto"] = beats
                log(f"task {tid}: auto-story built ({len(beats)} beats)")
            clear_asked(STORY_ASKED_PATH, tid)

            # 0. Question gate (v2.1, narrated tasks only) — BEFORE
            # claiming: a genuine creative fork leaves the task OPEN
            # and unclaimed. An unanswered question is skipped, not
            # re-asked; an edited task that resolves the fork clears
            # the record and renders.
            if is_narrated_task(task):
                gate_q = check_question(task)
                if gate_q is not None:
                    if is_asked(ASKED_PATH, tid):
                        entry["outcome"] = "awaiting_answer"
                        continue
                    posted = post_question_to_mc(password, task, gate_q)
                    record_asked(ASKED_PATH, tid, gate_q)
                    entry["question"] = gate_q.get("question")
                    entry["outcome"] = "question_asked"
                    entry["question"] = gate_q
                    entry["question_posted"] = posted
                    continue
                clear_asked(ASKED_PATH, tid)

            # 1. Claim first — never render twice.
            patch_task(password, tid, {"status": "in_progress"})
            record_claim(tid)

            # 2. No usable message text: block, ask for the hook.
            if not title:
                patch_task(password, tid, {
                    "status": "blocked",
                    "blockingReason": (
                        "Motion Bot needs a hook: this task has no title. "
                        "Add the video's message as the task title and "
                        "reopen it — the watcher will render it then."
                    ),
                })
                entry["outcome"] = "blocked"
                entry["error"] = "empty title: no hook to render"
                continue

            brief, composition = translate_to_brief(task, public_images)
            slug = f"task-{tid}-{slugify(title)}"
            entry["composition"] = composition

            # --- Narrated route (tasks asking for narration/voiceover) ---
            # Signalwood keeps its bespoke composition; everything else
            # that asks for narration goes Director -> prepare on the
            # iMac (stock fetch + Edge-TTS + captions) -> Narrated
            # render -> Critic. A narrated-step failure falls back to
            # the Harness route below (same pattern as Harness ->
            # Generic); a narrated Critic STRUCTURAL failure blocks
            # the task instead of falling back.
            rendered = False
            if composition != "Signalwood" and is_narrated_task(task):
                try:
                    # LLM Director first (default on), run ON THE
                    # IMAC — the VM cannot reach the Studio model
                    # directly (sandbox egress closes it). Any model
                    # or transport failure falls back to the
                    # deterministic Director silently — a down model
                    # never blocks a task.
                    nstoryboard = None
                    _route = skill_route((task.get("title") or "") + "\n" + (task.get("details") or ""))
                    entry["skills"] = _route["skills"]
                    _llm_task = dict(task)
                    _craft = craft_notes(_route)
                    _detail_pack = next((s for s in _route["skills"] if s != "motion-design-skills"), None)
                    if _detail_pack:
                        _craft += "\n" + load_skill_text(_detail_pack, 1500)
                    _llm_task["skill_craft"] = _craft
                    if os.environ.get("LLM_DIRECTOR", "1") != "0":
                        nstoryboard, llm_info = run_llm_via_imac(
                            _llm_task, IMAC_HOST, IMAC_REPO, IMAC_SSH,
                            IMAC_RSYNC_SSH)
                        if nstoryboard is not None:
                            entry["director"] = "llm"
                            entry["llm"] = llm_info
                        else:
                            entry["llm_fallback"] = str(
                                llm_info.get("reason", ""))[:300]
                            nstoryboard = None
                    if nstoryboard is None:
                        nstoryboard = build_narrated_storyboard(task)
                    nb_name = f"{slug}-narrated.json"
                    nb_path = REPO / "briefs" / nb_name
                    enriched_name = f"{slug}-narrated.enriched.json"
                    enriched_path = REPO / "briefs" / enriched_name
                    mp4_name = f"{slug}-narrated.mp4"
                    mp4_path = REPO / "out" / mp4_name
                    srt_name = f"{slug}-narrated.subtitles.srt"
                    srt_path = REPO / "out" / srt_name
                    nb_path.write_text(json.dumps(nstoryboard, indent=2) + "\n")
                    entry["brief"] = str(nb_path)
                    entry["composition"] = "Narrated"
                    # VM-side Pixabay fetch FIRST: the key lives in
                    # authd on this VM only, so stock is fetched +
                    # downloaded here and shipped to the iMac with the
                    # storyboard. A failure here is not fatal — the
                    # unenriched storyboard goes on and the iMac free
                    # ladder covers the scenes.
                    stock_dir = REPO / "out" / f"{slug}-narrated-stock"
                    try:
                        stock_summary = fetch_stock_on_vm(
                            nb_path, stock_dir, slug)
                        entry["stock"] = stock_summary
                        if stock_dir.exists() and any(stock_dir.iterdir()):
                            rsync_dir_to_imac(
                                stock_dir, f"public/narrated/{slug}",
                                bwlimit=400)
                    except Exception as e:
                        log(f"task {tid}: VM pixabay fetch failed "
                            f"(free ladder will cover it): {e}")
                        entry["stock_fallback"] = str(e)[:300]
                    rsync_dir_to_imac(REPO / "src", "src")
                    rsync_to_imac(nb_path, f"briefs/{nb_name}")
                    prepare_on_imac(f"briefs/{nb_name}",
                                    f"briefs/{enriched_name}")
                    rsync_from_imac(f"briefs/{enriched_name}", enriched_path)
                    # Global caption sidecar: prepare writes it next to
                    # the enriched storyboard on the iMac, named after
                    # the enriched file. Pulled before the render so a
                    # missing sidecar fails the step (fallback), not
                    # the finished clip.
                    imac_srt_rel = (
                        "briefs/"
                        + enriched_name.replace(".json", ".srt")
                    )
                    rsync_from_imac(imac_srt_rel, srt_path)
                    render_on_imac(f"briefs/{enriched_name}", "Narrated",
                                   f"out/{mp4_name}")
                    rsync_from_imac(f"out/{mp4_name}", mp4_path)
                    entry["mp4"] = str(mp4_path)
                    enriched = json.loads(enriched_path.read_text())
                    critic = run_critic(mp4_path, enriched_path,
                                        f"out/{mp4_name}", srt_path)
                    entry["critic"] = critic.get("overall")
                    structural_fail = [
                        name for name in CRITIC_STRUCTURAL_NARRATED
                        if critic.get("checks", {}).get(name, {}).get("status") == "FAIL"
                    ]
                    if structural_fail:
                        raise RuntimeError(
                            "critic structural FAIL ("
                            + ", ".join(structural_fail) + "): "
                            + critic_summary(critic)
                        )
                    _done = mark_done(password, tid, (
                        f"Motion Bot rendered (Narrated, "
                        f"{enriched.get('lengthSeconds', 12)}s): "
                        f"out/{mp4_name} — video file: "
                        f"~/workspace/repos/motion-bot/out/{mp4_name} — "
                        + critic_summary(critic)
                    ))
                    entry["outcome"] = ("rendered" if _done
                                        else "held-by-race (done skipped)")
                    try:
                        from memory import record_render as _mem_render
                        _mem_render(tid, title, "narrated",
                                    len(enriched.get("scenes") or []),
                                    critic.get("overall"), mp4_name)
                    except Exception:
                        pass
                    rendered = True
                except Exception as e:
                    if (isinstance(e, RuntimeError)
                            and str(e).startswith("critic structural FAIL")):
                        raise
                    log(f"task {tid}: narrated failed, falling back to Harness: {e}")
                    entry["narrated_fallback"] = str(e)[:300]
            if rendered:
                continue

            # --- Engine route (HyperFrames / huashu-motion, VM render) ---
            # Label-only: `engine: hyperframes` or `engine: huashu-motion`
            # in the brief details. Renders on this VM via
            # watcher/render_engine.py (no iMac hop, no telemetry).
            # Any failure falls back to the Harness route; a critic
            # STRUCTURAL failure blocks the task, same as Harness.
            rendered = False
            if composition != "Signalwood":
                try:
                    from render_engine import (  # noqa: E402
                        ENGINE_DURATIONS, engine_storyboard, render_engine)
                    _eroute = phase1_route(task)
                    _engine = _eroute.get("engine")
                    if _engine:
                        _edetails = task.get("details") or ""
                        _esub = ""
                        for _line in _edetails.splitlines():
                            _line = _line.strip()
                            if _line and not re.match(
                                    r"(?i)^[A-Za-z][A-Za-z ]*:", _line):
                                _esub = _line
                                break
                        _estoryboard = engine_storyboard(
                            _engine, title, _esub)
                        _esb_name = f"{slug}-engine.json"
                        _esb_path = REPO / "briefs" / _esb_name
                        _esb_path.write_text(
                            json.dumps(_estoryboard, indent=2) + "\n")
                        entry["brief"] = str(_esb_path)
                        entry["composition"] = _eroute.get("composition")
                        entry["engine"] = _engine
                        entry["format"] = "landscape"
                        _emp4_path = render_engine(
                            _engine, title, _esub, slug)
                        _emp4_name = _emp4_path.name
                        entry["mp4"] = str(_emp4_path)
                        _esverify = skill_verify(str(_emp4_path), {
                            "width": 1280, "height": 720,
                            "min_duration_s": ENGINE_DURATIONS[_engine] - 1.0})
                        entry["skill_verify"] = _esverify
                        if not _esverify["structural_ok"]:
                            raise RuntimeError(
                                "critic structural FAIL (skill_verify: "
                                + "; ".join(_esverify["mismatches"]) + ")")
                        _ecritic = run_critic(
                            _emp4_path, _esb_path, f"out/{_emp4_name}",
                            picks=_eroute)
                        entry["critic"] = _ecritic.get("overall")
                        _estructural = [
                            name for name in CRITIC_STRUCTURAL
                            if _ecritic.get("checks", {}).get(name, {}).get("status") == "FAIL"
                        ]
                        if _estructural:
                            raise RuntimeError(
                                "critic structural FAIL ("
                                + ", ".join(_estructural) + "): "
                                + critic_summary(_ecritic))
                        _evariety = _ecritic.get("checks", {}).get("variety", {})
                        if _evariety.get("status") == "FAIL":
                            raise RuntimeError(
                                "critic variety FAIL (Check 8): "
                                + _evariety.get("detail", ""))
                        try:
                            _eapprox = _eroute.get("approximation")
                            _eapprox_note = (
                                _eapprox.get("note")
                                if isinstance(_eapprox, dict) else str(_eapprox or ""))
                            phase1_append_run({
                                "brief_id": f"task-{tid}",
                                "brief_title": title,
                                "picks": {k: _eroute.get(k) for k in
                                          ("panel", "variant", "font", "motion",
                                           "kinetic", "move", "style",
                                           "composition", "format")
                                          if _eroute.get(k) is not None},
                                "critic": {"overall": _ecritic.get("overall"),
                                           "checks": {k: v.get("status") for k, v in
                                                      _ecritic.get("checks", {}).items()},
                                           "summary": critic_summary(_ecritic)},
                                "labelled": bool(_eroute.get("labelled")),
                                "label": _eroute.get("label_source") or "",
                                "approximation": _eapprox_note,
                                "assumptions": _eroute.get("assumptions", []),
                                "placeholders": _eroute.get("placeholders", []),
                                "repicks": [],
                                "delivery_note": "",
                                "mp4": _emp4_name,
                                "storyboard": _esb_name,
                                "tag": "live",
                                "composition": _eroute.get("composition"),
                                "forced": False,
                                "expect": {},
                            })
                        except Exception as _h_e:
                            log(f"task {tid}: phase1 history append failed: {_h_e}")
                        _done = mark_done(password, tid, (
                            f"Motion Bot rendered ({_eroute.get('composition')}, "
                            f"{ENGINE_DURATIONS[_engine]}s): "
                            f"out/{_emp4_name} — video file: "
                            f"~/workspace/repos/motion-bot/out/{_emp4_name} — "
                            + critic_summary(_ecritic)
                        ))
                        entry["outcome"] = ("rendered" if _done
                                            else "held-by-race (done skipped)")
                        try:
                            from memory import record_render as _mem_render
                            _mem_render(tid, title, "engine", 1,
                                        _ecritic.get("overall"), _emp4_name)
                        except Exception:
                            pass
                        rendered = True
                except Exception as e:
                    if (isinstance(e, RuntimeError)
                            and (str(e).startswith("critic structural FAIL")
                                 or str(e).startswith("critic variety FAIL"))):
                        raise
                    log(f"task {tid}: engine failed, falling back to Harness: {e}")
                    entry["engine_fallback"] = str(e)[:300]
            if rendered:
                continue

            # --- Harness route (default for non-Signalwood tasks) ---
            # Signalwood keeps its bespoke composition; everything else
            # goes through the Director -> Harness, with Generic as the
            # fallback if any Harness step fails. A critic STRUCTURAL
            # failure (identical/blank frames, wrong probe) means the
            # video itself is broken — that re-raises to block the task
            # instead of falling back and shipping a broken clip.
            rendered = False
            if composition != "Signalwood":
                try:
                    # Phase 1 routing (Nov 22): the registry router
                    # picks panel/variant/font/motion/kinetic/move/
                    # style by label, content fit, then LRU — the
                    # old skill_route + task-id rotation is retired
                    # for the Harness route (narrated keeps it).
                    # The route dict gains a "skills" key so the rung
                    # chain below reads it unchanged.
                    # Writer stage (Harness route only — NOT narrated,
                    # NOT Signalwood): condense the task into 2-5
                    # capped beats BEFORE routing, so the router's
                    # content fit and the Director's scenes both read
                    # the beats. ANY Writer failure falls back to the
                    # deterministic path (beats=None). Kill-switch:
                    # MOTION_BOT_WRITER=0 disables the Writer.
                    _beats = None
                    _writer_info = {"fallback": True,
                                    "reason": "writer disabled"}
                    if os.environ.get("MOTION_BOT_WRITER", "1") != "0":
                        try:
                            _beats, _writer_info = write_beats(
                                title, task.get("details") or "")
                        except Exception as _w_e:  # noqa: BLE001
                            _beats = None
                            _writer_info = {
                                "fallback": True,
                                "reason": f"write_beats raised: {_w_e}"[:300]}
                    if _beats:
                        entry["writer"] = {
                            "model": _writer_info.get("model"),
                            "endpoint": _writer_info.get("endpoint"),
                            "attempts": _writer_info.get("attempts"),
                            "beats": len(_beats),
                        }
                    else:
                        entry["writer_fallback"] = str(
                            _writer_info.get("reason", ""))[:300]
                    _route = phase1_route(task, beats=_beats)
                    _route["skills"] = phase1_skills_for(_route.get("style"))
                    storyboard = build_storyboard(
                        task, route=_route, beats=_beats,
                        writer_info=_writer_info)
                    if not _beats:
                        storyboard.setdefault("notes", []).append(
                            "writer fallback: "
                            + str(_writer_info.get("reason", ""))[:200])
                    storyboard["skills"] = _route["skills"]
                    storyboard["format"] = _route.get("format", "landscape")
                    storyboard["craft_notes"] = phase1_craft_notes(_route)
                    _composition = "Vertical" if _route.get("format") == "vertical" else "Harness"
                    _codec = None
                    _labels = parse_labels(task.get("details") or "")
                    _rows = parse_data_rows(task.get("details") or "")
                    _style = _route.get("style") or ""
                    if _rows or _style.startswith("chart."):
                        # Chart rung (v2.3, v2.8): data rows ALONE fire
                        # the chart — a task carrying Data: rows is a
                        # data task, no chart trigger words needed.
                        # Numbers from the task, nothing invented.
                        # Count-up / build-and-hold live in Chart.tsx
                        # (v2.8); Unit:/Mode: labels pass through.
                        # Phase 1 draft-first: a chart-style pick
                        # with no numbers still renders, with
                        # placeholder bars — never a refusal. Writer
                        # bars (storyboard["bars"] from stat beats)
                        # are real brief numbers: never overwritten
                        # with placeholders, and explicit Data: rows
                        # win over them when present.
                        if not _rows and not storyboard.get("bars"):
                            _rows = draft_data_rows(task.get("details") or "")
                            storyboard.setdefault("notes", []).append(
                                "phase1 draft: chart brief carries no "
                                "numbers — placeholder bars "
                                "[VALUE 1/2 NEEDED] at 0; add Data: "
                                "rows and re-render")
                        _composition = "Chart"
                        if _labels.get("chart", "").lower() == "d3" or _style == "chart.d3":
                            # D3 rung (Nov 3 2026, opt-in only): d3 scales
                            # lay out the same bars; default Chart unchanged.
                            # The route pick honors an LRU d3 pick too —
                            # without this the record would claim D3Chart
                            # while the rung rendered Chart.
                            _composition = "D3Chart"
                        if _rows:
                            storyboard["bars"] = _rows
                        storyboard["chartTitle"] = storyboard.get("hook", "")
                        if _labels.get("unit"):
                            storyboard["unit"] = _labels["unit"]
                        if _labels.get("mode", "").lower() in ("bars", "stats"):
                            storyboard["mode"] = _labels["mode"].lower()
                        elif _style == "chart.stats":
                            storyboard["mode"] = "stats"
                        elif _style == "chart.count-up":
                            storyboard["mode"] = "bars"
                    elif "ecommerce-video-skills" in _route["skills"] or _labels.get("product"):
                        # Product-demo rung (v2.8): ProductDemo comp.
                        # build_product_demo returns None without a
                        # product (Product: label, else the title when
                        # the ecommerce trigger matched) — no invented
                        # product, and money only from labels.
                        _demo = build_product_demo(
                            task, storyboard,
                            ecommerce_matched=("ecommerce-video-skills" in _route["skills"]),
                            draft=True)
                        if _demo:
                            _composition = "ProductDemo"
                            storyboard["product"] = _demo["product"]
                            storyboard["features"] = _demo["features"]
                            storyboard["offer"] = _demo["offer"]
                            storyboard["cta"] = _demo["cta"]
                            storyboard["scenes"] = _demo["scenes"]
                            _demo_len = storyboard.get("lengthSeconds") or 15
                            storyboard["lengthSeconds"] = (
                                _demo_len if 12 <= _demo_len <= 30 else 15)
                    elif "ad-video-skills" in _route["skills"]:
                        # Ad rung (v2.7): data-driven AdTemplate. The
                        # variant comes only from the task (labels or
                        # story beats) — never invented copy. Length is
                        # the task's own when it fits the 15–30s ad
                        # anatomy, else 25s (CTA hold >= 2s needs it).
                        _ad = build_ad_variant(task, storyboard)
                        if _ad:
                            _composition = "AdTemplate"
                            storyboard["variant"] = _ad["variant"]
                            storyboard["testField"] = _ad["testField"]
                            storyboard["scenes"] = ad_beat_scenes(_ad["variant"])
                            _ad_len = storyboard.get("lengthSeconds") or 25
                            storyboard["lengthSeconds"] = (
                                _ad_len if 15 <= _ad_len <= 30 else 25)
                    elif "animate-canvas" in _route["skills"]:
                        # Canvas rung (v2.7): cut-paper / crosshatch as
                        # Remotion code. pick_canvas_style returns None
                        # for the five unimplemented styles — those
                        # tasks keep the default route, craft notes only.
                        _style = pick_canvas_style(
                            task, storyboard["notes"],
                            style=_style.split(".", 1)[1]
                            if _style.startswith("canvas.") else None)
                        if _style:
                            _composition = "CanvasStyles"
                            storyboard["canvasStyle"] = _style
                    elif "b-roll-skills" in _route["skills"]:
                        # B-roll rung (v2.7): cuts on the noun from the
                        # local pool, panel fallback when no clip
                        # matches. The storyboard drops its palette:
                        # footage has no palette, and the critic SKIPs
                        # palette/contrast when none is present.
                        _beats = [list(s["words"]) for s in storyboard["scenes"]]
                        _segments, _total, _bnotes = build_broll_segments(
                            _beats,
                            length_seconds=storyboard.get("lengthSeconds"))
                        if _segments:
                            _composition = "BRoll"
                            storyboard["segments"] = _segments
                            storyboard["lengthSeconds"] = _total
                            storyboard["notes"].extend(_bnotes)
                            storyboard.pop("palette", None)
                    elif any(p.startswith("everest-") for p in _route["skills"]) or _labels.get("everest"):
                        # Everest rung (v2.8): EverestPanels comp, one
                        # category prop. build_everest_panel returns
                        # None when the category's numbers are absent
                        # (or for broll-frames, which is DROPPED) —
                        # those tasks keep the default route, craft
                        # notes only, never an invented figure. The
                        # Everest: label fires the rung on its own —
                        # the router's everest triggers are narrow
                        # multi-word phrases, so a bare label would
                        # otherwise never reach the panel code.
                        _everest = build_everest_panel(
                            task, storyboard, _route["skills"], draft=True)
                        if _everest:
                            _composition = "EverestPanels"
                            storyboard["category"] = _everest["category"]
                            for _k in ("prompt", "steps", "outputLines",
                                       "bars", "tiers", "usage", "name",
                                       "role", "pills", "quote",
                                       "highlight", "comparison",
                                       "version", "receipt", "wasPrice",
                                       "nowPrice", "project"):
                                if _k in _everest:
                                    storyboard[_k] = _everest[_k]
                            storyboard["scenes"] = _everest["scenes"]
                    elif "synthwave-style" in _route["skills"] and _route["format"] != "vertical":
                        # Synthwave rung (v2.3): purple-free style preset.
                        _composition = "Synthwave"
                    elif "explainer-video-skills" in _route["skills"]:
                        # Explainer rung (v2.9): one idea per scene,
                        # build-and-hold, end-card recap. build_explainer
                        # returns None when the task carries no ideas —
                        # those tasks keep the default route, craft
                        # notes only, never an invented diagram.
                        _explainer = build_explainer(
                            task, storyboard, draft=True,
                            style=(_route.get("style") or "").split(".", 1)[1]
                            if (_route.get("style") or "").startswith("explainer.")
                            else None)
                        if _explainer:
                            _composition = "Explainer"
                            # Top-level keys: the brief IS the props.
                            storyboard["ideas"] = _explainer["ideas"]
                            storyboard["style"] = _explainer["style"]
                            storyboard["cta"] = _explainer["cta"]
                            storyboard["scenes"] = _explainer["scenes"]
                            storyboard["lengthSeconds"] = _explainer[
                                "lengthSeconds"]
                    elif "what-if-animation" in _route["skills"]:
                        # What If rung (v2.11): WhatIf comp, dusk
                        # stick-figure rig. Placed after Explainer on
                        # purpose: a task matching both ("explain what
                        # if...") keeps the pre-v2.11 Explainer route;
                        # a pure what-if task falls through the earlier
                        # rungs (none match its narrow triggers) to
                        # here. build_whatif returns None without
                        # Power + 3 Demo lines + Fact + Question —
                        # those tasks keep the default route, craft
                        # notes only, never an invented fact, demo, or
                        # number. Silent: no ElevenLabs voiceover is
                        # wired. The comp is 720x1280, so the route
                        # format flips to vertical for the
                        # expected-dimensions check.
                        _whatif = build_whatif(task, storyboard, draft=True)
                        if _whatif:
                            _composition = "WhatIf"
                            _route["format"] = "vertical"
                            storyboard["whatif"] = _whatif["whatif"]
                            storyboard["lengthSeconds"] = _whatif["lengthSeconds"]
                            storyboard["story"] = _whatif["story"]
                            storyboard["scenes"] = _whatif["scenes"]
                    elif _labels.get("name"):
                        # Lower-third rung (v2.3, v2.10): transparent
                        # overlay export. v2.10: a Name: label ALONE
                        # fires the rung — the old condition also
                        # required lower-thirds-skills in the route,
                        # and the router's triggers are narrow
                        # ("lower third", "name card"...), so a bare
                        # Name: label never reached the overlay.
                        # Pills:/Source: ride along when present.
                        _composition = "LowerThird"
                        _codec = "alpha-prores"
                        storyboard = {
                            "name": _labels["name"],
                            "role": _labels.get("role", ""),
                            "pills": [p.strip() for p in
                                      re.split(r"[,|]", _labels.get("pills", ""))
                                      if p.strip()][:4],
                            "source": _labels.get("source", ""),
                            "palette": storyboard.get("palette"),
                            "lengthSeconds": 6,
                            "skills": _route["skills"],
                            "format": "overlay",
                        }
                    sb_name = f"{slug}-harness.json"
                    sb_path = REPO / "briefs" / sb_name
                    mp4_name = f"{slug}-harness.mov" if _composition == "LowerThird" else f"{slug}-harness.mp4"
                    mp4_path = REPO / "out" / mp4_name
                    sb_path.write_text(json.dumps(storyboard, indent=2) + "\n")
                    entry["brief"] = str(sb_path)
                    entry["composition"] = _composition
                    entry["skills"] = _route["skills"]
                    entry["format"] = _route["format"]
                    rsync_dir_to_imac(REPO / "src", "src")
                    rsync_to_imac(sb_path, f"briefs/{sb_name}")
                    if _composition == "BRoll":
                        # Pool clips live outside git (gitignored *.mp4)
                        # in public/broll/; ship each used clip to the
                        # iMac's public/ so staticFile() resolves it.
                        for _seg in storyboard.get("segments", []):
                            _clip = _seg.get("clip") or ""
                            if not _clip.startswith("broll/"):
                                continue
                            _local = REPO / "public" / _clip
                            if _local.exists():
                                rsync_to_imac(_local, f"public/{_clip}")
                            else:
                                log(f"task {tid}: b-roll clip missing "
                                    f"locally, segment falls back: {_clip}")
                    render_on_imac(f"briefs/{sb_name}", _composition,
                                   f"out/{mp4_name}", codec=_codec)
                    rsync_from_imac(f"out/{mp4_name}", mp4_path)
                    entry["mp4"] = str(mp4_path)
                    if _composition == "LowerThird":
                        # Alpha is the whole point of the overlay: a webm
                        # without an alpha channel is a failed export.
                        if not has_alpha(str(mp4_path)):
                            raise RuntimeError(
                                "critic structural FAIL (skill_verify: "
                                "lower-third export has no alpha channel)")
                        entry["skill_verify"] = {"alpha": True}
                        entry["critic"] = "alpha-ok"
                        try:
                            _approx = _route.get("approximation")
                            _approx_note = (
                                _approx.get("note")
                                if isinstance(_approx, dict) else str(_approx or ""))
                            phase1_append_run({
                                "brief_id": f"task-{tid}",
                                "brief_title": title,
                                "picks": {k: _route.get(k) for k in
                                          ("panel", "variant", "font", "motion",
                                           "kinetic", "move", "style",
                                           "composition", "format")
                                          if _route.get(k) is not None},
                                "critic": {"overall": "PASS",
                                           "checks": {"alpha": "PASS"},
                                           "summary": "alpha-ok"},
                                "labelled": bool(_route.get("labelled")),
                                "label": _route.get("label_source") or "",
                                "approximation": _approx_note,
                                "assumptions": _route.get("assumptions", []),
                                "placeholders": _route.get("placeholders", []),
                                "repicks": [],
                                "delivery_note": "",
                                "mp4": mp4_name,
                                "storyboard": sb_name,
                                "tag": "live",
                                "composition": _composition,
                                "forced": False,
                                "expect": {},
                            })
                        except Exception as _h_e:
                            log(f"task {tid}: phase1 history append failed: {_h_e}")
                        _done = mark_done(password, tid, (
                            f"Motion Bot rendered (LowerThird, transparent ProRes .mov): "
                            f"out/{mp4_name} — video file: "
                            f"~/workspace/repos/motion-bot/out/{mp4_name}"
                        ))
                        entry["outcome"] = ("rendered" if _done
                                            else "held-by-race (done skipped)")
                        try:
                            from memory import record_render as _mem_render
                            _mem_render(tid, title, "lower-third", 0,
                                        "alpha-ok", mp4_name)
                        except Exception:
                            pass
                        rendered = True
                        continue
                    _expected = {"width": 720, "height": 1280} if _route["format"] == "vertical" else {"width": 1280, "height": 720}
                    _expected["min_duration_s"] = max(1.0, storyboard.get("lengthSeconds", 12) - 1.5)
                    _sverify = skill_verify(str(mp4_path), _expected)
                    entry["skill_verify"] = _sverify
                    if not _sverify["structural_ok"]:
                        raise RuntimeError(
                            "critic structural FAIL (skill_verify: "
                            + "; ".join(_sverify["mismatches"]) + ")")
                    critic = run_critic(mp4_path, sb_path, f"out/{mp4_name}",
                                        picks=_route)
                    entry["critic"] = critic.get("overall")
                    structural_fail = [
                        name for name in CRITIC_STRUCTURAL
                        if critic.get("checks", {}).get(name, {}).get("status") == "FAIL"
                    ]
                    if structural_fail:
                        raise RuntimeError(
                            "critic structural FAIL ("
                            + ", ".join(structural_fail) + "): "
                            + critic_summary(critic)
                        )
                    # Check 8 (Phase 1): a repeat ships never — the
                    # run stops here and the task stays open for the
                    # next sweep (fresh route), instead of falling
                    # back to Generic and delivering a repeat clip.
                    # The router's own cooldown loop re-picks at route
                    # time, so this fires only when it missed one.
                    _variety = critic.get("checks", {}).get("variety", {})
                    if _variety.get("status") == "FAIL":
                        raise RuntimeError(
                            "critic variety FAIL (Check 8): "
                            + _variety.get("detail", ""))
                    # Opt-in silence cut (Nov 3 2026): ONLY when details
                    # carry `Silence-cut: on`. Runs on the iMac (where
                    # auto-editor lives) and is ffprobe-verified before
                    # the delivered file swaps; any failure keeps the
                    # original clip and is recorded, never blocks.
                    _sc_note = ""
                    if _labels.get("silence-cut", "").lower() == "on":
                        try:
                            from auto_editor import (
                                command as _ae_cmd,
                                verify as _ae_verify,
                            )
                            _cut_name = f"{slug}-silencecut.mp4"
                            _cut_rel = f"out/{_cut_name}"
                            _r = run([IMAC_SSH, f"cd {IMAC_REPO} && {_ae_cmd(f'out/{mp4_name}', _cut_rel)}"], timeout=300)
                            if _r.returncode == 0:
                                _cut_path = REPO / "out" / _cut_name
                                rsync_from_imac(_cut_rel, _cut_path)
                                _ok, _detail = _ae_verify(str(mp4_path), str(_cut_path))
                                entry["silence_cut"] = _detail
                                if _ok:
                                    mp4_name, mp4_path = _cut_name, _cut_path
                                    entry["mp4"] = str(mp4_path)
                                    _sc_note = " (silence-cut applied)"
                            else:
                                entry["silence_cut"] = {"ok": False, "reason": "auto-editor exited non-zero"}
                        except Exception as _ae_e:
                            entry["silence_cut"] = {"ok": False, "reason": str(_ae_e)[:300]}
                    # Opt-in finishing pass (v2.9, ffmpeg-finishing):
                    # ONLY when details carry `Finish:` (e.g.
                    # `Finish: fade+loudness+thumbnail` or
                    # `Finish: preset reels`). Runs on the iMac
                    # (watcher/finishing.py), never overwrites the
                    # source; any failure keeps the original clip and
                    # is recorded, never blocks. The critic already
                    # ran on the pre-finish clip; the finished file
                    # is probe-verified (same duration/dims) before
                    # the delivered file swaps.
                    _fin_note = ""
                    _finish = (_labels.get("finish") or "").strip().lower()
                    if _finish and _finish not in ("off", "no", "none"):
                        try:
                            _preset = ""
                            for _p in ("reels", "shorts", "youtube", "x",
                                       "linkedin", "facebook"):
                                if _p in _finish:
                                    _preset = f" --preset {_p}"
                                    break
                            _fin_name = f"{slug}-finished.mp4"
                            _fin_rel = f"out/{_fin_name}"
                            _r = run([IMAC_SSH,
                                      f"cd {IMAC_REPO} && python3 watcher/finishing.py "
                                      f"out/{mp4_name} --out {_fin_rel}{_preset} --json"],
                                     timeout=600)
                            if _r.returncode == 0:
                                _fin_path = REPO / "out" / _fin_name
                                rsync_from_imac(_fin_rel, _fin_path)
                                _fin_detail = json.loads(_r.stdout or "{}")
                                entry["finishing"] = _fin_detail
                                mp4_name, mp4_path = _fin_name, _fin_path
                                entry["mp4"] = str(mp4_path)
                                _fin_note = " (finishing pass applied)"
                            else:
                                entry["finishing"] = {
                                    "ok": False,
                                    "reason": ((_r.stderr or _r.stdout or "")
                                               .strip()[-300:])}
                        except Exception as _fin_e:
                            entry["finishing"] = {"ok": False,
                                                  "reason": str(_fin_e)[:300]}
                    # Phase 1 history: every render is logged; the
                    # Router reads this log, never the model. The
                    # record carries the FINAL mp4 (after any
                    # finishing pass) and the shipped picks.
                    try:
                        _approx = _route.get("approximation")
                        _approx_note = (
                            _approx.get("note")
                            if isinstance(_approx, dict) else str(_approx or ""))
                        phase1_append_run({
                            "brief_id": f"task-{tid}",
                            "brief_title": title,
                            "picks": {k: _route.get(k) for k in
                                      ("panel", "variant", "font", "motion",
                                       "kinetic", "move", "style",
                                       "composition", "format")
                                      if _route.get(k) is not None},
                            "critic": {"overall": critic.get("overall"),
                                       "checks": {k: v.get("status") for k, v in
                                                  critic.get("checks", {}).items()},
                                       "summary": critic_summary(critic)},
                            "labelled": bool(_route.get("labelled")),
                            "label": _route.get("label_source") or "",
                            "approximation": _approx_note,
                            "assumptions": _route.get("assumptions", []),
                            "placeholders": _route.get("placeholders", []),
                            "repicks": [],
                            "delivery_note": "",
                            "mp4": mp4_name,
                            "storyboard": sb_name,
                            "tag": "live",
                            "composition": _composition,
                            "forced": False,
                            "expect": {},
                        })
                    except Exception as _h_e:
                        log(f"task {tid}: phase1 history append failed: {_h_e}")
                    _done = mark_done(password, tid, (
                        f"Motion Bot rendered ({_composition}, "
                        f"{storyboard.get('lengthSeconds', 12)}s): "
                        f"out/{mp4_name} — video file: "
                        f"~/workspace/repos/motion-bot/out/{mp4_name} — "
                        + critic_summary(critic)
                        + _sc_note
                        + _fin_note
                    ))
                    entry["outcome"] = ("rendered" if _done
                                        else "held-by-race (done skipped)")
                    try:
                        from memory import record_render as _mem_render
                        _story = storyboard.get("story") or {}
                        _mem_render(tid, title, _story.get("source", "title"),
                                    len(_story.get("beats") or [])
                                    or len(storyboard.get("scenes") or []),
                                    critic.get("overall"), mp4_name)
                    except Exception:
                        pass
                    rendered = True
                except Exception as e:
                    if (isinstance(e, RuntimeError)
                            and (str(e).startswith("critic structural FAIL")
                                 or str(e).startswith("critic variety FAIL"))):
                        raise
                    log(f"task {tid}: harness failed, falling back to Generic: {e}")
                    entry["harness_fallback"] = str(e)[:300]
            if rendered:
                continue

            # --- Generic / Signalwood path (fallback, or Signalwood) ---
            brief_name = f"{slug}.json"
            mp4_name = f"{slug}.mp4"
            brief_path = REPO / "briefs" / brief_name
            mp4_path = REPO / "out" / mp4_name
            entry["brief"] = str(brief_path)
            entry["composition"] = composition

            # 3. Brief to the iMac (Signalwood uses its fixed brief file;
            #    the composition's text is bespoke, the brief is only the
            #    render.sh argument).
            brief_path.write_text(json.dumps(brief, indent=2) + "\n")
            if composition == "Signalwood":
                brief_rel = "briefs/signalwood-proof.json"
            else:
                rsync_to_imac(brief_path, f"briefs/{brief_name}")
                brief_rel = f"briefs/{brief_name}"

            # 4. Render on the iMac.
            render_on_imac(brief_rel, composition, f"out/{mp4_name}")

            # 5. MP4 back, md5-verified.
            rsync_from_imac(f"out/{mp4_name}", mp4_path)
            entry["mp4"] = str(mp4_path)

            # 6. Mark done with the video location.
            fallback_note = (
                f" (Generic fallback: {entry['harness_fallback']})"
                if entry.get("harness_fallback") else ""
            )
            _done = mark_done(password, tid, (
                f"Motion Bot rendered ({composition}, "
                f"{brief.get('lengthSeconds', 12)}s): out/{mp4_name} — "
                f"video file: ~/workspace/repos/motion-bot/out/{mp4_name}"
                f"{fallback_note}"
            ))
            entry["outcome"] = ("rendered" if _done
                                else "held-by-race (done skipped)")
            try:
                from memory import record_render as _mem_render
                _mem_render(tid, title, "generic",
                            len(brief.get("scenes") or []),
                            "not-criticized", mp4_name)
            except Exception:
                pass
        except Exception as e:
            entry["outcome"] = "failed"
            entry["error"] = str(e)[:1000]
            log(f"task {tid} failed: {e}")
            try:
                patch_task(password, tid, {
                    "status": "blocked",
                    "blockingReason": f"Motion Bot render failed: {str(e)[:500]}",
                })
                entry["outcome"] = "blocked"
            except Exception as e2:
                summary["errors"].append(f"task {tid}: could not mark blocked: {e2}")

    # --- Bot HQ replies (verbatim results back to the dashboard) ---
    # Fail-silent: a reply failure is logged, never an error — the MC
    # record is the source of truth, HQ is the notification channel.
    if hq_origin:
        _hq_key = hq_bridge.load_key()
        if _hq_key is not None:
            for entry in summary["tasks"]:
                hq_id = hq_origin.get(entry["task_id"])
                if not hq_id:
                    continue
                outcome = entry.get("outcome")
                if outcome == "rendered":
                    text = (f"Rendered: {entry.get('title')} — "
                            f"{entry.get('mp4')} "
                            f"(critic: {entry.get('critic')})")
                    kind = "render"
                elif outcome == "blocked":
                    text = (f"Blocked: {entry.get('title')} — "
                            f"{entry.get('error') or 'see Mission Control'}")
                    kind = "blocked"
                elif outcome == "question_asked":
                    text = (entry.get("question")
                            or "A question is waiting on this task — "
                               "see Mission Control.")
                    kind = "question"
                else:
                    continue
                try:
                    hq_bridge.send_message(_hq_key, text,
                                           in_reply_to=hq_id)
                    hq_bridge.post_event(_hq_key, kind,
                                         entry.get("title")
                                         or f"task-{entry['task_id']}",
                                         text[:300])
                except Exception as e:
                    log(f"HQ reply for task {entry['task_id']} failed ({e})")

    print(json.dumps(summary, indent=2))
    return 0 if not summary["errors"] else 1


if __name__ == "__main__":
    sys.exit(main())
