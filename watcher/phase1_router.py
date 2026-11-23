#!/usr/bin/env python3
"""Phase 1 — Router (Video Bot PRD Section 4, Steps 1-3).

Every brief, labelled or not, goes through the same three steps in
the same order. The Router picks ONLY from the Style Registry —
never from memory, never from the full prompt library. No step in
this flow can refuse the job (draft-first: a thin brief still gets
a draft; missing inputs become clearly marked placeholders).

Step 1 — Explicit label wins, as an override, never a requirement.
  A label naming an implemented registry entry uses it and the run
  is logged as a labelled pick. A label naming a backlog item
  (named but not built, or dropped) still drafts: the Router uses
  the backlog item's nearest implemented entry, flags the draft as
  an approximation in the delivery note, and never calls it the
  unbuilt style.

Step 2 — The Router reads the whole prompt and chooses.
  The hook, story, subject, tone and purpose are read and the
  registry is filtered by content_fit / use_for: numbers go to
  Chart and data panels; a product goes to ProductDemo; a
  step-by-step explanation goes to an Explainer style; a short
  vertical social clip goes to the short-form formats. If the
  best-fit style needs something the brief does not carry, the
  Router does NOT block — it picks the style anyway and the draft
  carries clearly marked placeholders and stated assumptions.

Step 3 — Rotation picks inside the fit set.
  From the entries that fit, the Router picks the least-recently-
  used one from the History log. Ties break toward the lowest
  use_count. Cold-start entries (last_used_at null) rank first.

The pick record this module returns is the storyboard's routing:
panel, variant, motion, font, kinetic, move, style (the
distinguishing style entry, or None for a plain Harness/Vertical
clip), composition, format, plus labelled / approximation /
assumptions / placeholders. The effective word-entry — what the
renderer actually uses for the words — is derived: a reveal-kind
registry move replaces the kinetic reveal and the v2.6 motion for
its scene (Vertical.tsx / Harness.tsx renderWords); a non-word
kinetic reveal replaces the motion; otherwise the motion runs.
The Critic's variety gate (Check 8) compares the panel and the
effective entry, because those are what is actually on screen.
"""

import json
import re
from pathlib import Path

from harness_director import (  # noqa: E402
    EXPLAINER_STYLES,
    KINETIC_REVEALS,
    MOVE_ALIASES,
    REGISTRY_MOVES,
    parse_data_rows,
    parse_labels,
)
from phase1_history import (  # noqa: E402
    family_over_cap,
    load_history,
    pair_in_last,
    pick_lru,
)
from skill_router import PACKS as SKILL_PACKS  # noqa: E402

WATCHER_DIR = Path(__file__).resolve().parent
REGISTRY_PATH = WATCHER_DIR / "style_registry.json"
BACKLOG_PATH = WATCHER_DIR / "style_backlog.json"

PANELS = ["centered", "split", "card", "lower-third", "word-stack"]
VARIANTS = ["orbit", "kinetic", "sweep", "rise"]
MOTIONS = ["kinetic", "slide", "scale", "rise"]
FONTS = ["serif", "sans", "mono"]
# Registry moves whose kind is "reveal" — they replace the kinetic
# reveal and the v2.6 motion for their scene (see renderWords).
REVEAL_MOVES = {
    "pop-in", "stagger", "mask-reveal", "typewriter", "count-up",
    "kinetic-type",
}

PANEL_RE = re.compile(r"(?im)^\s*panel\s*[:\-=]\s*([A-Za-z\-]+)\s*$")
FONT_RE = re.compile(r"(?im)^\s*font\s*[:\-=]\s*([A-Za-z]+)\s*$")
VARIANT_RE = re.compile(r"(?im)^\s*(?:variant|motion)\s*[:\-=]\s*([A-Za-z\- ]+)\s*$")
MOVE_RE = re.compile(r"(?im)^\s*move\s*[:\-=]\s*([A-Za-z][A-Za-z\-]*)\s*$")
MOVES_RE = re.compile(r"(?im)^\s*moves\s*[:\-=]\s*(.+?)\s*$")
KINETIC_RE = re.compile(r"(?im)^\s*kinetic\s*[:\-=]\s*([A-Za-z]+)\s*$")
STYLE_RE = re.compile(r"(?im)^\s*style\s*[:\-=]\s*([A-Za-z\- ]+)\s*$")
TIKTOK_RE = re.compile(r"(?im)^\s*tiktok\s*[:\-=]\s*([A-Za-z\- ]+)\s*$")
EVEREST_RE = re.compile(r"(?im)^\s*everest\s*[:\-=]\s*([A-Za-z\- ]+)\s*$")
ENGINE_RE = re.compile(r"(?im)^\s*engine\s*[:\-=]\s*([A-Za-z\-]+)\s*$")
ENGINE_IDS = {"hyperframes": "engine.hyperframes",
              "huashu-motion": "engine.huashu-motion",
              "huashu": "engine.huashu-motion"}
CHART_RE = re.compile(r"(?im)^\s*chart\s*[:\-=]\s*([A-Za-z0-9]+)\s*$")

TIKTOK_FORMATS = {"hook-first": "hook-first", "hook first": "hook-first",
                  "fast-cut": "fast-cut", "fast cut": "fast-cut",
                  "duet": "duet", "reaction": "duet",
                  "reaction-split": "duet"}
EVEREST_ALIASES = {
    "product-ui": "product-ui", "product ui": "product-ui",
    "prompts-results": "prompts-results", "prompts": "prompts-results",
    "agents-workflows": "agents-workflows", "agents": "agents-workflows",
    "models-benchmarks": "models-benchmarks",
    "benchmarks": "models-benchmarks",
    "comparisons": "comparisons", "comparison": "comparisons",
    "launch-news": "launch-news", "launch": "launch-news",
    "pricing-limits": "pricing-limits", "pricing": "pricing-limits",
    "lower-thirds": "lower-thirds", "lower thirds": "lower-thirds",
    "broll-frames": "broll-frames", "b-roll frames": "broll-frames",
    "evidence-quotes": "evidence-quotes", "evidence": "evidence-quotes",
    "usage-cost": "usage-cost", "usage": "usage-cost",
}

# Content signals -> registry content_fit values. A signal fires on
# the brief's own words (or a label); the fit set is the union of
# the families the signals name. "general" is always in the fit set
# for the rotating dimensions (panel, variant, motion, font,
# kinetic, move) — a style entry with content_fit ["explain"] only
# enters the fit set when the explain signal fires.
SIGNAL_PATTERNS = [
    ("numbers", [r"\b(chart|graph|dataset|percent|growth|statistic|bar chart|line chart)\b",
                 r"\bdata\s*:"]),
    ("product", [r"\b(shop|store|product demo|unboxing|buy)\b",
                 r"\bproduct\s*:"]),
    ("explain", [r"\b(explain|explainer|how it works|tutorial|step by step|guide)\b"]),
    ("vertical-social", [r"\b(vertical|reel|short|tiktok|9:16|portrait|story format)\b"]),
    ("ad", [r"\b(ad|advert|promo|product launch|sell|offer)\b"]),
    ("whatif", [r"\bwhat if\b"]),
    ("canvas", [r"\b(cut paper|cut-paper|crosshatch ink|crosshatch-ink|riso print|sketchbook style|pixel animation|isometric animation|canvas animation|procedural animation)\b"]),
    ("everest", None),  # matched from the skill router's everest-* triggers
    ("broll", [r"\b(b-roll|broll|talking head|presenter)\b"]),
    ("name-card", [r"\bname\s*:"]),
    ("synthwave", [r"\b(synthwave|outrun|neon drive|retro wave)\b"]),
]

SIGNAL_TO_FAMILY = {
    "numbers": "chart",
    "product": "product",
    "explain": "explainer",
    "vertical-social": "tiktok",
    "ad": "ad",
    "whatif": "what-if",
    "canvas": "canvas",
    "everest": "everest",
    "broll": "broll",
    "name-card": "lower-third",
    "synthwave": None,  # backlog only — handled as an approximation
}


def load_registry():
    return json.loads(REGISTRY_PATH.read_text())


def load_backlog():
    if not BACKLOG_PATH.exists():
        return {"version": 1, "items": []}
    return json.loads(BACKLOG_PATH.read_text())


def registry_by_id(registry):
    return {e["id"]: e for e in registry.get("entries", [])}


def backlog_by_id(backlog):
    return {i["id"]: i for i in backlog.get("items", [])}


def _normalize_move(value):
    key = (value or "").strip().lower().replace("_", " ")
    key = re.sub(r"\s+", " ", key)
    if key in REGISTRY_MOVES:
        return key
    return MOVE_ALIASES.get(key)


def detect_signals(text, labels, rows):
    """Brief text + labels + data rows -> set of content signals."""
    hay = (text or "").lower()
    signals = set()
    for name, patterns in SIGNAL_PATTERNS:
        if patterns is None:
            continue
        for pat in patterns:
            if re.search(pat, hay):
                signals.add(name)
                break
    if rows:
        signals.add("numbers")
    # Everest: reuse the skill router's narrow everest-* triggers.
    for pack in SKILL_PACKS:
        if not pack.startswith("everest-"):
            continue
        for pat in SKILL_PACKS[pack][0]:
            if re.search(pat, hay):
                signals.add("everest")
                break
    return signals


def effective_entry(picks):
    """The word-entry actually rendered, for the variety gate.

    A reveal-kind registry move replaces the kinetic reveal and the
    v2.6 motion; a non-word kinetic reveal replaces the motion;
    otherwise the motion runs. Returns a registry id."""
    move = picks.get("move")
    if move and move.replace("move.", "") in REVEAL_MOVES:
        return move
    kinetic = picks.get("kinetic")
    if kinetic and kinetic != "kinetic.word":
        return kinetic
    return picks.get("motion") or "motion.kinetic"


def _lru_from(entries, exclude_ids=None):
    """LRU pick from registry entries, skipping excluded ids."""
    exclude = set(exclude_ids or [])
    candidates = [e for e in entries if e["id"] not in exclude]
    return pick_lru(candidates)


def _entries_in_family(registry, family):
    return [e for e in registry.get("entries", []) if e.get("family") == family]


def _dominant_content_type(beats):
    """Writer beats -> most frequent content_type.

    Ties break toward the earliest beat in order. None when no
    beats or no content_type is set."""
    if not beats:
        return None
    counts = {}
    for beat in beats:
        ctype = (beat or {}).get("content_type")
        if ctype:
            counts[ctype] = counts.get(ctype, 0) + 1
    if not counts:
        return None
    best = max(counts.values())
    for beat in beats:
        if counts.get((beat or {}).get("content_type")) == best:
            return (beat or {}).get("content_type")
    return None


def route(task, beats=None, exclude_ids=None):
    """Task dict -> pick record (PRD Section 4, Steps 1-3).

    task needs `title` (the hook) and `details` (free text + labels).
    `exclude_ids` is a set of registry ids the re-pick must avoid
    (used after a Check 8 FAIL). `beats` (Writer stage) is a list
    of writer beats: their dominant content_type steers Step 2 fit
    ahead of rotation — stat -> chart family, sequence/list ->
    explainer family, statement/quote -> no style pick (plain host)
    with motion.kinetic + kinetic.word forced. Step 1 label override
    still wins over everything, and LRU stays only the tiebreaker
    among styles that fit. Pure function of the task + the
    registry file + the history log: no model calls, no network.
    """
    # Backward compat: an old positional caller passed exclude_ids
    # as the second argument (phase1_proof.py).
    if isinstance(beats, (set, frozenset)):
        exclude_ids = beats
        beats = None
    registry = load_registry()
    backlog = load_backlog()
    by_id = registry_by_id(registry)
    backlog_ids = backlog_by_id(backlog)
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    labels = parse_labels(details)
    rows = parse_data_rows(details)
    signals = detect_signals(title + "\n" + details, labels, rows)
    history = load_history()
    exclude = set(exclude_ids or [])
    dominant = _dominant_content_type(beats)

    picks = {"labelled": False, "label_source": None,
             "approximation": None, "assumptions": [], "placeholders": []}

    # ---- Step 1: explicit label wins (per dimension) ----
    # Panel / font / variant / motion / kinetic / move labels name
    # their dimension directly. A label naming a backlog item
    # resolves to that item's nearest implemented entry and flags
    # the approximation; a dropped item with no nearest proceeds
    # with the normal fit-set pick and a note.
    def _label_value(regex):
        m = regex.search(details)
        return m.group(1).strip().lower() if m else None

    def _approx(requested, backlog_id, dimension):
        item = backlog_ids.get(backlog_id)
        nearest = item.get("nearest") if item else None
        if nearest and nearest in by_id:
            picks["approximation"] = {
                "requested": requested,
                "nearest": nearest,
                "note": (f"Requested {requested} is not built; this draft "
                         f"uses the nearest implemented entry "
                         f"{nearest} and is flagged as an approximation — "
                         f"it is not {requested}."),
            }
            picks["assumptions"].append(
                f"Requested style {requested} is not implemented; "
                f"drafted with nearest implemented entry {nearest}.")
            return nearest
        picks["assumptions"].append(
            f"Requested style {requested} is not implemented and has "
            f"no near equivalent; drafted with the normal fit-set pick.")
        return None

    panel_val = _label_value(PANEL_RE)
    if panel_val in PANELS and f"panel.{panel_val}" in by_id:
        picks["panel"] = f"panel.{panel_val}"
        picks["labelled"] = True
        picks["label_source"] = f"Panel: {panel_val}"
    font_val = _label_value(FONT_RE)
    if font_val in FONTS and f"font.{font_val}" in by_id:
        picks["font"] = f"font.{font_val}"
        picks["labelled"] = True
        picks["label_source"] = (picks["label_source"] or "") + f" Font: {font_val}"
    variant_val = _label_value(VARIANT_RE)
    if variant_val:
        key = re.sub(r"\s+", " ", variant_val)
        if key in VARIANTS and f"variant.{key}" in by_id:
            picks["variant"] = f"variant.{key}"
            picks["labelled"] = True
            picks["label_source"] = (picks["label_source"] or "") + f" Variant: {key}"
        elif key in MOTIONS and f"motion.{key}" in by_id:
            picks["motion"] = f"motion.{key}"
            picks["labelled"] = True
            picks["label_source"] = (picks["label_source"] or "") + f" Motion: {key}"
        elif key in KINETIC_REVEALS and f"kinetic.{key}" in by_id:
            picks["kinetic"] = f"kinetic.{key}"
            picks["labelled"] = True
            picks["label_source"] = (picks["label_source"] or "") + f" Kinetic: {key}"
        elif _normalize_move(key):
            move_id = f"move.{_normalize_move(key)}"
            if move_id in by_id:
                picks["move"] = move_id
                picks["labelled"] = True
                picks["label_source"] = (picks["label_source"] or "") + f" Motion: {key}"
    move_val = _label_value(MOVE_RE)
    if move_val:
        name = _normalize_move(move_val)
        if name and f"move.{name}" in by_id:
            picks["move"] = f"move.{name}"
            picks["labelled"] = True
            picks["label_source"] = (picks["label_source"] or "") + f" Move: {name}"
        elif name:
            approx = _approx(f"move.{name}", f"move.{name}", "move")
            if approx:
                picks["move"] = approx
        else:
            # Unknown move name: is it a named-but-unbuilt catalog move?
            for item in backlog.get("items", []):
                if item.get("family") == "move" and move_val in item.get("id", ""):
                    approx = _approx(move_val, item["id"], "move")
                    if approx:
                        picks["move"] = approx
                    break
            else:
                picks["assumptions"].append(
                    f"Move '{move_val}' is not a known registry or "
                    f"backlog name; ignored, normal rotation applies.")
    kinetic_val = _label_value(KINETIC_RE)
    if kinetic_val in KINETIC_REVEALS and f"kinetic.{kinetic_val}" in by_id:
        picks["kinetic"] = f"kinetic.{kinetic_val}"
        picks["labelled"] = True
        picks["label_source"] = (picks["label_source"] or "") + f" Kinetic: {kinetic_val}"

    # Style dimension labels, in watcher rung order. The first
    # style label that resolves wins; the rest are noted.
    style = None
    style_label = None
    if rows:
        mode = (labels.get("mode") or "").strip().lower()
        chart_label = _label_value(CHART_RE)
        if chart_label == "d3" and "chart.d3" in by_id:
            style, style_label = "chart.d3", "Chart: d3"
        elif mode == "stats" and "chart.stats" in by_id:
            style, style_label = "chart.stats", "Mode: stats"
        elif "chart.count-up" in by_id:
            style, style_label = "chart.count-up", "Data: rows"
    if style is None:
        engine_val = _label_value(ENGINE_RE)
        if engine_val:
            key = re.sub(r"\s+", " ", engine_val)
            eid = ENGINE_IDS.get(key)
            if eid and eid in by_id:
                style, style_label = eid, f"Engine: {key}"
                picks["engine"] = ("huashu-motion"
                                   if eid == "engine.huashu-motion"
                                   else "hyperframes")
            elif key:
                picks["assumptions"].append(
                    f"Engine '{engine_val}' is not a known engine "
                    f"(hyperframes, huashu-motion); ignored, normal "
                    f"route applies.")
    if style is None and (labels.get("product") or "").strip():
        if "product.demo" in by_id:
            style, style_label = "product.demo", "Product: label"
    if style is None:
        style_val = _label_value(STYLE_RE)
        if style_val:
            key = re.sub(r"\s+", " ", style_val)
            if key in ("cut-paper", "cut paper") and "canvas.cut-paper" in by_id:
                style, style_label = "canvas.cut-paper", f"Style: {key}"
            elif key in ("crosshatch", "crosshatch-ink", "crosshatch ink") \
                    and "canvas.crosshatch" in by_id:
                style, style_label = "canvas.crosshatch", f"Style: {key}"
            elif key in EXPLAINER_STYLES and \
                    f"explainer.{EXPLAINER_STYLES[key]}" in by_id:
                style, style_label = (f"explainer.{EXPLAINER_STYLES[key]}",
                                      f"Style: {key}")
            else:
                # Canvas style named but not built (riso, sketchbook,
                # math, pixel, isometric) -> approximation.
                approx = _approx(f"canvas.{key}", f"canvas.{key}", "canvas")
                if approx:
                    style, style_label = approx, f"Style: {key} (approximation)"
    if style is None:
        tiktok_val = _label_value(TIKTOK_RE)
        if tiktok_val:
            key = re.sub(r"\s+", " ", tiktok_val)
            fmt = TIKTOK_FORMATS.get(key)
            if fmt and f"tiktok.{fmt}" in by_id:
                style, style_label = f"tiktok.{fmt}", f"TikTok: {key}"
            elif key in ("caption-led", "caption led", "countdown"):
                approx = _approx(f"tiktok.{key}", f"tiktok.{key}", "tiktok")
                if approx:
                    style, style_label = approx, f"TikTok: {key} (approximation)"
    if style is None:
        everest_val = _label_value(EVEREST_RE)
        if everest_val:
            key = re.sub(r"\s+", " ", everest_val)
            cat = EVEREST_ALIASES.get(key)
            if cat and f"everest.{cat}" in by_id:
                style, style_label = f"everest.{cat}", f"Everest: {key}"
            elif cat:
                approx = _approx(f"everest.{cat}", f"everest.{cat}", "everest")
                if approx:
                    style, style_label = approx, f"Everest: {key} (approximation)"
    if style is None and (labels.get("name") or "").strip():
        if "lower-third.strap" in by_id:
            style, style_label = "lower-third.strap", "Name: label"
    if style is not None:
        picks["style"] = style
        picks["labelled"] = True
        picks["label_source"] = (picks["label_source"] or "") + f" {style_label}"

    # ---- Step 2: content fit (only where no label decided) ----
    # Writer beats steer fit AHEAD of rotation: the dominant
    # content_type names the family. stat -> chart, sequence/list ->
    # explainer, statement/quote -> NO style pick at all (plain
    # host) — the kinetic-headline mapping below forces the motion.
    if dominant:
        picks["content_type"] = dominant
        picks["assumptions"].append(
            f"writer beats: dominant content_type '{dominant}'")
    if "style" not in picks and dominant in ("statement", "quote"):
        pass  # plain host: no style pick, kinetic headline below
    elif "style" not in picks:
        fit_families = {SIGNAL_TO_FAMILY[s] for s in signals
                        if SIGNAL_TO_FAMILY.get(s)}
        if dominant == "stat":
            fit_families.add("chart")
        elif dominant in ("sequence", "list"):
            fit_families.add("explainer")
        fit_entries = [e for e in registry.get("entries", [])
                       if e.get("family") in fit_families
                       and e["id"] not in exclude]
        # Family cap: a family at 2 of the last 5 leaves the fit set.
        fit_entries = [e for e in fit_entries
                       if not family_over_cap(e.get("family"))]
        if fit_entries:
            chosen = _lru_from(fit_entries)
            if chosen:
                picks["style"] = chosen["id"]
        elif "synthwave" in signals:
            # Synthwave is backlog-only: approximate, do not block.
            approx = _approx("synthwave", "base.synthwave", "synthwave")
            if approx:
                picks["style"] = approx

    # Kinetic headline: a statement/quote-dominant brief is a plain
    # host clip whose words ARE the motion — force motion.kinetic +
    # kinetic.word unless a Step-1 label already set motion/kinetic.
    if dominant in ("statement", "quote"):
        if "motion" not in picks:
            picks["motion"] = "motion.kinetic"
        if "kinetic" not in picks:
            picks["kinetic"] = "kinetic.word"

    # Format follows the style (vertical compositions) or the signal.
    style_entry = by_id.get(picks.get("style") or "")
    if style_entry and "9:16" in (style_entry.get("ratios") or []) \
            and "16:9" not in (style_entry.get("ratios") or []):
        picks["format"] = "vertical"
    elif "vertical-social" in signals:
        picks["format"] = "vertical"
    else:
        picks["format"] = "landscape"

    # ---- Step 3: rotation inside the fit set (dimensions) ----
    def _rotate(family, key, exclude_extra=None):
        if key in picks:
            return picks[key]
        entries = [e for e in _entries_in_family(registry, family)
                   if e["id"] not in exclude
                   and e["id"] not in (exclude_extra or set())]
        chosen = _lru_from(entries)
        return chosen["id"] if chosen else None

    picks["panel"] = picks.get("panel") or _rotate("panel", "panel")
    picks["variant"] = picks.get("variant") or _rotate("variant", "variant")
    picks["motion"] = picks.get("motion") or _rotate("motion", "motion")
    picks["font"] = picks.get("font") or _rotate("font", "font")
    picks["kinetic"] = picks.get("kinetic") or _rotate("kinetic", "kinetic")
    picks["move"] = picks.get("move") or _rotate("move", "move")

    # Pair cooldown: if this panel + effective-entry pair ran in the
    # last 5, re-pick the move, then kinetic, then motion, then
    # panel (up to 3 re-picks); a labelled pick is exempt by design
    # and is logged as a labelled override instead.
    if not picks["labelled"]:
        tries = 0
        while tries < 3 and pair_in_last(picks.get("panel"),
                                         effective_entry(picks)):
            tries += 1
            if tries == 1 and picks.get("move"):
                alt = _rotate("move", "move", {picks["move"]})
                if alt:
                    picks["move"] = alt
                    continue
            if tries == 2 and picks.get("kinetic"):
                alt = _rotate("kinetic", "kinetic", {picks["kinetic"]})
                if alt:
                    picks["kinetic"] = alt
                    continue
            alt = _rotate("motion", "motion", {picks.get("motion")})
            if alt:
                picks["motion"] = alt
                continue
            alt = _rotate("panel", "panel", {picks.get("panel")})
            if alt:
                picks["panel"] = alt
                continue
            break
        picks["rotation_repicks"] = tries

    # Composition resolves from the style entry, else the format host.
    if style_entry:
        picks["composition"] = style_entry.get("composition") or (
            "Vertical" if picks["format"] == "vertical" else "Harness")
    else:
        picks["composition"] = (
            "Vertical" if picks["format"] == "vertical" else "Harness")

    picks["entry"] = effective_entry(picks)
    picks["label_source"] = (picks.get("label_source") or "").strip() or None
    return picks
