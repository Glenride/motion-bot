#!/usr/bin/env python3
"""Phase 1 — History log and rotation state (Video Bot PRD, Sections 5-6).

History is a log, not a memory. Every render appends ONE JSON line to
history.jsonl: date, brief, the registry IDs used (panel, variant,
motion, font, kinetic, move, style, format), whether the pick was
labelled, any approximation, assumptions/placeholders, and the Critic
result (including fail-and-repick events). The Router reads this log;
the model is never asked to remember what it did last time.

After every run this module also updates the registry file itself:
each picked entry's last_used_at becomes the run timestamp and its
use_count increments by one. That is what makes least-recently-used
rotation possible — without it, "pick something different" is a wish,
not a mechanism.

Cooldowns (PRD Section 5):
  - No panel-and-motion pair may repeat within the last 5 renders.
  - No single primary style family may take more than 2 of the last
    5 renders. "Primary style family" is the family of the run's
    distinguishing style entry (chart, product-demo, explainer,
    tiktok, canvas, everest, whatif, ad, broll, lower-third,
    synthwave, or "default" for a plain Harness/Vertical clip).
    Panels, motions, fonts, variants and kinetic reveals are present
    in nearly every render, so they are not the family counted here —
    they are covered by the pair cooldown and by LRU instead.
  - An explicit user label overrides rotation by design; the log
    records it as a labelled override.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

WATCHER_DIR = Path(__file__).resolve().parent
HISTORY_PATH = WATCHER_DIR / "history.jsonl"
REGISTRY_PATH = WATCHER_DIR / "style_registry.json"

COOLDOWN_WINDOW = 5
FAMILY_CAP = 2

# Reveal-kind moves replace the kinetic reveal and the v2.6 motion
# as the word-entry actually rendered. Mirrors
# phase1_router.effective_entry — duplicated here (not imported)
# because phase1_router imports this module.
REVEAL_MOVES = {
    "pop-in", "stagger", "mask-reveal", "typewriter", "count-up",
    "kinetic-type",
}


def effective_entry(picks):
    """The word-entry actually rendered for a picks dict: a
    reveal-kind move wins, then a non-word kinetic reveal, then
    the v2.6 motion. Returns a registry id."""
    picks = picks or {}
    move = picks.get("move")
    if move and move.replace("move.", "") in REVEAL_MOVES:
        return move
    kinetic = picks.get("kinetic")
    if kinetic and kinetic != "kinetic.word":
        return kinetic
    return picks.get("motion") or "motion.kinetic"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_history(limit=None):
    """All run records, oldest first. Missing file -> []."""
    if not HISTORY_PATH.exists():
        return []
    records = []
    for line in HISTORY_PATH.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records[-limit:] if limit else records


def load_registry():
    if not REGISTRY_PATH.exists():
        return {"version": 1, "entries": []}
    return json.loads(REGISTRY_PATH.read_text())


def _save_registry(registry):
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2) + "\n")


def append_run(record):
    """Append one run record and update registry usage counters.

    record must carry: brief_id, brief_title, picks (dict with
    panel, motion, font, format and any of variant/kinetic/move/
    style), critic (dict with overall), labelled (bool).
    Optional: approximation, assumptions, placeholders, repicks,
    delivery_note, mp4, storyboard.
    Returns the stored record (with run_id and timestamp added).
    """
    stored = dict(record)
    stored["run_id"] = f"p1-{utc_now().replace(':', '').replace('-', '')}"
    stored["timestamp"] = utc_now()
    with HISTORY_PATH.open("a") as f:
        f.write(json.dumps(stored) + "\n")
    # Registry usage counters: every picked entry id gets stamped.
    picks = stored.get("picks") or {}
    picked_ids = [v for v in picks.values() if isinstance(v, str)]
    if picked_ids:
        registry = load_registry()
        by_id = {e.get("id"): e for e in registry.get("entries", [])}
        changed = False
        for entry_id in picked_ids:
            entry = by_id.get(entry_id)
            if entry is None:
                continue
            entry["last_used_at"] = stored["timestamp"]
            entry["use_count"] = int(entry.get("use_count") or 0) + 1
            changed = True
        if changed:
            _save_registry(registry)
    return stored


def recent_runs(n=COOLDOWN_WINDOW):
    """The last n run records (oldest first within the window)."""
    return load_history(limit=n)


def pair_in_last(panel_id, motion_id, n=COOLDOWN_WINDOW):
    """True when this exact panel-and-effective-entry pair ran in
    the last n runs. motion_id is an EFFECTIVE entry (move/kinetic/
    motion as the renderer resolves it) — the stored run's entry
    is computed the same way, not read from its raw motion field.
    (Bug fixed Nov 22: the first version compared the stored
    run's raw v2.6 motion, so the cooldown never fired when the
    entry was a move or a kinetic reveal.)"""
    for run in recent_runs(n):
        picks = run.get("picks") or {}
        if (picks.get("panel") == panel_id
                and effective_entry(picks) == motion_id):
            return True
    return False


def primary_family_of(run):
    """The distinguishing style family of a run record, or None
    when the run has no style pick (a plain Harness/Vertical
    render). 'Default' is the absence of a style, not a family —
    counting every unstyled render as one family made the cap fire
    on any third consecutive plain brief (admission run, Nov 22:
    adm-3 failed 4 times on a 'default' cap that no re-pick of
    the entry could fix)."""
    picks = run.get("picks") or {}
    style = picks.get("style")
    if style:
        return style.split(".")[0]
    return None


def family_count_last(family, n=COOLDOWN_WINDOW):
    """How many of the last n runs used this primary style family.
    None (no family) counts 0 — unstyled runs never trip the cap."""
    if family is None:
        return 0
    return sum(1 for run in recent_runs(n)
               if primary_family_of(run) == family)


def family_over_cap(family, n=COOLDOWN_WINDOW, cap=FAMILY_CAP):
    return family_count_last(family, n) >= cap


def lru_key(entry):
    """Sort key: never-used entries first, then least recently used,
    ties toward the lowest use count. last_used_at is an ISO
    timestamp string, so lexicographic order is chronological."""
    last = entry.get("last_used_at")
    if last is None:
        return (0, "", int(entry.get("use_count") or 0))
    return (1, last, int(entry.get("use_count") or 0))


def pick_lru(candidates):
    """Least-recently-used entry from a non-empty candidate list.
    Cold-start entries (last_used_at null) rank first; ties break
    toward the lowest use_count. Deterministic: final tie-break is
    the entry id, so the same history always yields the same pick."""
    if not candidates:
        return None
    return sorted(candidates, key=lambda e: (lru_key(e), e.get("id", "")))[0]


def entry_last_used(entry_id):
    """Last-used timestamp for one registry id, from the registry file."""
    registry = load_registry()
    for entry in registry.get("entries", []):
        if entry.get("id") == entry_id:
            return entry.get("last_used_at")
    return None
