#!/usr/bin/env python3
"""Remake slice 1 tests (2026-11-03): story intake, memory, gate, critic.

Run from the watcher dir:  python3 test_remake_slice1.py
Plain asserts, no test framework. The Episode 1 beat sheet below is
faithful to MC task 236's completionSteps (headers, narrative texts,
and header line verbatim; choreography lines trimmed — the parser
only reads headers + Narrative Text lines).

Exit 0 on all-pass, 1 on the first failure (with the failing check).
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from story_intake import (  # noqa: E402
    extract_story,
    parse_beat_sheet,
)
from harness_director import build_storyboard  # noqa: E402
from story_gate import check_story  # noqa: E402
import memory  # noqa: E402
from harness_critic import _distinctive_words  # noqa: E402

EP1_STEPS = """Compile Episode 1 of the "Anti-Slop Protocol" promotional series.
Viewport: 1080x1920 (9:16), 60fps, Total Duration: 15.0 seconds.

Execute the following interlocking beat sheet with zero deviation:

[BEAT 1: THE BAIT | 0.00s - 3.00s]
- Emotional State: APATHETIC_SLOP (Deliberate parody of bad AI bots)
- Narrative Text: "3 Secrets to 10x Your Workflow"
- DOM Choreography: Deliberately render a cliche centered flexbox layout.

[BEAT 2: THE FRACTURE | 3.00s - 7.50s]
- Emotional State: IRRITATION_GLITCH
- Narrative Text: "STOP. Look at this CSS. ease-in-out? Centered div? You can smell the template."
- DOM Choreography: Inject bright red inspector bounding boxes.

[BEAT 3: THE PURGE | 7.50s - 12.50s]
- Emotional State: CATHARSIS_IMPACT
- Narrative Text: "HTML handles the choreography. Emotional FFmpeg handles the nervous system."
- DOM Choreography: Shatter the text downward off-screen.

[BEAT 4: THE BRIDGE HOOK | 12.50s - 15.00s]
- Emotional State: CLINICAL_SUSPENSE
- Narrative Text: "> INIT_EMOTION: ANXIETY"
- DOM Choreography: Collapse all grid columns inward.
- Exit Vector: SINGLE_GREEN_PIXEL_LOCK (Frame 900 must end on this exact centered green block cursor on a #000000 canvas).
"""

EP1_DETAILS = """### ROLE & OBJECTIVE
You are an elite, deterministic Kinetic Typography engine.
STRICT ANTI-SLOP LAWS: banned easing like `0.3s` or `1s` fades.
Background: parchment, gold
"""


def check(name, cond, extra=""):
    if not cond:
        print(f"FAIL: {name} {extra}")
        sys.exit(1)
    print(f"ok: {name}")


def main():
    # 1. Beat-sheet parse (task 236, faithful).
    sheet = parse_beat_sheet(EP1_STEPS)
    check("beat sheet parses", sheet is not None)
    check("4 beats", len(sheet["beats"]) == 4, f"got {len(sheet['beats'])}")
    check("beat 1 text",
          sheet["beats"][0]["text"] == "3 Secrets to 10x Your Workflow",
          f"got {sheet['beats'][0]['text']!r}")
    check("beat 1 window",
          (sheet["beats"][0]["start"], sheet["beats"][0]["end"]) == (0.0, 3.0))
    check("beat 4 exit title", sheet["beats"][3]["title"] == "THE BRIDGE HOOK")
    check("header duration", sheet["duration"] == 15.0)
    check("header fps", sheet["fps"] == 60)
    check("header viewport", sheet["viewport"] == (1080, 1920))

    # 2. Header-only sheet is labels, not story.
    check("header-only sheet -> None",
          parse_beat_sheet("[BEAT 1: THE BAIT | 0.00s - 3.00s]\n"
                           "- Emotional State: APATHETIC_SLOP\n") is None)

    # 3. extract_story priority: beat sheet beats Story: block.
    task = {"title": "The Anatomy of Slop", "details": EP1_DETAILS,
            "completionSteps": EP1_STEPS}
    story = extract_story(task)
    check("extract source beat_sheet", story["source"] == "beat_sheet")
    check("extract 4 beats", len(story["beats"]) == 4)

    # 4. Story: block fallback.
    task2 = {"title": "A small story", "details":
             "Story: first beat happens here now | second beat turns it | "
             "third beat lands the meaning"}
    story2 = extract_story(task2)
    check("story_block source", story2["source"] == "story_block")
    check("story_block 3 beats", len(story2["beats"]) == 3)

    # 5. Storyboard: beats become scenes; 0.3s artifact must NOT win.
    board = build_storyboard(task)
    check("storyboard 4 scenes", len(board["scenes"]) == 4,
          f"got {len(board['scenes'])}")
    check("scene 1 words from beat 1",
          board["scenes"][0]["words"] ==
          ["3", "Secrets", "to", "10x", "Your", "Workflow"],
          f"got {board['scenes'][0]['words']}")
    check("length 15, not 0.3s artifact", board["lengthSeconds"] == 15,
          f"got {board['lengthSeconds']}")
    check("storyboard carries story",
          board.get("story", {}).get("source") == "beat_sheet")

    # 6. Old behavior unchanged when there is no story.
    plain = {"title": "A quiet room, slowly",
             "details": "Background: parchment, gold\nLength: 12 seconds"}
    board2 = build_storyboard(plain)
    check("plain task has no story key", "story" not in board2)
    check("plain task length 12", board2["lengthSeconds"] == 12)
    check("plain task scenes from title",
          board2["scenes"][0]["words"] == ["A", "quiet", "room,", "slowly"],
          f"got {board2['scenes'][0]['words']}")

    # 7. Gate accepts beat sheets; still fires on labels-only.
    check("gate accepts beat sheet", check_story(task) is None)
    check("gate fires on labels-only",
          check_story(plain) is not None
          and check_story(plain)["trigger"] == "missing_story")

    # 8. Memory roundtrip (tmp path; verbatim correction).
    with tempfile.TemporaryDirectory() as tmp:
        mem = str(Path(tmp) / "memory.json")
        memory.record_render(236, "The Anatomy of Slop", "beat_sheet", 4,
                             "PASS", "out/task-236.mp4", path=mem)
        memory.record_correction(
            236, "No — the green cursor must END the clip, not open it.",
            applies_to="task-236", path=mem)
        memory.record_learning("Beat-sheet tasks render 15s when the "
                               "header duration is read.", "critic", path=mem)
        data = memory.load(path=mem)
        check("memory 1 render", len(data["renders"]) == 1)
        check("correction verbatim",
              data["corrections"][0]["text"] ==
              "No — the green cursor must END the clip, not open it.")
        notes = memory.learnings_summary(path=mem)
        check("summary carries verbatim correction",
              any("END the clip, not open it" in n for n in notes))

    # 9. Critic coverage words.
    words = _distinctive_words("3 Secrets to 10x Your Workflow")
    check("distinctive words", "secrets" in words and "workflow" in words,
          f"got {words}")

    # 10. Memory wiring: the Director reads memory into storyboard notes.
    with tempfile.TemporaryDirectory() as tmp:
        mem = str(Path(tmp) / "memory.json")
        memory.record_correction(
            236, "The green cursor must END the clip, not open it.",
            applies_to="task-236", path=mem)
        old_path = memory.MEMORY_PATH
        memory.MEMORY_PATH = mem
        try:
            board3 = build_storyboard(plain)
        finally:
            memory.MEMORY_PATH = old_path
        check("storyboard carries memory note",
              any("END the clip, not open it" in n for n in board3["notes"]),
              f"got {board3['notes']}")

    print("ALL SLICE-1 TESTS PASSED")


if __name__ == "__main__":
    main()
