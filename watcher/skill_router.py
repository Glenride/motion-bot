#!/usr/bin/env python3
"""Motion Bot — skill router (v2.2, iart-ai motion-skills).

The iart-ai packs live under skills/ (MIT, cloned from github.com/iart-ai).
A skill is craft guidance, never copy: it may change HOW a clip moves
(easing, safe areas, pacing, loop, format) but never WHAT it says —
scene text still comes only from the hook, voiceover words only from
the hook, exactly as before.

route(text) -> dict with:
  skills:   pack ids matched, in priority order (base craft first)
  format:   "landscape" | "vertical"  (vertical = 720x1280 Vertical comp)
  reasons:  human-readable why each skill matched
  craft:    short craft notes distilled from the matched SKILL.md files
            (loaded at runtime, truncated so an LLM prompt stays small)

Keyword triggers are deliberately narrow: a skill that fires on every
brief would be decoration, not craft. "vertical" etc. must be explicit
in the task (a label or the words themselves) — the router never
guesses a format from a vague brief.
"""

import re
from pathlib import Path

SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"

# pack id -> (trigger regexes, craft focus, format)
PACKS = {
    "motion-design-skills": (
        [r"\b(motion design|easing|loop|safe area|brand motion)\b"],
        "Base craft: easing curves, safe areas, seamless loops, on-brand type/color.",
        None,
    ),
    "kinetic-typography-skills": (
        [r"\b(kinetic|typography|title card|word by word|big text|text anim)\b"],
        "Kinetic type: word-by-word landings, stagger timing, readable at speed.",
        None,
    ),
    "explainer-video-skills": (
        [r"\b(explain|explainer|how it works|tutorial|step by step|guide)\b"],
        "Explainer: one idea per scene, build-and-hold pacing, end-card recap.",
        None,
    ),
    "tiktok-video-skills": (
        [r"\b(vertical|reel|short|tiktok|9:16|portrait|story format)\b"],
        "Short-form vertical: 720x1280, 120px safe areas top/bottom, hook in first 1s, fast cuts.",
        "vertical",
    ),
    "data-animation-skills": (
        [r"\b(chart|graph|dataset|percent|growth|statistic|bar chart|line chart)\b"],
        "Data: frame-accurate numbers, count-up on the value, never animate the axis away from the data.",
        None,
    ),
    "lower-thirds-skills": (
        [r"\b(lower third|name card|overlay|stream overlay)\b"],
        "Lower thirds: transparent overlay, name + role, in/out in under 12 frames.",
        None,
    ),
    "synthwave-style": (
        [r"\b(synthwave|outrun|neon drive|retro wave)\b"],
        "Synthwave, purple-free: navy sky, striped orange sun, cyan grid, scanlines, chrome title.",
        None,
    ),
    "b-roll-skills": (
        [r"\b(b-roll|broll|talking head|presenter)\b"],
        "B-roll: visuals timed to the spoken words, cut on the noun, never a still.",
        None,
    ),
    "ad-video-skills": (
        [r"\b(ad|advert|promo|product launch|sell|offer)\b"],
        "Ad: product first frame, one claim, end card with the offer, no price promises.",
        None,
    ),
    "ecommerce-video-skills": (
        [r"\b(shop|store|product demo|unboxing|buy)\b"],
        "E-commerce: product demo beats, feature callouts, end card, no invented claims.",
        None,
    ),
    # Everest components (everestchris.com/components, wired 2026-11-01).
    # One entry per catalog category, narrow multi-word triggers only, so
    # a brief pulls just the categories that fit it. All entries share
    # skills/everest-components/SKILL.md (see load_skill_text); each is
    # craft guidance only — recreate the pattern code-drawn with the
    # brief's own words and numbers, never a fake real UI, post, handle,
    # logo, or invented figure.
    "everest-product-ui": (
        [r"\b(agent cli|tool call|chat window|permission prompt|step chips|done card|desktop agent|messaging app|prompt input)\b"],
        "Everest Product UI: typed prompt, ticking tool calls, stacking step chips, done line — brief's own words only.",
        None,
    ),
    "everest-prompts-results": (
        [r"\b(prompt card|elapsed timer|failure call-out|failure callout|output builds|key phrases light|local preview|creator handle)\b"],
        "Everest Prompts & results: prompt card to staged output, elapsed timer, quiet time stamp, honest failure call-outs.",
        None,
    ),
    "everest-agents-workflows": (
        [r"\b(coordinator agent|parallel sub-agents|sub-agents|connectors|memory surface|inbox sorts|week strip|cloud task card|skill\.md card)\b"],
        "Everest Agents & workflows: real surfaces, not node diagrams — coordinator task rows ticking done, connectors switching on, memory saved then recalled.",
        None,
    ),
    "everest-models-benchmarks": (
        [r"\b(model lineup|spec picker|spec card|token chips|model versions|benchmark bars|old score|new score|delta counts)\b"],
        "Everest Models & benchmarks: bars grow, old to new score with delta counting up, spec picker with one recommended tier — numbers only from the brief.",
        None,
    ),
    "everest-comparisons": (
        [r"\b(side by side|two results|recommendation table|finish order|checklist collapses|two real app windows)\b"],
        "Everest Comparisons: two windows side by side, timers run, winner ticks and loser dims, one recommendation chip per row.",
        None,
    ),
    "everest-launch-news": (
        [r"\b(launch post|version number ticks|who gets it|official post|system card scrolls)\b"],
        "Everest Launch & news: mark, name, and version tick into place, one sentence highlighted, tiers/regions/platforms light up.",
        None,
    ),
    "everest-pricing-limits": (
        [r"\b(subscription tiers|per 1m tokens|price in/out|receipt prints|token cost|old price struck)\b"],
        "Everest Pricing & limits: the tier you need lifts, old price struck through, receipt prints tokens/minutes/tool calls/total — costs only from the brief.",
        None,
    ),
    "everest-lower-thirds": (
        [r"\b(keyword pills|corner badge|corner credit|source chip|guest name|speaker name|floating keyword)\b"],
        "Everest Lower thirds & labels: name and role slide in and settle, keyword pills near the gesture, corner source credit, inside safe areas.",
        None,
    ),
    "everest-broll-frames": (
        [r"\b(presenter inset|phone capture|punch-in|watch-page card|b-roll frame)\b"],
        "Everest B-roll frames: clean frame with a source line, presenter inset kept on screen, punch-in with a ring on the target.",
        None,
    ),
    "everest-evidence-quotes": (
        [r"\b(key phrase|reaction post|rest dims|slow push-in|key line highlighted)\b"],
        "Everest Evidence & quotes: rest dims, one line highlights with a slow push-in; posts and emails as styled cards, never fake real screenshots.",
        None,
    ),
    "everest-usage-cost": (
        [r"\b(usage bar|usage panel|limit banner|reset countdown|hits the cap)\b"],
        "Everest AI usage & cost: usage bar fills to the cap, limit banner slides in with a reset countdown — caps only from the brief.",
        None,
    ),
}

MAX_SKILL_CHARS = 4000


def route(text: str) -> dict:
    """Match skill packs against a task's title + details."""
    hay = (text or "").lower()
    matched = []
    reasons = []
    fmt = "landscape"
    for pack, (patterns, _focus, pack_fmt) in PACKS.items():
        hit = None
        for pat in patterns:
            m = re.search(pat, hay)
            if m:
                hit = m.group(0)
                break
        if hit:
            matched.append(pack)
            reasons.append(f"{pack} (matched '{hit}')")
            if pack_fmt:
                fmt = pack_fmt
    # Base craft always rides along: every clip benefits from easing /
    # safe-area / loop discipline, and it costs one short note.
    if "motion-design-skills" not in matched:
        matched.insert(0, "motion-design-skills")
        reasons.insert(0, "motion-design-skills (base craft, always on)")
    return {"skills": matched, "format": fmt, "reasons": reasons}


def load_skill_text(pack: str, max_chars: int = MAX_SKILL_CHARS) -> str:
    """Concatenate a pack's SKILL.md files, truncated. Empty if absent."""
    # Everest category packs share one reference file.
    pack_dir = SKILLS_DIR / ("everest-components" if pack.startswith("everest-") else pack)
    if not pack_dir.is_dir():
        return ""
    chunks = []
    for skill_file in sorted(pack_dir.rglob("SKILL.md")):
        try:
            chunks.append(skill_file.read_text()[:max_chars])
        except OSError:
            continue
    joined = "\n\n".join(chunks)
    return joined[: max_chars * 2]


def craft_notes(route_result: dict) -> str:
    """One-line craft focus per matched pack (no file reads needed)."""
    lines = []
    for pack in route_result["skills"]:
        focus = PACKS.get(pack, ("", "Craft guidance.", None))[1]
        lines.append(f"- {pack}: {focus}")
    if route_result["format"] == "vertical":
        lines.append("- Format: 720x1280 vertical (Vertical composition), safe areas 120px top/bottom.")
    else:
        lines.append("- Format: 1280x720 landscape (Harness composition).")
    return "\n".join(lines)
