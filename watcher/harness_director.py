#!/usr/bin/env python3
"""Motion Bot Harness — Director.

Turns a full Mission Control task (title + ALL of the details) into a
storyboard JSON that the Harness composition renders.

This is the fix for the intake gap: the old watcher only read the title
as the hook and only accepted hex codes in strict `Label: value` lines,
so free text in the details — e.g. task 161's "Background: white, gold,
parchment" — was silently dropped. The Director reads everything:

  * named colors anywhere in the text ("white", "gold", "parchment", ...)
    plus hex codes anywhere, in order of appearance;
  * mood / tone words ("ominous", "dramatic", "warm", ...) -> pacing hints;
  * the hook itself, split on clause breaks into 2-4 scenes;
  * a motif picked from the hook's nouns (mirror, clock, ...) from a
    small code-drawn motif library;
  * a camera + transition plan per scene (push in / pull back / drift,
    diagonal wipe or zoom-cut between scenes — never plain fades only).

Deterministic: no LLM, no network, no keys — it works when the Mac
Studio is down. Explicit `Label: value` lines in the details still win
as overrides wherever they are present.

Epistemic rule (his standing rule 2026-11-03): the hard anchor is
premises, not expression. Facts in a render (names, stats, quotes,
project states) come ONLY from explicit task input — subtitle /
project name only from explicit labels, never invented. Scene text
comes from the task's story (beat sheet or Story: block, his words),
and shaping that story into scenes, pacing, motif, camera, and
transitions is expression, not fabrication. A task with an empty
title still has no hook — the watcher blocks it, same as before.

Banned colors: purple / violet / lavender / indigo / magenta are NEVER
rendered (his standing rule: he hates purple). If the details name one,
it is ignored and noted in `notes`, never mapped to a hex.
"""

import re

from concepts import scene_keywords, semantic_keywords
from story_intake import extract_story
import memory

# ---------------------------------------------------------------- colors
# Every mapping the Director knows. Documented here, and in HARNESS.md.
# "parchment" and "paper" are the Signalwood paper #F4EEDC (locked).
COLOR_NAMES = {
    # light neutrals
    "white": "#FFFFFF",
    "parchment": "#F4EEDC",
    "paper": "#F4EEDC",
    "cream": "#FFF8E7",
    "ivory": "#FFFFF0",
    "sand": "#D9C7A7",
    # metallics
    "gold": "#D4AF37",
    "silver": "#C0C0C0",
    "bronze": "#CD7F32",
    "copper": "#B87333",
    # darks
    "black": "#0A0A0A",
    "ink": "#1F1A14",
    "charcoal": "#1F2937",
    "slate": "#334155",
    "midnight": "#05080A",
    "soil": "#0E1A10",
    # greens (Signalwood family)
    "forest green": "#3E6B3A",
    "deep forest": "#24402A",
    "fern green": "#2E7D4F",
    "emerald": "#2E7D4F",
    "olive": "#6B7C3F",
    "neon green": "#39FF6A",
    # warm accents
    "amber": "#FFB02E",
    "amber deep": "#D97E1F",
    "burnt sienna": "#E97451",
    "sienna deep": "#B84A2B",
    "crimson": "#9B1B30",
    "rose": "#E8B4B8",
    # blues / teals
    "navy": "#0F2A43",
    "sky": "#4FC3F7",
    "teal": "#0F766E",
    # earth
    "mud": "#7A5A3A",
    "bark": "#4A3220",
    "wood": "#8A5A33",
    "forest floor": "#6B4A2F",
}

# Multi-word names must match before their single-word parts.
_SORTED_COLOR_NAMES = sorted(COLOR_NAMES, key=len, reverse=True)

# Banned: named, ignored with a note, never rendered.
BANNED_COLORS = {"purple", "violet", "lavender", "indigo", "magenta", "plum"}

HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
LENGTH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b", re.I)
LABEL_RE = re.compile(
    r"(?im)^\s*(project|subtitle|tagline|end card|background|accent|text|name|role|"
    r"image|images|length|duration|mood|tone|motif)\s*[:\-=]\s*(.+?)\s*$"
)

# ------------------------------------------------------------------ mood
# mood word -> (tone, pacing). Pacing: "slow" | "medium" | "fast".
# Mood never overrides an explicit palette — it only tunes pacing,
# particle density and camera speed hints.
MOOD_WORDS = {
    "ominous": ("ominous", "slow"),
    "dramatic": ("dramatic", "slow"),
    "haunting": ("haunting", "slow"),
    "creepy": ("haunting", "slow"),
    "eerie": ("haunting", "slow"),
    "dark": ("dark", "slow"),
    "sad": ("somber", "slow"),
    "somber": ("somber", "slow"),
    "warm": ("warm", "medium"),
    "cozy": ("warm", "medium"),
    "gentle": ("gentle", "medium"),
    "soft": ("gentle", "medium"),
    "calm": ("calm", "slow"),
    "quiet": ("calm", "slow"),
    "peaceful": ("calm", "slow"),
    "bold": ("bold", "fast"),
    "loud": ("bold", "fast"),
    "energetic": ("energetic", "fast"),
    "fast": ("energetic", "fast"),
    "urgent": ("urgent", "fast"),
    "playful": ("playful", "fast"),
    "fun": ("playful", "fast"),
    "hopeful": ("hopeful", "medium"),
    "bright": ("bright", "medium"),
}

# --------------------------------------------------------------- motifs
# Motif library (code-drawn, no images). Keyword -> motif type.
# "mirror" is first because task 161 needs it.
MOTIF_KEYWORDS = {
    "mirror": "mirror",
    "reflection": "mirror",
    "clock": "clock",
    "ticking": "clock",
    "time": "clock",
    "watch": "clock",
    "door": "door",
    "key": "key",
    "fox": "fox",
    "reynard": "fox",
    "tree": "tree",
    "forest": "tree",
    "grove": "tree",
    "flame": "flame",
    "fire": "flame",
    "candle": "flame",
    "wave": "wave",
    "ocean": "wave",
    "sea": "wave",
    "star": "star",
    "crown": "crown",
    "coin": "coin",
    "window": "window",
}

# ---------------------------------------------------------------- helpers
def _hex_to_rgb(hexcode):
    h = hexcode.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(rgb):
    return "#%02X%02X%02X" % tuple(max(0, min(255, round(c))) for c in rgb)


def _luminance(hexcode):
    r, g, b = _hex_to_rgb(hexcode)

    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast_ratio(hex_a, hex_b):
    """WCAG contrast ratio between two hex colors (1.0 - 21.0)."""
    la, lb = _luminance(hex_a), _luminance(hex_b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _mix(hex_a, hex_b, t):
    """Blend hex_a toward hex_b by t (0 = a, 1 = b)."""
    ra, ga, ba = _hex_to_rgb(hex_a)
    rb, gb, bb = _hex_to_rgb(hex_b)
    return _rgb_to_hex((ra + (rb - ra) * t, ga + (gb - ga) * t,
                        ba + (bb - ba) * t))


def _darken(hexcode, amount=0.35):
    return _mix(hexcode, "#000000", amount)


def _find_colors(text):
    """Named colors + hex codes in order of appearance.

    Returns (colors, notes): colors is a list of (name_or_None, hex) in
    first-appearance order, deduped by hex; notes records banned colors
    that were ignored.
    """
    found = []  # (position, name, hex)
    notes = []
    low = (text or "").lower()
    for name in _SORTED_COLOR_NAMES:
        for m in re.finditer(r"\b" + re.escape(name) + r"\b", low):
            found.append((m.start(), name, COLOR_NAMES[name]))
    for m in HEX_RE.finditer(text or ""):
        found.append((m.start(), None, m.group(0).upper()))
    for word in BANNED_COLORS:
        if re.search(r"\b" + word + r"\b", low):
            notes.append(f"ignored banned color '{word}' (no purple, ever)")
    found.sort(key=lambda item: item[0])
    colors, seen = [], set()
    for _, name, hexcode in found:
        hexcode = hexcode.upper()
        if hexcode in seen:
            continue
        seen.add(hexcode)
        colors.append((name, hexcode))
    return colors, notes


def parse_labels(details):
    """Explicit `Label: value` lines from the task details."""
    labels = {}
    for m in LABEL_RE.finditer(details or ""):
        labels[m.group(1).lower().replace(" ", "_")] = m.group(2).strip()
    return labels


def detect_mood(text):
    """First mood word found in the text -> (tone, pacing)."""
    low = (text or "").lower()
    for word, (tone, pacing) in MOOD_WORDS.items():
        if re.search(r"\b" + re.escape(word) + r"\b", low):
            return {"tone": tone, "pacing": pacing, "word": word}
    return {"tone": "neutral", "pacing": "medium", "word": None}


def split_scenes(hook):
    """Split a hook into 2-4 scenes on clause breaks.

    Breaks, in order: em/en dashes, semicolons, ", except / but /
    that's when / and then" clause starts, then a comma inside a long
    segment. Conjunctions stay with the clause they start, and a comma
    stays attached to the word before the break. Cap 4 scenes by
    merging the shortest adjacent pair. One scene if no break exists.
    Never drops or invents words — the scenes' words rejoin to the
    hook (only the dash/semicolon separators themselves are dropped).
    """
    text = re.sub(r"\s+", " ", (hook or "").strip())
    if not text:
        return []
    # 1. Dashes and semicolons are hard breaks.
    parts = re.split(r"\s*(?:—|–|;)\s*", text)
    # 2. Clause-start conjunctions after a comma (or standing alone).
    #    The separator is captured so a comma stays attached to the
    #    word before the break ("smiling," keeps its comma).
    out = []
    for part in parts:
        tokens = re.split(
            r"(,\s*)(?=(?:except|but|and then|that'?s when|when)\b)"
            r"|(\s+)(?=(?:except|but)\b)",
            part,
        )
        segments = [tokens[0]]
        # Two alternative capture groups -> tokens step by 3:
        # [text, comma-sep|None, space-sep|None, text, ...]
        for i in range(1, len(tokens), 3):
            sep = tokens[i] or tokens[i + 1] or ""
            nxt = tokens[i + 2] if i + 2 < len(tokens) else ""
            if sep.startswith(","):
                segments[-1] = segments[-1].rstrip() + ","
            if nxt and nxt.strip():
                segments.append(nxt.strip())
        out.extend(s for s in segments if s.strip())
    # 3. Long segment with a comma: split at the first comma — but
    #    never on a trailing comma (that would mint an empty scene).
    refined = []
    for seg in out:
        words = seg.split()
        if len(words) > 8 and "," in seg:
            head, _, tail = seg.partition(",")
            if tail.strip():
                refined.append(head.strip() + ",")
                refined.append(tail.strip())
                continue
        refined.append(seg)
    # 4. Cap at 4 scenes: merge the shortest adjacent pair, repeatedly.
    while len(refined) > 4:
        idx = min(range(len(refined) - 1),
                  key=lambda i: len(refined[i]) + len(refined[i + 1]))
        refined[idx:idx + 2] = [refined[idx] + " " + refined[idx + 1]]
    return refined


def pick_motif(hook, labels):
    """Motif from an explicit `Motif:` label, else the hook's nouns.

    Returns a motif dict. Mirror carries the reflection word (first
    -ing word in the hook, e.g. SMILING) and a tears flag (cry/tear).
    """
    label = (labels.get("motif") or "").strip().lower()
    low = (hook or "").lower()
    mtype = None
    if label:
        for key, value in MOTIF_KEYWORDS.items():
            if key in label:
                mtype = value
                break
        if mtype is None and label in ("mirror", "clock", "door", "key",
                                       "fox", "tree", "flame", "wave",
                                       "star", "crown", "coin", "window",
                                       "orbit", "none"):
            mtype = label
    if mtype is None:
        for key, value in MOTIF_KEYWORDS.items():
            if re.search(r"\b" + re.escape(key) + r"\b", low):
                mtype = value
                break
    if mtype is None:
        mtype = "orbit"  # fallback: drifting orbital rings, always safe
    motif = {"type": mtype}
    if mtype == "mirror":
        gerund = re.search(r"\b([A-Za-z]+ing)\b", hook or "")
        if gerund:
            motif["reflectionWord"] = gerund.group(1).upper()
        motif["tears"] = bool(re.search(r"\b(cry|cries|crying|tear|tears)\b", low))
    if mtype == "clock":
        motif["ticking"] = bool(re.search(r"\b(tick|ticking|beat)\b", low))
    # Scene the motif belongs to: the scene naming its keyword, else
    # scene 2 when there is one, else scene 1. Resolved by the caller
    # against the scene list; stored as a keyword for matching.
    motif["keyword"] = next((k for k, v in MOTIF_KEYWORDS.items()
                             if v == mtype), mtype)
    return motif


def build_palette(details, labels, notes):
    """Role assignment for the colors found in the details.

    Order of appearance fills background -> accent -> surface. Text is
    DERIVED for contrast unless an explicit `Text:` label gives one:
    dark ink on a light background, white/parchment on a dark one (a
    light third color on a dark background becomes the text color).
    Defaults mirror Generic when no colors are named at all.
    """
    colors, color_notes = _find_colors(details or "")
    notes.extend(color_notes)
    # Label overrides: a label's own colors replace the free-text list
    # for that role (hex or named).
    label_colors = {}
    for role in ("background", "accent", "text"):
        if labels.get(role):
            found, _ = _find_colors(labels[role])
            if found:
                label_colors[role] = found[0][1]
                notes.append(
                    f"label override: {role} = {found[0][1]}"
                    + (f" ('{found[0][0]}')" if found[0][0] else ""))
    hexes = [h for _, h in colors]
    background = label_colors.get("background") or (hexes[0] if hexes else "#111827")
    accent = label_colors.get("accent") or (hexes[1] if len(hexes) > 1 else "#FFB02E")
    third = hexes[2] if len(hexes) > 2 else None
    bg_light = _luminance(background) > 0.6
    if label_colors.get("text"):
        text = label_colors["text"]
        surface = third or _mix(background, "#FFFFFF" if bg_light else "#000000", 0.06)
    elif bg_light:
        text = "#1F1A14"  # ink on light backgrounds
        surface = third or _mix(background, "#000000", 0.06)
    else:
        # Dark background: a light third color becomes the text.
        if third and _luminance(third) > 0.7:
            text = third
            surface = _mix(background, "#FFFFFF", 0.08)
        else:
            text = "#FFFFFF"
            surface = third or _mix(background, "#FFFFFF", 0.08)
    if contrast_ratio(text, background) < 3.0:
        # Last-resort readability fix, noted, never silent: take
        # whichever of ink / white contrasts better with the background.
        text = max(("#1F1A14", "#FFFFFF"),
                   key=lambda c: contrast_ratio(c, background))
        notes.append("text color adjusted for contrast (>= 3.0)")
    palette = {
        "background": background.upper(),
        "surface": surface.upper(),
        "accent": accent.upper(),
        "accentDeep": _darken(accent, 0.35).upper(),
        "text": text.upper(),
        "glow": accent.upper(),
        "particle": accent.upper(),
    }
    for name, hexcode in colors:
        if name:
            notes.append(f"color '{name}' -> {hexcode}")
    return palette


# ------------------------------------------------------------- storyboard
CAMERA_MOVES = [
    {"fromScale": 1.0, "toScale": 1.08, "fromX": 0, "toX": -26},    # push in
    {"fromScale": 1.08, "toScale": 1.0, "fromX": -26, "toX": 22},   # pull back
    {"fromScale": 1.0, "toScale": 1.14, "fromX": 22, "toX": 0},     # push in, closer
    {"fromScale": 1.05, "toScale": 1.05, "fromX": -15, "toX": 15},  # lateral drift
]
TRANSITIONS = ["wipe", "zoom-cut"]  # alternate; never plain fades only


# ------------------------------------------------------------ motion variants (v2.4)
# The sameness complaint (2026-10-29): every Harness clip used one
# recipe — gradient + gold particles, serif kinetic line, orbiting
# motif, wipe/zoom-cut. Variants change the motion language itself
# (background + type treatment), not just the palette. Rotation is by
# task id so a batch of tasks cycles through them; an explicit
# `Variant:` / `Motion:` line in the details overrides rotation.
VARIANTS = ["orbit", "kinetic", "sweep", "rise"]
VARIANT_RE = re.compile(
    r"(?im)^\s*(variant|motion)\s*[:\-=]\s*([A-Za-z]+)\s*$")


def pick_variant(task, notes):
    """Task -> variant name. Explicit label wins, else id rotation."""
    details = task.get("details") or ""
    m = VARIANT_RE.search(details)
    if m and m.group(2).lower() in VARIANTS:
        notes.append(f"variant '{m.group(2).lower()}' (explicit label)")
        return m.group(2).lower()
    tid = task.get("id")
    if isinstance(tid, int):
        variant = VARIANTS[tid % len(VARIANTS)]
        notes.append(f"variant '{variant}' (rotation by task id)")
        return variant
    return "orbit"


# ------------------------------------------------------------ story parsing
# Remake (2026-11-03): a task's story IS its scenes. The v2.4 rule
# (beats are gate material, not scene text) belonged to the hook-clip
# model, where each clip was one beat of a sequence arc; it is retired
# for story-first tasks. A beat sheet in completionSteps (or a Story:
# block in the details) is that clip's own arc, and its beats become
# its scenes — see build_storyboard. Beats still reach the narrated
# LLM Director through the task details as before.
STORY_RE = re.compile(r"(?im)^\s*story\s*[:\-=]\s*(.+?)\s*$")


def parse_story(details):
    """Task details -> list of story beats, or [] when there is none.

    Beats come from a `Story:` line (parts split on | or ->), or —
    when no Story: line exists — from freeform narrative sentences in
    the details after label lines are stripped. A beat counts when it
    carries at least 3 words. Label-only details (Background / Project
    / Subtitle / length) yield no beats: a hook plus labels is not a
    story, and that is exactly what the gate is for.
    """
    details = details or ""
    m = STORY_RE.search(details)
    if m:
        raw = m.group(1)
        parts = re.split(r"\s*(?:\||->|=>)\s*", raw)
        return [p.strip() for p in parts if len(p.strip().split()) >= 3]
    # Freeform fallback: strip every `Label: value` line, then split
    # what remains into sentences. Mode/length markers ("narrated, 12
    # seconds", "synthwave, 12 seconds") are not story: a line counts
    # only when 3+ real words survive after mode/length words and
    # numbers are removed.
    MODE_WORDS = {"narrated", "narration", "voiceover", "voice-over",
                  "synthwave", "chart", "vertical", "landscape",
                  "seconds", "second", "secs", "sec", "s"}
    kept = []
    for line in details.splitlines():
        if LABEL_RE.match(line.strip()):
            continue
        if VARIANT_RE.match(line.strip()):
            continue
        words = [w.strip(",") for w in line.strip().split()]
        real = [w for w in words
                if w.lower() not in MODE_WORDS and not w.replace(".", "", 1).isdigit()]
        if len(real) >= 3:
            kept.append(line.strip())
    text = re.sub(r"\s+", " ", " ".join(kept)).strip()
    if not text:
        return []
    sentences = [s.strip() for s in re.split(r"[.!?]+\s+", text) if s.strip()]
    return [s for s in sentences if len(s.split()) >= 3]


def build_storyboard(task):
    """Mission Control task dict -> storyboard dict (Harness props).

    task needs `title` (the hook) and `details` (free text + labels).
    Raises ValueError on an empty title — the watcher blocks those.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    if not title:
        raise ValueError("empty title: no hook to render")
    labels = parse_labels(details)
    notes = []

    # Story first (remake): the beat sheet / Story: block is the
    # clip's own arc — its beats become scenes, and its header
    # duration (when present) sets the length. Otherwise the old
    # rules apply unchanged (labels, then "Ns" in details, else 12s).
    story = extract_story(task)
    story_beats = story["beats"]
    if story_beats:
        notes.append(f"story: {len(story_beats)} beats from "
                     f"{story['source']}")
        if story["duration"] is not None:
            notes.append(f"story duration: {story['duration']}s")
        if story["fps"] is not None:
            notes.append(f"story fps: {story['fps']} (render stays "
                         f"30fps until the Phase 3 kinetic engine)")

    # Length: beat-sheet header first, else Length:/Duration: label,
    # else "Ns" anywhere, 3-60s.
    length = story["duration"]
    if length is None:
        if labels.get("length") or labels.get("duration"):
            m = LENGTH_RE.search(labels.get("length") or labels.get("duration"))
            length = float(m.group(1)) if m else None
    if length is None:
        m = LENGTH_RE.search(details)
        length = float(m.group(1)) if m else None
    length_seconds = int(length) if length is not None else 12
    length_seconds = max(3, min(60, length_seconds))

    palette = build_palette(details, labels, notes)
    mood = detect_mood(title + " " + details)
    if mood["word"]:
        notes.append(f"mood '{mood['word']}' -> tone {mood['tone']}, "
                     f"pacing {mood['pacing']}")

    if story_beats:
        # Story-first: each beat's narrative text is one scene, in
        # beat order. Beat windows are recorded in the storyboard for
        # the Phase 3 engine; the Harness still splits duration evenly
        # across scenes (stated limit in the remake spec).
        scene_texts = [b["text"] for b in story_beats]
    else:
        scene_texts = split_scenes(title)
    if not scene_texts:
        scene_texts = [title]
    motif = pick_motif(title, labels)
    # Motif scene: first scene mentioning the motif keyword, else
    # scene index 1 when there are 3+ scenes, else 0.
    motif_scene = 0
    for i, scene in enumerate(scene_texts):
        if re.search(r"\b" + re.escape(motif["keyword"]) + r"\b",
                     scene.lower()):
            motif_scene = i
            break
    else:
        motif_scene = 1 if len(scene_texts) >= 3 else 0
    motif["scene"] = motif_scene
    motif.pop("keyword", None)
    notes.append(f"motif '{motif['type']}' in scene {motif_scene + 1}"
                 + (f", reflection '{motif['reflectionWord']}'"
                    if motif.get("reflectionWord") else "")
                 + (", tears" if motif.get("tears") else ""))

    scenes = []
    for i, text in enumerate(scene_texts):
        scenes.append({
            "words": text.split(),
            "camera": CAMERA_MOVES[i % len(CAMERA_MOVES)],
            "transitionOut": (TRANSITIONS[i % len(TRANSITIONS)]
                              if i < len(scene_texts) - 1 else "none"),
        })

    variant = pick_variant(task, notes)
    legacy_story = parse_story(details)
    if legacy_story and not story_beats:
        notes.append(f"story: {len(legacy_story)} beats")

    # Memory read (remake): past renders, his verbatim corrections,
    # and observed learnings inform this storyboard. Failure-silent:
    # memory must never break a storyboard.
    try:
        for _note in memory.learnings_summary(limit=3):
            notes.append(f"memory: {_note}")
    except Exception:
        pass

    storyboard = {
        "version": 1,
        "hook": title,
        "lengthSeconds": length_seconds,
        "palette": palette,
        "mood": {"tone": mood["tone"], "pacing": mood["pacing"]},
        "motif": motif,
        "scenes": scenes,
        "variant": variant,
        "notes": notes,
    }
    if story_beats:
        # The critic's story-coverage check reads this: every beat
        # must show up in the rendered video, not just in the notes.
        storyboard["story"] = {
            "source": story["source"],
            "beats": story_beats,
        }
    # Project / subtitle ONLY from explicit labels — never invented,
    # never the Motion Bot project/person name.
    project = (labels.get("project") or "").strip()
    if project:
        storyboard["project"] = project
    subtitle = (labels.get("subtitle") or labels.get("tagline")
                or labels.get("end_card") or "").strip()
    if subtitle:
        storyboard["subtitle"] = subtitle
    return storyboard


# ------------------------------------------------------------ narrated mode
# A task is NARRATED when its title or details ask for narration
# ("narrated" / "narration" / "voiceover" / "voice-over"). The
# Director is deterministic — no LLM, no network — so the trigger is
# a plain word match, with one guard: a trigger immediately preceded
# by a negation ("no voiceover", "without narration", "not
# narrated") does NOT trigger. v2.1 fixed the old limitation where
# "no voiceover" still triggered.
NARRATED_RE = re.compile(r"\b(narrated|narration|voiceover|voice-over)\b", re.I)
NEGATION_RE = re.compile(r"\b(no|not|without|never|don't|dont)\s+[\w\-]*$", re.I)

# Words too generic to search stock with. The trigger words
# themselves ("narrated", "voiceover") are in here too: a scene
# saying "narrated" has no visual in that word.
NARRATED_STOP_WORDS = {
    "narrated", "narration", "voiceover", "voice-over",
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for",
    "with", "by", "at", "from", "is", "are", "was", "were", "be", "it",
    "its", "this", "that", "these", "those", "you", "your", "we", "our",
    "he", "she", "they", "i", "me", "my", "his", "her", "their", "not",
    "no", "do", "does", "did", "can", "could", "will", "would", "should",
    "when", "where", "why", "how", "what", "who", "which", "there",
    "here", "very", "just", "only", "also", "than", "then", "so", "as",
    "if", "about", "into", "over", "after", "before", "between", "through",
    "during", "without", "within", "every", "each", "all", "any", "some",
    "more", "most", "other", "such", "own", "same", "too", "again",
    "once", "now", "out", "up", "down", "off", "am", "an", "us",
}


def is_narrated_task(task):
    """True when the title or details ask for narration/voiceover.

    A trigger immediately preceded by a negation ("no voiceover",
    "without narration", "not narrated") does not count: the task
    is narrated only if at least one trigger occurrence is NOT
    negated.
    """
    text = ((task.get("title") or "") + " " + (task.get("details") or ""))
    for m in NARRATED_RE.finditer(text):
        before = text[max(0, m.start() - 16):m.start()]
        if NEGATION_RE.search(before):
            continue
        return True
    return False


def keywords_for_scene(text, limit=4):
    """Top content words of a scene, for stock search.

    v2.1: routed through the semantics layer (concepts.py) — mapped
    phrases stay whole ("supply chain" -> freight truck / shipping
    port / warehouse), abstract words never become search terms.
    Keeps order of first appearance, dedupes. Falls back to
    ["landscape"] so a scene with no content words still gets a
    visual.
    """
    keywords, _, _ = semantic_keywords(
        text, stop_words=NARRATED_STOP_WORDS, limit=limit)
    return keywords or ["landscape"]


def estimate_scene_seconds(text):
    """Rough voiceover length: ~2.2 words/sec + 1.5s, min 3s.

    prepare.ts replaces this with the real Edge-TTS duration; the
    estimate only sizes the storyboard before preparation.
    """
    words = len((text or "").split())
    return max(3, int(words / 2.2) + 2)


def build_narrated_storyboard(task):
    """Mission Control task dict -> narrated storyboard dict.

    Scenes come from the same clause splitter as the Harness
    (2-4 scenes from the hook), each carrying its voiceover text and
    stock-search keywords. Project / subtitle ONLY from explicit
    labels, same rule as the Harness. Raises ValueError on an empty
    title — the watcher blocks those.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    if not title:
        raise ValueError("empty title: no hook to render")
    labels = parse_labels(details)
    notes = []

    scene_texts = split_scenes(title)
    if not scene_texts:
        scene_texts = [title]

    # Length: Length:/Duration: label caps the total; otherwise the
    # per-scene voice estimates sum up (prepare.ts re-times exactly).
    length = None
    if labels.get("length") or labels.get("duration"):
        m = LENGTH_RE.search(labels.get("length") or labels.get("duration"))
        length = float(m.group(1)) if m else None
    if length is None:
        m = LENGTH_RE.search(details)
        length = float(m.group(1)) if m else None
    est_total = sum(estimate_scene_seconds(t) for t in scene_texts)
    length_seconds = int(length) if length is not None else est_total
    length_seconds = max(3, min(60, length_seconds))

    scenes = []
    for text in scene_texts:
        keywords, scene_concepts, dropped = scene_keywords(
            text, title, stop_words=NARRATED_STOP_WORDS, limit=4)
        scene = {
            "voiceoverText": text,
            # Concept visuals first (search phrases), then concrete
            # words. A scene with no concept and no concrete word
            # keeps visualKeywords empty — the stock fetcher falls
            # back to "landscape", and the question gate treats
            # empty as a fork (see question_gate.py).
            "visualKeywords": keywords,
            "concepts": scene_concepts,
        }
        if scene_concepts:
            notes.append(
                f"concept {scene_concepts[0]!r} -> "
                f"{', '.join(keywords[:5])}")
        if dropped:
            notes.append(f"abstract words dropped from search: "
                         f"{', '.join(dropped)}")
        # Image: label only, and only when the file exists under
        # public/ — prepare.ts re-checks on the iMac; a missing file
        # is ignored there, never searched as stock keywords.
        scenes.append(scene)
    image_label = labels.get("image") or labels.get("images")
    if image_label:
        names = re.findall(r"[\w\-.]+\.(?:jpg|jpeg|png|webp)", image_label, re.I)
        if names and scenes:
            scenes[0]["localAsset"] = names[0]
            notes.append(f"local asset '{names[0]}' for scene 1 (if it exists)")

    storyboard = {
        "version": 1,
        "narrated": True,
        "hook": title,
        "lengthSeconds": length_seconds,
        "scenes": scenes,
        "notes": notes,
    }
    project = (labels.get("project") or "").strip()
    if project:
        storyboard["project"] = project
    subtitle = (labels.get("subtitle") or labels.get("tagline")
                or labels.get("end_card") or "").strip()
    if subtitle:
        storyboard["subtitle"] = subtitle
    return storyboard


if __name__ == "__main__":
    import json
    import sys
    demo = {
        "title": "Every mirror in your house shows you smiling, "
                 "except when you turn your back—that's when it "
                 "starts to cry.",
        "details": "10s duration\nBackground: white, gold, parchment",
    }
    print(json.dumps(build_storyboard(demo), indent=2))
    if len(sys.argv) > 1:
        print(json.dumps(build_storyboard(
            {"title": sys.argv[1],
             "details": sys.argv[2] if len(sys.argv) > 2 else ""}), indent=2))


# ------------------------------------------------------------ data rows (v2.3)
# A chart brief carries its numbers as plain "Label: number" lines in
# the details (e.g. "2024: 192"). Known label keys are excluded, and
# fewer than 2 rows is not a chart — it is prose that happens to
# contain a number, and the Harness route stays the default.
DATA_ROW_RE = re.compile(
    r"(?im)^\s*([\w][\w\s&'.\-]{0,40}?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*$")
_DATA_LABEL_KEYS = {
    "project", "subtitle", "tagline", "end card", "background",
    "accent", "text", "image", "images", "length", "duration",
    "mood", "tone", "motif", "name", "role",
}


def parse_data_rows(details):
    """Details text -> [{label, value}] or [] (needs >= 2 rows)."""
    rows = []
    for m in DATA_ROW_RE.finditer(details or ""):
        label = m.group(1).strip()
        if label.lower() in _DATA_LABEL_KEYS:
            continue
        rows.append({"label": label, "value": float(m.group(2))})
    return rows if len(rows) >= 2 else []
