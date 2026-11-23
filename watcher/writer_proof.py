#!/usr/bin/env python3
"""Writer proof — Motion Bot Writer stage (Video Bot).

Exercises the full Writer flow OFFLINE (no live watcher, no
Mission Control): for each of four inputs, runs write_beats (live
via the iMac) -> route(beats) -> build_storyboard(beats) -> writes
the brief JSON to briefs/ -> prints per-beat word counts,
before/after words-per-scene, the route picks, and the critic
density verdict on the storyboard (density logic called directly,
no render needed here).

Inputs:
  486 — the task-486 story, reconstructed as a task dict
        (title = hook, details = "Story: " + beat texts).
  391 — the task-391 story, reconstructed the same way.
  stat — synthetic TEST brief with real numbers, to exercise the
         stat -> chart mapping.
  sequence — synthetic TEST brief with ordered steps, to exercise
             the sequence -> explainer mapping.

Usage (from the repo root):
  python3 watcher/writer_proof.py

Exit 0 only if all four inputs produce valid beats (or a
documented fallback) with per-scene words <= 15.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPO = Path(__file__).resolve().parent.parent
BRIEFS_DIR = REPO / "briefs"

from harness_critic import check_density  # noqa: E402
from harness_director import build_explainer, build_storyboard  # noqa: E402
from harness_writer import write_beats  # noqa: E402
from phase1_router import route as phase1_route  # noqa: E402

# Fallbacks if the proof briefs are not on disk (verbatim beat
# texts from briefs/task-486-...-harness.json and
# briefs/task-391-...-harness.json).
FALLBACK_486 = {
    "title": "You are an amazing human with many gifts",
    "beats": ["He sees the messages overflowing his inbox. He tries "
              "to please everyone, but he is left deflated. Unpaid "
              "bills sit unopened, priorities are backwards. He "
              "decides to join the new Glenride council. Gives him "
              "meaning and he feels good about it."],
}
FALLBACK_391 = {
    "title": "Panels turn to face the morning",
    "beats": ["Panels turn to face the morning",
              "The grid wakes row by row",
              "Power reaches the town by noon"],
}

STAT_TASK = {
    "title": "Sales up 42% this quarter",
    "details": ("TEST — synthetic stat brief for writer proof.\n"
                "Sales rose 42% in Q2. Revenue hit $1,605 per order. "
                "Orders grew 3x since January."),
}

SEQUENCE_TASK = {
    "title": "Bake the morning loaf",
    "details": ("TEST — synthetic sequence brief for writer proof.\n"
                "First mix the flour and water. Then knead the dough "
                "until smooth. Next let it rise for one hour. Then "
                "shape the loaf and score the top. Finally bake "
                "until the crust turns gold."),
}


def load_story_task(brief_name, fallback):
    """Proof brief -> reconstructed task dict (title = hook,
    details = 'Story: ' + beat texts)."""
    path = BRIEFS_DIR / brief_name
    if path.exists():
        brief = json.loads(path.read_text())
        beats = [(b.get("text") or "") for b in
                 (brief.get("story") or {}).get("beats") or []]
        beats = [b for b in beats if b.strip()]
        if beats:
            return {"title": brief.get("hook") or fallback["title"],
                    "details": "Story: " + " | ".join(beats)}
    return {"title": fallback["title"],
            "details": "Story: " + " | ".join(fallback["beats"])}


def scene_word_counts(storyboard):
    """Words per scene, by the density rule (headline + support
    when headline is present, else words)."""
    counts = []
    for scene in storyboard.get("scenes") or []:
        if scene.get("headline"):
            counts.append(len(scene["headline"])
                          + len(scene.get("support") or []))
        else:
            counts.append(len(scene.get("words") or []))
    return counts


def run_input(name, task, out_name):
    """One proof input through the full flow. Returns True when
    the input passes (valid beats or documented fallback, and
    per-scene words <= 15)."""
    print(f"\n=== {name} ===")
    print(f"title: {task['title']!r}")
    beats, info = write_beats(task["title"], task.get("details") or "")
    if beats is None:
        print(f"writer: FALLBACK — {info.get('reason', '')}")
        print("beats: none (deterministic path)")
    else:
        print(f"writer: {info.get('model')} via {info.get('endpoint')} "
              f"(attempts: {info.get('attempts')})")
        for i, beat in enumerate(beats):
            headline_n = len((beat.get("headline") or "").split())
            support_n = len((beat.get("support") or "").split())
            print(f"  beat {i + 1}: role={beat.get('role')} "
                  f"type={beat.get('content_type')} "
                  f"headline {headline_n}w + support {support_n}w = "
                  f"{headline_n + support_n}w "
                  f"({beat.get('duration_sec')}s) "
                  f"{beat.get('headline')!r}"
                  + (f" / {beat.get('support')!r}"
                     if beat.get("support") else ""))
        print(f"beats JSON: {json.dumps(beats)}")
    # Before: the deterministic path, no beats, no route.
    before = build_storyboard(task)
    before_counts = scene_word_counts(before)
    print(f"before words-per-scene: {before_counts} "
          f"(max {max(before_counts) if before_counts else 0})")
    routed = phase1_route(task, beats=beats)
    print(f"route picks: style={routed.get('style')} "
          f"composition={routed.get('composition')} "
          f"format={routed.get('format')} "
          f"motion={routed.get('motion')} "
          f"kinetic={routed.get('kinetic')} "
          f"content_type={routed.get('content_type')} "
          f"panel={routed.get('panel')}")
    board = build_storyboard(task, route=routed, beats=beats,
                             writer_info=info)
    after_counts = scene_word_counts(board)
    print(f"after words-per-scene: {after_counts} "
          f"(max {max(after_counts) if after_counts else 0})")
    print(f"lengthSeconds: {board.get('lengthSeconds')} "
          f"(writer: {board.get('writer')})")
    if board.get("bars") is not None:
        print(f"bars: {json.dumps(board.get('bars'))}")
    density = check_density(board)
    print(f"density: {density['status']} — {density['detail']}")
    # Explainer rung check: when the route picks an explainer
    # style, the end-card scene must also pass density.
    explainer_ok = True
    if (routed.get("style") or "").startswith("explainer."):
        style = routed["style"].split(".", 1)[1]
        explainer = build_explainer(task, board, draft=True, style=style)
        if explainer:
            end_words = len(explainer["scenes"][-1]["words"])
            print(f"explainer end-card words: {end_words} "
                  f"(style {style}, {len(explainer['ideas'])} ideas)")
            explainer_ok = end_words <= 15
    out_path = BRIEFS_DIR / out_name
    out_path.write_text(json.dumps(board, indent=2) + "\n")
    print(f"brief written: {out_path}")
    density_ok = density["status"] in ("PASS", "SKIP")
    beats_ok = beats is not None or density_ok
    ok = density_ok and beats_ok and explainer_ok
    print(f"verdict: {'PASS' if ok else 'FAIL'}")
    return ok


def main():
    inputs = [
        ("486 (task-486 story)",
         load_story_task(
             "task-486-you-are-an-amazing-human-with-many-gifts-harness.json",
             FALLBACK_486),
         "writer-proof-486.json"),
        ("391 (task-391 story)",
         load_story_task(
             "task-391-panels-turn-to-face-the-morning-harness.json",
             FALLBACK_391),
         "writer-proof-391.json"),
        ("stat (synthetic TEST)",
         STAT_TASK,
         "writer-proof-stat-test.json"),
        ("sequence (synthetic TEST)",
         SEQUENCE_TASK,
         "writer-proof-sequence-test.json"),
    ]
    results = {}
    for name, task, out_name in inputs:
        try:
            results[name] = run_input(name, task, out_name)
        except Exception as e:  # noqa: BLE001 - report, don't crash
            print(f"\n=== {name} ===\nERROR: {e}")
            results[name] = False
    print("\n=== summary ===")
    for name, ok in results.items():
        print(f"  {'PASS' if ok else 'FAIL'}: {name}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
