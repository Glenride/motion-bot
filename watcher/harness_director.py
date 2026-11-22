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
    r"pills|source|logo|kinetic|bpm|"
    r"image|images|length|duration|mood|tone|motif|panel|font|motion|move|moves|tiktok|"
    r"power|demo|rule|fact|question|fun|"
    r"hook|benefit|proof|cta|style|test|ad|"
    r"product|features|feature|offer|was|now|code|deadline|everest|data|unit|mode|"
    r"chart|prompt|steps|step|output|benchmark|tier|usage|reset|quote|highlight|"
    r"compare|row|version|receipt|idea)\s*[:\-=]\s*(.+?)\s*$"
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
    r"(?im)^\s*(variant|motion)\s*[:\-=]\s*([A-Za-z][A-Za-z\-]*)\s*$")


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


# ------------------------------------------------------------ panels / fonts / motions (v2.6)
# The 2026-11-20 correction: variants changed background + type size,
# but every clip still read as the same centered serif paragraph.
# Panel changes the composition of the words, font changes the
# typeface, motion changes how words enter. Each rotates by task id
# on a different stride so adjacent tasks differ in all three;
# explicit labels override rotation. Defaults (centered / serif /
# kinetic) render exactly the pre-v2.6 look.
PANELS = ["centered", "split", "card", "lower-third", "word-stack"]
FONTS = ["serif", "sans", "mono"]
MOTIONS = ["kinetic", "slide", "scale", "rise"]
PANEL_RE = re.compile(r"(?im)^\s*panel\s*[:\-=]\s*([A-Za-z\-]+)\s*$")
FONT_RE = re.compile(r"(?im)^\s*font\s*[:\-=]\s*([A-Za-z]+)\s*$")
MOVE_RE = re.compile(r"(?im)^\s*move\s*[:\-=]\s*([A-Za-z][A-Za-z\-]*)\s*$")


def _pick_rotating(task, notes, name, values, regex, stride, offset):
    """Explicit `Name:` label wins, else rotation by task id."""
    details = task.get("details") or ""
    m = regex.search(details)
    if m and m.group(1).lower() in values:
        notes.append(f"{name} '{m.group(1).lower()}' (explicit label)")
        return m.group(1).lower()
    tid = task.get("id")
    if isinstance(tid, int):
        value = values[(tid * stride + offset) % len(values)]
        notes.append(f"{name} '{value}' (rotation by task id)")
        return value
    return values[0]


def pick_panel(task, notes):
    return _pick_rotating(task, notes, "panel", PANELS, PANEL_RE, 1, 0)


def pick_font(task, notes):
    return _pick_rotating(task, notes, "font", FONTS, FONT_RE, 2, 1)


def pick_motion(task, notes):
    """Task -> motion name. `Move:` wins; a `Motion:` / `Variant:`
    line whose value is also a motion name sets the motion too
    (kinetic/rise mean the same motion language in both vocabularies;
    slide/scale are motions only, orbit/sweep are variants only).
    `Motion:` stays the variant label — this does not change that."""
    details = task.get("details") or ""
    m = MOVE_RE.search(details)
    if m and m.group(1).lower() in MOTIONS:
        notes.append(f"motion '{m.group(1).lower()}' (explicit Move: label)")
        return m.group(1).lower()
    m = VARIANT_RE.search(details)
    if m and m.group(2).lower() in MOTIONS:
        notes.append(f"motion '{m.group(2).lower()}' (explicit Motion: label)")
        return m.group(2).lower()
    tid = task.get("id")
    if isinstance(tid, int):
        value = MOTIONS[(tid * 3 + 2) % len(MOTIONS)]
        notes.append(f"motion '{value}' (rotation by task id)")
        return value
    return "kinetic"


# ------------------------------------------- kinetic reveals / beat grid (v2.10)
# kinetic-typography-skills: the reveal is explicit-only, never
# rotated — a clip with no Kinetic: label renders the v2.6
# word-by-word line, exactly as before. A Motion:/Move: value that
# names a reveal (mask/blur/wipe/char/path) sets it too, so the
# director choice and the label agree.
KINETIC_REVEALS = ["word", "char", "mask", "blur", "wipe", "path"]
KINETIC_RE = re.compile(r"(?im)^\s*kinetic\s*[:\-=]\s*([A-Za-z]+)\s*$")
BPM_RE = re.compile(r"(?im)^\s*bpm\s*[:\-=]\s*(\d+)\s*$")


def pick_kinetic(task, notes):
    """Task -> kinetic reveal name. `Kinetic:` wins; a `Move:` /
    `Motion:` value naming a reveal wins next; else `word`."""
    details = task.get("details") or ""
    m = KINETIC_RE.search(details)
    if m and m.group(1).lower() in KINETIC_REVEALS:
        notes.append(f"kinetic '{m.group(1).lower()}' (explicit label)")
        return m.group(1).lower()
    m = MOVE_RE.search(details)
    if m and m.group(1).lower() in KINETIC_REVEALS:
        notes.append(f"kinetic '{m.group(1).lower()}' (explicit Move: label)")
        return m.group(1).lower()
    m = VARIANT_RE.search(details)
    if m and m.group(2).lower() in KINETIC_REVEALS:
        notes.append(f"kinetic '{m.group(2).lower()}' (explicit Motion: label)")
        return m.group(2).lower()
    return "word"


def pick_bpm(task, notes):
    """Task -> BPM for the beat grid, or None. `BPM:` label only,
    clamped 40-240; no label means the even scene split."""
    details = task.get("details") or ""
    m = BPM_RE.search(details)
    if not m:
        return None
    bpm = max(40, min(240, int(m.group(1))))
    notes.append(f"bpm {bpm} (explicit label, beat-grid cuts)")
    return bpm


# ------------------------------------------- named moves / TikTok formats (v2.11)
# motion-prompt registry (src/harness/motionRegistry.tsx is the
# source of truth — this list mirrors its 18 shipped names; a name
# here that is not in the registry renders nothing, and a registry
# name missing here never reaches a clip). tiktok-video-skills
# formats live in src/TikTokFormats.tsx.
REGISTRY_MOVES = {
    "pop-in", "stagger", "mask-reveal", "typewriter", "count-up",
    "kinetic-type", "shape-morph", "light-sweep", "impact-shake",
    "rack-focus", "pan", "dolly-in", "zoom-in", "mask-transition",
    "jump-cut", "match-cut", "whip-pan", "cross-dissolve",
}
MOVE_ALIASES = {
    "mask reveal": "mask-reveal", "mask": "mask-reveal",
    "count up": "count-up", "shape morph": "shape-morph",
    "light sweep": "light-sweep", "impact shake": "impact-shake",
    "rack focus": "rack-focus", "dolly in": "dolly-in",
    "slow dolly in": "dolly-in", "zoom in": "zoom-in",
    "mask transition": "mask-transition", "jump cut": "jump-cut",
    "match cut": "match-cut", "whip pan": "whip-pan",
    "cross dissolve": "cross-dissolve",
    "kinetic typography": "kinetic-type", "kinetic": "kinetic-type",
}
MOVES_RE = re.compile(r"(?im)^\s*moves\s*[:\-=]\s*(.+?)\s*$")
TIKTOK_RE = re.compile(r"(?im)^\s*tiktok\s*[:\-=]\s*([A-Za-z\- ]+)\s*$")
TIKTOK_FORMATS = {"hook-first": "hook-first", "hook first": "hook-first",
                  "fast-cut": "fast-cut", "fast cut": "fast-cut",
                  "duet": "duet", "reaction": "duet", "reaction-split": "duet"}


def _normalize_move(value):
    """Label value -> registry name, or None."""
    key = (value or "").strip().lower().replace("_", " ")
    key = re.sub(r"\s+", " ", key)
    if key in REGISTRY_MOVES:
        return key
    return MOVE_ALIASES.get(key)


def pick_move(task, notes):
    """Task -> registry move name, or None. `Move:` wins; a
    `Motion:` value naming a registry move wins next (mask-reveal
    via the alias map — VARIANT_RE only captures the first word,
    so "mask-reveal" arrives as "mask"). No label means no move:
    the registry never rotates, so a clip with no label renders
    exactly as before."""
    details = task.get("details") or ""
    m = MOVE_RE.search(details)
    if m:
        name = _normalize_move(m.group(1))
        if name:
            notes.append(f"move '{name}' (explicit Move: label)")
            return name
    m = VARIANT_RE.search(details)
    if m:
        name = _normalize_move(m.group(2))
        if name:
            notes.append(f"move '{name}' (explicit Motion: label)")
            return name
    return None


def pick_moves(task, notes):
    """Task -> per-scene registry move names, or None. `Moves:`
    is a comma list, one move per scene in order; unknown names
    are dropped with a note, never invented. A list shorter than
    the scene count leaves the later scenes on the clip move (or
    the default)."""
    details = task.get("details") or ""
    m = MOVES_RE.search(details)
    if not m:
        return None
    names = []
    for part in re.split(r"[,;]", m.group(1)):
        name = _normalize_move(part)
        if name:
            names.append(name)
        elif part.strip():
            notes.append(f"move '{part.strip()}' unknown — dropped")
    if not names:
        return None
    notes.append(f"moves {names} (explicit Moves: label)")
    return names


def pick_tiktok_format(task, notes):
    """Task -> TikTok format name, or None. `TikTok:` label only
    (hook-first | fast-cut | duet); no label means the v2.6
    Vertical exactly as before."""
    details = task.get("details") or ""
    m = TIKTOK_RE.search(details)
    if not m:
        return None
    key = re.sub(r"\s+", " ", m.group(1).strip().lower())
    fmt = TIKTOK_FORMATS.get(key)
    if fmt:
        notes.append(f"tiktok format '{fmt}' (explicit TikTok: label)")
        return fmt
    notes.append(f"tiktok format '{key}' unknown — dropped")
    return None


# ------------------------------------------- what-if episodes (v2.11)
# what-if-animation: the WhatIf composition (src/WhatIf.tsx) needs
# Power + 3 Demo lines + Fact; Rule / Fun / Question ride along.
# A demo line is "line | prop" — the prop is the picture
# (mug | phone | crosswalk | slice | stair | quiz | cookie);
# unknown props fall back to "none" (figure only), never invented.
WHATIF_PROPS = {"mug", "phone", "crosswalk", "slice", "stair", "quiz", "cookie", "none"}


def build_whatif(task, storyboard, draft=False):
    """Task + its storyboard -> what-if dict for the WhatIf rung,
    or None. Returns None without Power + 3 Demo lines + Fact —
    those tasks keep the default route, craft notes only, never
    an invented fact, demo, or number. With draft=True (Phase 1
    draft-first), the missing inputs become clearly marked
    placeholders instead of a refusal: the draft renders, the
    delivery note lists every placeholder, and the user corrects
    the values or tells the bot to re-render. The length clamps to
    the skill's 15–25 s (default 20 s). Scenes carry durationSeconds
    so the critic samples each beat at its midpoint."""
    details = task.get("details") or ""
    labels = parse_labels(details)
    power = (labels.get("power") or "").strip()
    rule = (labels.get("rule") or "").strip()
    fun = (labels.get("fun") or "").strip()
    fact = (labels.get("fact") or "").strip()
    question = (labels.get("question") or "").strip()
    demo_lines = _repeated_lines(details, "demo")
    if not power or len(demo_lines) < 3 or not fact or not question:
        if not draft:
            return None
        notes = storyboard.setdefault("notes", [])
        if not power:
            power = "[POWER NEEDED]"
            notes.append("what-if draft: no Power: label — placeholder "
                         "power, add a Power: line to replace it")
        while len(demo_lines) < 3:
            demo_lines.append(f"[DEMO {len(demo_lines) + 1} NEEDED]")
            notes.append("what-if draft: a Demo: line is missing — "
                         "placeholder demo, add Demo: lines to replace it")
        if not fact:
            fact = "[FACT NEEDED]"
            notes.append("what-if draft: no Fact: label — placeholder "
                         "fact, add a real fact with a number to replace it")
        if not question:
            question = "[QUESTION NEEDED]"
            notes.append("what-if draft: no Question: label — "
                         "placeholder question, add one to replace it")
    power_word = power.split()[0].capitalize()
    demos = []
    for line in demo_lines[:3]:
        if "|" in line:
            text, prop = line.rsplit("|", 1)
            prop = prop.strip().lower()
        else:
            text, prop = line, "none"
        demos.append({"line": text.strip(),
                      "prop": prop if prop in WHATIF_PROPS else "none"})
    # Fun defaults to the third demo line — one more escalation of
    # the brief's own demo, never an invented line.
    fun = fun or demos[2]["line"]
    length = storyboard.get("lengthSeconds") or 20
    length = max(15, min(25, int(length)))
    cold = round(length * 0.525 / 3, 2)
    beats = [
        {"title": "Demo 1", "text": f"{power_word}. {demos[0]['line']}"},
        {"title": "Demo 2", "text": f"{power_word}. {demos[1]['line']}"},
        {"title": "Demo 3", "text": f"{power_word}. {demos[2]['line']}"},
        {"title": "Premise", "text": f"What if you could {power}? {rule}"},
        {"title": "Fun", "text": fun},
        {"title": "Turn", "text": f"{fact} That's real."},
        {"title": "Question", "text": question},
    ]
    # Beat durations follow the composition's fractions (cold open
    # 52.5%, premise 20%, fun 7.5%, turn 20%) — the demo scenes
    # split the cold open evenly.
    scenes = [
        {"words": demos[0]["line"].split(), "durationSeconds": cold,
         "camera": {"fromScale": 1, "toScale": 1, "fromX": 0, "toX": 0},
         "transitionOut": "none"},
        {"words": demos[1]["line"].split(), "durationSeconds": cold,
         "camera": {"fromScale": 1, "toScale": 1, "fromX": 0, "toX": 0},
         "transitionOut": "none"},
        {"words": demos[2]["line"].split(), "durationSeconds": cold,
         "camera": {"fromScale": 1, "toScale": 1, "fromX": 0, "toX": 0},
         "transitionOut": "none"},
        {"words": ["WHAT", "IF", "YOU", "COULD", power.upper() + "?"],
         "durationSeconds": round(length * 0.2, 1),
         "camera": {"fromScale": 1, "toScale": 1, "fromX": 0, "toX": 0},
         "transitionOut": "none"},
        {"words": (fun or demos[2]["line"]).split(),
         "durationSeconds": round(length * 0.075, 1),
         "camera": {"fromScale": 1, "toScale": 1, "fromX": 0, "toX": 0},
         "transitionOut": "none"},
        {"words": fact.split(), "durationSeconds": round(length * 0.2, 1),
         "camera": {"fromScale": 1, "toScale": 1, "fromX": 0, "toX": 0},
         "transitionOut": "none"},
    ]
    return {
        "whatif": {"power": power, "rule": rule, "demos": demos,
                   "fun": fun, "fact": fact, "question": question},
        "lengthSeconds": length,
        "story": {"source": "whatif", "beats": beats},
        "scenes": scenes,
    }


def parse_pills(labels):
    """`Pills:` label -> up to 4 keyword pills (comma/pipe separated)."""
    raw = (labels.get("pills") or "").strip()
    if not raw:
        return []
    return [p.strip() for p in re.split(r"[,|]", raw) if p.strip()][:4]


# ------------------------------------------------- ad template (v2.7)
# ad-video-skills: ONE data-driven template, variant {hook, benefit,
# proof, cta}, 5-beat hook -> CTA, CTA hold >= 2s, one variable per
# variant. The variant is built ONLY from the task: explicit
# Hook:/Benefit:/Proof:/CTA: labels win, else the story beats
# (beat 1 = hook, beat 2 = benefit, beat 3 = proof). The CTA defaults
# to the hook text itself — message-matched by construction, and no
# product, price, or claim is ever invented. A task with fewer than
# 3 beats still renders: missing fields fall back to the hook.
AD_BEAT_SCENES = [
    ("hook", 0.12), ("context", 0.20), ("payoff", 0.32),
    ("proof", 0.24), ("cta", 0.12),
]


def build_ad_variant(task, storyboard):
    """Task + its storyboard -> variant dict for AdTemplate.

    Returns None only when there is no text at all (the watcher
    blocks empty titles upstream, so this is defensive). Appends
    notes to storyboard['notes'] about where each field came from.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    labels = parse_labels(details)
    notes = storyboard.setdefault("notes", [])
    story_beats = [(b.get("text") or "") for b in
                   (storyboard.get("story") or {}).get("beats") or []]
    if not story_beats:
        story_beats = split_scenes(title)
    story_beats = [b for b in story_beats if b.strip()]
    if not story_beats and not title:
        return None
    hook = (labels.get("hook") or "").strip() or (
        story_beats[0] if story_beats else title)
    benefit = (labels.get("benefit") or "").strip() or (
        story_beats[1] if len(story_beats) > 1 else hook)
    proof = (labels.get("proof") or "").strip() or (
        story_beats[2] if len(story_beats) > 2 else benefit)
    # CTA: explicit label, else the hook itself — the promise the
    # hook made, paid off by the button. Never invented copy.
    cta = (labels.get("cta") or "").strip() or hook
    test_field = (labels.get("test") or "hook").strip().lower()
    if test_field not in ("hook", "benefit", "proof", "cta"):
        test_field = "hook"
    variant = {"hook": hook, "benefit": benefit, "proof": proof,
               "cta": cta}
    notes.append(f"ad variant (test field: {test_field}): hook from "
                 f"{'Hook: label' if labels.get('hook') else 'story beat 1'}, "
                 f"benefit from "
                 f"{'Benefit: label' if labels.get('benefit') else 'story beat 2'}, "
                 f"proof from "
                 f"{'Proof: label' if labels.get('proof') else 'story beat 3'}, "
                 f"cta {'CTA: label' if labels.get('cta') else 'message-matched to hook'}")
    return {"variant": variant, "testField": test_field}


def ad_beat_scenes(variant):
    """Variant -> 5 critic scenes (one per ad beat) with the words
    each beat shows, so the critic samples every beat's midpoint."""
    texts = [
        variant["hook"],
        variant["benefit"],
        variant["benefit"],
        variant["proof"],
        variant["cta"],
    ]
    scenes = []
    for i, (name, frac) in enumerate(AD_BEAT_SCENES):
        scenes.append({
            "words": texts[i].split(),
            "camera": CAMERA_MOVES[i % len(CAMERA_MOVES)],
            "transitionOut": "none",
            "beat": name,
        })
    return scenes


# ------------------------------------------------- canvas styles (v2.7)
# animate-canvas: only cut-paper and crosshatch exist as Remotion
# code (src/CanvasStyles.tsx). The other five upstream styles (riso,
# sketchbook, math, pixel, isometric) stay craft notes only — a
# Style: label naming one of them returns None and the task renders
# the default Vertical/Harness route unchanged.
CANVAS_STYLE_ALIASES = {
    "cut-paper": "cut-paper",
    "cut paper": "cut-paper",
    "cutpaper": "cut-paper",
    "crosshatch": "crosshatch",
    "crosshatch-ink": "crosshatch",
    "crosshatch ink": "crosshatch",
}
CANVAS_STYLE_RE = re.compile(r"(?im)^\s*style\s*[:\-=]\s*(.+?)\s*$")
CANVAS_UNIMPLEMENTED = {"riso", "riso print", "sketchbook",
                        "sketchbook style", "math", "pixel",
                        "pixel animation", "isometric",
                        "isometric animation"}


def pick_canvas_style(task, notes):
    """Task -> 'cut-paper' | 'crosshatch' | None.

    An explicit `Style:` label wins; otherwise the style words in
    the text ("cut paper", "crosshatch ink") pick it. An
    unimplemented style is noted and returns None — never a wrong
    style, never a crash.
    """
    details = task.get("details") or ""
    text = ((task.get("title") or "") + "\n" + details)
    m = CANVAS_STYLE_RE.search(details)
    if m:
        raw = m.group(1).strip().lower()
        if raw in CANVAS_STYLE_ALIASES:
            style = CANVAS_STYLE_ALIASES[raw]
            notes.append(f"canvas style '{style}' (explicit Style: label)")
            return style
        if raw in CANVAS_UNIMPLEMENTED or any(
                raw.startswith(u) for u in CANVAS_UNIMPLEMENTED):
            notes.append(f"canvas style '{raw}' has no Remotion "
                         f"implementation yet — craft notes only")
            return None
        notes.append(f"canvas style '{raw}' unknown — default route")
        return None
    low = text.lower()
    for phrase, style in (("cut paper", "cut-paper"),
                          ("crosshatch ink", "crosshatch"),
                          ("crosshatch", "crosshatch")):
        if phrase in low:
            notes.append(f"canvas style '{style}' (matched '{phrase}')")
            return style
    return None


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
        if PANEL_RE.match(line.strip()):
            continue
        if FONT_RE.match(line.strip()):
            continue
        if MOVE_RE.match(line.strip()):
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


def build_storyboard(task, route=None):
    """Mission Control task dict -> storyboard dict (Harness props).

    task needs `title` (the hook) and `details` (free text + labels).
    Raises ValueError on an empty title — the watcher blocks those.

    route (Phase 1): a Phase 1 router record (phase1_router.route)
    overrides the task-id rotation picks — panel, variant, font,
    motion, kinetic, move, tiktokFormat come from the registry
    instead of the pick_* functions. route=None (default) keeps
    the live watcher's behaviour exactly: the watcher calls
    build_storyboard(task) unchanged.
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

    if route is not None:
        # Phase 1 route override: the registry picks replace the
        # task-id rotation. IDs carry their family prefix
        # ("panel.centered"); the storyboard keeps the bare names
        # the renderers expect. bpm still comes from the brief.
        def _bare(rid, default):
            if not rid:
                return default
            return rid.split(".", 1)[1] if "." in rid else rid
        variant = _bare(route.get("variant"), "orbit")
        panel = _bare(route.get("panel"), "centered")
        font = _bare(route.get("font"), "serif")
        motion = _bare(route.get("motion"), "kinetic")
        kinetic = _bare(route.get("kinetic"), "word")
        bpm = pick_bpm(task, notes)
        move = _bare(route.get("move"), None) or None
        # Per-scene Moves: labels still pass through in route mode:
        # the router picks one default move, but an explicit Moves:
        # list cycles per scene (how the v2.11 clips proved the
        # move families). No label means no moves prop at all.
        moves = pick_moves(task, notes)
        tiktok_format = _bare(route.get("tiktokFormat"), None) or None
        notes.append("phase1 route: panel '{}', variant '{}', font '{}', "
                     "motion '{}', kinetic '{}', move '{}', tiktok '{}'".format(
                         panel, variant, font, motion, kinetic,
                         move or "-", tiktok_format or "-"))
        if route.get("labelled"):
            notes.append("phase1: labelled override — '{}'".format(
                route.get("label") or ""))
        if route.get("approximation"):
            notes.append("phase1: APPROXIMATION — '{}' is not built; "
                         "nearest implemented entry '{}' used, not the "
                         "labelled style".format(
                             route.get("approximation"), route.get("style") or ""))
    else:
        variant = pick_variant(task, notes)
        panel = pick_panel(task, notes)
        font = pick_font(task, notes)
        motion = pick_motion(task, notes)
        kinetic = pick_kinetic(task, notes)
        bpm = pick_bpm(task, notes)
        move = pick_move(task, notes)
        moves = pick_moves(task, notes)
        tiktok_format = pick_tiktok_format(task, notes)
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
        "panel": panel,
        "font": font,
        "motion": motion,
        "kinetic": kinetic,
        "notes": notes,
    }
    if route is not None:
        # Phase 1 record: the proof harness and the history log read
        # this, never the model's memory. The router record is flat
        # (panel/variant/... at top level); the picks stored here
        # are the same flat fields.
        storyboard["phase1"] = {
            "picks": {k: route.get(k) for k in
                      ("panel", "variant", "font", "motion", "kinetic",
                       "move", "style", "composition", "format")
                      if route.get(k) is not None},
            "composition": route.get("composition", ""),
            "format": route.get("format", ""),
            "labelled": bool(route.get("labelled")),
            "label": route.get("label") or "",
            "approximation": route.get("approximation") or "",
            "reason": route.get("reason") or "",
        }
    if bpm is not None:
        storyboard["bpm"] = bpm
    # Named moves (v2.11, motion-prompt registry): Move: / Moves:
    # labels pass through so Vertical can dispatch the registry;
    # no label means no move prop at all. TikTok: label selects a
    # short-form format for Vertical.
    if move is not None:
        storyboard["move"] = move
    if moves is not None:
        storyboard["moves"] = moves
    if tiktok_format is not None:
        storyboard["tiktokFormat"] = tiktok_format
    # Lower-third overlay (v2.10): Name:/Role:/Pills:/Source: labels
    # pass through so Vertical/Harness can strap the clip; the
    # standalone LowerThird rung reads the same labels in the watcher.
    # Logo: label passes the wordmark for the LogoReveal end card.
    name_label = (labels.get("name") or "").strip()
    if name_label:
        storyboard["name"] = name_label
    role_label = (labels.get("role") or "").strip()
    if role_label:
        storyboard["role"] = role_label
    pills = parse_pills(labels)
    if pills:
        storyboard["pills"] = pills
    source_label = (labels.get("source") or "").strip()
    if source_label:
        storyboard["source"] = source_label
    logo_label = (labels.get("logo") or "").strip()
    if logo_label:
        storyboard["logo"] = logo_label
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
# v2.8: a `Data:` line also carries rows — comma/semicolon-separated
# `Label: number` pairs ("Data: Q2 2026: 227, Q3 2026: 225"). A task
# carrying Data: rows IS a data task: the watcher routes to Chart
# on rows alone, without requiring the chart trigger words too.
DATA_ROW_RE = re.compile(
    r"(?im)^\s*([\w][\w\s&'.\-]{0,40}?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*$")
DATA_LINE_RE = re.compile(r"(?im)^\s*data\s*[:\-=]\s*(.+?)\s*$")
# A pair is `<label> <number>` or `<label>: <number>`, anchored on the
# number at the END of the part — so "Q2 2026: 227" reads label
# "Q2 2026", value 227, never label "Q" value 2.
DATA_PAIR_RE = re.compile(
    r"([\w][\w\s&'.\-]{0,40}?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*$")
_DATA_LABEL_KEYS = {
    "project", "subtitle", "tagline", "end card", "background",
    "accent", "text", "image", "images", "length", "duration",
    "mood", "tone", "motif", "name", "role", "panel", "font",
    "motion", "move", "hook", "benefit", "proof", "cta", "style",
    "test", "ad", "product", "features", "feature", "offer", "was",
    "now", "code", "deadline", "everest", "data", "unit", "mode",
    "chart", "prompt", "steps", "step", "output", "benchmark",
    "tier", "usage", "reset", "quote", "highlight", "compare",
    "row", "version", "receipt", "pills",
}


def parse_data_rows(details):
    """Details text -> [{label, value}] or [] (needs >= 2 rows).

    Plain `Label: number` lines, plus `Data:` lines carrying
    comma/semicolon-separated `Label: number` pairs. A row whose
    label is a known label key (Length:, Product:, ...) is not data.
    """
    rows = []
    for m in DATA_ROW_RE.finditer(details or ""):
        label = m.group(1).strip()
        if label.lower() in _DATA_LABEL_KEYS:
            continue
        rows.append({"label": label, "value": float(m.group(2))})
    for m in DATA_LINE_RE.finditer(details or ""):
        for part in re.split(r"[;,]", m.group(1)):
            pm = DATA_PAIR_RE.search(part.strip())
            if not pm:
                continue
            label = pm.group(1).strip()
            # The label must carry a letter or an explicit `:`/`=`
            # separator: a bare "227" part is a number without a
            # label, not a row — but "2024: 192" is a year row.
            if (label.lower() in _DATA_LABEL_KEYS or not label
                    or (not re.search(r"[A-Za-z]", label)
                        and ":" not in part and "=" not in part)):
                continue
            rows.append({"label": label, "value": float(pm.group(2))})
    return rows if len(rows) >= 2 else []


def draft_data_rows(details):
    """Phase 1 draft-first: a Chart brief with no parseable numbers
    still gets a draft. Two placeholder bars at value 0, labelled
    [VALUE 1 NEEDED] / [VALUE 2 NEEDED] — the flat bars and the
    labels say on screen that the numbers are missing, and no
    figure is invented. The delivery note tells the user to add
    `Data:` rows and re-render. Distinct labels (not two identical
    ones) so React keys stay unique."""
    return [{"label": "[VALUE 1 NEEDED]", "value": 0},
            {"label": "[VALUE 2 NEEDED]", "value": 0}]


def _split_list(value):
    """A `Features:` / `Steps:` / `Pills:` value -> [items]."""
    return [p.strip() for p in re.split(r"[;,]", value or "") if p.strip()]


def _repeated_lines(details, key):
    """All `Key: value` lines (parse_labels keeps only the last)."""
    return [m.group(1).strip() for m in re.finditer(
        r"(?im)^\s*" + re.escape(key) + r"\s*[:\-=]\s*(.+?)\s*$",
        details or "")]


def _money(value):
    """'$1,605' / '1605.50' -> float, or None when unparseable."""
    if value is None:
        return None
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)", str(value).replace("$", ""))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


# ------------------------------------------------- product demo (v2.8)
# ecommerce-video-skills: ProductDemo needs a product name (a
# `Product:` label, else the task title when the ecommerce trigger
# matched — the title IS the brief's own words, never invented).
# Features come from `Features:` / repeated `Feature:` lines, else
# the story beats after the first (the demo's own content, same
# pattern as the ad variant). Money NEVER comes from beats: offer
# text, was/now, code, and deadline only from explicit labels. A
# was/now pair renders only when now < was — a bad row shows no
# price drop at all. Returns None when there is no product to demo.
def build_product_demo(task, storyboard, ecommerce_matched=False, draft=False):
    """Task + storyboard -> ProductDemo props dict, or None.

    With draft=True (Phase 1 draft-first), a demo with no features
    renders one clearly marked placeholder feature instead of
    returning None — the draft ships, the delivery note names the
    missing feature, and the user corrects it or re-renders. Money
    is never invented: offer, was/now, code and deadline come only
    from explicit labels, in draft or not."""
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    labels = parse_labels(details)
    notes = storyboard.setdefault("notes", [])
    product = (labels.get("product") or "").strip()
    if not product and ecommerce_matched and title:
        product = title
        notes.append("product demo: product name from the task title "
                     "(ecommerce trigger matched, no Product: label)")
    if not product:
        return None
    features = _split_list(labels.get("features") or "")
    if not features:
        features = _repeated_lines(details, "feature")
    if not features:
        beats = [(b.get("text") or "") for b in
                 (storyboard.get("story") or {}).get("beats") or []]
        features = [b for b in beats[1:] if b.strip()][:4]
        if features:
            notes.append("product demo: features from story beats 2+ "
                         "(no Features:/Feature: label)")
    if not features and draft:
        features = ["[FEATURE NEEDED]"]
        notes.append("product demo draft: no features in the brief — "
                     "placeholder feature, add Features: lines to "
                     "replace it")
    features = features[:4]
    offer = {}
    was = _money(labels.get("was"))
    now = _money(labels.get("now"))
    if was is not None and now is not None:
        if now < was:
            offer["was"] = was
            offer["now"] = now
        else:
            notes.append(f"product demo: was/now ${was:g}/${now:g} "
                         f"ignored — now must be below was (no price "
                         f"drop renders)")
    if (labels.get("offer") or "").strip():
        offer["text"] = labels["offer"].strip()
    if (labels.get("code") or "").strip():
        offer["code"] = labels["code"].strip()
    if (labels.get("deadline") or "").strip():
        offer["deadline"] = labels["deadline"].strip()
    cta = (labels.get("cta") or "").strip() or title
    demo = {"product": product, "features": features, "offer": offer,
            "cta": cta, "hook": title}
    notes.append(f"product demo: '{product}'"
                 + (f", {len(features)} feature(s)" if features else
                    ", no features")
                 + (", offer" if offer else ", no offer"))
    # Critic scenes: product frame, one per feature, end card.
    scenes = [{"words": (product + " " + title).split(),
               "camera": CAMERA_MOVES[0], "transitionOut": "none"}]
    for f in features:
        scenes.append({"words": f.split(), "camera": CAMERA_MOVES[1],
                       "transitionOut": "none"})
    scenes.append({"words": (product + " " + cta).split(),
                   "camera": CAMERA_MOVES[2], "transitionOut": "none"})
    demo["scenes"] = scenes
    return demo


# ------------------------------------------------- everest panels (v2.8)
# everest-components: one category prop selects the panel in
# src/EverestPanels.tsx. The category comes from an explicit
# `Everest:` label ("Everest: benchmarks" or the full pack id)
# else the first matched everest-* pack in route order. Each
# category lists what it needs from the task; a category whose
# numbers are absent returns None and the watcher falls back to
# the default route with a note — never an invented figure, never
# a fake real surface.
EVEREST_PACK_TO_CATEGORY = {
    "everest-product-ui": "product-ui",
    "everest-prompts-results": "prompts-results",
    "everest-agents-workflows": "agents-workflows",
    "everest-models-benchmarks": "models-benchmarks",
    "everest-comparisons": "comparisons",
    "everest-launch-news": "launch-news",
    "everest-pricing-limits": "pricing-limits",
    "everest-lower-thirds": "lower-thirds",
    "everest-broll-frames": "broll-frames",
    "everest-evidence-quotes": "evidence-quotes",
    "everest-usage-cost": "usage-cost",
}
EVEREST_CATEGORY_ALIASES = {
    "product-ui": "product-ui", "product ui": "product-ui",
    "prompts-results": "prompts-results", "prompts": "prompts-results",
    "agents-workflows": "agents-workflows", "agents": "agents-workflows",
    "models-benchmarks": "models-benchmarks", "benchmarks": "models-benchmarks",
    "comparisons": "comparisons", "comparison": "comparisons",
    "launch-news": "launch-news", "launch": "launch-news",
    "pricing-limits": "pricing-limits", "pricing": "pricing-limits",
    "lower-thirds": "lower-thirds", "lower thirds": "lower-thirds",
    "broll-frames": "broll-frames", "b-roll frames": "broll-frames",
    "evidence-quotes": "evidence-quotes", "evidence": "evidence-quotes",
    "usage-cost": "usage-cost", "usage": "usage-cost",
}
# broll-frames is DROPPED (see EverestPanels.tsx header): every
# pattern in it needs real footage or a real app screenshot, and
# Motion Bot has no footage source of its own.
EVEREST_DROPPED = {
    "broll-frames": ("everest b-roll-frames has no Remotion "
                     "implementation — every pattern needs real "
                     "footage or a real app screenshot, and Motion "
                     "Bot has no footage source"),
}

BENCHMARK_RE = re.compile(
    r"(?im)^\s*benchmark\s*[:\-=]\s*(.+?)\s+(\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?)\s*$")
TIER_RE = re.compile(
    r"(?im)^\s*tier\s*[:\-=]\s*(.+?)\s*$")
COMPARE_RE = re.compile(
    r"(?im)^\s*compare\s*[:\-=]\s*(.+?)\s+vs\.?\s+(.+?)\s*$")
ROW_RE = re.compile(
    r"(?im)^\s*row\s*[:\-=]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*(?:\|\s*(left|right)\s*)?$")
USAGE_RE = re.compile(
    r"(?im)^\s*usage\s*[:\-=]\s*(\d+(?:\.\d+)?)\s*(?:/|of)\s*(\d+(?:\.\d+)?)")


def _parse_tiers(details):
    """`Tier: Name $price — note (recommended)` lines -> [tiers]."""
    tiers = []
    for raw in _repeated_lines(details, "tier"):
        recommended = "(recommended)" in raw.lower()
        raw = re.sub(r"\(recommended\)", "", raw, flags=re.I).strip()
        price_m = re.search(r"\$[\d,]+(?:\.\d+)?(?:\s*/\s*\w+)?", raw)
        price = price_m.group(0).replace(" ", "") if price_m else ""
        head = raw[:price_m.start()].strip() if price_m else raw
        tail = raw[price_m.end():].strip() if price_m else ""
        note = re.sub(r"^[\-–—:]\s*", "", tail).strip()
        name = re.sub(r"[\-–—:]\s*$", "", head).strip()
        if name:
            tiers.append({"name": name, "price": price, "note": note,
                          "recommended": recommended})
    return tiers


def _parse_receipt(details):
    """`Receipt: tokens 1200, minutes 4, calls 18, total $0.42`."""
    labels = parse_labels(details)
    raw = labels.get("receipt") or ""
    receipt = {}
    for key, pat in (("tokens", r"tokens?\s*[:=]?\s*([\d,]+)"),
                     ("minutes", r"minutes?\s*[:=]?\s*([\d,]+)"),
                     ("calls", r"(?:tool\s*)?calls?\s*[:=]?\s*([\d,]+)")):
        m = re.search(pat, raw, re.I)
        if m:
            receipt[key] = int(m.group(1).replace(",", ""))
    m = re.search(r"total\s*[:=]?\s*(\$[\d,]+(?:\.\d+)?)", raw, re.I)
    if m:
        receipt["total"] = m.group(1)
    return receipt


def build_everest_panel(task, storyboard, matched_packs, draft=False):
    """Task + storyboard + matched everest-* packs -> panel props.

    Returns None when the selected category cannot be rendered
    without inventing data (reason in storyboard['notes']) — the
    watcher then falls back to the default route. With draft=True
    (Phase 1 draft-first), the missing inputs become clearly
    marked placeholders instead of a refusal: numbers render as 0
    with a [VALUE NEEDED]-style label, never as an invented
    figure presented as real. The delivery note lists every
    placeholder.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    labels = parse_labels(details)
    notes = storyboard.setdefault("notes", [])
    category = None
    everest_label = (labels.get("everest") or "").strip().lower()
    if everest_label:
        if everest_label in EVEREST_PACK_TO_CATEGORY:
            category = EVEREST_PACK_TO_CATEGORY[everest_label]
        elif everest_label in EVEREST_CATEGORY_ALIASES:
            category = EVEREST_CATEGORY_ALIASES[everest_label]
        if category:
            notes.append(f"everest panel '{category}' (explicit "
                         f"Everest: label)")
    if category is None:
        for pack in matched_packs or []:
            if pack in EVEREST_PACK_TO_CATEGORY:
                category = EVEREST_PACK_TO_CATEGORY[pack]
                notes.append(f"everest panel '{category}' (matched "
                             f"'{pack}')")
                break
    if category is None:
        return None
    if category in EVEREST_DROPPED:
        notes.append("everest DROPPED: " + EVEREST_DROPPED[category])
        return None
    beats = [(b.get("text") or "") for b in
             (storyboard.get("story") or {}).get("beats") or []]
    beats = [b for b in beats if b.strip()]
    panel = {"category": category, "hook": title}
    if category in ("product-ui", "prompts-results", "agents-workflows"):
        panel["prompt"] = (labels.get("prompt") or "").strip() or title
        steps = _split_list(labels.get("steps") or "")
        if not steps:
            steps = _repeated_lines(details, "step")
        if not steps:
            steps = beats
        if not steps:
            steps = [title]
        panel["steps"] = steps
        if category == "prompts-results":
            panel["outputLines"] = steps
        notes.append(f"everest '{category}': prompt + "
                     f"{len(steps)} step(s) from "
                     f"{'Steps:/Step: label' if labels.get('steps') or _repeated_lines(details, 'step') else 'story beats'}")
    elif category == "models-benchmarks":
        bars = []
        for m in BENCHMARK_RE.finditer(details):
            bars.append({"label": m.group(1).strip(),
                         "old": float(m.group(2)),
                         "new": float(m.group(3))})
        if not bars:
            if not draft:
                notes.append("everest DROPPED: models-benchmarks needs "
                             "`Benchmark: <label> <old> -> <new>` lines — "
                             "no numbers in the task, none invented")
                return None
            bars = [{"label": "[BENCHMARK NEEDED]", "old": 0, "new": 0}]
            notes.append("everest draft: models-benchmarks has no "
                         "Benchmark: lines — placeholder bar at 0 with "
                         "a [BENCHMARK NEEDED] label, add Benchmark: "
                         "lines to replace it")
        panel["bars"] = bars
        notes.append(f"everest 'models-benchmarks': {len(bars)} bar(s)")
    elif category == "comparisons":
        m = COMPARE_RE.search(details)
        rows = []
        for rm in ROW_RE.finditer(details):
            rows.append({"label": rm.group(1).strip(),
                         "left": rm.group(2).strip(),
                         "right": rm.group(3).strip(),
                         "winner": (rm.group(4) or "right").strip().lower()})
        if not m or not rows:
            if not draft:
                notes.append("everest DROPPED: comparisons needs "
                             "`Compare: <A> vs <B>` plus `Row: <label> | "
                             "<left> | <right> | <left|right>` lines")
                return None
            m = None
            rows = [{"label": "[ROW NEEDED]", "left": "—",
                     "right": "—", "winner": "right"}]
            notes.append("everest draft: comparisons has no Compare:/"
                         "Row: lines — placeholder comparison, add "
                         "Compare: and Row: lines to replace it")
        panel["comparison"] = {"left": m.group(1).strip() if m else "[OPTION A NEEDED]",
                               "right": m.group(2).strip() if m else "[OPTION B NEEDED]", "rows": rows}
        notes.append(f"everest 'comparisons': {m.group(1).strip()} vs "
                     f"{m.group(2).strip()}, {len(rows)} row(s)")
    elif category == "launch-news":
        name = ((labels.get("name") or "").strip()
                or (labels.get("product") or "").strip()
                or (labels.get("project") or "").strip())
        if not name:
            if not draft:
                notes.append("everest DROPPED: launch-news needs a "
                             "`Name:` / `Product:` / `Project:` label — "
                             "no name to launch")
                return None
            name = "[NAME NEEDED]"
            notes.append("everest draft: launch-news has no Name:/"
                         "Product:/Project: label — placeholder name, "
                         "add one to replace it")
        panel["name"] = name
        if (labels.get("version") or "").strip():
            panel["version"] = labels["version"].strip()
        tiers = _parse_tiers(details)
        if tiers:
            panel["tiers"] = tiers
        notes.append(f"everest 'launch-news': '{name}'"
                     + (f" v{panel.get('version')}" if panel.get("version") else "")
                     + (f", {len(tiers)} tier(s)" if tiers else ""))
    elif category == "pricing-limits":
        tiers = _parse_tiers(details)
        was = _money(labels.get("was"))
        now = _money(labels.get("now"))
        receipt = _parse_receipt(details)
        if not tiers and not (was is not None and now is not None) and not receipt:
            if not draft:
                notes.append("everest DROPPED: pricing-limits needs "
                             "`Tier:` lines, a `Was:`/`Now:` pair, or a "
                             "`Receipt:` line — no prices in the task")
                return None
            tiers = [{"name": "[TIER NEEDED]", "price": "[PRICE NEEDED]",
                      "note": "", "recommended": False}]
            notes.append("everest draft: pricing-limits has no Tier:/"
                         "Was:/Now:/Receipt: lines — placeholder tier, "
                         "add Tier: lines to replace it")
        if tiers:
            panel["tiers"] = tiers
        if was is not None and now is not None and now < was:
            panel["wasPrice"] = f"${was:g}"
            panel["nowPrice"] = f"${now:g}"
        if receipt:
            panel["receipt"] = receipt
        notes.append(f"everest 'pricing-limits': {len(tiers)} tier(s)"
                     + (", was/now" if panel.get("wasPrice") else "")
                     + (", receipt" if receipt else ""))
    elif category == "lower-thirds":
        name = (labels.get("name") or "").strip()
        if not name:
            if not draft:
                notes.append("everest DROPPED: lower-thirds needs a "
                             "`Name:` label")
                return None
            name = "[NAME NEEDED]"
            notes.append("everest draft: lower-thirds has no Name: "
                         "label — placeholder name, add one to replace it")
        panel["name"] = name
        if (labels.get("role") or "").strip():
            panel["role"] = labels["role"].strip()
        pills = _split_list(labels.get("pills") or "")
        if pills:
            panel["pills"] = pills
        if (labels.get("project") or "").strip():
            panel["project"] = labels["project"].strip()
        notes.append(f"everest 'lower-thirds': '{name}'")
    elif category == "usage-cost":
        m = USAGE_RE.search(details)
        if not m:
            if not draft:
                notes.append("everest DROPPED: usage-cost needs a "
                             "`Usage: <used>/<cap>` line — no cap in the "
                             "task")
                return None
            usage = {"used": 0, "cap": 0, "label": "[CAP NEEDED]"}
            panel["usage"] = usage
            notes.append("everest draft: usage-cost has no Usage: line "
                         "— placeholder 0/0 with a [CAP NEEDED] label "
                         "(the 0 cap is a stand-in so the bar math "
                         "renders; add a Usage: <used>/<cap> line to "
                         "replace it)")
            panel["scenes"] = [
                {"words": title.split(), "camera": CAMERA_MOVES[0],
                 "transitionOut": "none"}]
            return panel
        usage = {"used": float(m.group(1)), "cap": float(m.group(2))}
        reset = (labels.get("reset") or "").strip()
        if reset:
            rm = re.match(r"^(\d+):(\d\d)$", reset)
            if rm:
                usage["resetSeconds"] = int(rm.group(1)) * 60 + int(rm.group(2))
            elif reset.isdigit():
                usage["resetSeconds"] = int(reset)
        panel["usage"] = usage
        notes.append(f"everest 'usage-cost': {usage['used']:g}/"
                     f"{usage['cap']:g}")
    elif category == "evidence-quotes":
        quote = (labels.get("quote") or "").strip()
        if not quote:
            if not draft:
                notes.append("everest DROPPED: evidence-quotes needs a "
                             "`Quote:` label — no supplied quote to card")
                return None
            quote = "[QUOTE NEEDED]"
            notes.append("everest draft: evidence-quotes has no Quote: "
                         "label — placeholder quote, add a Quote: label "
                         "to replace it")
        panel["quote"] = quote
        if (labels.get("highlight") or "").strip():
            panel["highlight"] = labels["highlight"].strip()
        if (labels.get("project") or "").strip():
            panel["project"] = labels["project"].strip()
        notes.append("everest 'evidence-quotes': supplied quote card")
    # Critic scenes: the hook header is on screen the whole clip,
    # plus one scene per step / bar / row so samples land mid-panel.
    scene_words = [title]
    if panel.get("steps"):
        scene_words = panel["steps"][:4]
    elif panel.get("bars"):
        scene_words = [f"{b['label']} {b['old']:g} {b['new']:g}"
                       for b in panel["bars"][:4]]
    elif panel.get("comparison"):
        scene_words = [r["label"] for r in
                       panel["comparison"]["rows"][:4]]
    panel["scenes"] = [
        {"words": w.split(), "camera": CAMERA_MOVES[i % len(CAMERA_MOVES)],
         "transitionOut": "none"}
        for i, w in enumerate(scene_words)]
    return panel


# ------------------------------------------------- explainer (v2.9)
# explainer-video-skills: one idea per scene, build-and-hold
# pacing, end-card recap. The Explainer composition renders three
# code-drawn styles (diagram / whiteboard / isometric) from the
# same ideas prop. Ideas come only from the task: Idea:/Step:
# labels, else the story beats — never invented. The diagram IS
# the brief's beats in order; no figure is drawn from nothing.
# wrapped-video is not a separate composition: its grammar is the
# same build-and-hold + end-card shape and its count-up already
# lives in Chart/D3Chart (v2.8) — a Wrapped-style brief (a data
# row with a hero number) routes to Chart stats mode instead.
EXPLAINER_STYLES = {
    "diagram": "diagram",
    "whiteboard": "whiteboard",
    "white board": "whiteboard",
    "white-board": "whiteboard",
    "scribe": "whiteboard",
    "isometric": "isometric",
    "iso": "isometric",
    "isometric-animation": "isometric",
}


def build_explainer(task, storyboard, draft=False):
    """Task + storyboard -> Explainer props dict, or None.

    Returns None only when the task carries no ideas at all (no
    story beats, no Idea:/Step: labels) — the watcher then falls
    back to the default route. With draft=True (Phase 1
    draft-first), the missing ideas become one clearly marked
    placeholder idea instead of a refusal.
    """
    title = (task.get("title") or "").strip()
    details = task.get("details") or ""
    labels = parse_labels(details)
    notes = storyboard.setdefault("notes", [])
    style = None
    style_label = (labels.get("style") or "").strip().lower()
    if style_label in EXPLAINER_STYLES:
        style = EXPLAINER_STYLES[style_label]
        notes.append(f"explainer style '{style}' (explicit Style: label)")
    if style is None:
        low = ((task.get("title") or "") + "\n" + details).lower()
        if "whiteboard" in low or "scribe" in low:
            style = "whiteboard"
        elif "isometric" in low or re.search(r"\biso\b", low):
            style = "isometric"
        else:
            style = "diagram"
        notes.append(f"explainer style '{style}' (default)")
    lines = _split_list(labels.get("idea") or "")
    if not lines:
        lines = _repeated_lines(details, "idea")
    if not lines:
        lines = _split_list(labels.get("step") or "")
    if not lines:
        lines = _repeated_lines(details, "step")
    if not lines:
        lines = [(b.get("text") or "") for b in
                 (storyboard.get("story") or {}).get("beats") or []]
        lines = [b for b in lines if b.strip()]
        if lines:
            notes.append("explainer ideas from story beats "
                         "(no Idea:/Step: label)")
    if not lines:
        if not draft:
            notes.append("explainer DROPPED: no ideas — no story beats "
                         "and no Idea:/Step: label, nothing to explain")
            return None
        lines = ["[IDEA NEEDED] — add an Idea: line or story beats"]
        notes.append("explainer draft: no ideas in the brief — "
                     "placeholder idea, add Idea: lines or story beats "
                     "to replace it")
    lines = lines[:4]
    ideas = [{"title": " ".join(l.split()[:2]),
              "line": l.strip()} for l in lines]
    cta = (labels.get("cta") or "").strip() or title
    explainer = {"hook": title, "ideas": ideas, "style": style,
                 "cta": cta}
    notes.append(f"explainer: {len(ideas)} idea(s), style '{style}'")
    # Critic scenes: one per idea plus the end-card recap.
    scenes = [{"words": i["line"].split(),
               "camera": CAMERA_MOVES[k % len(CAMERA_MOVES)],
               "transitionOut": "none"}
              for k, i in enumerate(ideas)]
    scenes.append({"words": (title + " " + cta).split(),
                   "camera": CAMERA_MOVES[len(ideas) % len(CAMERA_MOVES)],
                   "transitionOut": "none"})
    explainer["scenes"] = scenes
    explainer["lengthSeconds"] = len(ideas) * 4 + 3
    return explainer
